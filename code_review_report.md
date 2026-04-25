# TripStore Code Review Report
**Date:** 2026-04-25
**Reviewed by:** Claude (automated daily review)
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py
**Files listed but not found in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py (likely in local archive folder on Sumit's Mac)

---

## Summary

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 6     |
| MODERATE  | 12    |
| MINOR     | 8     |
| **TOTAL** | **26**|

---

## CRITICAL Issues

### C1 — Plaintext passwords in Google Sheets `[Code.gs]`
**Location:** `checkLogin()` line 261, `handleSignup()` line 289
Passwords are stored as plain text in the Users sheet and compared directly with `dbPass === pass.trim()`. If anyone gains read access to the spreadsheet (a shared viewer, a compromised account, or an Apps Script error log), all user credentials are immediately exposed with no protection.
**Fix:** Hash passwords with a salt before storing. Minimum: use SHA-256 via `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)`.

---

### C2 — No authentication on sensitive GET endpoints `[Code.gs]`
**Location:** `doGet()` lines 28–40
`getAllSaved`, `getQuoteLog`, and `searchItinerary` have zero authentication. Anyone who knows (or guesses) the Apps Script `/exec` URL can:
- Dump all saved pax names: `?action=getAllSaved`
- Download the full quote log with all pricing: `?action=getQuoteLog`
- Load any itinerary JSON by pax name: `?action=search&name=Sharma`

The URL is also hardcoded (visible) in the public GitHub repo (index_fit.tripstore.html line 426).
**Fix:** Add a token or key parameter to sensitive endpoints, or move them to POST with a validated session token.

---

### C3 — `saveItinerary` has no authentication `[Code.gs]`
**Location:** `doPost()` lines 52–53
A POST with `{ action: "saveItinerary", paxName: "...", payload: {...} }` will overwrite any saved itinerary with no login required. Any external caller can corrupt or delete production quotes.
**Fix:** Require a valid session token in the POST body and validate it against the Users sheet before writing.

---

### C4 — Admin role stored in localStorage and trusted without server verification `[index_fit.tripstore.html]`
**Location:** `checkAutoLogin()` lines 641–651
The `isAdmin` flag is read directly from `localStorage`. Anyone can open browser DevTools and run:
```javascript
localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:"ADMIN MODE"}))
```
This instantly grants full admin UI access (admin panel, ability to load any saved quote) without knowing any credentials.
**Fix:** Re-verify role with a backend call on session restore, or add a server-issued signed token that cannot be forged client-side.

---

### C5 — Infinite recursion risk in `logQuote` `[Quote_Intelligence.gs]`
**Location:** `logQuote()` lines 29–37
If `setupQuoteLog()` creates the sheet but `ss.getSheetByName('Quote_Log')` still returns null on the retry (Apps Script cache miss, renamed sheet, etc.), the function calls itself infinitely until a stack overflow. Because `logQuote` is called inside `saveItinerary`, this would crash the save operation for the user.
**Fix:** Add a guard flag before recursing:
```javascript
function logQuote(paxName, data, _isRetry) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('Quote_Log');
  if (!logSheet) {
    if (_isRetry) { Logger.log('Quote_Log still missing after setup'); return; }
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
  // ...
}
```

---

### C6 — `sheet_is_empty` check always false in write_to_sheets.py `[write_to_sheets.py]`
**Location:** `main()` line 168
```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```
`ws.row_count` is the total allocated rows in gspread (default 1000), not the count of populated rows. An empty new sheet has `row_count = 1000`, so this condition is **always False**. The header row and its formatting are **never written** to a new sheet created by this script. All data is appended with no header.
**Fix:**
```python
existing_data = ws.get_all_values()
sheet_is_empty = len(existing_data) == 0
```

---

## MODERATE Issues

### M1 — checkLogin routing mismatch: POST frontend vs GET backend `[Code.gs + index_fit.tripstore.html]`
**Location:** `doPost()` Code.gs line 43; `checkLogin()` HTML line 583
The frontend sends login credentials via POST with a JSON body. The backend handles `checkLogin` only in `doGet()` using URL query parameters (`e.parameter.user`, `e.parameter.pass`). `doPost()` has no `checkLogin` case and would return "Invalid action".
This means either (a) login is currently broken in the repo version, or (b) the live deployed script was separately edited and differs from Code.gs.
**Fix:** Move the `checkLogin` handler to `doPost()` and read credentials from `data.user` / `data.pass`.

---

### M2 — `_buildInputSheet` adds duplicate banner rows on re-run `[Pipeline.gs]`
**Location:** `_buildInputSheet()` line 778
`ws.insertRowBefore(2)` is called every time `setupSheets()` runs, even if the banner row already exists. Re-running setup inserts a new blank row above row 2 each time, pushing data rows down and breaking the `getPendingRows` assumption that data starts at row 3.
**Fix:** Check if row 2 already contains the banner text before inserting:
```javascript
const existing = ws.getRange(2, 1).getValue();
if (!existing || !String(existing).includes('ℹ️')) {
  ws.insertRowBefore(2);
}
```

---

### M3 — No execution time guard in pipeline `[Pipeline.gs]`
**Location:** `runMidnightEnrichment()` line 146
Apps Script has a 6-minute hard execution limit. If many rows are pending across all four INPUT sheets, the function can be killed mid-run, leaving some rows PROCESSED and others still PENDING. There is no checkpoint or resume mechanism.
**Fix:** Check elapsed time inside the batch loop and stop gracefully before the limit:
```javascript
const startTime = new Date();
// inside batch loop:
if ((new Date() - startTime) > 300000) { // 5-minute guard
  auditLog(ss, 'Time limit approaching — stopping. Will continue next run.');
  break;
}
```

---

### M4 — Claude response index not validated against batch position `[Pipeline.gs]`
**Location:** `processSheet()` lines 228–249
Claude is expected to return an array where each item's `idx` matches its position in the batch. The code uses `results[idx]` (position in returned array) without comparing it to `res.idx`. If Claude reorders, drops, or adds items in the response, rows will be processed with the wrong enrichment data silently.
**Fix:** Build a lookup map from the response:
```javascript
const resMap = {};
results.forEach(r => { if (r && r.idx !== undefined) resMap[r.idx] = r; });
// then: const res = resMap[idx_in_batch];
```

---

### M5 — Quote ID collision in high-frequency saves `[Quote_Intelligence.gs]`
**Location:** `buildQuoteLogRow()` line 140
```javascript
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```
The last 8 digits of a millisecond timestamp cycle every ~27.7 hours. Two saves within the same millisecond (e.g., batch backfill) produce identical Quote IDs.
**Fix:**
```javascript
const quoteId = 'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
```

---

### M6 — `backfillQuoteLog` makes hundreds of individual API calls `[Quote_Intelligence.gs]`
**Location:** `backfillQuoteLog()` lines 289–305
`logSheet.appendRow()` is called once per historical quote row. For 200+ rows this makes 200+ individual Sheets API write calls, takes several minutes, and will almost certainly hit Apps Script's daily write quota.
**Fix:** Collect all rows first and call `logSheet.appendRows(allRows)` once after the loop.

---

### M7 — `value_input_option="USER_ENTERED"` corrupts data types `[write_to_sheets.py]`
**Location:** `main()` line 196
```python
ws.append_rows(new_rows, value_input_option="USER_ENTERED")
```
Google Sheets will auto-parse values: strings like `"1-2"` become dates, numbers with leading zeros lose them, values starting with `=` execute as formulas. For raw archive data this is dangerous.
**Fix:** Use `value_input_option="RAW"`.

---

### M8 — `connect_sheet` creates worksheet with fixed 20 columns `[write_to_sheets.py]`
**Location:** `connect_sheet()` line 57
```python
ws = spreadsheet.add_worksheet(title=SHEET_NAME, rows=1000, cols=20)
```
If the CSV has more than 20 columns, data beyond column 20 is silently truncated.
**Fix:** Pass `cols=len(headers) + 5` (compute after reading CSV headers).

---

### M9 — `innerHTML` with data from Google Sheets — XSS risk `[index_fit.tripstore.html]`
**Location:** Lines 1883, 1954, 1993, 2009, 2077, 2171, 2215
Multiple modal and table renders use `` container.innerHTML = items.map(item => `...${item.name}...`) ``. If any sheet value (hotel name, tour name, pax name) contains characters like `<`, `>`, or `"`, layout breaks. A value like `<img src=x onerror=alert(1)>` in a hotel name field would execute JavaScript in the agent's browser.
**Fix:** Use `textContent` for user-visible strings, or sanitise before inserting:
```javascript
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
```

---

### M10 — No session expiry on localStorage login `[index_fit.tripstore.html]`
**Location:** `checkAutoLogin()` line 641
Sessions stored in `localStorage` have no TTL. Once logged in, a session persists indefinitely — through browser restarts, weeks of inactivity, and on shared devices.
**Fix:** Store a `loginTimestamp` in the session object and reject sessions older than 8–24 hours.

---

### M11 — Raw error message exposed to client on signup `[index_fit.tripstore.html]`
**Location:** `handleSignup()` line 619
```javascript
document.getElementById('loginError').innerText = "❌ " + result;
```
`result` is the raw Apps Script response body (e.g., "Setup Error: Users sheet not found"). This leaks internal implementation details.
**Fix:** Map known responses to user-friendly messages; show "Something went wrong, please try again" for anything unexpected.

---

### M12 — GST rate hardcoded as silent fallback `[Quote_Intelligence.gs]`
**Location:** `buildQuoteLogRow()` line 119
```javascript
const gstPct = d.gst || 5;
```
If the `gst` field is missing, the fallback silently uses 5%. Old itineraries backfilled with a wrong rate produce incorrect quote totals with no warning.
**Fix:** Add a log line: `if (!d.gst) Logger.log('GST field missing for ' + paxName + ' — defaulting to 5%');`

---

## MINOR Issues

### N1 — Column index hardcoded without named constant `[Code.gs]`
`r[18]` for Annual Avg in `getHotels()` (line 99). If a column is inserted in the Hotels sheet, this index silently reads the wrong value. Pipeline.gs uses named constants (HC, SC, etc.) — Code.gs should do the same.

### N2 — Internal error details exposed in API responses `[Code.gs]`
`'Server Error: ' + err.message` returned to callers (lines 39, 57). Log internally and return a generic message.

### N3 — No retry on Claude API rate limits `[Pipeline.gs]`
A single 429 or 503 marks the entire batch as ERROR. Needs up to 3 retries with 5-second backoff before giving up.

### N4 — Fixed `Utilities.sleep(1500)` with no backoff `[Pipeline.gs]`
Flat 1.5-second inter-batch delay doesn't adapt to API load. Add exponential backoff starting at 1s.

### N5 — `substr()` deprecated `[Quote_Intelligence.gs]`
`_titleCase()` line 315: replace `t.substr(1)` with `t.slice(1)`.

### N6 — `colorLogRow` uses magic index 21 `[Quote_Intelligence.gs]`
`const flag = row[21]` — define as a named constant so it stays in sync if columns shift.

### N7 — No `.gitignore` verification for credentials file `[write_to_sheets.py]`
`sheets-credentials.json` should be confirmed gitignored. If accidentally committed, the service account key (with full Sheets access) is in git history permanently and must be rotated.

### N8 — `SPREADSHEET_ID` hardcoded as string literal `[write_to_sheets.py]`
Read from environment variable instead: `os.environ.get("TRIPSTORE_SHEET_ID", "<default>")`.

---

## Prioritised Action Items

| # | Action | File | Severity |
|---|--------|------|----------|
| 1 | Add auth to `getAllSaved`, `getQuoteLog`, `searchItinerary` in doGet | Code.gs | CRITICAL |
| 2 | Hash passwords before storing | Code.gs | CRITICAL |
| 3 | Add auth check to `saveItinerary` in doPost | Code.gs | CRITICAL |
| 4 | Move `checkLogin` to doPost to fix routing mismatch | Code.gs | CRITICAL |
| 5 | Don't trust localStorage `isAdmin` — re-verify on auto-login | index_fit.tripstore.html | CRITICAL |
| 6 | Fix `sheet_is_empty` check using `get_all_values()` length | write_to_sheets.py | CRITICAL |
| 7 | Fix infinite recursion in `logQuote` with `_isRetry` guard | Quote_Intelligence.gs | CRITICAL |
| 8 | Add 5-minute execution time guard to pipeline | Pipeline.gs | MODERATE |
| 9 | Fix `_buildInputSheet` duplicate banner row on re-run | Pipeline.gs | MODERATE |
| 10 | Switch `append_rows` to `value_input_option="RAW"` | write_to_sheets.py | MODERATE |
| 11 | Fix Quote ID collision — add random suffix | Quote_Intelligence.gs | MODERATE |
| 12 | Sanitise all `innerHTML` inserts with escape helper | index_fit.tripstore.html | MODERATE |
| 13 | Add session TTL (8–24 hrs) to localStorage session | index_fit.tripstore.html | MODERATE |
| 14 | Validate Claude response idx against batch position | Pipeline.gs | MODERATE |
| 15 | Convert `backfillQuoteLog` to single `appendRows` call | Quote_Intelligence.gs | MODERATE |

---

## Files Not Found in This Repo

The following files were listed for review but do not exist in this repository. They are likely in Sumit's local archive folder (`/Users/Sumit/Desktop/Itinerary-Create/` or similar):

- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

These should be added to this repo or reviewed in a separate session.

---

*Generated automatically by Claude Code — TripStore daily review pipeline — 2026-04-25*
