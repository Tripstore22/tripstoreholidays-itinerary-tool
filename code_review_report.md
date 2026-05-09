# TripStore Code Review Report
**Date:** 2026-05-09
**Reviewer:** Claude (automated daily review)
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Commit reviewed:** d64a756

---

## Summary

| Severity | Count |
|----------|---------|
| CRITICAL | 4 |
| MODERATE | 15 |
| MINOR    | 11 |
| **TOTAL** | **30** |

---

## CRITICAL Issues

### [CRITICAL-1] Login Never Works for New Users — Backend/Frontend Method Mismatch
**File:** `index_fit.tripstore.html` line 583 + `Code.gs` lines 25–30

The frontend sends `checkLogin` as an HTTP **POST** with a JSON body:
```js
await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But `Code.gs` only handles `checkLogin` inside `doGet()` (reading URL query parameters), not `doPost()`. Any POST with `action: "checkLogin"` hits the `doPost` fallthrough and returns `"Invalid action"`. The frontend then shows "Invalid Credentials" for every fresh login.

**Why it hasn't been noticed:** Existing users stay logged in via `localStorage.getItem("tripstore_session")` — the app auto-logs them in without hitting the backend. New signups cannot log in.

**Fix:** Move `checkLogin` handling into `doPost()` reading `data.user` and `data.pass`. Redeploy after changing.

---

### [CRITICAL-2] Passwords Stored and Transmitted in Plain Text
**File:** `Code.gs` lines 257–261, 289

Passwords are stored as plain text in the Google Sheet "Users" column B and compared with `dbPass === pass.trim()`. No hashing of any kind. A compromised Google Sheet (accidental public sharing, exported CSV) instantly exposes all agency passwords.

Additionally, `doGet` makes `checkLogin` reachable via URL like `?action=checkLogin&user=X&pass=Y` — credentials appear in server access logs in plain text.

**Fix (short-term):** Remove the doGet `checkLogin` route.
**Fix (proper):** Hash passwords on signup with SHA-256 via `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)`. Store and compare hashes only.

---

### [CRITICAL-3] `setupQuoteLog()` Permanently Destroys All Historical Quote Data
**File:** `Quote_Intelligence.gs` line 196

```js
function setupQuoteLog() {
  let ws = ss.getSheetByName('Quote_Log');
  if (!ws) ws = ss.insertSheet('Quote_Log');
  ws.clear();   // ← wipes everything unconditionally, even if data already exists
```

`ws.clear()` runs even when the sheet already has 100+ saved quotes. Running `setupQuoteLog()` a second time (e.g. to fix column widths or add a new column) **permanently deletes every quote row with no confirmation, no backup, no undo**.

**Fix:** Add a guard before clearing:
```js
if (ws.getLastRow() > 1) {
  SpreadsheetApp.getUi().alert('Quote_Log already has data — aborting to protect it. Backup first.');
  return;
}
```

---

### [CRITICAL-4] Admin Panel Access Controlled Only Client-Side
**File:** `index_fit.tripstore.html` lines 641–650

The session is stored in `localStorage` as `{isLoggedIn: true, isAdmin: true, ...}`. Any user can open DevTools → Application → localStorage, change `isAdmin` to `true`, reload, and get full admin access. The server has no concept of "admin" in any endpoint handler — `getAllSaved`, `searchItinerary`, and `saveItinerary` all have zero auth checks.

**Fix:** Pass a credential token with every request and validate the user's role from the Users sheet on the server side.

---

## MODERATE Issues

### [MODERATE-1] GST Calculation in Quote Log Always Defaults to 5% — Field Name Bug
**File:** `Quote_Intelligence.gs` lines 119–121

```js
const gstPct = d.gst || 5;  // d.gst is NEVER set — payload uses d.gstMode ('5pkg','18svc','none')
const gstAmt = Math.round(markupAmt * gstPct / 100);
```

The saved itinerary payload uses `gstMode` (a string), not `gst` (a number). So `d.gst` is always `undefined`, `gstPct` always defaults to 5, and Quote_Log column R (GST Amount) is wrong for every quote where GST is None or 18%. This silently corrupts all historical reporting.

**Fix:**
```js
let gstAmt = 0;
const gstMode = d.gstMode || 'none';
if (gstMode === '5pkg')  gstAmt = Math.round((subTotal + markupAmt) * 0.05);
if (gstMode === '18svc') gstAmt = Math.round(markupAmt * 0.18);
```

---

### [MODERATE-2] `_buildInputSheet` Inserts Duplicate Banner Rows on Every `setupSheets()` Run
**File:** `Pipeline.gs` line 778

```js
ws.insertRowBefore(2);  // inserts a new Row 2 every time — no check if banner already exists
```

Running `setupSheets()` twice creates two banner rows and pushes all data down by one. `getPendingRows()` hardcodes "data starts at row 3 (index 2)" — so any extra banner row silently causes the first real data row to be skipped by the pipeline.

**Fix:**
```js
if (!ws.getRange(2, 1).getValue().toString().includes('ℹ️')) {
  ws.insertRowBefore(2);
}
```

---

### [MODERATE-3] Claude May Return Object Instead of Array — Column Order Not Guaranteed
**File:** `Pipeline.gs` lines 241–242

```js
const rowArr = Array.isArray(r) ? r
  : (r && typeof r === 'object' ? Object.values(r) : [String(r)]);
mst.appendRow(rowArr);
```

When Claude returns an object, `Object.values()` produces values in key-insertion order. If Claude uses different key names or ordering than expected, column data silently lands in the wrong master sheet columns — prices in the city column, star ratings in the name column, etc.

**Fix:** Define an explicit column-extraction function per data type that reads named keys in the declared column order, not `Object.values()`.

---

### [MODERATE-4] `saveItinerary` Logs Quote Before Verifying Write Succeeded
**File:** `Code.gs` lines 356–357, 362–363

`logQuote(paxName, payload)` is called immediately after the sheet write. If the write throws an exception (quota exceeded, permissions error), `doPost` returns "Server Error" but `logQuote` may have already appended a Quote_Log entry — creating a quote record for a save that never completed.

**Fix:** Call `logQuote` only after both sheet writes complete successfully, immediately before the return statement.

---

### [MODERATE-5] No Server-Side Authentication on Read/Write Endpoints
**File:** `Code.gs` — `getAllSaved()`, `searchItinerary()`, `saveItinerary()`

All three are accessible to anyone who knows the API URL with no session token or user check. Any person can list all pax names, load any itinerary, or overwrite any saved record.

**Fix:** Accept a session token in POST payloads; validate it server-side against a tokens sheet with a TTL.

---

### [MODERATE-6] No Brute-Force Protection on Login
**File:** `Code.gs` — `checkLogin()` has no rate limiting

The login endpoint has no attempt counter, lockout, or delay. An attacker can make unlimited programmatic login attempts.

**Fix:** Track failed attempts per username in the sheet. Lock after 10 failures within 1 hour.

---

### [MODERATE-7] `Array.fill()` Shares Object Reference Across Error Batch
**File:** `Pipeline.gs` line 593

```js
return Array(expectedCount).fill({ valid: false, error_reason: '...' });
```

`Array.fill()` with an object fills every slot with the **same object reference**. Mutating one element mutates all.

**Fix:**
```js
return Array.from({ length: expectedCount }, () => ({
  valid: false,
  error_reason: `Claude API error — will retry: ${e.message}`
}));
```

---

### [MODERATE-8] `parse_hotels_cell` — Pipe Delimiter Breaks on Names Containing `|`
**File:** `archive_to_input.py` lines 63–76

The parser splits on `|` and reads groups of 4 fields: city | name | nights | cost. Any hotel name, city, or price containing a literal `|` shifts the offset, misaligning all remaining entries and silently importing wrong city/name pairs.

**Fix:** Validate that parsed field 3 matches `\d+N` and field 4 starts with `INR` before appending, or use a safer delimiter.

---

### [MODERATE-9] `parse_trains_cell` — `index(" to ")` Finds First Occurrence Only
**File:** `archive_to_input.py` lines 109–114

```python
idx = lower.index(" to ")  # splits on FIRST occurrence only
```

Route descriptions like `"Nice to Monaco (connect to Monte Carlo)"` split at the wrong position.

**Fix:** Pre-strip parenthetical notes before splitting:
```python
desc_clean = re.sub(r'\s*\(.*?\)', '', desc).strip()
idx = desc_clean.lower().index(" to ")
```

---

### [MODERATE-10] Transfer City Heuristic Only Knows 10 Airport Codes
**File:** `archive_to_input.py` lines 155–161

The regex keyword list knows CDG, LHR, AMS, FRA, VIE, BCN, FCO — but misses MXP, ATH, PRG, CPH, BRU, ZRH, NCE and dozens more. For unrecognised airports, the fallback to the first word of `from_loc` can yield "Terminal" or "Gate" as the city name.

**Fix:** Expand the airport keyword list, or split on a broader set of location-type nouns: `(airport|terminal|station|central|port|hotel|resort|city|downtown|centre|center)`.

---

### [MODERATE-11] No Execution Timeout Protection in Pipeline.gs
**File:** `Pipeline.gs` — `runMidnightEnrichment()`

Google Apps Script has a 6-minute execution limit. With large INPUT sheets and slow Claude API responses, the pipeline can time out mid-run, leaving rows in an indeterminate state with no checkpoint or resume mechanism.

**Fix:** Track the last-processed row index in Script Properties and resume from there on the next run.

---

### [MODERATE-12] No Max-Retry Limit for ERROR Rows
**File:** `Pipeline.gs` — overall design

ERROR rows are retried every night indefinitely. A systemic error creates infinite nightly failures with no escalation alert.

**Fix:** Add a `Retry_Count` column. After 3 failures mark as `PERMANENT_ERROR` and send an email alert.

---

### [MODERATE-13] Recursive `logQuote` → `setupQuoteLog` Has No Loop Guard
**File:** `Quote_Intelligence.gs` lines 34–37

If `setupQuoteLog()` itself throws (permissions, quota), the sheet still won't exist, and `logQuote` recurses indefinitely until a stack overflow.

**Fix:**
```js
function logQuote(paxName, data, _retry = false) {
  const logSheet = ss.getSheetByName('Quote_Log');
  if (!logSheet) {
    if (_retry) { Logger.log('Quote_Log still missing after setup'); return; }
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
  ...
}
```

---

### [MODERATE-14] XSS via `innerHTML` with Unescaped Data from masterData
**File:** `index_fit.tripstore.html` lines 1287, 1604, 1719

City names, transfer From/To values, and intercity route strings are inserted directly into `innerHTML` without escaping. If a Google Sheet cell contains `<img src=x onerror=alert(1)>`, it executes. Risk is low (admin-controlled sheet) but latent.

**Fix:** Use a `htmlEncode()` helper for all data inserted via innerHTML.

---

### [MODERATE-15] Hotel Swap Selects by Name Only — Ignores Room Type
**File:** `index_fit.tripstore.html` line 1823

```js
const origIdx = allCityHotels.findIndex(o => o.name === h.name);
```

If the same hotel appears multiple times (Deluxe, Suite), this always picks the **first** entry. The agent selects "Suite" in the UI but "Deluxe" gets applied.

**Fix:** Match on both `name` AND `roomType`.

---

## MINOR Issues

### [MINOR-1] Quote ID Collision Risk
**File:** `Quote_Intelligence.gs` line 140
`'Q-' + new Date().getTime().toString().slice(-8)` cycles every ~115 days. Two quotes saved in the same millisecond get the same ID.
**Fix:** Append a random suffix: `+ Math.random().toString(36).slice(2,6).toUpperCase()`

### [MINOR-2] `colorLogRow` Uses Hardcoded Column Index 21
**File:** `Quote_Intelligence.gs` line 179
`const flag = row[21]` — adding a column before V silently colors based on the wrong value.

### [MINOR-3] `_titleCase` Uses Deprecated `substr`
**File:** `Quote_Intelligence.gs` line 315
`t.substr(1)` is deprecated. Replace with `t.slice(1)`.

### [MINOR-4] `formatDate()` Timezone Edge Case
**File:** `index_fit.tripstore.html` line 2028
`new Date("2024-01-15")` parses as midnight UTC — in timezones behind UTC shows the previous date.
**Fix:** `new Date(d + 'T00:00:00')` to force local time parsing.

### [MINOR-5] `autoSaveThenDo` Swallows Save Errors Silently
**File:** `index_fit.tripstore.html` line 2292
If the backend is down, the itinerary is exported but not saved with no warning.
**Fix:** `showToast("Auto-save failed — export proceeding anyway", "error")` in the catch.

### [MINOR-6] Missing Content-Type Headers on POST Fetch Calls
**File:** `index_fit.tripstore.html` lines 720, 612, 2288
All POST requests omit `headers: { 'Content-Type': 'application/json' }`. Works today but non-standard.

### [MINOR-7] `doGet` Returns Server Errors as 200 OK
**File:** `Code.gs` line 38
Exceptions returned as `200 OK` with body `"Server Error: ..."` — the frontend cannot distinguish real errors from valid responses.

### [MINOR-8] `appendToLog` Silently Truncates Row Data at 500 Chars
**File:** `Pipeline.gs` line 654
`JSON.stringify(d).slice(0, 500)` can hide the actual error cause.

### [MINOR-9] `instanceId` Float Precision Risk
**File:** `index_fit.tripstore.html` — `addTour()` line 1008
`instanceId = Date.now() + Math.random()` can lose precision when serialised through HTML attributes.
**Fix:** Use `crypto.randomUUID()` or an integer counter.

### [MINOR-10] Spreadsheet ID Hardcoded in Python Scripts
**File:** `write_to_sheets.py` line 29, `archive_to_input.py` line 32
Live sheet ID exposed in source code. **Fix:** Use `os.environ["TRIPSTORE_SHEET_ID"]`. Confirm `sheets-credentials.json` is in `.gitignore`.

### [MINOR-11] `ws.row_count == 0` Check Unreliable in gspread
**File:** `write_to_sheets.py` line 168
`row_count` reflects grid size (default 1000), not data rows. Remove the check; rely solely on `not ws.get_all_values()`.

---

## Missing Files
These were requested for review but are **not in this repository**:
- `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`
- `clean_pipeline_data.py`, `cross_reference.py` *(lives in separate archive folder on Mac)*
- `enrich_hotels.py`, `enrich_hotels_booking.py`

---

## Priority Action Items

### Do This Week
1. **[CRITICAL-2]** Hash passwords before storing in Code.gs. Redeploy.
2. **[CRITICAL-1]** Move `checkLogin` into `doPost` in Code.gs. Redeploy.
3. **[CRITICAL-3]** Add a data-protection guard to `setupQuoteLog()` before `ws.clear()`.
4. **[MODERATE-1]** Fix the GST field name bug in Quote_Intelligence.gs (`d.gst` → `d.gstMode`). This is silently corrupting every Quote_Log financial row right now.

### Do This Month
5. **[CRITICAL-4]** Add server-side role validation — remove reliance on localStorage `isAdmin`.
6. **[MODERATE-2]** Fix `_buildInputSheet` banner-row idempotency guard.
7. **[MODERATE-3]** Replace `Object.values()` with explicit column-order extraction in Pipeline.gs.
8. **[MODERATE-7]** Fix `Array.fill()` object-reference bug → use `Array.from()`.
9. **[MODERATE-15]** Fix hotel swap to match on `name + roomType`, not name alone.
10. **[MODERATE-12]** Add 3-strike PERMANENT_ERROR for pipeline retry limit.

### Ongoing
11. **[MINOR-5]** Show toast warning when `autoSaveThenDo` fails.
12. **[MINOR-10]** Move hardcoded spreadsheet IDs to environment variables.
13. **[MINOR-3]** Replace deprecated `substr` with `slice` in Quote_Intelligence.gs.

---

*Report generated automatically. Session date: 2026-05-09.*
