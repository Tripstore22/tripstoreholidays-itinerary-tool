# TripStore Code Review Report
**Date:** 2026-05-08
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Commit:** d64a756

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| MODERATE | 12 |
| MINOR    | 9 |

---

## CRITICAL Issues

### [CRITICAL-1] Login Never Works for New Users — Backend/Frontend Mismatch
**File:** `index_fit.tripstore.html` line 583 + `Code.gs` lines 25–30

The frontend sends `checkLogin` as an HTTP **POST** with a JSON body:
```js
await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But `Code.gs` only handles `checkLogin` inside `doGet()` (reading from query parameters), not `doPost()`. Any POST with `action: "checkLogin"` hits the `doPost` fallthrough and returns `"Invalid action"`. The frontend then shows "Invalid Credentials" for every new login attempt.

**Why this hasn't been noticed:** Existing users stay logged in via `localStorage.getItem("tripstore_session")` — the app auto-logs them in without hitting the backend at all. New signups cannot log in.

**Fix:** Move `checkLogin` handling into `doPost()` reading from `data.user` and `data.pass`, or rewrite the frontend to send a GET request with query params.

---

### [CRITICAL-2] Passwords Stored and Transmitted in Plain Text
**File:** `Code.gs` lines 257–261, `index_fit.tripstore.html` line 583

Passwords are stored as plain text in the Google Sheet "Users" column B and compared with `dbPass === pass.trim()`. No hashing of any kind. A compromised Google Sheet (accidental public sharing, shared link) instantly exposes all agency passwords.

Additionally, `doGet` makes `checkLogin` reachable via a URL like `?action=checkLogin&user=X&pass=Y` — credentials appear in web server access logs in plain text.

**Fix (short-term):** Remove the doGet checkLogin route. **Fix (proper):** Hash passwords on signup using a one-way hash before storing; compare hashes on login.

---

### [CRITICAL-3] `setupQuoteLog()` Silently Destroys All Historical Quote Data
**File:** `Quote_Intelligence.gs` line 196

```js
function setupQuoteLog() {
  let ws = ss.getSheetByName('Quote_Log');
  if (!ws) ws = ss.insertSheet('Quote_Log');
  ws.clear(); // ← WIPES EVERYTHING unconditionally
```

`ws.clear()` runs even when the sheet already has data. Running `setupQuoteLog()` a second time (e.g. to fix column widths) permanently deletes every saved quote row with no confirmation, no backup, no undo.

**Fix:** Add a guard before clearing:
```js
if (ws.getLastRow() > 1) {
  SpreadsheetApp.getUi().alert('Quote_Log already has data. Aborting setup to protect it.');
  return;
}
```

---

## MODERATE Issues

### [MODERATE-1] `_buildInputSheet` Inserts Extra Banner Rows Every Time `setupSheets()` Runs
**File:** `Pipeline.gs` line 778

```js
ws.insertRowBefore(2); // inserts a NEW Row 2 every call — never checks if it already exists
```

Every call to `setupSheets()` inserts another Row 2 banner, pushing data down by one. After N runs there are N banner rows. `getPendingRows()` skips only rows 1 and 2 (hardcoded), so all real data from Row 4+ is silently ignored by the pipeline.

**Fix:** Check whether Row 2 is already a banner before inserting:
```js
if (!ws.getRange(2, 1).getValue().toString().includes('ℹ️')) {
  ws.insertRowBefore(2);
}
```

---

### [MODERATE-2] Claude Returns Object Instead of Array — Column Order Not Guaranteed
**File:** `Pipeline.gs` lines 241–242

```js
const rowArr = Array.isArray(r) ? r
  : (r && typeof r === 'object' ? Object.values(r) : [String(r)]);
mst.appendRow(rowArr);
```

When Claude returns an object, `Object.values()` produces values in key-insertion order. If Claude uses different key names or ordering than expected, column data silently lands in the wrong master sheet columns — hotel star ratings in the city column, prices in name column, etc. This is invisible and corrupts the master data.

**Fix:** Define an explicit column-extraction function per data type that reads named properties in the correct, declared order rather than relying on `Object.values()`.

---

### [MODERATE-3] `checkLogin` in `doGet` Exposes Credentials in URL and Server Logs
**File:** `Code.gs` lines 25–30

Even though the frontend currently sends login via POST (which is broken — see CRITICAL-1), the `doGet` route `?action=checkLogin&user=X&pass=Y` remains reachable. Any GET-based call includes credentials in the URL, which are recorded in Google's access logs and visible in browser history.

**Fix:** Remove `checkLogin` from `doGet` entirely. Handle it only in `doPost` with a JSON body.

---

### [MODERATE-4] GST Calculation in Quote Log Always Defaults to 5% — Ignores Actual Selection
**File:** `Quote_Intelligence.gs` lines 119–121

```js
const gstPct = d.gst || 5; // d.gst is never set — frontend stores d.gstMode ('5pkg','18svc','none')
const gstAmt = Math.round(markupAmt * gstPct / 100);
```

The saved itinerary payload uses `gstMode` (a string like `'none'`), not `gst` (a number). So `d.gst` is always `undefined`, `gstPct` always defaults to 5, and Quote_Log column R (GST Amount) is wrong for every quote where GST is None or 18%.

**Fix:**
```js
let gstAmt = 0;
const gstMode = d.gstMode || 'none';
if (gstMode === '5pkg')  gstAmt = Math.round((subTotal + markupAmt) * 0.05);
if (gstMode === '18svc') gstAmt = Math.round(markupAmt * 0.18);
```

---

### [MODERATE-5] `saveItinerary` Logs Quote Before Verifying Write Succeeded
**File:** `Code.gs` lines 356–357, 362–363

`logQuote(paxName, payload)` is called immediately after writing to the sheet. If the sheet write throws an exception (quota exceeded, permissions error), `doPost` returns "Server Error" to the client but `logQuote` may have already appended a row — creating a Quote_Log entry for a save that never completed.

**Fix:** Move `logQuote` calls to only after the `ContentService.createTextOutput(...)` is ready to return, or wrap the writes in try/finally with the log call in a post-success position.

---

### [MODERATE-6] `parse_hotels_cell` — Pipe Delimiter Breaks on Hotel Names Containing `|`
**File:** `archive_to_input.py` lines 63–76

The parser reads groups of 4 pipe-delimited fields. Any hotel name, city, or price containing a literal `|` shifts the offset, misaligning all remaining entries and silently importing wrong city/name pairs into INPUT_Hotels.

**Fix:** Use a delimiter that cannot appear in travel data (e.g., `|||` triple-pipe), or validate that each parsed group has the expected structure (e.g., field 3 matches the pattern `\d+N`, field 4 starts with `INR`) before appending.

---

### [MODERATE-7] `parse_trains_cell` — Brittle on First ` to ` Occurrence in Route Description
**File:** `archive_to_input.py` lines 109–114

```python
idx = lower.index(" to ")  # finds first occurrence only
from_city = desc[:idx].strip()
```

If a route description contains ` to ` in an unexpected position (e.g. notes like "Paris to Bordeaux (connect to Lyon)"), only the first " to " is used as the split point. City names with embedded "to" substrings could produce malformed from/to pairs.

**Fix:** Pre-strip parenthetical notes before splitting: `desc = re.sub(r'\s*\(.*?\)', '', desc).strip()`

---

### [MODERATE-8] Transfer City Extraction Heuristic Misses Most European Airport Keywords
**File:** `archive_to_input.py` lines 155–161

The regex split list includes only 7 IATA codes (`cdg|lhr|ams|fra|vie|bcn|fco`). "Rome Fiumicino Airport" extracts city as "Rome Fiumicino"; "Brussels Zaventem" extracts "Brussels Zaventem". These dirty city names propagate into INPUT_Transfers and then into the master Transfers sheet.

**Fix:** Extract city as the first word of `from_loc` — simpler and more reliable:
```python
city = from_loc.split()[0] if from_loc.split() else ""
```

---

### [MODERATE-9] Error Responses Leak Internal Exception Messages to Clients
**File:** `Code.gs` lines 39–40, 57–58

```js
return ContentService.createTextOutput('Server Error: ' + err.message);
```

Internal Apps Script exception messages (sheet tab names, column indices, method names, quota details) are returned to the browser. This leaks internal structure to anyone inspecting network responses.

**Fix:** Log server-side with `Logger.log(err.message)` and return a generic `"Server Error"` string to the client.

---

### [MODERATE-10] `notes` Field in `getTransfers` Maps to Schedule Column — Mislabelled
**File:** `Code.gs` line 203

```js
notes: String(r[13] || '').trim(), // comment says "Column N: Schedule"
```

Column N (0-based index 13) is the Schedule field per the sheet definition. The actual Notes column is index 14. The property named `notes` returns schedule text, and the real notes column is never read into the API response.

**Fix:**
```js
schedule: String(r[13] || '').trim(),
notes:    String(r[14] || '').trim(),
```

---

### [MODERATE-11] `write_to_sheets.py` — `ws.row_count == 0` Check Is Always False for New Sheets
**File:** `write_to_sheets.py` line 168

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```

A newly created Google Sheet has `row_count = 1000` (default grid size), never 0. The first condition is dead code. The second condition is correct and saves this from being a real bug, but the dead condition is misleading.

**Fix:** `sheet_is_empty = not ws.get_all_values()`

---

### [MODERATE-12] No Retry Logic for Transient Claude API Failures in Pipeline
**File:** `Pipeline.gs` lines 564–598

When `callClaudeAPI` fails (network timeout, 529 rate-limit, transient 500), all rows in the batch are marked ERROR and require manual `resetErrorRows()` before the next night's run. A single CDN hiccup creates avoidable manual work.

**Fix:** Add up to 2 retries with `Utilities.sleep(3000)` between attempts before marking rows as ERROR.

---

## MINOR Issues

### [MINOR-1] Quote ID Collision Risk During Backfill
**File:** `Quote_Intelligence.gs` line 140

`'Q-' + new Date().getTime().toString().slice(-8)` — last 8 digits of millisecond timestamp. During `backfillQuoteLog()` which loops without pausing, two rows processed within the same millisecond get the same Quote ID.

**Fix:** `'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2,5)`

---

### [MINOR-2] `logQuote` Recursive Self-Call on Sheet-Not-Found
**File:** `Quote_Intelligence.gs` lines 33–37

If `setupQuoteLog()` succeeds but the sheet is still not found on retry, `logQuote` recurses infinitely until Apps Script stack limit crashes the save operation.

**Fix:** Re-fetch the sheet reference after setup instead of recursing.

---

### [MINOR-3] `backfillQuoteLog` Creates Duplicate Entries When Run More Than Once
**File:** `Quote_Intelligence.gs` lines 278–309

No deduplication check — every run appends all rows from `Saved_Itineraries` again. Running it twice doubles all Quote_Log entries.

**Fix:** Build a set of existing pax names from Quote_Log column B before appending, and skip entries already present.

---

### [MINOR-4] `localStorage` `isAdmin` Flag Can Be Spoofed Client-Side
**File:** `index_fit.tripstore.html` lines 641–651

A user can open DevTools and set `localStorage.tripstore_session` to `{"isLoggedIn":true,"isAdmin":true}` to unlock the Admin Panel UI. The backend `getAllSaved` has no server-side role verification.

**Fix:** `getAllSaved()` should require a verified admin token.

---

### [MINOR-5] City Names Interpolated Into `innerHTML` Without HTML Escaping
**File:** `index_fit.tripstore.html` line 841

`r.city` from master data is interpolated directly into innerHTML. Low risk today (server-controlled data), but a malicious Hotels sheet value would execute as JS in every user's browser.

**Fix:** Escape HTML entities before interpolation.

---

### [MINOR-6] `archive_to_input.py` Writes Directly to INPUT Sheets With No Header Validation
**File:** `archive_to_input.py` lines 385–391

If run before `setupSheets()` in Apps Script, data lands starting at Row 1, overwriting the header position. The pipeline then reads wrong column positions silently.

**Fix:** Read Row 1 of each INPUT sheet and warn/abort if headers are missing.

---

### [MINOR-7] Hardcoded Production Spreadsheet ID — No Test Environment Switch
**File:** `write_to_sheets.py` line 28, `archive_to_input.py` line 32

Both scripts have production `SPREADSHEET_ID` hardcoded. Any test run writes to production. No `--dry-run` flag exists.

**Fix:** `SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "<production-id>")` so test runs can point elsewhere.

---

### [MINOR-8] `searchItinerary` Missing JSON MIME Type on Response
**File:** `Code.gs` lines 329–335

`getData()` and `getQuoteLog()` both set `.setMimeType(ContentService.MimeType.JSON)` but `searchItinerary` does not. Inconsistent and could cause caching issues.

**Fix:** Add `.setMimeType(ContentService.MimeType.JSON)` to the return statement.

---

### [MINOR-9] Model Version Hardcoded — No Maintenance Reminder
**File:** `Pipeline.gs` line 39

```js
MODEL: 'claude-haiku-4-5-20251001',
```

No comment about when to review or update this. Pipeline silently continues on an older model as newer ones are released.

**Fix:** Add a comment: `// Update quarterly — check console.anthropic.com for latest model IDs`

---

## Action Items (Priority Order)

1. **[CRITICAL-1]** Fix login: move `checkLogin` into `doPost` so new users can authenticate
2. **[CRITICAL-3]** Guard `setupQuoteLog()` — abort if sheet already has data
3. **[MODERATE-4]** Fix GST in `buildQuoteLogRow` to read `gstMode` string not `gst` number
4. **[MODERATE-1]** Guard `_buildInputSheet` against inserting extra banner rows on repeated runs
5. **[MODERATE-2]** Replace `Object.values()` with named-property extraction for Claude response rows
6. **[MODERATE-12]** Add retry logic to `callClaudeAPI` before marking rows ERROR
7. **[MODERATE-6/7/8]** Harden `archive_to_input.py` parsers for pipe-in-values, city-with-"to", airport keywords
8. **[MODERATE-5]** Move `logQuote` calls to after successful sheet write
9. **[MINOR-3]** Deduplicate `backfillQuoteLog` — skip pax names already in Quote_Log
10. **[MINOR-4]** Add server-side admin role check to `getAllSaved`
11. **[CRITICAL-2]** Plan password hashing — longer-term infrastructure change

---

*Report generated automatically by Claude Code — daily review run 2026-05-08*
