# TripStore Daily Code Review — 2026-06-13

**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Files listed but absent from repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| MODERATE | 5 |
| MINOR    | 5 |
| **Total**| **12** |

---

## CRITICAL

### C1 — Login is broken: `checkLogin` routed as POST but `doPost` doesn't handle it
**Files:** `index_fit.tripstore.html:583` + `Code.gs:43–57`

The frontend sends login credentials via HTTP POST:
```javascript
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })
```
But `doPost()` in Code.gs only handles `"signup"` and `"saveItinerary"`. It falls through to:
```javascript
return ContentService.createTextOutput('Invalid action');
```
The frontend receives `"Invalid action"`, which is not `"ADMIN"`, `"USER"`, or `"PENDING_APPROVAL"`, so it always displays **"Invalid Credentials"**.

Login will permanently fail for every user unless the deployed Apps Script is running a different (older) version than the repo. Any re-deployment of Code.gs as-is will lock all users out.

**Fix:** Add the missing handler to `doPost`:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### C2 — Passwords stored and compared in plaintext
**Files:** `Code.gs:261`, `Code.gs:289`

User passwords are saved directly to the Google Sheet:
```javascript
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...]);
```
And compared with plain string equality:
```javascript
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) {
```
Anyone with read access to the Google Sheet can see all user passwords. If the sheet is shared with anyone (team members, contractors), this is a full credential exposure.

**Fix:** Hash passwords before storage using a one-way hash. Apps Script has no built-in bcrypt, but `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` provides at minimum a SHA-256 hash. Store and compare hashes only. Never store plaintext passwords.

---

## MODERATE

### M1 — GST 0% silently defaults to 5% due to falsy check
**File:** `Quote_Intelligence.gs:119`

```javascript
const gstPct = d.gst || 5;
```
If an itinerary is built with `gst: 0` (e.g. a service explicitly marked as GST-exempt), the `||` short-circuit treats `0` as falsy and applies 5% GST instead. This silently inflates the quoted price.

**Fix:**
```javascript
const gstPct = d.gst != null ? Number(d.gst) : 5;
```

---

### M2 — `logQuote` can recurse if `setupQuoteLog()` fails to create the sheet
**File:** `Quote_Intelligence.gs:33–37`

```javascript
if (!logSheet) {
  setupQuoteLog();
  return logQuote(paxName, data); // retry
}
```
If `setupQuoteLog()` throws or creates the sheet under a slightly different name (e.g. trailing space), `getSheetByName('Quote_Log')` returns null again and the function recurses indefinitely. Apps Script will hit the stack limit and throw, which also corrupts the response from `saveItinerary` since `logQuote` is called inline.

**Fix:** Guard the recursion:
```javascript
if (!logSheet) {
  setupQuoteLog();
  const retrySheet = ss.getSheetByName('Quote_Log');
  if (!retrySheet) { Logger.log('Quote_Log still missing after setup — skipping log'); return; }
  // proceed with retrySheet
}
```

---

### M3 — Pipeline risks hitting Apps Script's 6-minute execution limit
**File:** `Pipeline.gs:224–253` (`processSheet` loop)

Each Claude API call takes 2–5 seconds. With `BATCH_SIZE = 5` and `Utilities.sleep(1500)` between batches, 20 new rows require 4+ batches x ~6 seconds = 24+ seconds. With 100+ pending rows (possible after a bulk archive import), the pipeline will be killed mid-run. Partially written rows remain as PENDING and get reprocessed, potentially calling Claude for the same rows multiple times (wasted API cost + duplicates).

**Fix:** Track elapsed time and stop gracefully before the limit:
```javascript
const DEADLINE_MS = 5 * 60 * 1000;
const startTime = Date.now();
for (let i = 0; i < toEnrich.length; i += CFG.BATCH_SIZE) {
  if (Date.now() - startTime > DEADLINE_MS) {
    auditLog(ss, `Deadline reached — ${toEnrich.length - i} rows deferred to next run`);
    break;
  }
  // existing batch logic...
}
```

---

### M4 — `callClaudeAPI` does not guard against unexpected response structures
**File:** `Pipeline.gs:586`

```javascript
const text = responseData.content[0].text;
```
If Claude returns a 200 response without `content[0]` (e.g. `stop_reason: "max_tokens"` with empty content, or an error payload that returns HTTP 200), this throws a `TypeError`. The catch block then marks all rows in the batch as `"Claude API error"` with a misleading message that hides the real cause.

**Fix:**
```javascript
const text = responseData?.content?.[0]?.text;
if (!text) throw new Error(`Unexpected API response: ${JSON.stringify(responseData).slice(0, 200)}`);
```

---

### M5 — `innerHTML` built from Google Sheet data without sanitization
**File:** `index_fit.tripstore.html:686, 841, 1821, 2112, 2215`

Multiple places inject Google Sheet data directly into the DOM via `innerHTML`:
```javascript
document.getElementById('cityList').innerHTML = cities.map(c => `<option value="${c}">`).join('');
list.innerHTML = results.map(s => `...<div>${s.info}</div>...`).join('');
```
If an attacker gains write access to the Google Sheet and injects `"><script>malicious()</script>` into a city or tour name, it executes in every logged-in agent's browser. This is a stored XSS vector.

**Fix:** Escape dynamic values before inserting into HTML strings:
```javascript
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// then: `<option value="${esc(c)}">` etc.
```

---

## MINOR

### N1 — `doGet checkLogin` would expose credentials in URL and server logs
**File:** `Code.gs:26`

`checkLogin` in `doGet` reads credentials from URL query parameters (`e.parameter.user`, `e.parameter.pass`). If anything calls login as a GET request (a test, fallback, or future change), the password appears in the URL and is written to Apps Script execution logs permanently.

**Fix:** As part of C1 remediation, move login entirely to POST-body handling and remove the GET handler for credentials.

---

### N2 — No login rate-limiting or brute-force protection
**File:** `Code.gs:249–268`

`checkLogin` performs no request counting, account lockout, or artificial delay. A script can attempt thousands of password combinations against any username without throttling.

**Fix (minimal):** Add `Utilities.sleep(500)` on every login call, and log failed attempts to the sheet for admin visibility.

---

### N3 — `ws.row_count == 0` is always False on Google Sheets
**File:** `write_to_sheets.py:168`

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```
`ws.row_count` in gspread returns the sheet's row *dimension* (default 1000), not the data count. It is never 0. The condition works only because of the `or not ws.get_all_values()` guard — the first clause is dead code.

**Fix:**
```python
sheet_is_empty = not ws.get_all_values()
```

---

### N4 — Hardcoded Spreadsheet IDs and credential paths
**Files:** `write_to_sheets.py:28`, `archive_to_input.py:32`

```python
SPREADSHEET_ID   = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
CREDENTIALS_PATH = Path("./sheets-credentials.json")
```
Running against a staging sheet or from a different working directory requires editing source code.

**Fix:** Replace with `os.environ.get("SPREADSHEET_ID")` and `os.environ.get("CREDENTIALS_PATH", "./sheets-credentials.json")`.

---

### N5 — 7 review-listed files absent from the repository
The following files were listed in the review checklist but do not exist in the repo:
- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

If these are in active use (run locally from the Desktop), they should be committed to the repo for version control and backup. If retired, note that in a CHANGELOG.

---

## Action Items (Priority Order)

1. **[C1 — URGENT]** Add `checkLogin` handler inside `doPost` in Code.gs and re-deploy the Apps Script — without this, login will break on the next redeploy.
2. **[C2 — URGENT]** Hash passwords before storage (`handleSignup`) and before comparison (`checkLogin`). Use `Utilities.computeDigest(SHA_256, password)` at minimum.
3. **[M1]** Fix `d.gst || 5` falsy bug in Quote_Intelligence.gs line 119.
4. **[M2]** Guard `logQuote` recursion against infinite loop in Quote_Intelligence.gs.
5. **[M3]** Add deadline guard to `processSheet` loop in Pipeline.gs.
6. **[M4]** Add null-check on `responseData.content[0]` in `callClaudeAPI`.
7. **[M5]** Escape all Google Sheet data before injecting into `innerHTML`.
8. **[N3]** Remove dead `ws.row_count == 0` check in write_to_sheets.py.
9. **[N4]** Replace hardcoded Spreadsheet IDs with environment variables.
10. **[N5]** Commit missing Python scripts to the repo or document their retirement.

---

*Generated automatically — 2026-06-13*
