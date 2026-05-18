# TripStore Code Review Report
**Date:** 2026-05-18
**Reviewed by:** Automated daily review
**Git log (last 10):**
```
56edcaa Auto: daily code review
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main — sync all app files to production
f3b87ad Sync index.html with index_fit.tripstore.html
```

**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py

**Files requested but NOT found in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py — these likely live in a separate local pipeline folder and are not committed to this repo.

---

## Summary

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 3     |
| MODERATE  | 11    |
| MINOR     | 7     |

---

## Code.gs

### CRITICAL — Passwords Stored and Compared in Plaintext
**Line 261:** `if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim())`

Passwords in the Users sheet are stored as raw plain text and compared with `===`. If the Google Sheet is ever accessed by an unauthorised person (shared link, permission mishap, accidental public sharing), all user passwords are instantly exposed. There is no hashing at all.

**Fix:** Store passwords as SHA-256 hashes. On signup, hash before writing. On login, hash the incoming password and compare. Apps Script has `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass)`.

---

### CRITICAL — checkLogin via POST Will Break on Next Code.gs Redeploy
**Code.gs doPost (lines 44–57):** `doPost` handles only `signup` and `saveItinerary` — `checkLogin` is only handled in `doGet`.

**index_fit.tripstore.html line 583:** `await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })`

The frontend sends `checkLogin` as a **POST**, but `doPost` does not handle it. The currently deployed Apps Script is likely an older copy that still had `checkLogin` in `doPost`. On the **next redeploy** of Code.gs, all logins will silently fail with "Invalid Credentials" and the site will be unusable.

**Fix (5 minutes):** Add to `doPost` in Code.gs:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### MODERATE — No Auth on getAllSaved and searchItinerary
**Lines 299–335:** Both endpoints return customer data with zero authentication. Anyone who discovers the Apps Script `/exec` URL can enumerate all saved pax names via `?action=getAllSaved`, then read any full itinerary JSON via `?action=search&name=...` directly in a browser. No session token is required.

**Fix:** Require an API secret header or move sensitive operations to POST with a session token check.

---

### MODERATE — No Rate Limiting on Login Endpoint
`checkLogin` loops through the entire Users sheet on every call with no lockout, no CAPTCHA, no attempt counter. An attacker can brute-force passwords with unlimited speed.

**Fix:** Track failed attempts per username in a sheet column. Lock the account after 5 consecutive failures.

---

### MODERATE — saveItinerary Has No Auth Check
**Line 342:** Anyone knowing the API URL and any pax name can overwrite that person's saved itinerary. There is no check that the caller is the logged-in owner.

---

### MINOR — getIntercity Does Not Filter Zero-Price Rows
**Lines 228–240:** Hotels and Sightseeing both filter out `price <= 0` rows, but `getIntercity` returns all train/ferry rows including those with `price: 0`. Zero-price rows appear in the intercity dropdown and corrupt cost totals.

**Fix:** Add `if (parsePrice(r[5]) <= 0) continue;` in the `getIntercity` loop.

---

## Pipeline.gs

### MODERATE — _buildInputSheet Inserts Duplicate Banner Row on Repeated Runs
**Line 779:** `ws.insertRowBefore(2)` is called unconditionally. If `setupSheets()` is run a second time (common when adding a new tab or after a reset), every existing INPUT sheet gets an extra row inserted at position 2, pushing all data down by one row. After 3 runs, data starts at row 5. The pipeline's `getPendingRows` function skips rows 1–2 (`for (let i = 2; ...)`), so it will miss data rows that have been pushed down — silently processing nothing.

**Fix:** Check whether row 2 is already the banner before inserting:
```javascript
const existing = ws.getRange(2, 1).getValue().toString();
if (!existing.startsWith('ℹ️')) ws.insertRowBefore(2);
```

---

### MODERATE — No Retry for Claude API — Single Transient Error Marks Whole Batch as ERROR
**Lines 564–598 (`callClaudeAPI`):** If Claude returns a transient error (rate limit 429, timeout, 500), the entire batch of 5 rows is immediately marked ERROR. Since the pipeline only runs once per day, those rows stay red until a human manually runs `resetErrorRows()`.

**Fix:** Add a simple 2-attempt retry with 5-second delay before marking as error.

---

### MODERATE — Object.values() Fallback Produces Unpredictable Column Order
**Line 242:** `const rowArr = Array.isArray(r) ? r : (r && typeof r === 'object' ? Object.values(r) : [String(r)]);`

When Claude returns a JSON object instead of an array, `Object.values()` returns properties in insertion order, which may differ from the expected sheet column order. Wrong values silently land in wrong columns with no error raised.

**Fix:** If Claude returns an object, extract values by explicit key names in the correct sequence rather than using `Object.values()`.

---

### MODERATE — anthropic-version Header Is Pinned to Oldest Supported Version
**Line 572:** `'anthropic-version': '2023-06-01'`

This is the oldest API version Anthropic still supports. Newer versions add prompt caching, which would meaningfully reduce Claude API costs for this nightly batch workload where prompt structure is largely static.

---

### MINOR — Model Name Will Silently Break When Anthropic Retires It
**Line 39:** `MODEL: 'claude-haiku-4-5-20251001'`

This hardcoded dated model string will eventually be retired. When it is, the pipeline will start throwing API errors with no diagnostic message pointing at the model name. There is no startup validation.

**Fix:** Document the model and add a note to update it when Anthropic publishes a retirement notice. Alternatively, fetch the model name from Script Properties so it can be changed without a code edit.

---

### MINOR — No Within-Batch Sleep for Rate Limiting
**Line 252:** A 1.5s sleep is added between batches but each batch is a single Claude call, so this is currently adequate. However, if `BATCH_SIZE` is ever increased, multiple rapid Claude calls per batch could trigger rate limiting. Worth noting for future-proofing.

---

## Quote_Intelligence.gs

### CRITICAL — logQuote Has Infinite Recursion Risk
**Lines 29–47:**
```javascript
function logQuote(paxName, data) {
  const logSheet = ss.getSheetByName('Quote_Log');
  if (!logSheet) {
    setupQuoteLog();         // may fail silently
    return logQuote(paxName, data); // RECURSIVE — no base case if sheet creation fails
  }
}
```

If `setupQuoteLog()` fails (quota exceeded, permission error, structural issue), it returns without creating the sheet. `logQuote` then calls itself recursively until a stack overflow, which also crashes the parent `saveItinerary` call and **loses the customer's itinerary save silently**.

**Fix (10 minutes):** Add a retry guard:
```javascript
function logQuote(paxName, data, isRetry = false) {
  const logSheet = ss.getSheetByName('Quote_Log');
  if (!logSheet) {
    if (isRetry) { Logger.log('Quote_Log missing — skipping log'); return; }
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
  ...
}
```

---

### MODERATE — Quote ID Has Collision Risk Every ~28 Hours
**Line 140:** `const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);`

The last 8 digits of a millisecond Unix timestamp cycle every ~27.8 hours. Two saves at the same clock time on consecutive days produce identical Quote IDs. Duplicate IDs break pivot tables, outcome tracking, and any future lookup by ID in the Quote_Log sheet.

**Fix (5 minutes):**
```javascript
const quoteId = 'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
```

---

### MINOR — GST Rate Always Logs as 5% Regardless of Agent Selection
**Line 119:** `const gstPct = d.gst || 5;`

The `saveItinerary` payload stores `gstMode` (a string: `'5pkg'`, `'18svc'`, `'none'`) but never a numeric `d.gst` field. So `d.gst` is always `undefined`, and `gstPct` always defaults to 5%. Quote_Log will always show 5% GST even when the agent used the 18% service charge mode, corrupting financial reporting.

**Fix (5 minutes):**
```javascript
const gstPct = d.gstMode === '18svc' ? 18 : d.gstMode === '5pkg' ? 5 : 0;
```

---

## index_fit.tripstore.html

### MODERATE — Session Token in localStorage Has No Expiry
**Lines 586–588 / 641–652:** Login session is stored in `localStorage` with no expiry timestamp. A session persists forever until the user explicitly logs out. On a shared or public device (common in travel agency offices), the session remains active indefinitely.

**Fix:** Add a `loginAt` field to the stored session object. In `checkAutoLogin`, reject sessions older than 24 hours:
```javascript
if (Date.now() - s.loginAt > 86400000) { localStorage.removeItem("tripstore_session"); return; }
```

---

### MODERATE — Fetch Response Status Not Checked
**Lines 583–596 (`checkLogin`):** `res.text()` is called directly without checking `res.ok`. If the Apps Script returns a redirect (re-auth flow) or an error page, the raw HTML is compared against `"ADMIN"` / `"USER"` and silently treated as wrong credentials. The developer has no way to distinguish an auth failure from a deployment problem.

---

### MINOR — Itinerary Date Comes from Client Clock
**Line 687:** `document.getElementById('currentDate').innerText = DATE: ${new Date()...}`

The date printed on the customer-facing travel proposal comes from the user's browser clock. A device with the wrong date (common) will print an incorrect date on a professional document.

---

### MINOR — City Name Injected into innerHTML Without Escaping
**Line 686:** `` cities.map(c => `<option value="${c}">`) ``

City names from the Google Sheet are injected directly into innerHTML. If a city name contains `"` or `>`, it could break the datalist markup. Low risk given controlled data, but worth escaping.

---

## write_to_sheets.py

### MODERATE — sheet_is_empty Check Is Unreliable
**Line 168:** `sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()`

`ws.row_count` in gspread returns the declared row capacity (default 1000 for a newly created sheet via `add_worksheet`), not the count of non-empty rows. A brand-new empty sheet returns `row_count == 1000`, not 0. The `or not ws.get_all_values()` clause saves the logic today, but the first condition is incorrect and dangerous if the code is ever modified.

**Fix:** Remove `ws.row_count == 0` and rely solely on `not ws.get_all_values()`.

---

### MINOR — Spreadsheet ID Hardcoded in Two Files
**write_to_sheets.py line 28 / archive_to_input.py line 32:** Same SPREADSHEET_ID string in both files. If the sheet is ever migrated, both files must be updated manually with no safeguard against a missed update silently writing to the wrong sheet.

**Fix:** Use an environment variable:
```python
import os
SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID", "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM")
```

---

## archive_to_input.py

### MODERATE — Cell Parsers Are Brittle to Extra or Missing Pipe Segments
**Lines 63–76 (`parse_hotels_cell`):** Parser iterates in steps of 4 assuming exactly `city|name|nights|cost` per hotel. If a hotel name contains a pipe character, the parser misaligns all subsequent entries in that cell and silently skips them without any warning. Same fragility exists in `parse_sightseeing_cell` (step 3) and `parse_trains_cell` (step 2). No validation or warning is raised when `len(parts)` is not a clean multiple of the step size.

**Fix:** Log a warning when `len(parts) % step != 0`.

---

### MINOR — Transfer City Extraction Falls Back to First Word
**Lines 155–161:** If the airport-keyword regex split fails, city falls back to `from_loc.split()[0]` — the first word of the location string. For `"Terminal 2 CDG to Hotel"`, city would be extracted as `"Terminal"` rather than anything useful.

---

### MINOR — CSV Column Names Not Validated at Startup
**Line 340:** `row.get("Hotels Used", "")` — if the CSV was exported with a slightly different column name (capitalisation difference, trailing space), the column returns empty string for every row, silently skipping all hotels with no warning.

**Fix:** At startup, assert that all expected column names exist in `archive_rows[0].keys()` if `archive_rows` is non-empty.

---

## Prioritised Action Items

| Priority | Action | Severity | File | Est. Time |
|----------|--------|----------|------|-----------|
| 1 | Add `checkLogin` to `doPost` before next redeploy | CRITICAL | Code.gs | 5 min |
| 2 | Add recursion guard to `logQuote` | CRITICAL | Quote_Intelligence.gs | 10 min |
| 3 | Fix GST rate derivation in `buildQuoteLogRow` | MODERATE | Quote_Intelligence.gs | 5 min |
| 4 | Fix Quote ID collision (add random suffix) | MODERATE | Quote_Intelligence.gs | 5 min |
| 5 | Hash passwords in signup + update login comparison | CRITICAL | Code.gs | 30 min |
| 6 | Guard `_buildInputSheet` banner from double-insertion | MODERATE | Pipeline.gs | 10 min |
| 7 | Add session expiry to localStorage auto-login | MODERATE | index_fit.tripstore.html | 10 min |
| 8 | Fix `sheet_is_empty` check in write_to_sheets.py | MODERATE | write_to_sheets.py | 5 min |
| 9 | Add retry logic to `callClaudeAPI` | MODERATE | Pipeline.gs | 15 min |
| 10 | Add auth on `getAllSaved` and `searchItinerary` | MODERATE | Code.gs | 20 min |
| 11 | Add zero-price filter to `getIntercity` | MINOR | Code.gs | 2 min |
| 12 | Move SPREADSHEET_ID to env var in Python scripts | MINOR | write_to_sheets.py, archive_to_input.py | 10 min |
| 13 | Add CSV column validation in archive_to_input.py | MINOR | archive_to_input.py | 10 min |

---

*Report generated automatically — 2026-05-18*
