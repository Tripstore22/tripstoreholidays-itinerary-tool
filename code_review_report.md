# TripStore Code Review Report
**Date:** 2026-05-02
**Reviewed by:** Claude (automated daily review)
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Files listed but not found in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py (likely in local archive folder on Sumit's Mac — not tracked in this repo)

---

## Summary

| Severity  | Count | New This Review | Carried Over |
|-----------|-------|-----------------|--------------|
| CRITICAL  | 5     | 1               | 4            |
| MODERATE  | 10    | 2               | 8            |
| MINOR     | 5     | 0               | 5            |
| **TOTAL** | **20**| **3**           | **17**       |

> Issues marked ⚠️ NEW were not present or were not flagged in the previous report.

---

## CRITICAL Issues

### C1 — Plaintext passwords in Google Sheets `[Code.gs]` *(carried over)*
**Location:** `checkLogin()` line 261, `handleSignup()` line 289
Passwords are stored as plain text in the Users sheet and compared with `dbPass === pass.trim()`. A shared viewer, compromised Google account, or Apps Script log leak instantly exposes all credentials.
**Fix:** Hash with salt before storing. Minimum: `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt)` and compare hashes.

---

### C2 — No authentication on sensitive GET endpoints `[Code.gs]` *(carried over)*
**Location:** `doGet()` lines 28–40
`getAllSaved`, `getQuoteLog`, and `searchItinerary` have zero authentication. The Apps Script `/exec` URL is also committed to the public GitHub repo in `index_fit.tripstore.html` line 426. Anyone on the internet can:
- Dump all saved pax names: `?action=getAllSaved`
- Download the full quote log with pricing: `?action=getQuoteLog`
- Load any itinerary by pax name: `?action=search&name=<any-name>`

**Fix:** Add a secret token parameter validated on each call, or move sensitive actions to POST with session validation.

---

### C3 — `saveItinerary` accepts unauthenticated writes `[Code.gs]` *(carried over)*
**Location:** `doPost()` lines 52–53
A POST with `{ action: "saveItinerary", paxName: "...", payload: {...} }` will overwrite any saved itinerary with no login required. Any external caller can corrupt or delete production quotes.
**Fix:** Require a valid session token in the POST body validated against the Users sheet before writing.

---

### C4 — Admin flag stored in localStorage and trusted client-side `[index_fit.tripstore.html]` *(carried over)*
**Location:** `checkAutoLogin()` lines 641–651
The `isAdmin` flag is read directly from `localStorage`. Anyone with browser DevTools can run:
```javascript
localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:"ADMIN MODE"}));
location.reload();
```
…and immediately get full admin access (load any itinerary, see all saved quotes) with zero server verification.
**Fix:** Re-verify the session on the server during `init()` or use a signed server-side token.

---

### C5 — `checkLogin` sent as POST but doPost() doesn't handle it — LOGIN MISMATCH ⚠️ NEW `[Code.gs + index_fit.tripstore.html]`
**Location:** Frontend `checkLogin()` line 583; backend `doPost()` lines 44–57
The frontend sends login credentials as a POST request:
```javascript
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })
```
But `doPost()` only handles `"signup"` and `"saveItinerary"`. It returns `"Invalid action"` for any other action, meaning login would always show "❌ Invalid Credentials" based on the repo code.

The `checkLogin` handler exists only in `doGet()` (line 26), which handles `?action=checkLogin&user=…&pass=…` GET parameters.

**Assessment:** The live site appears to work, so the deployed Apps Script version likely has a different `doPost()` than what is in the repo. The repo is out of sync with the deployed script. This is a maintenance risk — if Code.gs is re-deployed from the repo, login will break for all users.

**Immediate action:** Open Apps Script → Code.gs in the live project → compare with repo version → sync `doPost()` to include the `checkLogin` action, OR ensure the frontend sends login as a GET request to match the deployed backend.

---

## MODERATE Issues

### M1 — Full Apps Script URL committed to public repo `[index_fit.tripstore.html]` *(carried over)*
**Location:** Line 426
`const API_URL = "https://script.google.com/macros/s/AKfycby8KK3...exec";`
The deployment URL is hard-coded in a file committed to a public GitHub repo. Combined with the unauthenticated endpoints in C2, any person who finds this repo can extract and abuse the API. The URL cannot be easily rotated without re-deploying the app.
**Fix:** Do not commit the production URL. Use a config file excluded from git, or at minimum rotate the deployment URL and add authentication first (C2 fix).

---

### M2 — `callClaudeAPI()` has unsafe response parsing `[Pipeline.gs]` *(carried over)*
**Location:** Lines 585–587
```javascript
const responseData = JSON.parse(response.getContentText());
const text = responseData.content[0].text;
```
If the Anthropic API returns a rate-limit error (429), overload response (529), or a non-text content block, `content[0].text` will throw and mark all rows in the batch as ERROR. There is also no handling for malformed JSON from Claude (e.g., if Claude wraps the array in markdown despite the prompt instruction).
**Fix:** Add a guard: `if (!responseData.content?.[0]?.text) throw new Error('Unexpected Claude response shape');` and strip markdown more robustly with a regex that captures content between `[` and `]` if the ` ```json ` strip fails.

---

### M3 — No execution-time guard in batch processor `[Pipeline.gs]` *(carried over)*
**Location:** `processSheet()` lines 224–255
Apps Script has a hard 6-minute execution limit. If there are many pending rows across all 4 sheets, `runMidnightEnrichment()` can be killed mid-batch, leaving some INPUT rows permanently stuck in an ambiguous state (partially written master sheet, status not updated).
**Fix:** Add a start-time check inside the batch loop: `if ((new Date() - start) > 300000) { auditLog(ss, 'TIMEOUT — will continue next run'); break; }` (5-minute soft limit leaves 1 minute for cleanup and email).

---

### M4 — Hardcoded EUR→INR exchange rate is stale `[Pipeline.gs]` ⚠️ NEW
**Location:** `enrichTrains()` prompt, line 463
```
"INR price at ₹110/€"
```
The current EUR/INR rate is approximately ₹93–97 (as of mid-2026). The prompt instructs Claude to convert European rail prices at ₹110/€, causing all newly enriched train prices to be **12–17% overestimated**. This inflates quotes for routes where Claude back-calculates INR from EUR data.
**Fix:** Either update the rate to a current value and add a comment noting the last update date, or store it as a `CFG.EUR_INR_RATE` constant so it is easy to update in one place without searching the prompt.

---

### M5 — `logQuote()` recursive retry is fragile `[Quote_Intelligence.gs]` *(carried over)*
**Location:** `logQuote()` lines 32–47
If `Quote_Log` sheet is missing, `logQuote()` calls `setupQuoteLog()` then recursively calls itself. If `setupQuoteLog()` fails or the sheet is not immediately available (a known Apps Script eventual-consistency issue), this creates an uncontrolled recursive call. The outer `try/catch` would catch it, but the save operation completes with no log entry and no warning to the operator.
**Fix:** Remove the recursive call. After `setupQuoteLog()`, re-fetch the sheet and append directly rather than re-entering `logQuote()`.

---

### M6 — `SPREADSHEET_ID` hardcoded in Python scripts `[write_to_sheets.py, archive_to_input.py]` *(carried over)*
**Location:** `write_to_sheets.py` line 28; `archive_to_input.py` line 32
Both scripts hard-code the production Spreadsheet ID. If someone forks the repo or the sheet is migrated, the wrong sheet will be written to silently.
**Fix:** Read from an environment variable: `SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID") or "1U3f6Ph..."` with a loud warning if the env var is absent.

---

### M7 — `ws.row_count == 0` check is unreliable `[write_to_sheets.py]` *(carried over)*
**Location:** Line 168
```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```
`gspread`'s `row_count` returns the sheet's *allocated* row capacity (default 1000), not the number of rows with data. This condition is always `False` on the first part (`row_count == 0`). The script only works because of the second clause (`not ws.get_all_values()`), but this redundancy is misleading and could break if refactored.
**Fix:** Remove the dead `ws.row_count == 0` check. Use only `not ws.get_all_values()`.

---

### M8 — Brittle pipe-delimited cell parsers with no error recovery `[archive_to_input.py]` *(carried over)*
**Location:** `parse_hotels_cell()` line 70, `parse_sightseeing_cell()` line 87, `parse_trains_cell()` line 103, `parse_transfers_cell()` line 143
All parsers assume a strict pipe-delimited structure with a fixed field count per entry (4-field hotels, 3-field sightseeing, 2-field trains/transfers). Any archive row with an extra `|` in a hotel name, a missing cost field, or whitespace variance silently skips or misaligns all subsequent entries in that cell.
**Fix:** Add field-count validation per entry and a per-row error counter. Log skipped entries with row index and raw cell value so data gaps can be investigated.

---

### M9 — Server error details leaked to frontend `[Code.gs]` *(carried over)*
**Location:** `doGet()` line 39, `doPost()` line 57
```javascript
return ContentService.createTextOutput('Server Error: ' + err.message);
```
Stack traces and internal error messages from Apps Script (sheet names, property keys, formula errors) are returned verbatim to the browser. This reveals internal implementation details to any caller.
**Fix:** Log the full error internally (`Logger.log(err.stack)`) and return a generic `"Something went wrong. Try again."` message to the client.

---

### M10 — `sendSummaryEmail` fails silently with no audit trail `[Pipeline.gs]` *(carried over)*
**Location:** Lines 673–674
```javascript
const email = PropertiesService.getScriptProperties().getProperty('SUMMARY_EMAIL');
if (!email) return;
```
If `SUMMARY_EMAIL` is not set (e.g., after a script property reset), the pipeline runs, enriches data, and completes — but Sumit receives no notification and has no way to know whether it ran or what it did that night.
**Fix:** `auditLog(ss, 'WARNING: SUMMARY_EMAIL not configured — no email sent');` before the early return.

---

## MINOR Issues

### N1 — Quote ID collision risk within a 27-hour window `[Quote_Intelligence.gs]`
**Location:** Line 139
```javascript
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```
`getTime()` returns milliseconds since epoch. The last 8 digits roll over every ~27.8 hours (~100,000 seconds). Two quotes saved at `T+0` and `T+100,001s` will produce the same Quote ID. On a busy day with many agents, intra-day collisions are also possible (same millisecond saves from concurrent sessions).
**Fix:** Use a full timestamp or a UUID approach: `'Q-' + new Date().getTime()` (13 digits) or `Utilities.getUuid().slice(0, 8).toUpperCase()`.

---

### N2 — `logQuote` is an invisible cross-file dependency `[Code.gs]`
**Location:** `saveItinerary()` lines 356, 363
`logQuote()` is called from Code.gs but defined only in Quote_Intelligence.gs. If Quote_Intelligence.gs is accidentally removed or not deployed alongside Code.gs, `logQuote` throws a `ReferenceError` at runtime, which is silently caught. There is no warning that quote logging has stopped.
**Fix:** Add a comment in Code.gs: `// logQuote() is defined in Quote_Intelligence.gs — both files must be present in this Apps Script project.`

---

### N3 — City and hotel names injected into innerHTML without sanitization `[index_fit.tripstore.html]`
**Location:** `renderRouteInputs()` line 842, `renderTables()` line ~1287
City names and hotel names from master data are interpolated directly into `innerHTML` template strings (e.g., `<b>${r.city}</b>`). If a city name in Google Sheets contains `<`, `>`, or `"` characters (e.g., a data entry error), it will cause visible UI corruption.
**Fix:** Use `document.createTextNode()` or a simple escape function: `const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');`

---

### N4 — No retry logic in Python scripts for transient Google Sheets API failures `[write_to_sheets.py, archive_to_input.py]`
**Location:** `main()` in both files
Both scripts make multiple `gspread` API calls with no retry on 503/429 responses. Google Sheets API frequently returns transient errors, especially on `append_rows()` with large payloads. A failure partway through silently leaves the sheet in a partially-written state.
**Fix:** Wrap `append_rows()` calls with a simple exponential-backoff retry (3 attempts, 2s/4s/8s delays).

---

### N5 — `parse_transfers_cell` airport keyword list is hardcoded and will silently miss new cities `[archive_to_input.py]`
**Location:** Lines 155–160
The city-extraction heuristic splits on a hardcoded list of airport keywords: `cdg`, `lhr`, `ams`, `fra`, `vie`, `bcn`, `fco`. Any archive entry for a city not in this list (e.g., `MXP` for Milan, `ZRH` for Zurich, `CPH` for Copenhagen) will fail to extract the city name, resulting in the city field being filled with the full `from_loc` string or just the first word.
**Fix:** Extend the keyword list to include common European airport codes, or use a regex that matches any 3-letter uppercase airport code pattern: `r'\s+[A-Z]{3}\b'`.

---

## Action Items (Prioritised)

| # | Action | File | Urgency |
|---|--------|------|---------|
| 1 | Compare deployed doPost() with repo and sync (C5 — login mismatch) | Code.gs | **TODAY** |
| 2 | Add checkLogin to doPost() or change frontend to GET (C5) | Code.gs / index_fit.tripstore.html | **TODAY** |
| 3 | Update EUR→INR rate from ₹110 to current rate ~₹95 (M4) | Pipeline.gs | This week |
| 4 | Add server-side session validation; stop trusting localStorage isAdmin (C4) | Code.gs + frontend | This week |
| 5 | Hash passwords before storing in Users sheet (C1) | Code.gs | This sprint |
| 6 | Add auth token to sensitive GET endpoints (C2, C3) | Code.gs | This sprint |
| 7 | Add execution time guard to processSheet() (M3) | Pipeline.gs | This sprint |
| 8 | Fix unsafe Claude response parsing in callClaudeAPI() (M2) | Pipeline.gs | This sprint |
| 9 | Remove hardcoded SPREADSHEET_ID — use env var (M6) | Python scripts | Next sprint |
| 10 | Fix ws.row_count check (M7) | write_to_sheets.py | Low |

---

*Generated by automated daily code review — 2026-05-02*
*TripStore Enrichment Pipeline v2.1 | fit.tripstoreholidays.com*
