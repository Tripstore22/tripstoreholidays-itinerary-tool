# TripStore Code Review Report
**Date:** 2026-05-23  
**Reviewer:** Automated Daily Review  
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Files Not Found (skipped):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Recent Commits
```
56edcaa Auto: daily code review
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main
f3b87ad Sync index.html with index_fit.tripstore.html
```

> ⚠️ **Status note:** No fixes have been applied to any of the issues from previous reviews. All CRITICAL, MODERATE, and MINOR issues listed below remain unresolved. The only real code change since the last substantive commit (`fdd2f17`) is the budget hint inline-style fix which was unrelated to any flagged issue.

---

## CRITICAL Issues (Fix Immediately)

### [CRITICAL-1] checkLogin Sent as POST — Only Handled in GET — Login Broken on New Devices
**File:** index_fit.tripstore.html:583 + Code.gs:25–28  
**Status: OPEN (3rd consecutive review)**  
The HTML `checkLogin()` sends `fetch(API_URL, { method:"POST", body:JSON.stringify({action:"checkLogin",...})})`. But `doPost()` in Code.gs only handles `signup` and `saveItinerary` — it returns `'Invalid action'` for `checkLogin`. The working handler lives in `doGet()` which reads URL query params, not POST body. Any user on a new device gets a permanent "Invalid Credentials" failure. Existing sessions in localStorage hide the bug.  
**Fix:** In `doPost()` in Code.gs add: `if (action === 'checkLogin') return checkLogin(data.user || '', data.pass || '');`

### [CRITICAL-2] Admin Role Trusted Entirely from localStorage — Full Auth Bypass
**File:** index_fit.tripstore.html:641–652  
**Status: OPEN (3rd consecutive review)**  
`checkAutoLogin()` reads `isAdmin` directly from localStorage and calls `launchApp()` with no server re-verification. Any person with browser access can open DevTools and run:  
```js
localStorage.setItem('tripstore_session',JSON.stringify({isLoggedIn:true,isAdmin:true,modeText:'ADMIN MODE'}))
```
…then reload to get full Admin Panel access including loading any pax itinerary.  
**Fix:** On auto-login, re-verify role against the backend before revealing the admin panel. Never render admin UI based on localStorage state alone.

### [CRITICAL-3] Plaintext Passwords in Google Sheets
**File:** Code.gs:261, 289  
**Status: OPEN (3rd consecutive review)**  
`checkLogin()` compares `dbPass === pass.trim()` directly. `handleSignup()` stores the raw password: `sheet.appendRow([username, password.trim(), ...])`. Anyone with Viewer access to the spreadsheet sees every user's password.  
**Fix:** Hash before writing: `const hashed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');` Store the hex digest, compare digests on login.

### [CRITICAL-4] XSS — Unsanitized Sheet Data Injected into innerHTML (Expanded)
**File:** index_fit.tripstore.html — multiple locations  
**Status: OPEN + NEW SURFACE AREAS FOUND (3rd consecutive review)**  
Fields from the Google Sheet (hotel names, city names, sightseeing info, from/to fields, mode, stopover city) are inserted directly into HTML via template literals. Newly confirmed injection points beyond what was listed last review:

| Location | Injected data |
|---|---|
| renderTables():1287 | `${item.city}` — city name into element content |
| renderTables():1343–1346 | `${s.category}`, `${s.duration}` — into span elements |
| renderTables():1403 | `${t.city}` — into element content |
| filterIntercityModal():1718–1720 | `${item.mode}`, `${item.from}`, `${item.to}`, `${item.stopoverCity}` |
| applyHotelFilters():1829 | `${h.starRating}`, `${h.name}`, `${h.category}`, `${h.roomType}` |
| filterSightsInModal():1940–1941 | `${s.info}`, `${s.category}`, `${s.duration}` |
| applyTransferFilters():1604 | `${t.from} ➔ ${t.to}` |

A malicious value like `<img src=x onerror=alert(document.cookie)>` in any Sheet cell executes in every agent's browser.  
**Fix:** Add a single escape helper and apply everywhere before injecting sheet values into innerHTML:
```js
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
```

---

## MODERATE Issues (Fix This Week)

### [MODERATE-1] No Rate Limiting on Login Endpoint
**File:** Code.gs:249–269 | **Status: OPEN**  
`checkLogin` has no throttle or account lockout. The public Apps Script URL can be brute-forced indefinitely.  
**Fix:** Log failed attempts per username in a Lockout_Log sheet. After 5 failures, reject for 15 minutes.

### [MODERATE-2] Unauthenticated Access to Saved Itineraries and Quote Log
**File:** Code.gs:299–335, 372–418 | **Status: OPEN**  
`getAllSaved`, `searchItinerary`, and `getQuoteLog` require no auth. The Apps Script URL is hardcoded in the public GitHub repo. Anyone can enumerate all pax names, download any quote payload, or read full pricing data.  
**Fix:** Require a rotating daily HMAC token: callers include `?token=HMAC(secret, today)` and the backend validates.

### [MODERATE-3] Pipeline Writes Claude Output Directly to Master Sheets — No Human Review
**File:** Pipeline.gs:238–249 | **Status: OPEN**  
`mst.appendRow(rowArr)` commits Claude-enriched data straight to the production Hotels/Sightseeing/Trains/Transfers sheets. A hallucinated price or invented city goes live and affects real client quotes immediately.  
**Fix:** Write Claude output to STAGING_* tabs first. Add a one-click "Approve All" function that moves staging rows to master after a spot-check.

### [MODERATE-4] Apps Script 6-Minute Limit — Pipeline Can Be Killed Mid-Run Silently
**File:** Pipeline.gs:146–161, 223–253 | **Status: OPEN**  
With `BATCH_SIZE=5`, `sleep(1500)` between batches, and ~3s Claude latency, a large run can exceed Apps Script's 6-minute hard kill. When killed, remaining rows stay PENDING with no indication in the summary email.  
**Fix:** Check elapsed time inside the batch loop. If > 300 seconds, break and flag "RUN TRUNCATED" in the email.

### [MODERATE-5] `setupSheets()` Inserts Duplicate Banner Row on Each Re-run
**File:** Pipeline.gs:778 | **Status: OPEN**  
`_buildInputSheet()` unconditionally calls `ws.insertRowBefore(2)` whether the banner already exists or not. Running `setupSheets()` a second time shifts all data down, breaking `getPendingRows()` which expects data to start at row 3.  
**Fix:** Guard before inserting: `if (ws.getRange(2,1).getValue() === '') ws.insertRowBefore(2);`

### [MODERATE-6] localStorage Session Has No Expiry
**File:** index_fit.tripstore.html:587 | **Status: OPEN**  
The session JSON in localStorage never expires. A shared or borrowed browser retains access indefinitely with no forced re-login.  
**Fix:** Add `loginTime: Date.now()` to the session object. In `checkAutoLogin()`, reject sessions older than 8 hours.

### [MODERATE-7] Hardcoded Spreadsheet ID in Python Scripts
**File:** write_to_sheets.py:28, archive_to_input.py:32 | **Status: OPEN**  
`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is committed to the repo.  
**Fix:** `SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID")` with a `.env` file that is gitignored.

### [MODERATE-8] No Retry Count — Broken Rows Consume Claude Credits Every Night Forever
**File:** Pipeline.gs:593–596 | **Status: OPEN**  
`resetErrorRows()` resets failed rows to PENDING with no attempt counter. A permanently unprocessable row retries at every midnight run indefinitely.  
**Fix:** Add an `Attempt_Count` column. After 3 failures, set status to `MANUAL_REVIEW` and exclude from `getPendingRows()`.

### [MODERATE-9] Claude Response `idx` Not Validated Against Batch Position
**File:** Pipeline.gs:228–249 | **Status: OPEN**  
Claude results are consumed by array position, not by matching `res.idx`. If Claude drops an item or reorders the response, rows are silently matched to the wrong enrichment data.  
**Fix:** Build a lookup map: `const resMap = {}; results.forEach(r => { if (r?.idx !== undefined) resMap[r.idx] = r; });` then use `resMap[originalIdx]`.

---

## MINOR Issues (Fix When Convenient)

### [MINOR-1] `logQuote()` Has Infinite Recursion Risk
**File:** Quote_Intelligence.gs:33–47 | **Status: OPEN**  
`logQuote()` calls `setupQuoteLog()` then recurses with no guard. If the sheet is still null after setup, the recursion is infinite.  
**Fix:** `function logQuote(paxName, data, _retry=false)` — if `_retry` is true and sheet is still missing, log and return.

### [MINOR-2] Quote IDs Collide After 27.7 Hours and Under Concurrent Saves
**File:** Quote_Intelligence.gs:139 | **Status: OPEN**  
`'Q-' + new Date().getTime().toString().slice(-8)` — rolls over every ~27.7 hours.  
**Fix:** `` `Q-${Date.now()}-${Math.random().toString(36).slice(2,5).toUpperCase()}` ``

### [MINOR-3] `backfillQuoteLog()` Creates Duplicates on Re-run
**File:** Quote_Intelligence.gs:278–309 | **Status: OPEN**  
No dedup check — running the backfill twice doubles all quote log rows.  
**Fix:** Before appending, build a set of existing `(paxName + loggedAt)` pairs and skip already-present rows.

### [MINOR-4] `formatDate()` Shows One Day Early in IST
**File:** index_fit.tripstore.html:2030 | **Status: OPEN**  
`new Date(d)` where `d` is a date string like `"2024-03-15"` parses as UTC midnight. In IST (UTC+5:30) that becomes `2024-03-14 18:30`, so the date renders as the day before.  
**Fix:** `new Date(d + 'T12:00:00')` (noon UTC) stays on the correct calendar day across all reasonable timezones.

### [MINOR-5] Dead `ws.row_count == 0` Check in write_to_sheets.py
**File:** write_to_sheets.py:168 | **Status: OPEN**  
`ws.row_count` returns the allocated count (default 1000), never 0. This condition is always False.  
**Fix:** Remove it; rely solely on `not ws.get_all_values()`.

### [MINOR-6] No Batch Chunking for Large Appends in Python Scripts
**File:** write_to_sheets.py:196, archive_to_input.py:390 | **Status: OPEN**  
`ws.append_rows(new_rows, ...)` in a single call hits gspread's ~2MB per-request limit at 500+ rows with no partial-write recovery.  
**Fix:** Chunk: `for i in range(0, len(new_rows), 100): ws.append_rows(new_rows[i:i+100], ...)`

### [MINOR-7] Adult Count Silently Floored to 1 — No User Feedback
**File:** index_fit.tripstore.html:479 | **Status: OPEN**  
`if (adults < 1) adults = 1` corrects silently; the total price changes with no explanation to the user.  
**Fix:** `if (adults < 1) { adults = 1; showToast("Minimum 1 adult required", "error"); }`

### [MINOR-8] `anthropic-version` Header Is Outdated
**File:** Pipeline.gs:571 | **Status: OPEN**  
`'anthropic-version': '2023-06-01'` is the oldest supported version.  
**Fix:** Monitor Anthropic's changelog and update when new features are needed.

---

## Summary

| Severity | Count | Status vs Last Review |
|---|---|---|
| CRITICAL | 4 | All open — no fixes applied |
| MODERATE | 9 | All open — no fixes applied |
| MINOR | 8 | All open — no fixes applied |
| **Total** | **21** | **0 resolved since first report** |

### Priority Action Items
1. **[CRITICAL-1]** Add `checkLogin` to `doPost()` in Code.gs — login is broken for any user not in localStorage.
2. **[CRITICAL-2]** Re-verify role server-side on auto-login — admin panel is trivially bypassable.
3. **[CRITICAL-3]** Hash passwords before storing in the Users sheet — plaintext passwords are a data breach waiting to happen.
4. **[CRITICAL-4]** Add `esc()` helper and apply to all masterData fields rendered via innerHTML — XSS risk across all modal and table rendering.
5. **[MODERATE-3]** Write Claude output to STAGING tabs before committing to master sheets.
6. **[MODERATE-5]** Guard `_buildInputSheet()` against inserting a duplicate banner row.
7. **[MODERATE-9]** Validate Claude response `idx` before applying enrichment to prevent row cross-contamination.
