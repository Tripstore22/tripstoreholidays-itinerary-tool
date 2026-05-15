# TripStore Code Review — 2026-05-15

**Reviewer:** Automated (Claude)
**Scope:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Files requested but NOT found in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py — these 7 files were not present; they may live only on the local machine.

---

## Recent Commits
```
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main
e6a35d9 Merge v2 into main — sync all app files to production
f3b87ad Sync index.html with index_fit.tripstore.html
a105e1d Fix security issues and add budget suggestion hints
```

---

## FILES NOT FOUND IN REPO
The following files listed in the review scope do not exist in this repository:
- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

These may live only on Sumit's Mac. **Action required: confirm if these scripts are still in use and add them to version control.**

---

## CRITICAL Issues (3)

### C1 — Code.gs: Login probably broken — `checkLogin` not handled in `doPost`
**File:** `Code.gs` lines 43–57 vs `index_fit.tripstore.html` line 583

The frontend sends login credentials as a **POST** request with a JSON body:
```javascript
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })
```
But `doPost()` in Code.gs only handles `"signup"` and `"saveItinerary"`. A POST body with `action: "checkLogin"` falls through to `return ContentService.createTextOutput('Invalid action')`. The UI would always show "❌ Invalid Credentials".

Meanwhile, `checkLogin` IS handled in `doGet()` (line 25) using URL query parameters (`e.parameter.user`, `e.parameter.pass`). There is a mismatch. If login is working in production, **the deployed GAS script differs from this file — the repo is out of sync with the live app.**

**Fix:** Add a `checkLogin` case to `doPost` that reads credentials from `data.username` / `data.password` (consistent with the POST body format).

---

### C2 — Code.gs: Passwords stored in plaintext in Google Sheets
**File:** `Code.gs` lines 258–268, 289

Both `checkLogin()` and `handleSignup()` compare and store passwords as raw strings in the Users sheet. If the spreadsheet is shared with any third party (even read-only), all user passwords are immediately visible. Google's sharing-link feature creates further risk.

**Fix:** Use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` to hash before storing, and compare hash-to-hash on login.

---

### C3 — Code.gs: `getAllSaved`, `searchItinerary`, and `getQuoteLog` expose customer data without authentication
**File:** `Code.gs` lines 29–35

Anyone who knows the GAS `exec` URL — which is hardcoded in the HTML source at line 426 — can call:
- `?action=getAllSaved` → full list of all customer pax names
- `?action=search&name=X` → complete saved itinerary JSON for any customer
- `?action=getQuoteLog` → all quote financials (grand totals, hotel nets, GST, markup %) for every customer

There is zero auth on these endpoints. This is a customer PII and financial data exposure risk.

**Fix:** Require a shared secret token in the request checked against a Script Property, or change the GAS deployment to "Execute as me, only logged-in Google accounts." At minimum, remove `getQuoteLog` and `getAllSaved` from `doGet` and move them to `doPost` with a token check.

---

## MODERATE Issues (8)

### M1 — Pipeline.gs: Hardcoded stale EUR/INR exchange rate
**File:** `Pipeline.gs` line 463

```javascript
"INR price at ₹110/€"
```
As of mid-2026 the EUR/INR rate is approximately ₹90–95. Using ₹110/€ means Claude back-calculates train EUR prices roughly 15–20% too high, leading to systematically inflated `avg_e` values written to the Trains master sheet.

**Fix:** Update the hardcoded value to `₹92` and set a calendar reminder to re-check quarterly, or fetch the rate live using `UrlFetchApp.fetch('https://open.er-api.com/v6/latest/EUR')` at pipeline start.

---

### M2 — Pipeline.gs: `_buildInputSheet()` adds a duplicate banner row on every re-run of `setupSheets()`
**File:** `Pipeline.gs` line 779

```javascript
ws.insertRowBefore(2);
```
Every call to `setupSheets()` inserts a new row at position 2 without checking if a banner already exists. Re-running the setup (e.g., after adding a new column) silently stacks multiple banner rows, pushing data rows down and breaking the `getPendingRows()` row-offset assumption that data starts at row 3.

**Fix:** Before inserting, check if row 2 already has banner content:
```javascript
const existingBanner = ws.getRange(2, 1).getValue().toString();
if (!existingBanner.startsWith('ℹ️')) {
  ws.insertRowBefore(2);
}
```

---

### M3 — Pipeline.gs: No retry logic in `callClaudeAPI` — transient errors poison whole batches
**File:** `Pipeline.gs` lines 564–598

A single HTTP timeout or 5xx from the Anthropic API causes the `catch` block to return `valid: false` for **every row in the batch**. All 5 rows get marked ERROR in red and require manual `resetErrorRows()` intervention the next morning.

**Fix:** Add one retry with a short wait:
```javascript
if (response.getResponseCode() !== 200) {
  Utilities.sleep(3000);
  response = UrlFetchApp.fetch(...); // repeat call once
}
```

---

### M4 — Pipeline.gs: Batch result count mismatch — rows silently skipped if Claude returns fewer items
**File:** `Pipeline.gs` lines 228–249

`results.forEach((res, idx) => { const row = batch[idx]; if (!row) return; ... })` — if Claude returns 3 results for a 5-row batch, rows 4 and 5 in `batch` are never touched. They stay PENDING and will be re-sent to Claude every night indefinitely, silently wasting API quota.

**Fix:** After the forEach, check `results.length === batch.length`. Mark any unprocessed batch rows ERROR with reason "Claude returned incomplete batch — recheck next run."

---

### M5 — Quote_Intelligence.gs: `logQuote()` can recurse infinitely if `setupQuoteLog()` fails
**File:** `Quote_Intelligence.gs` lines 33–37

```javascript
if (!logSheet) {
  setupQuoteLog();
  return logQuote(paxName, data); // retry
}
```
If `setupQuoteLog()` fails silently (permissions, quota exceeded), the retry recurses into `logQuote` again, which again finds no sheet, and loops until Apps Script hits the call-stack limit. This will also crash the parent `saveItinerary` call, meaning the customer's itinerary is not saved.

**Fix:** Add a `_retry` guard:
```javascript
function logQuote(paxName, data, _retry = false) {
  ...
  if (!logSheet) {
    if (_retry) return; // give up, don't crash the save
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
```

---

### M6 — Quote_Intelligence.gs: `backfillQuoteLog()` creates duplicates if run a second time
**File:** `Quote_Intelligence.gs` lines 278–309

`backfillQuoteLog()` appends all rows from `Saved_Itineraries` to `Quote_Log` without checking if they already exist in the log. Running it twice doubles every historical entry.

**Fix:** Before appending, build a Set of pax names already present in `Quote_Log` and skip any that match.

---

### M7 — index_fit.tripstore.html: XSS via sheet data injected into `innerHTML` without escaping
**File:** `index_fit.tripstore.html` lines 686, 1390–1391, 1396, 1445

```javascript
document.getElementById('cityList').innerHTML = cities.map(c => `<option value="${c}">`).join('');
```
City names, hotel names, tour names, and notes all come from the Google Sheet and are injected directly into `innerHTML` via template literals. If any value contains `">` or `<script>`, it can execute arbitrary JavaScript in the agent's browser session, potentially stealing the localStorage session token.

**Fix:** Use `textContent` / `createElement` for data from the sheet, or add a global escaping helper:
```javascript
const esc = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
```
and wrap every sheet value: `<option value="${esc(c)}">`

---

### M8 — write_to_sheets.py: `ws.row_count == 0` check is always False (dead code)
**File:** `write_to_sheets.py` line 168

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```
`ws.row_count` returns the worksheet's allocated row capacity (default 1000), not the number of populated rows. It will never equal 0. The empty-sheet check works only because of the `not ws.get_all_values()` fallback — the first condition is dead code.

**Fix:** Simplify to:
```python
sheet_is_empty = not ws.get_all_values()
```

---

## MINOR Issues (5)

### N1 — Code.gs: No input length validation on signup fields
**File:** `Code.gs` lines 276–291

`handleSignup()` accepts and appends user-supplied values with no length limits. A malicious user could submit a multi-megabyte password or username, bloating the Users sheet.

**Fix:** Add a guard at the top of `handleSignup`:
```javascript
if (!username || username.length > 50 || password.length > 128) {
  return ContentService.createTextOutput('Invalid input');
}
```

---

### N2 — index_fit.tripstore.html: `isAdmin` role trusted from `localStorage` — client-side privilege escalation
**File:** `index_fit.tripstore.html` lines 587, 629, 642

The session object `{ isLoggedIn: true, isAdmin: true }` is saved to and read from `localStorage`. Any user can open DevTools → Application → localStorage and manually flip `isAdmin` to `true` to access the Admin panel and load any saved itinerary. Combined with C3 (no server-side auth), this is trivially exploitable.

**Fix:** Do not store the isAdmin flag in localStorage. Instead, require a server-side check on any admin-level action.

---

### N3 — archive_to_input.py / write_to_sheets.py: Hardcoded Spreadsheet ID
**Files:** `archive_to_input.py` line 32, `write_to_sheets.py` line 27

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
```
Hardcoding makes it impossible to test against a staging spreadsheet without modifying source.

**Fix:** `SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID", "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM")`

---

### N4 — archive_to_input.py: Pipe-delimited CSV cell parser is fragile
**File:** `archive_to_input.py` lines 63–171

Hotel/sightseeing/train/transfer data is encoded as pipe-separated strings with a fixed step size (hotels: step=4, sightseeing: step=3). If any field contains `|` (e.g., "Château | Spa"), the parser shifts out of phase and silently misparses all remaining entries.

**Fix:** Enforce no pipes in upstream data, or switch to a JSON-encoded column.

---

### N5 — Pipeline.gs: No memory-scale limit noted for master sheet reads
**File:** `Pipeline.gs` lines 263–270

`buildMasterKeySet()` loads the entire master sheet into memory every pipeline run. Fine now, but once Hotels/Sightseeing exceed ~5,000 rows this could hit Apps Script's ~50MB memory limit.

**Fix:** No immediate action. When sheets exceed 3,000 rows, switch to `masterSheet.getRange('A:B').getValues()` (key columns only).

---

## Action Items Summary

| # | Severity | File | Issue |
|---|---|---|---|
| C1 | CRITICAL | Code.gs / index_fit.tripstore.html | checkLogin not in doPost — login mismatch, repo may be out of sync |
| C2 | CRITICAL | Code.gs | Plaintext passwords in Google Sheet |
| C3 | CRITICAL | Code.gs | Customer PII/financials accessible with no auth via GET endpoints |
| M1 | MODERATE | Pipeline.gs | EUR/INR rate ₹110 is stale (~₹92 today) |
| M2 | MODERATE | Pipeline.gs | setupSheets() adds duplicate banner row on every re-run |
| M3 | MODERATE | Pipeline.gs | No retry on Claude API transient errors |
| M4 | MODERATE | Pipeline.gs | Batch count mismatch rows silently stay PENDING forever |
| M5 | MODERATE | Quote_Intelligence.gs | logQuote() can infinite-recurse and crash saveItinerary |
| M6 | MODERATE | Quote_Intelligence.gs | backfillQuoteLog() creates duplicates if run twice |
| M7 | MODERATE | index_fit.tripstore.html | XSS — sheet data in innerHTML without escaping |
| M8 | MODERATE | write_to_sheets.py | ws.row_count == 0 is dead code, always False |
| N1 | MINOR | Code.gs | No input length limits on signup |
| N2 | MINOR | index_fit.tripstore.html | isAdmin from localStorage is client-controlled |
| N3 | MINOR | Both .py files | SPREADSHEET_ID hardcoded, not env-variable |
| N4 | MINOR | archive_to_input.py | Pipe-delimited parser breaks on pipes in data |
| N5 | MINOR | Pipeline.gs | No note on memory scale assumption for large master sheets |
| INFO | — | Repo | 7 Python scripts in review scope not found in repository |

**Total: 3 Critical · 8 Moderate · 5 Minor · 1 Info**
