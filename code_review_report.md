# TripStore Code Review Report
**Date:** 2026-05-31
**Reviewer:** Automated Daily Review
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py
**Missing Files (not in repo):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Git Log (last 10 commits)
```
56edcaa Auto: daily code review
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main
e6a35d9 Merge v2 into main
f3b87ad Sync index.html with index_fit.tripstore.html
```

---

## Summary

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 2     |
| MODERATE  | 8     |
| MINOR     | 9     |
| **TOTAL** | **19**|

---

## CRITICAL Issues

### [CRITICAL-1] Code.gs — Passwords stored in plaintext
**File:** `Code.gs` — `checkLogin()` line 256, `handleSignup()` line 289

Passwords are stored and compared as plaintext strings in the Google Sheets "Users" tab. Anyone with read access to the spreadsheet (including sharing accidents, API key leaks, or disgruntled team members) can see every user's password immediately.

**Fix:** Hash passwords before storing. In Apps Script, at minimum use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` on both store and compare. Add a per-user salt stored in column 5 of the Users sheet.

---

### [CRITICAL-2] index_fit.tripstore.html — Login sent via POST but handler only exists in doGet
**File:** `index_fit.tripstore.html` line 583, `Code.gs` lines 25–28

The frontend sends `checkLogin` as a **POST** request:
```javascript
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```

But `Code.gs doPost()` only handles `signup` and `saveItinerary`. The `checkLogin` action lives in `doGet()` which reads `e.parameter.user` (URL query string). A POST to this route returns "Invalid action", showing "Invalid Credentials" to the user. Existing users are masked by `checkAutoLogin()` reading a cached localStorage session without server re-verification — making the bug invisible until a user clears their browser or logs in from a new device.

**Fix (Option A — minimal, fast):** Add `checkLogin` handling inside `doPost()` reading `data.user` / `data.pass`.
**Fix (Option B — secure):** Keep login as POST only. Remove the GET-based `checkLogin` path entirely — credentials in URL query strings appear in server logs, browser history, and CDN access logs.

---

## MODERATE Issues

### [MODERATE-1] Code.gs — No brute-force protection on login
**File:** `Code.gs` — `checkLogin()` lines 249–269

There is no rate limiting, account lockout, or CAPTCHA on the login endpoint. An attacker can send unlimited password guesses with no consequence. Combined with CRITICAL-1 (plaintext storage), the entire user base is at risk.

**Fix:** Track failed login attempts per username in Script Properties or a "FailedAttempts" tab. Lock the account after 5 consecutive failures for 15 minutes. Send an alert email to the admin after 10 attempts on any account.

---

### [MODERATE-2] Code.gs — Signup has no input validation
**File:** `Code.gs` — `handleSignup()` lines 276–291

No validation on: email format, mobile number format, password minimum length, or username character restrictions. A user can sign up with a 1-character password or a gibberish email and the system accepts it without complaint.

**Fix:** Add `validateEmail(email)`, `/^\d{10}$/.test(mobile)`, `password.length >= 8`, and `username.length >= 3` checks before `appendRow()`. Return specific error messages per failure.

---

### [MODERATE-3] Pipeline.gs — setupSheets() duplicates banner row on every re-run
**File:** `Pipeline.gs` — `_buildInputSheet()` lines 778–779

```javascript
ws.insertRowBefore(2);  // always inserts, even on an already-configured sheet
```

Every time `setupSheets()` is run on an existing sheet, a new blank banner row is pushed into row 2, shifting all data rows down by 1. Running it three times creates three banner rows. `getPendingRows()` starts reading from row 3 and will miss those extra rows.

**Fix:** Check whether row 2 already contains the info banner text before inserting:
```javascript
const existingBanner = ws.getRange(2, 1).getValue().toString();
if (!existingBanner.startsWith('ℹ️')) {
    ws.insertRowBefore(2);
    // set banner ...
}
```

---

### [MODERATE-4] Pipeline.gs — Hardcoded potentially-retired Claude model
**File:** `Pipeline.gs` — `CFG.MODEL` line 39

```javascript
MODEL: 'claude-haiku-4-5-20251001',
```

Today is 2026-05-31. Models with date suffixes have finite support windows. If this model ID is retired, every `callClaudeAPI()` call returns HTTP 400 and all pipeline rows are set to ERROR — the midnight enrichment silently fails for the entire run with no indication of root cause beyond "Claude API error — will retry next run", which loops forever.

**Fix:** Update to the current model ID (e.g. `claude-haiku-4-5`). Add specific detection for model-not-found errors (distinct from quota/rate-limit errors) and send an urgent alert email rather than a generic retry message.

---

### [MODERATE-5] Pipeline.gs — No execution-time guard; risks mid-batch Apps Script timeout
**File:** `Pipeline.gs` — `runMidnightEnrichment()` / `processSheet()`

Google Apps Script has a 6-minute execution hard limit. With 200+ PENDING rows across all INPUT sheets, the script will be killed mid-batch. Rows sent to Claude but not yet written to the master sheet are lost. On the next run they remain PENDING and Claude is called again — but the master sheet may have already been partially updated, creating duplicates that bypass the JavaScript duplicate check (which only checked before the interrupted run).

**Fix:** Track elapsed time inside the batch loop and stop gracefully before the limit:
```javascript
const RUN_START = Date.now();
for (let i = 0; i < toEnrich.length; i += CFG.BATCH_SIZE) {
    if (Date.now() - RUN_START > 300000) {  // 5-min safety cutoff (1 min before limit)
        auditLog(ss, 'Execution time limit approaching — halting. Remaining rows queued for next run.');
        break;
    }
    // existing batch logic ...
}
```

---

### [MODERATE-6] index_fit.tripstore.html — Save response not validated; server errors silently ignored
**File:** `index_fit.tripstore.html` — `saveItinerary()` lines 719–724

```javascript
await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
showToast("Saved Successfully");  // shown regardless of what the server returned
```

If the server returns `"Server Error: ..."` or `"Setup Error: Saved_Itineraries sheet not found"`, the user still sees "Saved Successfully" and believes their itinerary is safe. It is not.

**Fix:**
```javascript
const res  = await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
const text = await res.text();
if (!text.includes("Successfully")) throw new Error(text);
showToast("Saved Successfully");
```

---

### [MODERATE-7] index_fit.tripstore.html — XSS via unescaped master data in modal innerHTML
**File:** `index_fit.tripstore.html` — `applyTransferFilters()` ~line 1604, `filterIntercityModal()` ~line 1714

Transfer city names, hotel names, and route strings from `masterData` are injected directly into `container.innerHTML` without HTML escaping:
```javascript
<p class="... uppercase">${t.from} ➔ ${t.to}</p>
```

If any record in the Google Sheet contains `<img src=x onerror=alert(document.cookie)>`, it executes in every agent's browser who opens the swap modal. An admin with sheet write access could use this to steal sessions.

**Fix:** Create a small helper and wrap all master-data string interpolations:
```javascript
function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

---

### [MODERATE-8] write_to_sheets.py — Credentials path and Spreadsheet ID hardcoded in source
**File:** `write_to_sheets.py` lines 27–30

```python
SPREADSHEET_ID   = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
CREDENTIALS_PATH = Path("./sheets-credentials.json")
```

The spreadsheet ID is exposed to anyone with repository access. The credentials file is assumed to live at a fixed relative path — if accidentally committed to git (or if the repo is cloned to a machine where the credentials file also exists), the service account key (which has full sheet read/write) is leaked.

**Fix:** Read from environment variables:
```python
import os
SPREADSHEET_ID   = os.environ["SPREADSHEET_ID"]
CREDENTIALS_PATH = Path(os.environ.get("CREDENTIALS_PATH", "./sheets-credentials.json"))
```
Add `sheets-credentials.json` to `.gitignore`.

---

## MINOR Issues

### [MINOR-1] Code.gs — Dead variable in getQuoteLog()
**File:** `Code.gs` line 380

```javascript
const headers = rows[0];  // declared but never used
```
Remove to avoid confusion.

---

### [MINOR-2] Code.gs — Login credentials still in GET URL path (legacy)
**File:** `Code.gs` — `doGet()` lines 25–28

Even after fixing CRITICAL-2, the `doGet` path still accepts `?action=checkLogin&user=x&pass=y`. Credentials in URLs appear in browser history, server access logs, and CDN logs. Remove this GET-based login path entirely once the POST handler is in place.

---

### [MINOR-3] Quote_Intelligence.gs — Non-unique Quote IDs
**File:** `Quote_Intelligence.gs` — `buildQuoteLogRow()` line 140

```javascript
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```

The last 8 digits of a millisecond timestamp cycle every ~11.5 days. Two saves within the same millisecond (e.g. admin backfill) produce identical IDs. Use the full timestamp plus a random suffix: `'Q-' + Date.now() + '-' + Math.floor(Math.random()*1000)`.

---

### [MINOR-4] Quote_Intelligence.gs — Deprecated `.substr()` method
**File:** `Quote_Intelligence.gs` — `_titleCase()` line 315

```javascript
t.charAt(0).toUpperCase() + t.substr(1).toLowerCase()
```

`String.prototype.substr()` is deprecated. Replace with `.substring(1)`.

---

### [MINOR-5] Pipeline.gs — User data embedded in Claude prompts without length limits
**File:** `Pipeline.gs` — `enrichHotels()`, `enrichSightseeing()`, `enrichTrains()`, `enrichTransfers()`

Raw user-supplied strings from INPUT sheets are serialised directly into Claude prompt text via `JSON.stringify()`. A hotel name longer than 200 characters or containing unusual characters could confuse the model's JSON output parser. Low risk currently (controlled data entry) but worth a guard.

**Fix:** Truncate each string field to a max length before building the prompt:
```javascript
hotel_name: (r.data[HC.NAME-1] || '').toString().slice(0, 150),
```

---

### [MINOR-6] index_fit.tripstore.html — No check-in date validation in addCityToRoute()
**File:** `index_fit.tripstore.html` — `addCityToRoute()` lines 828–838

Users can add cities with past check-in dates. The only guard is `nights <= 0`, which catches same-day check-out but not historical dates. Itineraries with past dates produce confusing output in the day-wise table.

**Fix:**
```javascript
if (new Date(checkin) < new Date(new Date().toDateString())) return showToast("Check-in cannot be in the past", "error");
```

---

### [MINOR-7] index_fit.tripstore.html — Mobile number not validated on signup
**File:** `index_fit.tripstore.html` — `handleSignup()` line 609

Mobile number is checked only for non-empty. Any text passes. Add `/^\d{10}$/.test(mobile)` before submitting.

---

### [MINOR-8] write_to_sheets.py — No retry on Google Sheets API transient errors
**File:** `write_to_sheets.py` — `main()`

`ws.append_rows()` is called once with no retry logic. A transient 429 (rate limit) or 503 from the Sheets API will abort the entire upload with no partial-progress recovery.

**Fix:** Wrap in a retry loop with exponential backoff (2s, 4s, 8s, 16s max).

---

### [MINOR-9] write_to_sheets.py — New worksheet created with only 1000 rows
**File:** `write_to_sheets.py` — `connect_sheet()` line 57

```python
ws = spreadsheet.add_worksheet(title=SHEET_NAME, rows=1000, cols=20)
```

If the archive grows past 1000 rows and the tab needed to be recreated, appends would silently fail or truncate. Use `rows=5000` or dynamically calculate from the CSV row count.

---

## Missing Files — Not Reviewed
The following files were listed for review but **do not exist in this repository**. They are likely in a separate local folder (`tripstore-itinerary-archive`) that has not been committed:

- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

**Recommendation:** Push these files into a `/pipeline/` subfolder in this repo so they are version-controlled and included in future automated reviews.

---

## Action Items (Priority Order)

| # | Issue | File | Effort |
|---|-------|------|--------|
| 1 | CRITICAL-2: Fix checkLogin POST handler in doPost() | Code.gs | 5 min |
| 2 | CRITICAL-1: Hash passwords before storing | Code.gs | 30 min |
| 3 | MODERATE-6: Validate save response before success toast | index_fit.tripstore.html | 5 min |
| 4 | MODERATE-3: Guard against duplicate banner row in setupSheets() | Pipeline.gs | 10 min |
| 5 | MODERATE-4: Update Claude model ID to current version | Pipeline.gs | 2 min |
| 6 | MODERATE-7: Add escHtml() and sanitise modal innerHTML | index_fit.tripstore.html | 20 min |
| 7 | MODERATE-8: Move credentials/ID to env vars | write_to_sheets.py | 10 min |
| 8 | MODERATE-5: Add 5-min execution-time guard in pipeline | Pipeline.gs | 10 min |
| 9 | MODERATE-1: Implement login rate limiting | Code.gs | 45 min |
| 10 | MINOR-3: Fix Quote ID collision risk | Quote_Intelligence.gs | 2 min |

---

*Report generated automatically — 2026-05-31. Next review scheduled tomorrow.*
