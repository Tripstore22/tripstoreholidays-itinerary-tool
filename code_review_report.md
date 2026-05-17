# TripStore Code Review Report
**Date:** 2026-05-17  
**Reviewer:** Automated Daily Review  
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Files Not Found (skipped):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Recent Commits
```
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main
f3b87ad Sync index.html with index_fit.tripstore.html
a105e1d Fix security issues and add budget suggestion hints
```

---

## CRITICAL Issues (Fix Immediately)

### [CRITICAL-1] Login Action Sent as POST, Only Handled in GET — Login Broken on New Devices
**File:** index_fit.tripstore.html:583 + Code.gs:25–28  
The HTML `checkLogin()` sends `fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })`. But `doPost()` in Code.gs does NOT handle `checkLogin` — it only handles `signup` and `saveItinerary`, returning `'Invalid action'` for everything else. The `checkLogin` handler lives in `doGet()` which expects URL query params. Any user on a new device or after clearing localStorage gets "Invalid Credentials" permanently. Existing sessions in localStorage continue to work, masking the bug.  
**Fix:** In `doPost()` of Code.gs, add: `if (action === 'checkLogin') return checkLogin(data.user || '', data.pass || '');`

### [CRITICAL-2] Admin Flag Trusted Entirely from localStorage — Auth Bypass
**File:** index_fit.tripstore.html:641–652  
`checkAutoLogin()` reads `isAdmin` from `localStorage` with zero server-side re-verification. Any user can run in the browser console:  
```javascript
localStorage.setItem('tripstore_session', JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:'ADMIN MODE'}))
```
…reload, and get full admin access (Admin Panel, load any pax record) without knowing any password.  
**Fix:** On page load, always re-verify the role with the backend before revealing the Admin Panel. Do not render admin UI from localStorage state alone.

### [CRITICAL-3] Plaintext Passwords Stored in Google Sheets
**File:** Code.gs:261, 289  
`checkLogin()` compares `dbPass === pass.trim()` directly. `handleSignup()` stores the raw password via `sheet.appendRow([username, password.trim(), ...])`. Anyone with viewer access to the spreadsheet can read every user's password.  
**Fix:** Hash before storage: `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` in Apps Script as a minimum. Store and compare the hex digest.

### [CRITICAL-4] XSS — Unsanitized Sheet Data Injected into innerHTML
**File:** index_fit.tripstore.html:1285–1440, 1714–1726  
Hotel names, sightseeing descriptions, transfer from/to fields, intercity mode/route, and city names fetched from the Google Sheet are injected directly into HTML via template literals inside `innerHTML`. A malicious value like `<img src=x onerror=alert(document.cookie)>` in any Sheet cell executes in every agent's browser.  
**Fix:** Add an escape helper and apply everywhere: `const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');`

---

## MODERATE Issues (Fix This Week)

### [MODERATE-1] No Rate Limiting on Login Endpoint
**File:** Code.gs:249–269  
`checkLogin` iterates every row in the Users sheet on each call with no throttle or lockout. The endpoint can be brute-forced at full speed since the Apps Script URL is public.  
**Fix:** Track failed attempts in a Lockout_Log sheet. After 5 failures for a username, reject attempts for 15 minutes.

### [MODERATE-2] Unauthenticated Access to Saved Itineraries and Quote Log
**File:** Code.gs:299–314, 321–335, 372–418  
`getAllSaved`, `searchItinerary`, and `getQuoteLog` are accessible via plain GET requests with no authentication. The Apps Script URL is hardcoded in the public GitHub repo at line 426. Anyone can enumerate all pax names, download any quote payload, or read the full quote log with all pricing data.  
**Fix:** Require a rotating daily HMAC token: callers include `?token=HMAC(secret, today)` and the backend rejects mismatches.

### [MODERATE-3] Pipeline Writes Claude Output Directly to Master Sheets — No Human Review
**File:** Pipeline.gs:238–249  
`mst.appendRow(rowArr)` commits Claude-enriched data straight to production Hotels/Sightseeing/Trains/Transfers master sheets. A hallucinated hotel name, wrong INR price, or invented city goes live immediately and is used to quote real clients.  
**Fix:** Write Claude output to STAGING_* tabs first. Add an admin one-click "Approve all" that copies staging rows to master after human spot-check.

### [MODERATE-4] Apps Script 6-Minute Limit — Pipeline Can Be Killed Mid-Run Silently
**File:** Pipeline.gs:146–161, 223–253  
With `BATCH_SIZE = 5` and `Utilities.sleep(1500)` plus Claude response time (~3s average), a run with many pending rows across all four sheets can easily exceed the 6-minute hard kill. When killed mid-run, processed rows are marked PROCESSED but remaining rows are still PENDING with no alert in the email.  
**Fix:** Check elapsed time in the batch loop. If > 300 seconds, break gracefully and include "RUN TRUNCATED" in the summary email.

### [MODERATE-5] `setupSheets()` Inserts Duplicate Banner Row on Each Re-run
**File:** Pipeline.gs:778  
`_buildInputSheet()` unconditionally calls `ws.insertRowBefore(2)` even when the sheet and banner already exist. Running `setupSheets()` a second time inserts a blank row at row 2, pushing all data down — breaking the `getPendingRows()` assumption that data starts at row 3.  
**Fix:** Check before inserting: `if (!ws.getRange(2,1).getValue()) ws.insertRowBefore(2);`

### [MODERATE-6] localStorage Session Has No Expiry
**File:** index_fit.tripstore.html:587  
The session JSON in localStorage has no expiry timestamp and persists forever. A shared or stolen browser has permanent access with no forced re-login.  
**Fix:** Store `loginTime` in the session. In `checkAutoLogin()`, reject sessions older than 8 hours.

### [MODERATE-7] Hardcoded Spreadsheet ID in Python Scripts
**File:** write_to_sheets.py:28, archive_to_input.py:32  
`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is committed to the repo. If the repo becomes public or is shared, the Sheet ID is exposed.  
**Fix:** `SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID")` with a `.env` file that is gitignored.

### [MODERATE-8] No Retry Count Tracking — Bad Rows Consume API Credits Every Night Forever
**File:** Pipeline.gs:593–596  
`resetErrorRows()` resets failed rows to PENDING with no attempt counter. A permanently unprocessable row (e.g., empty city, test data Claude always rejects) retries every midnight indefinitely.  
**Fix:** Add an `Attempt_Count` column. After 3 failures, set status to `MANUAL_REVIEW` and exclude from `getPendingRows()`.

### [MODERATE-9] Claude Response `idx` Not Validated Against Batch Position
**File:** Pipeline.gs:228–249  
Claude is expected to return one result per batch row, and the code accesses `results[idx]` by position in the returned array — not by comparing `res.idx`. If Claude drops an item or reorders the response, rows are silently matched to the wrong enrichment data.  
**Fix:** Build a lookup by `idx`: `const resMap = {}; results.forEach(r => { if (r?.idx !== undefined) resMap[r.idx] = r; });` then use `resMap[originalIdx]`.

---

## MINOR Issues (Fix When Convenient)

### [MINOR-1] `logQuote()` Has Infinite Recursion Risk
**File:** Quote_Intelligence.gs:33–47  
`logQuote()` calls `setupQuoteLog()` then `return logQuote(paxName, data)` recursively with no base case guard. If `getSheetByName('Quote_Log')` returns null after setup (Apps Script cache miss), the recursion is infinite.  
**Fix:** Add `_isRetry` parameter: `function logQuote(paxName, data, _retry)` — if `_retry` is true and sheet is still missing, log and return without recursing.

### [MINOR-2] Quote IDs Collide After 27.7 Hours and Under Concurrent Saves
**File:** Quote_Intelligence.gs:139  
`'Q-' + new Date().getTime().toString().slice(-8)` — only the last 8 digits of the ms timestamp. Rolls over every ~27.7 hours. Two saves in the same millisecond (e.g., batch backfill) produce identical IDs.  
**Fix:** Use full timestamp plus a random suffix: `` `Q-${Date.now()}-${Math.random().toString(36).slice(2,5).toUpperCase()}` ``

### [MINOR-3] `backfillQuoteLog()` Creates Duplicates on Re-run
**File:** Quote_Intelligence.gs:278–309  
No deduplication check before appending. Running the backfill twice doubles every quote in the log.  
**Fix:** Before appending, build a set of existing `(paxName + loggedAt)` pairs from Quote_Log and skip already-present rows.

### [MINOR-4] `formatDate()` Shows One Day Early in IST
**File:** index_fit.tripstore.html:2028–2031  
`new Date('2024-03-15')` parses as UTC midnight. In IST (UTC+5:30) that is `2024-03-14 18:30`, so `toLocaleDateString('en-GB')` returns `14 Mar` — one day early on all itinerary tables and PDFs.  
**Fix:** `new Date(d + 'T12:00:00')` (noon UTC) stays on the correct calendar day across all reasonable timezones.

### [MINOR-5] Dead `ws.row_count == 0` Check in write_to_sheets.py
**File:** write_to_sheets.py:168  
`ws.row_count` returns the allocated row count (default 1000), never 0. The condition `ws.row_count == 0` is always False — dead code.  
**Fix:** Remove it; rely solely on `not ws.get_all_values()`.

### [MINOR-6] No Batch Chunking for Large Appends in Python Scripts
**File:** write_to_sheets.py:196, archive_to_input.py:390  
`ws.append_rows(new_rows, ...)` sends all rows in one API call. At 500+ rows this hits gspread's ~2MB per-request limit and may fail with no partial-write recovery.  
**Fix:** Chunk: `for i in range(0, len(new_rows), 100): ws.append_rows(new_rows[i:i+100], ...)`

### [MINOR-7] Adult Count Silently Floored to 1 — No User Feedback
**File:** index_fit.tripstore.html:479  
`if (adults < 1) adults = 1` corrects silently. User sees the total price change with no explanation.  
**Fix:** `showToast("Minimum 1 adult required", "error")` when correcting the value.

### [MINOR-8] `anthropic-version` Header Is Outdated
**File:** Pipeline.gs:571  
`'anthropic-version': '2023-06-01'` — the oldest supported API version. Newer versions may unlock additional capabilities.  
**Fix:** Monitor Anthropic's changelog and update to current recommended version when new features are needed.

---

## Summary

| Severity | Count | Files Affected |
|----------|-------|----------------|
| CRITICAL | 4 | Code.gs, index_fit.tripstore.html |
| MODERATE | 9 | Code.gs, Pipeline.gs, index_fit.tripstore.html, write_to_sheets.py |
| MINOR | 8 | Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py, Pipeline.gs |
| **Total** | **21** | |

### Priority Action Items
1. **[CRITICAL-1]** Add `checkLogin` handler to `doPost()` in Code.gs — login is broken on new devices.
2. **[CRITICAL-2]** Fix admin bypass — re-verify role with server on page load, never trust localStorage alone.
3. **[CRITICAL-3]** Hash passwords before writing to the Users sheet.
4. **[CRITICAL-4]** Add HTML escape helper and apply to all masterData fields rendered into innerHTML.
5. **[MODERATE-3]** Add STAGING layer — Claude should not write directly to production master sheets.
6. **[MODERATE-5]** Guard `_buildInputSheet()` against duplicate banner row insertion.
7. **[MODERATE-9]** Validate Claude response `idx` against batch index before applying enrichment.
