# TripStore Code Review Report
**Date:** 2026-05-12
**Reviewer:** Automated Daily Review
**Commit:** d64a756

---

## Files Reviewed
- Code.gs
- Pipeline.gs
- Quote_Intelligence.gs
- index_fit.tripstore.html
- write_to_sheets.py
- archive_to_input.py

## Files Not Found (requested but absent from repo)
- extract_itineraries.py
- write_inputs_to_sheets.py
- cleanup_sheet.py
- clean_pipeline_data.py
- cross_reference.py
- enrich_hotels.py
- enrich_hotels_booking.py

---

## CRITICAL Issues (3)

### C1 — Code.gs: Plaintext passwords in Google Sheets
**File:** Code.gs, line 261 (`checkLogin`), line 289 (`handleSignup`)

Passwords are stored and compared in plaintext. The Users sheet column B holds raw password strings. If the spreadsheet is ever shared accidentally or a viewer gains access, all user credentials are exposed immediately. There is no hashing (bcrypt, SHA-256, or otherwise).

**Fix:** Hash passwords before storing (SHA-256 via `Utilities.computeDigest` in Apps Script). Compare hashes at login, never plaintext.

---

### C2 — Code.gs: Login credentials potentially exposed via GET parameters
**File:** Code.gs, lines 25–28 (`doGet` / `checkLogin`)

`doGet` contains a `checkLogin` branch that reads `e.parameter.user` and `e.parameter.pass`. GET parameters appear in server access logs, browser history, and HTTP Referer headers. Any code path that invokes login via GET (including any testing or misconfiguration) will silently log plaintext credentials.

**Fix:** Remove the GET-based `checkLogin` path entirely. Login must only occur through `doPost`.

---

### C3 — index_fit.tripstore.html: Admin role enforced client-side only
**File:** index_fit.tripstore.html, lines 585–588, 626–633

`isAdmin` is a plain JavaScript boolean. On login, the session is stored in `localStorage` as `{"isAdmin": true}`. Anyone can open DevTools, run `localStorage.setItem('tripstore_session', JSON.stringify({isLoggedIn:true,isAdmin:true,modeText:'ADMIN MODE'}))`, and reload to gain the admin panel without credentials. The backend `getAllSaved` endpoint has no authentication at all — it returns every saved pax name to any anonymous caller.

**Fix:** The backend must authenticate every sensitive action (getAllSaved, saveItinerary, searchItinerary) by requiring a signed token or server-side session, not a client-supplied role flag.

---

## MODERATE Issues (9)

### M1 — Code.gs: No rate limiting on login (brute-force risk)
**File:** Code.gs, lines 249–269

`checkLogin` performs a linear scan of the Users sheet and returns INVALID/ADMIN/USER with no attempt counter or lockout. An attacker can submit unlimited login attempts programmatically.

**Fix:** Track failed attempts per username in a separate sheet column; lock after 5 failures for 15 minutes.

---

### M2 — Pipeline.gs: callClaudeAPI does not guard against unexpected API response shape
**File:** Pipeline.gs, lines 585–588

`responseData.content[0].text` is accessed without checking that `content` is an array or that index `[0]` exists. A malformed or rate-limit response from the Claude API (which may return a different JSON structure) will throw an uncaught TypeError, crashing the entire batch.

**Fix:**
```js
const content = responseData?.content;
if (!Array.isArray(content) || !content[0]?.text) throw new Error('Unexpected Claude response: ' + JSON.stringify(responseData).slice(0,200));
const text = content[0].text;
```

---

### M3 — Pipeline.gs: _buildInputSheet inserts duplicate banner rows on repeated setup
**File:** Pipeline.gs, line 778 (`_buildInputSheet`)

`ws.insertRowBefore(2)` is called unconditionally every time `setupSheets()` runs. If an admin runs setup twice, a second info banner row is inserted above the first, pushing all data rows down and breaking the hardcoded row-index assumption (`getPendingRows` starts at row index 2).

**Fix:** Check whether row 2 is already a merged banner cell before inserting.

---

### M4 — Pipeline.gs: Entire batch silently fails on any Claude API error
**File:** Pipeline.gs, lines 590–596

On any exception (network timeout, 429 rate limit, API outage), all rows in the current batch are marked ERROR. There is no distinction between a transient error (worth retrying) and a permanent validation failure. Tomorrow's run resets them via `resetErrorRows()` only if an admin manually runs that function.

**Fix:** Distinguish HTTP 429/503 (transient) from 400/422 (permanent). For transient errors, leave rows as PENDING so the next midnight run retries automatically.

---

### M5 — Quote_Intelligence.gs: Infinite recursion risk in logQuote
**File:** Quote_Intelligence.gs, lines 33–37

If `setupQuoteLog()` creates the sheet but then `logQuote` calls itself recursively — and if `ss.getSheetByName('Quote_Log')` returns null a second time (e.g., due to a race condition or Apps Script quota limit on insertSheet) — the recursion has no depth limit and will throw a stack overflow error that also kills the parent `saveItinerary` call.

**Fix:** Replace the recursive retry with a non-recursive approach: create the sheet inline if missing, then proceed once without re-calling `logQuote`.

---

### M6 — Quote_Intelligence.gs: GST calculation ignores gstMode
**File:** Quote_Intelligence.gs, lines 116–121

`gstPct = d.gst || 5` and `gstAmt = Math.round(markupAmt * gstPct / 100)`. The `gstMode` field saved by the frontend (`'5pkg'`, `'18svc'`, `'none'`) is not read here. When mode is `'none'`, GST is still calculated at 5% on the markup. When mode is `'5pkg'`, GST should be on the full package (subTotal + markupAmt), not just markupAmt. This causes Quote_Log to record incorrect GST and grand totals that don't match what the agent showed the client.

**Fix:** Read `d.gstMode`, apply 0% for `'none'`, 5% on `(subTotal + markupAmt)` for `'5pkg'`, and 18% on `markupAmt` for `'18svc'`.

---

### M7 — write_to_sheets.py: Credentials file path creates git exposure risk
**File:** write_to_sheets.py, line 32

`CREDENTIALS_PATH = Path("./sheets-credentials.json")` places the service account key in the repo root. If someone accidentally runs `git add .`, this file (containing private key material) could be committed and pushed to GitHub.

**Fix:** Move to an explicit path outside the repo (e.g., `~/.config/tripstore/sheets-credentials.json`) or read from an environment variable. Add `sheets-credentials.json` to `.gitignore` immediately.

---

### M8 — write_to_sheets.py / archive_to_input.py: Spreadsheet ID hardcoded in source
**Files:** write_to_sheets.py line 27, archive_to_input.py line 32

`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is committed to version control. Combined with a leaked service account key, this is sufficient information to read/write the entire spreadsheet.

**Fix:** Read from an environment variable: `SPREADSHEET_ID = os.environ["TRIPSTORE_SHEET_ID"]`.

---

### M9 — archive_to_input.py: make_transfer_row does not set Direction column
**File:** archive_to_input.py, lines 275–289

The Direction field (row index 6, maps to `XC.DIR` in Pipeline.gs) is left blank. Pipeline.gs `enrichTransfers` prompt explicitly requires `"ARRIVAL or DEPARTURE"`. Claude will likely mark these rows as ERROR or assign incorrect transfer types, wasting API calls.

**Fix:** Infer direction from `from_loc`/`to_loc`: if `from_loc` contains "airport" or an IATA code pattern, direction = "ARRIVAL"; if `to_loc` does, direction = "DEPARTURE". Default to "ARRIVAL" if ambiguous and note it in the Notes column.

---

## MINOR Issues (6)

### N1 — Pipeline.gs: setupTrigger uses getUi() — breaks in headless context
**File:** Pipeline.gs, line 847

`SpreadsheetApp.getUi().alert(...)` throws an error if `setupTrigger()` is called from a time-based trigger or the Apps Script editor's "Run" button in a context without a UI (e.g., triggered programmatically). The trigger is still created, but the confirmation alert crashes.

**Fix:** Replace with `Logger.log(...)` or `console.log(...)`.

---

### N2 — Quote_Intelligence.gs: quoteId collision risk
**File:** Quote_Intelligence.gs, line 140

`'Q-' + new Date().getTime().toString().slice(-8)` takes only the last 8 digits of the Unix timestamp in milliseconds. Two saves within the same second will generate the same Quote ID, causing silent duplicate rows in Quote_Log.

**Fix:** Append a random 4-character suffix: `'Q-' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(2,6).toUpperCase()`.

---

### N3 — Quote_Intelligence.gs: deprecated substr usage
**File:** Quote_Intelligence.gs, line 315

`t.substr(1)` uses the deprecated `String.prototype.substr` method. While it still works in V8 (Apps Script runtime), it may be removed in future runtimes.

**Fix:** Replace with `t.substring(1)`.

---

### N4 — write_to_sheets.py: sheet_is_empty check unreliable
**File:** write_to_sheets.py, lines 168–169

`ws.row_count == 0` is never true in gspread — newly created worksheets default to 1000 rows. The actual check `not ws.get_all_values()` works correctly, but `ws.row_count == 0` is dead code that misleads readers.

**Fix:** Remove the `ws.row_count == 0` part; use only `not ws.get_all_values()`.

---

### N5 — write_to_sheets.py: USER_ENTERED mode interprets formula strings as formulas
**File:** write_to_sheets.py, line 196

`ws.append_rows(new_rows, value_input_option="USER_ENTERED")` means any CSV cell starting with `=` will be interpreted as a Google Sheets formula. Malicious or malformed CSV input could inject sheet formulas.

**Fix:** Use `value_input_option="RAW"` for data writes.

---

### N6 — archive_to_input.py: Hardcoded IATA list in transfers city parser is stale
**File:** archive_to_input.py, lines 155–159

The regex for inferring a transfer's city name from `from_loc` contains a fixed list of IATA codes: `cdg|lhr|ams|fra|vie|bcn|fco`. Any new destination (e.g., Lisbon LIS, Athens ATH, Prague PRG) will fail to strip the airport name, producing a wrong or empty city value that Pipeline.gs will mark as ERROR.

**Fix:** Generalise the regex to match any 3-letter uppercase word (IATA pattern: `\b[A-Z]{3}\b`) rather than a hardcoded list.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3     |
| MODERATE | 9     |
| MINOR    | 6     |
| **TOTAL**| **18**|

---

## Priority Action Items

1. **[URGENT]** Hash all passwords in the Users sheet — current plaintext storage is a data breach waiting to happen.
2. **[URGENT]** Remove GET-based login (`checkLogin` in `doGet`) — credentials must never appear in URLs.
3. **[URGENT]** Move admin role check server-side — client localStorage can be trivially spoofed.
4. **[HIGH]** Add `sheets-credentials.json` to `.gitignore` and move credentials outside the repo.
5. **[HIGH]** Fix GST calculation in `buildQuoteLogRow` — quotes are logging wrong financials.
6. **[HIGH]** Guard `callClaudeAPI` response parsing — a malformed API response currently crashes the pipeline silently.
7. **[MEDIUM]** Fix `make_transfer_row` to populate Direction — blank direction causes Claude to fail enrichment.
8. **[MEDIUM]** Fix `_buildInputSheet` banner-row duplication bug — double setup breaks all pipeline row indices.
