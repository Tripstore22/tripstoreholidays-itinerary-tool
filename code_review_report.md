# TripStore Code Review Report
**Date:** 2026-04-30
**Reviewed by:** Automated Daily Review (Claude)
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Files requested but NOT present in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## SUMMARY

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 3     |
| MODERATE  | 10    |
| MINOR     | 7     |
| **TOTAL** | **20** |

---

## CRITICAL ISSUES

**File:** `index_fit.tripstore.html` line ~583 | `Code.gs` lines 43–58

### [CRITICAL-1] Passwords stored in plain text — Code.gs line 289

**File:** Code.gs  
**Function:** `handleSignup()`

Passwords are appended to the Google Sheet with `sheet.appendRow([username, password.trim(), 'PENDING', ...])`. Anyone with view access to the Google Sheet can read every user's password. There is also no minimum password complexity check.

**Fix:** Hash passwords before storing. Use a server-side hash (e.g. `Utilities.computeDigest` with SHA-256) or better, move to Google OAuth / Firebase Auth entirely and eliminate the Users sheet.

---

### [CRITICAL-2] Login request sent as POST but Code.gs only handles checkLogin in doGet — login is broken for new sessions

**Files:** index_fit.tripstore.html line 583 / Code.gs lines 43–58

The frontend calls:
```javascript
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })
```

But `doPost()` in Code.gs only handles `signup` and `saveItinerary`. A `checkLogin` action arriving at `doPost` falls through to `return ContentService.createTextOutput('Invalid action')`. This means any new login attempt returns "Invalid action", and the UI shows "❌ Invalid Credentials".

Existing users still appear logged in only because their session is stored in `localStorage` from a previous working deployment. New users or anyone who logs out will be unable to log back in.

**Fix:** Move the `checkLogin` handler into `doPost` in Code.gs, or change the frontend to use a GET request with query parameters for login.

---

### [CRITICAL-3] Admin access can be faked via localStorage manipulation — index_fit.tripstore.html lines 641–652

**File:** index_fit.tripstore.html  
**Function:** `checkAutoLogin()`

On page load, admin status is determined purely from localStorage:
```javascript
const s = JSON.parse(saved);
isAdmin = s.isAdmin;
launchApp(s.modeText);
```

Any user (or browser extension) can open DevTools, type:
```javascript
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
…and gain full admin access — including loading any saved itinerary — without a valid password.

**Fix:** The server must verify the session on every admin-only API call. Add a signed token (e.g., HMAC of username+timestamp using a secret stored in Script Properties) to the session, and verify it server-side on `getAllSaved` and `search` requests.

---

## MODERATE ISSUES

---

### [MODERATE-1] No rate limiting on login — brute-force attack possible

**File:** Code.gs / index_fit.tripstore.html

There is no lockout or delay after repeated failed login attempts. An attacker can script unlimited password guesses against the API URL (which is visible in the page source at HTML line 426).

**Fix:** Track failed attempts by username in a Sheets column. Lock the account for 15 minutes after 5 consecutive failures.

---

### [MODERATE-2] Session has no expiry

**File:** index_fit.tripstore.html lines 586–588

Sessions stored in localStorage never expire. A user who logged in months ago on a shared or stolen device remains permanently authenticated.

**Fix:** Store a `loginTimestamp` in the session object and reject sessions older than 7 days in `checkAutoLogin()`.

---

### [MODERATE-3] `getQuoteLog` returns all financial data with no authentication check

**File:** Code.gs lines 372–418

`doGet` dispatches `getQuoteLog` with no authentication. Anyone who knows the API URL (visible in the page source) can call:
```
https://script.google.com/.../exec?action=getQuoteLog
```
…and receive the full quote log including pax names, travel cities, grand totals, and markup percentages for every customer.

**Fix:** Add a secret token query parameter and validate it server-side before returning quote log data.

---

### [MODERATE-4] Formula injection via `value_input_option="USER_ENTERED"`

**Files:** write_to_sheets.py line 196 / archive_to_input.py line 390

Both scripts call `append_rows(..., value_input_option="USER_ENTERED")`. If any CSV value begins with `=`, `+`, `-`, or `@`, Google Sheets will execute it as a formula. A hotel name like `=IMPORTRANGE(...)` in the CSV could exfiltrate data from the spreadsheet.

**Fix:** Change to `value_input_option="RAW"` in both scripts.

---

### [MODERATE-5] `logQuote()` recursive call without base case — Quote_Intelligence.gs lines 33–37

**File:** Quote_Intelligence.gs  
**Function:** `logQuote()`

```javascript
if (!logSheet) {
  setupQuoteLog();
  return logQuote(paxName, data); // recursive retry with no exit if setup fails
}
```

If `setupQuoteLog()` fails (permissions error, quota exceeded), this recursion has no exit condition and will hit Apps Script's call stack limit, throwing an unhandled exception that could abort the parent `saveItinerary` call.

**Fix:** Add a `retried` flag parameter and return without recursing if already retried:
```javascript
function logQuote(paxName, data, retried = false) {
  if (!logSheet) {
    if (retried) return;
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
  ...
}
```

---

### [MODERATE-6] `setupSheets()` corrupts INPUT tabs if run more than once — Pipeline.gs line 779

**File:** Pipeline.gs  
**Function:** `_buildInputSheet()`

`ws.insertRowBefore(2)` is called unconditionally every time `setupSheets()` runs. Each run inserts another blank banner row, pushing data rows down and breaking the pipeline's row-start assumption (data starts at row 3). Running `setupSheets()` twice on an active sheet will cause the pipeline to miss row 3 data entirely.

**Fix:** Check whether row 2 already contains the banner text before inserting:
```javascript
if (!ws.getRange(2,1).getValue().toString().includes('ℹ️')) {
  ws.insertRowBefore(2);
}
```

---

### [MODERATE-7] XSS risk from spreadsheet data rendered via innerHTML

**File:** index_fit.tripstore.html (multiple locations — lines 1829, 1940, 1950, 2067, 2215+)

Hotel names, tour names, and transfer route strings from the master spreadsheet are interpolated directly into HTML strings, e.g.:
```javascript
`<div class="font-bold truncate">${h.name}</div>`
`<span class="font-medium">${s.info}</span>`
`<p class="font-bold uppercase">${t.from} ➔ ${t.to}</p>`
```

If any sheet cell contains `<script>alert(1)</script>` or `<img src=x onerror=...>`, it will execute in users' browsers when the modal opens.

**Fix:** Escape all spreadsheet values before interpolating into innerHTML. Add a helper:
```javascript
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```
and use `esc(h.name)` in all template literals.

---

### [MODERATE-8] Transfer city extraction heuristic fails for many European airports

**File:** archive_to_input.py lines 154–162

The regex to extract a city name from a transfer description splits on a hardcoded keyword list:
```python
re.split(r"\s+(?:airport|cdg|lhr|ams|fra|vie|bcn|fco|...)\b", ...)
```

Cities not in the list (Zurich ZRH, Lisbon LIS, Porto OPO, Edinburgh EDI, Dubai DXB, Singapore SIN, etc.) will produce an empty or truncated city name, causing Claude to reject those rows as INVALID.

**Fix:** Extend the keyword list or use a broader regex: detect any 3-letter uppercase word (likely an IATA code) as the split point.

---

### [MODERATE-9] `ws.row_count` does not count data rows — write_to_sheets.py line 168

**File:** write_to_sheets.py  
**Function:** `main()`

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```

`ws.row_count` returns the sheet's total row capacity (default 1000 for any new worksheet), not rows with data. It is never 0 for a real sheet. The empty check therefore silently relies entirely on the second condition, and `get_all_values()` is called again inside `build_existing_keys()` — doubling API quota consumption.

**Fix:** Call `all_values = ws.get_all_values()` once, use `len(all_values) == 0` for the empty check, and pass `all_values` to `build_existing_keys`.

---

### [MODERATE-10] No retry logic for Claude API or Google Sheets API failures

**Files:** Pipeline.gs `callClaudeAPI()` / write_to_sheets.py / archive_to_input.py

Transient network errors or quota-exceeded responses cause entire batches to be marked ERROR in the pipeline, requiring manual `resetErrorRows()` intervention. The Python scripts exit immediately on any gspread exception.

**Fix:** Add exponential backoff retry (2–3 attempts, starting at 2 seconds) around `UrlFetchApp.fetch` in Pipeline.gs and around `append_rows` in the Python scripts.

---

## MINOR ISSUES

---

### [MINOR-1] Error messages expose internal server details — Code.gs lines 39, 57

`catch (err) { return ContentService.createTextOutput('Server Error: ' + err.message); }` leaks internal function names and error details to the client. Replace with a generic "An error occurred. Please try again." message and log the full error with `Logger.log()` instead.

---

### [MINOR-2] `Object.values(r)` column order not guaranteed for all Claude responses — Pipeline.gs line 243

When Claude returns an object instead of an array, `Object.values(r)` is used as a fallback. If Claude's JSON key order ever varies from the expected column order, data is written to wrong columns silently. Add an explicit column list to extract values in the correct order rather than relying on object key order.

---

### [MINOR-3] Quote ID collision risk — Quote_Intelligence.gs line 140

```javascript
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```

Two saves within the same millisecond generate identical Quote IDs. The log sheet has no uniqueness constraint, so duplicates accumulate silently.

**Fix:** Append a short random suffix:
```javascript
const quoteId = 'Q-' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(-3).toUpperCase();
```

---

### [MINOR-4] No minimum paxName validation before cloud save — index_fit.tripstore.html

A user can save an itinerary with a blank pax name. The backend uses `data.paxName || ''`, creating a row with an empty key in Saved_Itineraries that is unretrievable via search.

**Fix:** In the frontend `saveItinerary()` function, validate `paxNameInput.value.trim().length > 0` before sending to the API.

---

### [MINOR-5] SPREADSHEET_ID hardcoded in two separate files with no shared config

**Files:** write_to_sheets.py line 27 / archive_to_input.py line 32

Both files hardcode the same spreadsheet ID `"1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"`. If the spreadsheet is replaced, both files need manual updates and there is no check that they reference the same sheet.

**Fix:** Move to a shared `config.py` or a `.env` file read by both scripts.

---

### [MINOR-6] `anthropic-version: '2023-06-01'` — still valid but worth noting for future upgrades

**File:** Pipeline.gs line 571

The Anthropic API header `anthropic-version: '2023-06-01'` is still accepted but is the oldest version string. When Anthropic deprecates it, all Claude enrichment calls will silently start failing. Consider moving to a newer version string and testing annually.

---

### [MINOR-7] Seven requested Python files are not committed to the repository

The following files listed in the review task do not exist in the repo and could not be reviewed:
- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

These likely exist locally on Sumit's Mac. Commit them to GitHub so they are included in future automated reviews and are not lost if the local machine fails.

---

## ACTION ITEMS — Priority Order

| # | Severity | Action |
|---|----------|--------|
| 1 | CRITICAL | Fix `checkLogin` in Code.gs `doPost` — login is currently broken for all users without cached localStorage |
| 2 | CRITICAL | Add server-side session/token validation to prevent admin bypass via DevTools |
| 3 | CRITICAL | Hash passwords before storing in Google Sheet |
| 4 | MODERATE | Change `USER_ENTERED` to `RAW` in write_to_sheets.py and archive_to_input.py (formula injection) |
| 5 | MODERATE | Escape all spreadsheet values before innerHTML rendering (XSS) |
| 6 | MODERATE | Protect `getQuoteLog` endpoint with a secret token |
| 7 | MODERATE | Fix `logQuote` infinite recursion |
| 8 | MODERATE | Fix `setupSheets` duplicate banner row insertion |
| 9 | MODERATE | Add session expiry (7-day max in localStorage) |
| 10 | MINOR | Commit 7 missing Python scripts to GitHub |

---

*Generated by automated daily review — 2026-04-30*
