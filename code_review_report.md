# TripStore Code Review Report
**Date:** 2026-04-28
**Reviewed by:** Claude (automated daily review)
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Files listed but not found in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py (likely in local archive folder on Sumit's Mac)
**Status note:** No code changes made since last review (2026-04-25). All previous issues remain open. `archive_to_input.py` reviewed for the first time this session (it was present in the repo but missed in the prior run).

---

## Summary

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 6     |
| MODERATE  | 14    |
| MINOR     | 10    |
| **TOTAL** | **30**|

---

## CRITICAL Issues

### C1 — Plaintext passwords in Google Sheets `[Code.gs]`
**Location:** `checkLogin()` line 261, `handleSignup()` line 289
**Status: UNRESOLVED**
Passwords are stored as plain text in the Users sheet and compared directly with `dbPass === pass.trim()`. If anyone gains read access to the spreadsheet, all user credentials are immediately exposed.
**Fix:** Hash passwords before storing: `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)`.

---

### C2 — No authentication on sensitive GET endpoints `[Code.gs]`
**Location:** `doGet()` lines 28–40
**Status: UNRESOLVED**
`getAllSaved`, `getQuoteLog`, and `searchItinerary` have zero authentication. Anyone who knows the Apps Script `/exec` URL (hardcoded in the public GitHub repo at HTML line 426) can dump all saved pax names, download the full quote log, or load any itinerary JSON.
**Fix:** Add a token parameter to sensitive endpoints, or move them to POST with a validated session token.

---

### C3 — `saveItinerary` has no authentication `[Code.gs]`
**Location:** `doPost()` lines 52–53
**Status: UNRESOLVED**
A POST with `{ action: "saveItinerary", paxName: "...", payload: {...} }` overwrites any saved itinerary with no login required.
**Fix:** Require a valid session token in the POST body and validate it against the Users sheet before writing.

---

### C4 — Admin role stored in localStorage and trusted without server verification `[index_fit.tripstore.html]`
**Location:** `checkAutoLogin()` lines 641–651
**Status: UNRESOLVED**
The `isAdmin` flag is read directly from `localStorage`. Anyone can open DevTools and set `isAdmin: true` to gain full admin access without credentials.
**Fix:** Re-verify role with a backend call on session restore, or add a server-issued signed token.

---

### C5 — Infinite recursion risk in `logQuote` `[Quote_Intelligence.gs]`
**Location:** `logQuote()` lines 29–37
**Status: UNRESOLVED**
If `setupQuoteLog()` creates the sheet but `ss.getSheetByName('Quote_Log')` returns null on the retry, the function calls itself infinitely until a stack overflow, crashing `saveItinerary` for the user.
**Fix:** Add a `_isRetry` guard flag before recursing.

---

### C6 — `sheet_is_empty` check always false in write_to_sheets.py `[write_to_sheets.py]`
**Location:** `main()` line 168
**Status: UNRESOLVED**
`ws.row_count == 0` is always False (gspread default is 1000). The header row is never written to new sheets; data is appended with no header.
**Fix:** `sheet_is_empty = len(ws.get_all_values()) == 0`

---

## MODERATE Issues

### M1 — checkLogin routing mismatch: POST frontend vs GET backend `[Code.gs + index_fit.tripstore.html]`
**Location:** `doPost()` Code.gs line 43; HTML line 583
**Status: UNRESOLVED**
Frontend sends login via POST with JSON body. Backend only handles `checkLogin` in `doGet()` via URL query params. `doPost()` returns "Invalid action" for login — this is either broken or the live deployed script differs from Code.gs.
**Fix:** Move `checkLogin` handler to `doPost()` and read from `data.user` / `data.pass`.

---

### M2 — `_buildInputSheet` adds duplicate banner rows on re-run `[Pipeline.gs]`
**Location:** `_buildInputSheet()` line 778
**Status: UNRESOLVED**
`ws.insertRowBefore(2)` is called on every `setupSheets()` run, pushing data rows down and breaking the row-3 assumption in `getPendingRows`.
**Fix:** Check if row 2 already contains the banner text before inserting.

---

### M3 — No execution time guard in pipeline `[Pipeline.gs]`
**Location:** `runMidnightEnrichment()` line 146
**Status: UNRESOLVED**
Apps Script has a 6-minute hard limit. With many pending rows the function can be killed mid-run with no checkpoint.
**Fix:** Check elapsed time inside the batch loop and stop gracefully at 5 minutes.

---

### M4 — Claude response index not validated against batch position `[Pipeline.gs]`
**Location:** `processSheet()` lines 228–249
**Status: UNRESOLVED**
`results[idx]` (positional) is used without comparing to `res.idx`. If Claude reorders or drops items, rows get the wrong enrichment data silently.
**Fix:** Build a lookup map keyed by `res.idx`.

---

### M5 — Quote ID collision in high-frequency saves `[Quote_Intelligence.gs]`
**Location:** `buildQuoteLogRow()` line 140
**Status: UNRESOLVED**
Last 8 digits of millisecond timestamp cycles every ~27.7 hours. Two saves in the same millisecond produce identical Quote IDs.
**Fix:** `'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase()`

---

### M6 — `backfillQuoteLog` makes hundreds of individual API calls `[Quote_Intelligence.gs]`
**Location:** `backfillQuoteLog()` lines 289–305
**Status: UNRESOLVED**
`logSheet.appendRow()` once per quote hits Apps Script write quota for 200+ historical rows.
**Fix:** Collect all rows then call `logSheet.appendRows(allRows)` once.

---

### M7 — `value_input_option="USER_ENTERED"` corrupts data types `[write_to_sheets.py]`
**Location:** `main()` line 196
**Status: UNRESOLVED**
Strings like "1-2" become dates, leading zeros are stripped, `=` prefixed values execute as formulas.
**Fix:** Use `value_input_option="RAW"`.

---

### M8 — `connect_sheet` creates worksheet with fixed 20 columns `[write_to_sheets.py]`
**Location:** `connect_sheet()` line 57
**Status: UNRESOLVED**
Data beyond column 20 is silently truncated if the CSV has more columns.
**Fix:** Pass `cols=len(headers) + 5`.

---

### M9 — `innerHTML` with data from Google Sheets — XSS risk `[index_fit.tripstore.html]`
**Location:** Multiple modal and table render functions
**Status: UNRESOLVED**
Unescaped sheet values inserted via `innerHTML`. A hotel name like `<img src=x onerror=alert(1)>` would execute JavaScript in the agent's browser.
**Fix:** `const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');`

---

### M10 — No session expiry on localStorage login `[index_fit.tripstore.html]`
**Location:** `checkAutoLogin()` line 641
**Status: UNRESOLVED**
Sessions never expire — persist through browser restarts, weeks of inactivity, and on shared devices.
**Fix:** Store `loginTimestamp` and reject sessions older than 8–24 hours.

---

### M11 — Raw error message exposed to client on signup `[index_fit.tripstore.html]`
**Location:** `handleSignup()` line 619
**Status: UNRESOLVED**
Raw Apps Script response body (e.g. "Setup Error: Users sheet not found") is displayed to users, leaking internal details.
**Fix:** Map known responses to user-friendly messages.

---

### M12 — GST rate hardcoded as silent fallback `[Quote_Intelligence.gs]`
**Location:** `buildQuoteLogRow()` line 119
**Status: UNRESOLVED**
`const gstPct = d.gst || 5;` silently defaults to 5% with no warning when the field is missing.
**Fix:** Add `if (!d.gst) Logger.log('GST field missing for ' + paxName + ' — defaulting to 5%');`

---

### M13 — `USER_ENTERED` import in archive_to_input.py corrupts data types `[archive_to_input.py]`
**Location:** `main()` line 390
**NEW FINDING — first seen 2026-04-28**
`append_rows(..., value_input_option="USER_ENTERED")` causes route strings, hotel names, and cost values to be auto-parsed by Sheets, risking date coercion and formula injection.
**Fix:** Use `value_input_option="RAW"`.

---

### M14 — City extraction in `parse_transfers_cell` is brittle `[archive_to_input.py]`
**Location:** `parse_transfers_cell()` lines 155–162
**NEW FINDING — first seen 2026-04-28**
Regex split on airport keywords returns only the first word for multi-word cities (e.g. "New York" → "New", "San Sebastian" → "San"). Wrong city names flow silently into INPUT_Transfers.
**Fix:** Maintain a `KNOWN_CITIES` list, or extract city from the archive row's city column instead of parsing the description.

---

## MINOR Issues

### N1 — Column index `r[18]` hardcoded without named constant `[Code.gs]`
**Status: UNRESOLVED** — `getHotels()` line 99. A column insertion silently reads the wrong value.

### N2 — Internal error details in API responses `[Code.gs]`
**Status: UNRESOLVED** — `'Server Error: ' + err.message` at lines 39, 57. Log and return a generic message.

### N3 — No retry on Claude API rate limits `[Pipeline.gs]`
**Status: UNRESOLVED** — A 429 or 503 marks the entire batch as ERROR. Add 3 retries with 5-second backoff.

### N4 — Fixed `Utilities.sleep(1500)` with no backoff `[Pipeline.gs]`
**Status: UNRESOLVED** — Add exponential backoff starting at 1s.

### N5 — `substr()` deprecated `[Quote_Intelligence.gs]`
**Status: UNRESOLVED** — `_titleCase()` line 315: replace `t.substr(1)` with `t.slice(1)`.

### N6 — `colorLogRow` uses magic index 21 `[Quote_Intelligence.gs]`
**Status: UNRESOLVED** — `const flag = row[21]` should be a named constant.

### N7 — No `.gitignore` check for credentials file `[write_to_sheets.py / archive_to_input.py]`
**Status: UNRESOLVED** — If `sheets-credentials.json` is committed, the service account key is permanently exposed in git history.

### N8 — `SPREADSHEET_ID` hardcoded in two scripts `[write_to_sheets.py + archive_to_input.py]`
**Status: UNRESOLVED** — Read from `os.environ.get("TRIPSTORE_SHEET_ID")` instead.

### N9 — Silent skip on unparseable train routes `[archive_to_input.py]`
**NEW FINDING — first seen 2026-04-28** — Routes without " to " (e.g. "Paris → Brussels") are silently dropped with no log output.
**Fix:** `print(f"  SKIP (no 'to'): {desc}")` before `continue`.

### N10 — Hotels parser silently skips entries with missing cost field `[archive_to_input.py]`
**NEW FINDING — first seen 2026-04-28** — `range(0, len(parts) - 3, 4)` silently drops hotels where the 4th pipe segment (cost) is absent.
**Fix:** Log skipped entries for visibility.

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
| 10 | Switch `append_rows` to `value_input_option="RAW"` | write_to_sheets.py + archive_to_input.py | MODERATE |
| 11 | Fix Quote ID collision — add random suffix | Quote_Intelligence.gs | MODERATE |
| 12 | Sanitise all `innerHTML` inserts with escape helper | index_fit.tripstore.html | MODERATE |
| 13 | Add session TTL (8–24 hrs) to localStorage session | index_fit.tripstore.html | MODERATE |
| 14 | Validate Claude response idx against batch position | Pipeline.gs | MODERATE |
| 15 | Convert `backfillQuoteLog` to single `appendRows` call | Quote_Intelligence.gs | MODERATE |
| 16 | Fix brittle city extraction in parse_transfers_cell | archive_to_input.py | MODERATE |

---

## Files Not Found in This Repo

- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

Likely in Sumit's local archive folder. Should be added to this repo or reviewed separately.

---

*Generated automatically by Claude Code — TripStore daily review pipeline — 2026-04-28*
