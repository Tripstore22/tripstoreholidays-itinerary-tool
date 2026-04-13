# TripStore Code Review Report
**Date:** 2026-04-13
**Reviewer:** Claude (Automated Daily Review)
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py

> **Note:** 7 of the 12 requested files were not found in this repository: `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`. These likely live in the separate `tripstore-itinerary-archive` repo and were not reviewed.

---

## Recent Git History
```
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main — sync all app files to production
```

---

## CRITICAL Issues (3)

### CRIT-1 · Code.gs — Plaintext passwords stored and compared in Google Sheets
**Lines:** 261 (login compare), 289 (signup save)

Passwords are stored as raw strings in the "Users" Sheet and compared with a plain equality check:
```js
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim())  // line 261
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...])  // line 289
```
Anyone with view access to the Google Sheet can read every user's password. If users reuse that password on other services this is effectively a credential breach.

**Fix:** Hash passwords using `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + SALT)` converted to hex before storing. Compare the hash at login. Never store or log the raw password.

---

### CRIT-2 · Code.gs `doGet` — Login credentials exposed as URL parameters
**Lines:** 25–27

`doGet()` accepts `?action=checkLogin&user=...&pass=...` as URL query parameters:
```js
if (action === 'checkLogin') {
  return checkLogin(e.parameter.user || '', e.parameter.pass || '');
}
```
GET parameters appear in browser history, server access logs, referrer headers, and CDN cache logs. The frontend correctly uses POST, but the GET route is still open to anyone crafting a direct URL — logging credentials to multiple systems in plaintext.

**Fix:** Remove the `checkLogin` case from `doGet()` entirely. Authentication must only be handled via `doPost()`.

---

### CRIT-3 · index_fit.tripstore.html — Admin flag stored in localStorage and trusted client-side
**Lines:** 586–589, 641–651

The admin flag is written to localStorage and read back directly on every page load:
```js
localStorage.setItem("tripstore_session", JSON.stringify({ isAdmin: status === "ADMIN", ... }));
// On reload:
isAdmin = s.isAdmin;  // read directly from localStorage — no server check
```
Any user can open DevTools → Application → LocalStorage → set `isAdmin: true` → reload, and immediately see the admin panel and load any other user's full itinerary. The server-side `getAllSaved` and `search` endpoints have no auth check beyond the action name.

**Fix:** Remove `isAdmin` from localStorage. On each admin API call, send the user's credentials or a server-issued token, and verify the role in `Code.gs` before returning restricted data.

---

## MODERATE Issues (9)

### MOD-1 · Code.gs — No brute-force protection on the login endpoint
The login endpoint has no rate limiting, lockout counter, or failed-attempt tracking. An attacker can send unlimited POST requests to try passwords automatically.

**Fix:** Track failed attempts per username with a timestamp. Lock for 15 minutes after 5 failures. Return the same generic message for wrong user or wrong password to prevent username enumeration.

---

### MOD-2 · Code.gs — No server-side validation on signup fields
**Line:** 289

Fields `mobile`, `email`, `username`, and `password` are stored after only `.trim()`. An invalid email format, a mobile with letters, an empty password, or a username with special characters are all accepted.

**Fix:** Add server-side validation: email must match a regex, mobile must be 10 digits, password at least 8 characters, username alphanumeric only. Return a specific error string per failed rule.

---

### MOD-3 · Pipeline.gs — Claude response written to master sheet without column-count validation
**Lines:** 239–244

```js
const rowArr = Array.isArray(r) ? r : Object.values(r);
mst.appendRow(rowArr);
```
If Claude returns a row with the wrong number of columns (e.g., drops the Annual Avg field for hotels), it appends misaligned data to the master sheet. The front-end reads that sheet directly, so corrupt rows flow straight to live quotes. There is no rollback.

**Fix:** Before `appendRow`, assert `rowArr.length === EXPECTED_COL_COUNT[type]`. Mark as ERROR and skip if mismatch.

---

### MOD-4 · Pipeline.gs — No elapsed-time guard: Apps Script 6-minute hard timeout risk
**Lines:** 146–161

All 4 sheets are processed sequentially with `Utilities.sleep(1500)` between every Claude batch. With 100+ pending rows the run will exceed Google Apps Script's 6-minute execution limit and be killed mid-batch, leaving rows in a partially-updated state.

**Fix:** Check elapsed time before each batch: `if (new Date() - start > 5.5 * 60 * 1000) { auditLog(ss, 'TIME LIMIT — stopping cleanly'); return stats; }`. Remaining rows stay PENDING for the next nightly run.

---

### MOD-5 · Pipeline.gs — No rollback if master sheet write succeeds but row marking fails
**Lines:** 240–248

If `mst.appendRow()` succeeds but `markRow()` throws (quota, timeout), the row stays PENDING and will be enriched again on the next run, creating a duplicate in the master sheet.

**Fix:** Wrap the append + mark sequence in a try/catch. On any failure after a successful append, mark the row ERROR with the reason so it is not reprocessed silently.

---

### MOD-6 · Quote_Intelligence.gs — Infinite recursion risk in `logQuote()`
**Lines:** 33–37

```js
if (!logSheet) {
  setupQuoteLog();
  return logQuote(paxName, data);  // unconditional retry
}
```
If `setupQuoteLog()` fails silently (permissions error, quota) or `getSheetByName` still returns null after creation (Apps Script race condition), this recurses indefinitely until Apps Script kills it with a stack overflow, blocking the originating `saveItinerary` call.

**Fix:** Add a `retried = false` parameter. If already retried once, log the error and return without recursing.

---

### MOD-7 · Quote_Intelligence.gs — `setupQuoteLog()` silently destroys all history if run twice
**Line:** 197

```js
ws.clear();
```
Running `setupQuoteLog()` a second time from the Apps Script menu silently wipes the entire Quote_Log with no confirmation and no backup warning.

**Fix:** Before clearing, check `if (ws.getLastRow() > 1)` and show a UI alert warning that data already exists. Require explicit intent before proceeding.

---

### MOD-8 · write_to_sheets.py + archive_to_input.py — Hardcoded Spreadsheet ID and credentials path
**write_to_sheets.py lines 28–30; archive_to_input.py lines 31–33**

```python
SPREADSHEET_ID   = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
CREDENTIALS_PATH = Path("./sheets-credentials.json")
```
The same production Sheet ID is hardcoded in both files. The credentials file is expected in the working directory with no protection against accidental git commit.

**Fix:** Read IDs from environment variables with a clear error if unset. Confirm `sheets-credentials.json` is in `.gitignore` and absent from git history (`git log --all --full-history -- sheets-credentials.json`).

---

### MOD-9 · archive_to_input.py — No error handling on `append_rows()` API calls
**Lines:** 388–391

```python
ss.worksheet(sheet_name).append_rows(rows, value_input_option="USER_ENTERED")
```
If the Sheets API call fails (quota exceeded, network timeout), the exception propagates and the script exits. The summary printed at the end incorrectly reports rows as queued.

**Fix:** Wrap each `append_rows` call in try/except, log failures per category, and report failed categories clearly in the final summary rather than crashing.

---

## MINOR Issues (7)

### MIN-1 · Code.gs — Hardcoded column indices break silently if sheet columns change
**Lines:** 99 (`r[18]`), 155 (`r[10]`)

```js
const annualAvg = parsePrice(r[18]);   // assumed Column S = Annual Avg
const tags = String(r[10] || '').trim();  // assumed Column K = Attraction Tags
```
Inserting or deleting a column in the Sheet shifts all indices without any error — wrong data is silently served to the live app.

**Fix:** Read the header row once per function call and build a `colIndex = headers.indexOf('Annual Avg (INR)')` map. Use named lookups instead of magic numbers.

---

### MIN-2 · Quote_Intelligence.gs — Quote ID has collision risk in bulk backfill
**Line:** 140

```js
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```
The last 8 digits of a millisecond timestamp cycle every ~27 hours. Running `backfillQuoteLog()` on hundreds of rows in rapid succession produces duplicate IDs since `new Date()` may not advance between iterations in Apps Script.

**Fix:** Use the full timestamp without slicing, or pass a row counter into `buildQuoteLogRow()` and append it as a suffix.

---

### MIN-3 · Quote_Intelligence.gs — `backfillQuoteLog()` has no duplicate detection
**Lines:** 288–308

Running `backfillQuoteLog()` twice imports all historical quotes a second time, creating duplicate rows in Quote_Log with no check for existing entries.

**Fix:** Before appending a row, check if a row for the same Pax Name already exists in Quote_Log, or add a "backfilled" flag column on the Saved_Itineraries sheet.

---

### MIN-4 · Pipeline.gs — Batch result undershoot not detected
**Lines:** 228–249

```js
results.forEach((res, idx) => {
  const row = batch[idx];
  if (!row) return;   // handles overshoot only
```
If Claude returns 3 results for a batch of 5, rows 4 and 5 are silently left PENDING with no error logged. They will be retried on the next run, incurring additional API cost.

**Fix:** After the forEach, check `if (results.length < batch.length)` and mark the untouched rows as ERROR with reason "Claude returned fewer results than expected".

---

### MIN-5 · archive_to_input.py — Incomplete IATA code list in transfer city parser
**Lines:** 155–160

The regex split pattern covers only: `cdg|lhr|ams|fra|vie|bcn|fco`. Major airports like MUC (Munich), ZRH (Zurich), BRU (Brussels), VCE (Venice), ATH (Athens), DUB (Dublin), PRG (Prague) are absent, causing city extraction to fall back to the first word of the description for those routes.

**Fix:** Extend the IATA code list, or after the regex split, if city extraction yields a single letter or all-caps result, fall back to the first word before the first space.

---

### MIN-6 · write_to_sheets.py — `ws.row_count == 0` is always false in gspread
**Line:** 168

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```
In gspread, `row_count` reflects the sheet's defined grid size (default 1000), never 0. This condition never triggers. The fallback `not ws.get_all_values()` is correct but the first part is dead code.

**Fix:** Simplify to `sheet_is_empty = not ws.get_all_values()`.

---

### MIN-7 · index_fit.tripstore.html — Vehicle dropdown fires optimizer without debounce
**Line:** 187

```html
<select id="vehicleTypeSelect" onchange="runOptimizer(false, false)">
```
Rapid dropdown changes (keyboard arrow keys) fire `runOptimizer` on every key press. For large itineraries this queues multiple simultaneous recalculations.

**Fix:** Debounce 300ms: clear and reset a `setTimeout` before calling `runOptimizer`.

---

## Summary Table

| # | Severity | File | Issue | Effort |
|---|----------|------|-------|--------|
| CRIT-1 | CRITICAL | Code.gs | Plaintext passwords in Sheets | Medium |
| CRIT-2 | CRITICAL | Code.gs | checkLogin in doGet exposes credentials in URL | Low |
| CRIT-3 | CRITICAL | index_fit.tripstore.html | isAdmin trusted from localStorage | Medium |
| MOD-1 | MODERATE | Code.gs | No brute-force protection on login | Medium |
| MOD-2 | MODERATE | Code.gs | No server-side signup validation | Low |
| MOD-3 | MODERATE | Pipeline.gs | Claude rows written without column-count check | Low |
| MOD-4 | MODERATE | Pipeline.gs | 6-minute timeout risk — no elapsed-time guard | Low |
| MOD-5 | MODERATE | Pipeline.gs | No rollback on partial write failure | Low |
| MOD-6 | MODERATE | Quote_Intelligence.gs | Infinite recursion in logQuote() | Low |
| MOD-7 | MODERATE | Quote_Intelligence.gs | setupQuoteLog() wipes history if run twice | Low |
| MOD-8 | MODERATE | write_to_sheets.py / archive_to_input.py | Hardcoded Sheet ID + credentials path | Low |
| MOD-9 | MODERATE | archive_to_input.py | No error handling on append_rows() | Low |
| MIN-1 | MINOR | Code.gs | Hardcoded column indices (r[18], r[10]) | Low |
| MIN-2 | MINOR | Quote_Intelligence.gs | Quote ID collision risk in backfill | Low |
| MIN-3 | MINOR | Quote_Intelligence.gs | backfillQuoteLog() has no duplicate check | Low |
| MIN-4 | MINOR | Pipeline.gs | Batch undershoot not detected or logged | Low |
| MIN-5 | MINOR | archive_to_input.py | Incomplete IATA list in transfer parser | Low |
| MIN-6 | MINOR | write_to_sheets.py | Dead code: ws.row_count == 0 never true | Trivial |
| MIN-7 | MINOR | index_fit.tripstore.html | Vehicle dropdown fires optimizer without debounce | Trivial |

**Total: 3 Critical · 9 Moderate · 7 Minor = 19 issues**

---

## Files Not in This Repository (not reviewed)
The following 7 files requested for review do not exist in `tripstoreholidays-itinerary-tool`. They likely live in the `tripstore-itinerary-archive` repo:

- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

Schedule a separate review run against that repo.

---

*Generated automatically by Claude Code daily review — 2026-04-13*
