# TripStore Code Review Report
**Date:** 2026-06-12  
**Reviewer:** Automated Daily Review  
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Files NOT Found (likely in separate archive repo):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 4 |
| 🟠 MODERATE | 12 |
| 🟡 MINOR | 7 |
| **Total** | **23** |

---

## 🔴 CRITICAL Issues

---

### C1 — Login handler routing mismatch (Code.gs + index_fit.tripstore.html)
**File:** Code.gs line 25–26 | index_fit.tripstore.html line 583  
**Risk:** Login is broken if Code.gs is redeployed in its current state.

The frontend sends `checkLogin` as a **POST** request:
```js
// index_fit.tripstore.html line 583
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But Code.gs only handles `checkLogin` inside `doGet` (line 25–26), not `doPost`. The `doPost` function has no `checkLogin` branch and falls through to `return ContentService.createTextOutput('Invalid action')`. This would display as "❌ Invalid Credentials" to every user.

The currently deployed Apps Script may differ from the file (SESSIONS.md notes a pending re-deploy), but deploying the current Code.gs as-is will lock out all users.

**Fix:** Add `checkLogin` to `doPost` in Code.gs:
```js
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```
Remove it from `doGet` entirely (credentials must not travel as URL parameters).

---

### C2 — Plaintext passwords stored in Google Sheets
**File:** Code.gs line 261, 289  
**Risk:** Anyone with read access to the "Users" Google Sheet can see all user passwords in plain text.

```js
// Code.gs line 289 — storage
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...]);

// Code.gs line 261 — comparison
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) {
```

No hashing, no salting.

**Fix:** Hash passwords before storage. For Apps Script, use SHA-256 via `Utilities.computeDigest()`. Store the hash; compare hash of input against stored hash at login time.

---

### C3 — GST always calculated as 5% in Quote_Log regardless of user selection
**File:** Quote_Intelligence.gs line 119  
**Risk:** All Quote_Log financial records have systematically wrong GST amounts. Any analytics built on this data are incorrect.

```js
// Quote_Intelligence.gs line 119
const gstPct = d.gst || 5;
```

The frontend saves `gstMode: "5pkg" | "18svc" | "none"` (a string) in the payload — not a numeric `d.gst` field. So `d.gst` is always `undefined`, and `gstPct` is always `5`, regardless of whether the user selected "18% Service Charge" or "No GST".

**Fix:**
```js
let gstPct = 0;
const gstMode = d.gstMode || 'none';
if      (gstMode === '5pkg')  gstPct = 5;
else if (gstMode === '18svc') gstPct = 18;
```

---

### C4 — Login credentials exposed as URL parameters in doGet branch
**File:** Code.gs line 25–26  
**Risk:** If the frontend is ever switched back to GET for login, credentials appear in server logs, browser history, and referrer headers.

```js
// Code.gs line 25-26 — credentials as GET query params
if (action === 'checkLogin') {
  return checkLogin(e.parameter.user || '', e.parameter.pass || '');
}
```

**Fix:** Remove the `checkLogin` handler from `doGet` entirely (see C1 fix). Login must only ever travel in a POST request body.

---

## 🟠 MODERATE Issues

---

### M1 — saveItinerary() always shows success toast regardless of server response
**File:** index_fit.tripstore.html line 720–721  

```js
await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
showToast("Saved Successfully");  // fires even if server returned an error
```

The fetch response is never inspected. A network timeout, sheet quota error, or Apps Script exception causes the success toast to fire anyway — the user believes their itinerary was saved when it was not.

**Fix:**
```js
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
const text = await res.text();
if (!text.includes("Successfully")) throw new Error(text);
showToast("Saved Successfully");
```

---

### M2 — setupQuoteLog() destroys all existing data with ws.clear()
**File:** Quote_Intelligence.gs line 196  

```js
function setupQuoteLog() {
  ...
  ws.clear();  // wipes all rows if run again
```

If anyone runs `setupQuoteLog()` on a live sheet (e.g., to refresh headers), all historical quote log data is permanently deleted with no warning or confirmation prompt.

**Fix:** Add a guard before clearing:
```js
const existing = ws.getLastRow();
if (existing > 1) {
  SpreadsheetApp.getUi().alert(existing - 1 + ' existing quote rows found. Backup first — run aborted.');
  return;
}
```

---

### M3 — _buildInputSheet() adds duplicate info banner rows on every setupSheets() run
**File:** Pipeline.gs line 777  

```js
ws.insertRowBefore(2);  // always inserts, no check if banner already exists
```

Re-running `setupSheets()` inserts a new banner row above row 2 every time. This pushes data rows down and breaks the `getPendingRows()` function which assumes data starts at row 3 (skipping rows 1 and 2 only).

**Fix:** Check if row 2 already contains the banner before inserting:
```js
const row2 = (ws.getRange(2, 1).getValue() || '').toString();
if (!row2.includes('ℹ️')) {
  ws.insertRowBefore(2);
  // ... style and set value
}
```

---

### M4 — callClaudeAPI error fallback uses Array.fill() with a shared object reference
**File:** Pipeline.gs line 593–596  

```js
return Array(expectedCount).fill({
  valid: false,
  error_reason: `Claude API error — will retry next run: ${e.message}`,
});
```

`Array.fill()` places the **same object reference** in every array slot. If downstream code mutates any property on one element, all elements change simultaneously — a subtle, hard-to-trace bug.

**Fix:**
```js
return Array.from({ length: expectedCount }, () => ({
  valid: false,
  error_reason: `Claude API error — will retry next run: ${e.message}`,
}));
```

---

### M5 — sendSummaryEmail() has no error handling
**File:** Pipeline.gs line 708  

```js
GmailApp.sendEmail(email, subject, body);
```

No try/catch. A Gmail quota exceeded error or invalid email address throws an unhandled exception at the very end of `runMidnightEnrichment()`. The final audit log entry (`PIPELINE COMPLETE`) never gets written, making it impossible to tell from logs whether the pipeline actually finished.

**Fix:**
```js
try { GmailApp.sendEmail(email, subject, body); }
catch (e) { auditLog(ss, 'Email send failed: ' + e.message); }
```

---

### M6 — No Apps Script 6-minute execution time guard on large batches
**File:** Pipeline.gs (runMidnightEnrichment / processSheet)  

Apps Script has a hard 6-minute execution limit. With 4 data types × multiple batches × 1.5s sleep per batch, a large pending queue (100+ rows) can time out mid-batch. This leaves partially-committed data in master sheets with no way to know which batch was the last to succeed.

**Fix:** Add an elapsed-time check inside the batch loop:
```js
const DEADLINE_MS = 5 * 60 * 1000;
const loopStart = new Date();
for (let i = 0; i < toEnrich.length; i += CFG.BATCH_SIZE) {
  if (new Date() - loopStart > DEADLINE_MS) {
    auditLog(ss, 'TIMEOUT GUARD: stopping at batch ' + i + ' to avoid execution limit');
    break;
  }
  // ... existing batch code
}
```

---

### M7 — localStorage session never expires
**File:** index_fit.tripstore.html line 641–652  

Sessions are stored without an expiry timestamp. A user whose account is suspended or downgraded from ADMIN to USER remains logged in with their old privileges indefinitely — until they manually log out or clear browser storage.

**Fix:** Store a login timestamp and reject sessions older than a threshold:
```js
// At login:
session.loginTime = Date.now();
localStorage.setItem("tripstore_session", JSON.stringify(session));

// At checkAutoLogin:
if (Date.now() - s.loginTime > 7 * 24 * 3600 * 1000) {
  localStorage.removeItem("tripstore_session");
  return;
}
```

---

### M8 — ws.row_count == 0 check for empty sheet is unreliable (write_to_sheets.py)
**File:** write_to_sheets.py line 168  

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```

`ws.row_count` in gspread returns the allocated grid size (default 1000 for a new sheet), never 0. The `ws.row_count == 0` branch is dead code. The `not ws.get_all_values()` part works correctly, but it means `get_all_values()` is called twice (here, then again in `build_existing_keys`), wasting API quota.

**Fix:** Fetch once and reuse:
```python
all_values = ws.get_all_values()
sheet_is_empty = not all_values
existing_keys = build_existing_keys_from_values(all_values, headers)
```

---

### M9 — value_input_option="USER_ENTERED" allows formula injection in both Python scripts
**File:** write_to_sheets.py line 196 | archive_to_input.py line 390  

```python
ws.append_rows(new_rows, value_input_option="USER_ENTERED")
```

`USER_ENTERED` tells Google Sheets to interpret values as if a user typed them. Any value starting with `=` (e.g., from a supplier note like `=IMPORTDATA(...)`) will be executed as a formula. Archive CSV data may contain such strings.

**Fix:** Use `value_input_option="RAW"` for all data rows. Only use `USER_ENTERED` when formula evaluation is intentionally needed.

---

### M10 — Archive cell parsers silently misalign on malformed input
**File:** archive_to_input.py lines 63–171  

All four parsers read pipe-delimited cells by slicing fixed-width field groups (hotels: 4 fields, sightseeing: 3, trains: 2, transfers: 2). A single extra or missing pipe causes silent field-shifting — a hotel's city value lands in the name slot of the next hotel, and so on. There is no validation that parsed fields are plausible (e.g., city is a non-empty string, cost is numeric). Misaligned rows produce junk INPUT rows that Claude rejects as errors.

**Fix:** Add per-entry validation before appending:
```python
# Hotels example
if city and name and len(city) >= 2 and len(name) >= 3:
    result.append({"city": city, "name": name, "cost_inr": cost})
```

---

### M11 — No retry logic in Python scripts for API failures
**File:** write_to_sheets.py, archive_to_input.py  

Both scripts make multiple Google Sheets API calls with no retry handling. A transient 429 (rate limit) or 503 (service unavailable) response crashes the run, potentially leaving only some INPUT tabs written and others untouched — with no log of which succeeded.

**Fix:** Wrap API calls with exponential backoff (the `tenacity` library is lightweight):
```python
from tenacity import retry, wait_exponential, stop_after_attempt

@retry(wait=wait_exponential(min=2, max=30), stop=stop_after_attempt(4))
def safe_append(ws, rows):
    ws.append_rows(rows, value_input_option="RAW")
```

---

### M12 — Inter-city transfer city matching uses substring, causing false matches
**File:** index_fit.tripstore.html line 1220–1226  

```js
dbCity.includes(fromC.toLowerCase())
```

This matches any city whose name contains `fromC` as a substring. Short city names (e.g., "Nice", "Rome", "Oman") will match unintended records. "Nice" matches "Venice", "Nice-Côte d'Azur", etc. The wrong transfer pricing is silently applied to the quote.

**Fix:** Use exact equality only:
```js
dbCity === fromC.toLowerCase()
```

---

## 🟡 MINOR Issues

---

### N1 — headers variable read but never used in getQuoteLog()
**File:** Code.gs line 380  
`const headers = rows[0];` is assigned but never used in the `.map()` below. Dead code.

---

### N2 — quoteId not guaranteed unique
**File:** Quote_Intelligence.gs line 140  
`'Q-' + new Date().getTime().toString().slice(-8)` — two `logQuote()` calls within the same millisecond produce identical IDs. Very low probability but non-zero if bulk operations trigger simultaneous saves.

---

### N3 — setupSheets() may throw on row operations on a single-row sheet
**File:** Pipeline.gs line 777  
`ws.insertRowBefore(2)` will throw if the sheet was just created and has only one row. Test with a freshly created spreadsheet before running in production.

---

### N4 — Budget range constants will go stale
**File:** index_fit.tripstore.html lines 782–784  
```js
const BUDGET_RANGES = { hotel: { low: 2500, high: 7500 }, land: { low: 1200, high: 2800 } };
```
These are hardcoded INR rates that will become stale as prices change. Consider loading them as a config row from the Google Sheet alongside `masterData` so Sumit can update them without a code push.

---

### N5 — _titleCase() uses deprecated substr()
**File:** Quote_Intelligence.gs line 315  
`t.substr(1).toLowerCase()` — `substr` is deprecated in modern JS. Replace with `t.slice(1).toLowerCase()`.

---

### N6 — SPREADSHEET_ID hardcoded in both Python scripts
**File:** write_to_sheets.py line 29 | archive_to_input.py line 30  
Switching the target spreadsheet requires editing source code. Move to an environment variable or a `.env` file excluded from version control.

---

### N7 — Trains and Transfers data quality not yet reviewed
**File:** N/A (data quality, noted in SESSIONS.md)  
The optimizer silently falls back to `price: 0` and `mode: "TBD"` when no match is found in master data. Users receive quotes with missing cost components and no indication that data is incomplete. At minimum, show a visible warning in the UI when a TBD leg is included in the quote.

---

## Action Items (Priority Order)

| # | Action | Severity | File |
|---|--------|----------|------|
| 1 | Add `checkLogin` to `doPost`; remove from `doGet` | CRITICAL | Code.gs |
| 2 | Hash passwords with SHA-256 before storing | CRITICAL | Code.gs |
| 3 | Fix GST calculation in logQuote() to read `gstMode` string | CRITICAL | Quote_Intelligence.gs |
| 4 | Add response check to saveItinerary() in frontend | MODERATE | index_fit.tripstore.html |
| 5 | Add guard to setupQuoteLog() before ws.clear() | MODERATE | Quote_Intelligence.gs |
| 6 | Add execution time guard to Pipeline.gs batch loop | MODERATE | Pipeline.gs |
| 7 | Fix Array.fill() → Array.from() in callClaudeAPI error handler | MODERATE | Pipeline.gs |
| 8 | Add try/catch around GmailApp.sendEmail in sendSummaryEmail | MODERATE | Pipeline.gs |
| 9 | Fix _buildInputSheet() to not duplicate banner row on re-run | MODERATE | Pipeline.gs |
| 10 | Add session expiry timestamp to localStorage | MODERATE | index_fit.tripstore.html |
| 11 | Change value_input_option to "RAW" in both Python scripts | MODERATE | write_to_sheets.py, archive_to_input.py |
| 12 | Add input validation to archive cell parsers | MODERATE | archive_to_input.py |
| 13 | Fix ws.row_count check to use get_all_values() result | MODERATE | write_to_sheets.py |
| 14 | Fix inter-city transfer city matching to exact equality | MODERATE | index_fit.tripstore.html |
| 15 | Add retry logic to Python scripts for API calls | MODERATE | write_to_sheets.py, archive_to_input.py |

---

*Report generated automatically on 2026-06-12. 7 files from the task list were not found in this repository — they likely reside in the tripstore-itinerary-archive repo.*
