# TripStore Itinerary Tool — Daily Code Review
**Date:** 2026-04-22
**Reviewer:** Claude (Automated)
**Branch:** v2

## Files Reviewed

| File | Status |
|------|--------|
| Code.gs | Reviewed |
| Pipeline.gs | Reviewed |
| Quote_Intelligence.gs | Reviewed |
| index_fit.tripstore.html | Reviewed |
| write_to_sheets.py | Reviewed |
| extract_itineraries.py | Not found in repo |
| write_inputs_to_sheets.py | Not found in repo |
| cleanup_sheet.py | Not found in repo |
| clean_pipeline_data.py | Not found in repo |
| cross_reference.py | Not found in repo |
| enrich_hotels.py | Not found in repo |
| enrich_hotels_booking.py | Not found in repo |

Note: 7 Python pipeline scripts mentioned in the review schedule are not in this repository. They likely exist only on the local machine (Desktop/Itinerary-Create folder). Consider adding them to this repo for version control and future automated review.

---

## Recent Commits

```
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main — sync all app files to production
f3b87ad Sync index.html with index_fit.tripstore.html
a105e1d Fix security issues and add budget suggestion hints
```

---

## CRITICAL Issues — Fix Immediately

### [CRITICAL-1] Login broken on fresh deployment (POST vs GET mismatch)
**Files:** Code.gs line 25 | index_fit.tripstore.html line 583

The HTML frontend sends login credentials as a POST with JSON body:
```javascript
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })
```

But `doPost()` in Code.gs only handles `signup` and `saveItinerary`. The `checkLogin` action is only handled in `doGet()` via URL parameters. Any POST login attempt returns "Invalid action" and the user sees "Invalid Credentials". Login will not work on any fresh deployment of the current Code.gs.

**Fix:** Add to `doPost()` in Code.gs:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### [CRITICAL-2] Admin access granted from localStorage alone — no server verification
**File:** index_fit.tripstore.html lines 641–652

`checkAutoLogin()` reads `isAdmin` from localStorage and immediately shows the admin panel without any server check. Anyone can run this in their browser console:
```javascript
localStorage.setItem('tripstore_session', JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:'ADMIN MODE'}))
```
Then reload — full admin access with no password required.

**Fix:** Do not store `isAdmin` in localStorage. On auto-login, re-call the server to verify the session is still valid and re-fetch the role before granting admin access.

---

### [CRITICAL-3] Passwords stored and transmitted in plaintext
**Files:** Code.gs lines 257–261, 289 | index_fit.tripstore.html lines 576–577

Passwords are sent as raw strings in the POST body and compared character-for-character against plaintext values stored in the Google Sheet. Anyone with sheet edit or view access sees all user passwords.

**Fix:** Hash passwords (SHA-256 minimum) client-side before sending. Store only the hash. Compare hashes on login. Apps Script supports `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)`.

---

## MODERATE Issues — Fix This Week

### [MODERATE-1] No authorization on getAllSaved / searchItinerary — Code.gs
`getAllSaved` and `searchItinerary` accept requests from any anonymous caller who knows the /exec URL. Any person on the internet can enumerate all saved pax names and download any complete itinerary by name. No session token or role check exists on these endpoints.

**Fix:** Require a caller-supplied token (stored in Script Properties) in all data-retrieval requests, and validate it server-side before returning data.

---

### [MODERATE-2] Claude API errors mark rows ERROR instead of leaving them PENDING — Pipeline.gs
**File:** Pipeline.gs lines 591–597

When `callClaudeAPI` catches any error (network timeout, 429 rate limit, malformed response), it returns a batch of `{valid: false, error_reason: "Claude API error — will retry next run"}` objects. These are then processed by `processSheet`, which calls `markRow` → marks every row in that batch as ERROR. The "will retry" message is misleading — ERROR rows are never retried automatically. A human must run `resetErrorRows()` manually.

**Fix:** On API-level errors (not data validation errors), return early without calling `markRow`. Leave rows as PENDING so they are picked up on the next nightly run.

---

### [MODERATE-3] No timeout on UrlFetchApp calls — Pipeline.gs
**File:** Pipeline.gs line 566

`UrlFetchApp.fetch()` is called without a `deadline` option. If the Claude API hangs, the Apps Script execution may hit the 6-minute runtime limit mid-pipeline, leaving input sheets in a partial state (some rows PROCESSED, some still PENDING, audit log incomplete).

**Fix:** Add `deadline: 30` to the fetch options object to cap each call at 30 seconds.

---

### [MODERATE-4] setupSheets() inserts duplicate banner row if run more than once — Pipeline.gs
**File:** Pipeline.gs line 779

`_buildInputSheet()` unconditionally calls `ws.insertRowBefore(2)` every time. Running `setupSheets()` twice inserts a second banner, shifting all data rows down by one, breaking the data validation range and row indexing.

**Fix:** Check whether row 2 is already a banner before inserting:
```javascript
const existingBanner = ws.getRange(2, 1).getValue();
if (!existingBanner || !existingBanner.toString().startsWith('ℹ️')) {
    ws.insertRowBefore(2);
}
```

---

### [MODERATE-5] setupQuoteLog() calls getUi() from a trigger context — Quote_Intelligence.gs
**File:** Quote_Intelligence.gs lines 33–37

`logQuote()` auto-creates the Quote_Log sheet by calling `setupQuoteLog()`, which calls `SpreadsheetApp.getUi().alert()`. `getUi()` throws an exception when called from a time-based trigger (no UI context is available). If Quote_Log is deleted, the nightly pipeline will silently fail to log any quotes.

**Fix:** Wrap `getUi().alert()` in a try/catch — fall back to `Logger.log()` when running from a trigger.

---

### [MODERATE-6] GST always logged as 5% regardless of selected mode — Quote_Intelligence.gs
**File:** Quote_Intelligence.gs line 119

```javascript
const gstPct = d.gst || 5;
```

The HTML payload saves `gstMode` (a string: "5pkg", "18svc", or "none") — not a numeric `d.gst`. So `d.gst` is always `undefined`, and GST is always calculated as 5% of markup even when "No GST" or "18% Service Charge" was selected. Every Quote_Log entry has incorrect GST data.

**Fix:**
```javascript
let gstPct = 0;
if (d.gstMode === '5pkg') gstPct = 5;
else if (d.gstMode === '18svc') gstPct = 18;
const gstAmt = Math.round(markupAmt * gstPct / 100);
```

---

### [MODERATE-7] XSS risk — masterData injected into innerHTML without escaping — index_fit.tripstore.html
Multiple places insert data from `masterData` (hotel names, city names, tour names) directly into innerHTML template literals. If the Google Sheet ever contains a value with `<script>` or `"` characters (whether accidentally or maliciously), it will execute in every logged-in user's browser.

**Fix:** Apply HTML escaping before any innerHTML injection:
```javascript
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
```

---

### [MODERATE-8] ws.row_count == 0 check is dead code — write_to_sheets.py
**File:** write_to_sheets.py line 168

`gspread`'s `ws.row_count` always returns the sheet's allocated row count (default 1000), never 0. The condition `ws.row_count == 0 or not ws.get_all_values()` will only ever trigger on the second clause. The first clause is misleading dead code.

**Fix:** Replace with:
```python
sheet_is_empty = not ws.get_all_values()
```

---

### [MODERATE-9] Spreadsheet ID hardcoded in source code — write_to_sheets.py
**File:** write_to_sheets.py line 29

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
```

This Sheet ID is committed to the repo. If the repo becomes public or is shared, the Sheet is immediately identifiable. Also prevents clean switching to a test Sheet.

**Fix:**
```python
import os
SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID", "")
```

---

## MINOR Issues — Low Priority

### [MINOR-1] Transfer `notes` field actually contains schedule text — Code.gs
**File:** Code.gs line 203: `notes: String(r[13] || '').trim(), // Column N: Schedule`
Column N is Schedule, not Notes. The field is misnamed in the JSON output, causing confusion downstream.

**Fix:** Rename to `schedule` in the returned object.

---

### [MINOR-2] Quote ID collision risk — Quote_Intelligence.gs
**File:** Quote_Intelligence.gs line 140
`'Q-' + new Date().getTime().toString().slice(-8)` repeats every ~1.15 days. During backfill operations, multiple saves in the same millisecond will share a Quote ID.

**Fix:** `'Q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5)`

---

### [MINOR-3] Missing Content-Type header on all POST fetch calls — index_fit.tripstore.html
**Files:** Lines 583, 612, 720 — all POST requests omit `headers: {'Content-Type': 'application/json'}`.
Google Apps Script is lenient about this, but it is not standards-compliant and may cause issues with stricter servers or proxies.

---

### [MINOR-4] Claude result matching uses array index, not res.idx — Pipeline.gs
**File:** Pipeline.gs lines 228–249
`results.forEach((res, idx) => { const row = batch[idx]; ... })` — the forEach index is used, not `res.idx`. If Claude re-orders its output array, the wrong rows get marked PROCESSED or ERROR.

**Fix:** Match on `res.idx`: `results.forEach(res => { const row = batch[res.idx]; ... })`

---

### [MINOR-5] localStorage session has no expiry — index_fit.tripstore.html
A session token saved months ago remains valid in the browser indefinitely. Deactivating a user in the Users sheet does not log them out of devices where they are auto-logged in.

**Fix:** Store `loginTimestamp` and reject sessions older than 8–12 hours in `checkAutoLogin()`.

---

### [MINOR-6] Missing Python scripts not under version control
The following 7 files cannot be reviewed because they are not in this repository:
- extract_itineraries.py
- write_inputs_to_sheets.py
- cleanup_sheet.py
- clean_pipeline_data.py
- cross_reference.py
- enrich_hotels.py
- enrich_hotels_booking.py

**Action:** Add these to the repo from the local machine.

---

## Summary Table

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | CRITICAL | Code.gs + HTML | Login POST/GET mismatch — login broken on fresh deploy |
| 2 | CRITICAL | HTML | Admin access granted from localStorage with no server check |
| 3 | CRITICAL | Code.gs + HTML | Passwords in plaintext (storage and transmission) |
| 4 | MODERATE | Code.gs | No auth on getAllSaved / searchItinerary endpoints |
| 5 | MODERATE | Pipeline.gs | API errors mark rows ERROR instead of leaving PENDING |
| 6 | MODERATE | Pipeline.gs | No timeout on Claude API fetch calls |
| 7 | MODERATE | Pipeline.gs | setupSheets() inserts duplicate banner on re-run |
| 8 | MODERATE | Quote_Intelligence.gs | getUi() crashes when called from trigger |
| 9 | MODERATE | Quote_Intelligence.gs | GST always 5% — gstMode field not read |
| 10 | MODERATE | HTML | XSS via masterData in innerHTML |
| 11 | MODERATE | write_to_sheets.py | ws.row_count dead code |
| 12 | MODERATE | write_to_sheets.py | Spreadsheet ID hardcoded in source |
| 13 | MINOR | Code.gs | Transfer notes/schedule field naming confusion |
| 14 | MINOR | Quote_Intelligence.gs | Quote ID collision risk |
| 15 | MINOR | HTML | Missing Content-Type on POST requests |
| 16 | MINOR | Pipeline.gs | Claude result matched by array index not res.idx |
| 17 | MINOR | HTML | No session expiry in localStorage |
| 18 | MINOR | — | 7 Python pipeline files missing from repo |

**Totals: 3 CRITICAL | 9 MODERATE | 6 MINOR**

---

*Automated daily review by Claude — 2026-04-22*
