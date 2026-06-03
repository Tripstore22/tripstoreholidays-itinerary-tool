# TripStore Code Review Report
**Date:** 2026-06-03
**Reviewer:** Automated Daily Review
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py
**Missing Files (not in repo):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Git Log (last 10 commits)
```
a5e4a7f Auto: daily code review
56edcaa Auto: daily code review
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main — sync all app files to production
```

> **⚠️ NOTICE:** All recent commits are automated code review only. No code fixes have been applied since 2026-05-31. All issues from the previous report remain **OPEN**.

---

## Summary

| Severity  | Count | Status vs Last Report |
|-----------|-------|-----------------------|
| CRITICAL  | 2     | No change — both still open |
| MODERATE  | 8     | No change — all still open |
| MINOR     | 10    | +1 new issue found today |
| **TOTAL** | **20**| **+1 vs last report** |

---

## CRITICAL Issues

### [CRITICAL-1] Code.gs — Passwords stored in plaintext *(STILL OPEN)*
**File:** `Code.gs` — `checkLogin()` line 256, `handleSignup()` line 289

Passwords are stored and compared as plaintext strings in the Google Sheets "Users" tab. Anyone with read access to the spreadsheet can see every user's password immediately.

**Fix:** Hash passwords before storing. Use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt)` on both store and compare. Add a per-user salt stored in a Users sheet column.

---

### [CRITICAL-2] index_fit.tripstore.html — Login sent via POST but doPost() has no checkLogin handler *(STILL OPEN)*
**File:** `index_fit.tripstore.html` line 583, `Code.gs` lines 43–57

The frontend sends `checkLogin` as a POST request:
```javascript
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But `doPost()` in Code.gs only handles `signup` and `saveItinerary`. The `checkLogin` action is in `doGet()`, reading URL query parameters. A POST to this route returns `"Invalid action"`, showing `"Invalid Credentials"` to the user. The bug is hidden by `checkAutoLogin()` reading a cached localStorage session — so existing users on familiar devices appear fine, but any fresh login from a new device or after clearing browser data will silently fail.

**Fix (minimal):** Add `checkLogin` handling inside `doPost()` in Code.gs:
```javascript
if (action === 'checkLogin') {
    return checkLogin(data.user || '', data.pass || '');
}
```
**Fix (secure):** Remove the GET-based `checkLogin` path entirely — credentials in URL query strings appear in server logs and browser history.

---

## MODERATE Issues

### [MODERATE-1] Code.gs — No brute-force protection on login *(STILL OPEN)*
**File:** `Code.gs` — `checkLogin()` lines 249–269

No rate limiting, account lockout, or CAPTCHA on the login endpoint. Unlimited password guesses are possible. Combined with CRITICAL-1 (plaintext storage), the entire user base is at risk.

**Fix:** Track failed login attempts per username in Script Properties. Lock the account for 15 minutes after 5 consecutive failures. Send alert email to admin after 10 attempts on any account.

---

### [MODERATE-2] Code.gs — Signup has no input validation *(STILL OPEN)*
**File:** `Code.gs` — `handleSignup()` lines 276–291

No validation on email format, mobile number, password minimum length, or username character restrictions. A user can sign up with a 1-character password or a garbage email.

**Fix:** Add `validateEmail(email)`, `/^\d{10}$/.test(mobile)`, `password.length >= 8`, and `username.length >= 3` checks before `appendRow()`.

---

### [MODERATE-3] Pipeline.gs — setupSheets() duplicates banner row on every re-run *(STILL OPEN)*
**File:** `Pipeline.gs` — `_buildInputSheet()` line 778

```javascript
ws.insertRowBefore(2);  // always inserts, even on an already-configured sheet
```
Every re-run of `setupSheets()` adds another blank row above the data, shifting all rows down by 1. `getPendingRows()` starts from row 3 and will silently skip the orphaned rows.

**Fix:** Check before inserting:
```javascript
const existingBanner = ws.getRange(2, 1).getValue().toString();
if (!existingBanner.startsWith('ℹ️')) {
    ws.insertRowBefore(2);
    // set banner ...
}
```

---

### [MODERATE-4] Pipeline.gs — Claude model ID uses date suffix; monitor for deprecation *(RISK REDUCED)*
**File:** `Pipeline.gs` — `CFG.MODEL` line 39

```javascript
MODEL: 'claude-haiku-4-5-20251001',
```
As of 2026-06-03, `claude-haiku-4-5-20251001` is the current Haiku model ID and is not yet retired. Risk is lower than previously flagged. However, if Anthropic releases a newer Haiku (4.6+) and retires this model, every `callClaudeAPI()` call will return HTTP 400 and the entire midnight pipeline will loop in error indefinitely with no root-cause alert.

**Fix:** Add specific detection for model-not-found HTTP errors and send an urgent alert email distinct from generic retry messages. Consider pinning to the alias `claude-haiku-4-5` if Anthropic supports it.

---

### [MODERATE-5] Pipeline.gs — No execution-time guard; risks mid-batch Apps Script timeout *(STILL OPEN)*
**File:** `Pipeline.gs` — `runMidnightEnrichment()` / `processSheet()`

Google Apps Script has a 6-minute hard execution limit. With 200+ PENDING rows, the script is killed mid-batch. Rows already sent to Claude but not yet written to the master sheet are lost — on the next run they remain PENDING, get sent to Claude again, and the master sheet may receive duplicates that bypass the in-memory duplicate check.

**Fix:**
```javascript
const RUN_START = Date.now();
for (let i = 0; i < toEnrich.length; i += CFG.BATCH_SIZE) {
    if (Date.now() - RUN_START > 300000) {
        auditLog(ss, 'Execution time limit approaching — halting gracefully.');
        break;
    }
    // existing batch logic ...
}
```

---

### [MODERATE-6] index_fit.tripstore.html — Save response not validated; server errors shown as success *(STILL OPEN)*
**File:** `index_fit.tripstore.html` — `saveItinerary()` lines 719–724

```javascript
await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
showToast("Saved Successfully");  // shown regardless of server response
```
If the server returns `"Server Error: ..."` or `"Setup Error: Saved_Itineraries sheet not found"`, the agent still sees "Saved Successfully" and believes the itinerary is safe. It is not.

**Fix:**
```javascript
const res  = await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
const text = await res.text();
if (!text.includes("Successfully")) throw new Error(text);
showToast("Saved Successfully");
```

---

### [MODERATE-7] index_fit.tripstore.html — XSS via unescaped master data injected into innerHTML *(STILL OPEN)*
**File:** `index_fit.tripstore.html` — lines 1604, 1718–1720

Transfer city names and route strings from `masterData` are injected into `innerHTML` without HTML-escaping `<` and `>`:
```javascript
// Line 1604 — transfers modal:
<p class="... uppercase">${t.from} ➔ ${t.to}</p>

// Line 1718–1720 — intercity modal:
<span>${item.mode}</span>
<p>${item.from} → ${item.to}</p>
<p>Via ${item.stopoverCity}</p>
```
Note: the `esc()` helper defined at line 1586 only escapes quotes for onclick attributes — it does **not** make these innerHTML injections safe. If any Google Sheet record contains `<img src=x onerror=alert(1)>`, it executes in every agent's browser.

**Fix:**
```javascript
function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Apply escHtml() to all master-data fields in modal innerHTML templates.
```

---

### [MODERATE-8] write_to_sheets.py — Credentials path and Spreadsheet ID hardcoded in source *(STILL OPEN)*
**File:** `write_to_sheets.py` lines 27–30

```python
SPREADSHEET_ID   = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
CREDENTIALS_PATH = Path("./sheets-credentials.json")
```
The spreadsheet ID is visible to anyone with repo access. If the credentials file is accidentally committed, the service account key (with full sheet read/write) is exposed.

**Fix:**
```python
import os
SPREADSHEET_ID   = os.environ["SPREADSHEET_ID"]
CREDENTIALS_PATH = Path(os.environ.get("CREDENTIALS_PATH", "./sheets-credentials.json"))
```
Also add `sheets-credentials.json` to `.gitignore`.

---

## MINOR Issues

### [MINOR-1] Code.gs — Dead variable in getQuoteLog() *(STILL OPEN)*
**File:** `Code.gs` line 380

```javascript
const headers = rows[0];  // declared but never used
```
Remove to reduce confusion.

---

### [MINOR-2] Code.gs — Login credentials still accepted via GET URL (legacy path) *(STILL OPEN)*
**File:** `Code.gs` — `doGet()` lines 25–28

Even after fixing CRITICAL-2, the GET path still accepts `?action=checkLogin&user=x&pass=y`. Credentials in URLs appear in browser history, server access logs, and CDN logs. Remove this path entirely once the POST handler is in place.

---

### [MINOR-3] Quote_Intelligence.gs — Non-unique Quote IDs *(STILL OPEN)*
**File:** `Quote_Intelligence.gs` — `buildQuoteLogRow()` line 140

```javascript
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```
Last 8 digits cycle every ~11.5 days. Two saves in the same millisecond (e.g. during backfill) produce identical IDs.

**Fix:** `'Q-' + Date.now() + '-' + Math.floor(Math.random()*1000)`

---

### [MINOR-4] Quote_Intelligence.gs — Deprecated `.substr()` method *(STILL OPEN)*
**File:** `Quote_Intelligence.gs` — `_titleCase()` line 315

```javascript
t.charAt(0).toUpperCase() + t.substr(1).toLowerCase()
```
`String.prototype.substr()` is deprecated. Replace with `.substring(1)`.

---

### [MINOR-5] Pipeline.gs — User data embedded in Claude prompts without length limits *(STILL OPEN)*
**File:** `Pipeline.gs` — enrichment functions

Raw user-supplied strings from INPUT sheets are serialised directly into Claude prompts via `JSON.stringify()`. A hotel name longer than 200 characters could confuse the JSON output parser.

**Fix:** Truncate each field before building the prompt:
```javascript
hotel_name: (r.data[HC.NAME-1] || '').toString().slice(0, 150),
```

---

### [MINOR-6] index_fit.tripstore.html — No past-date check in addCityToRoute() *(STILL OPEN)*
**File:** `index_fit.tripstore.html` — `addCityToRoute()` lines 828–838

Users can add cities with past check-in dates. The only guard is `nights <= 0`, which catches same-day checkout but not historical dates.

**Fix:**
```javascript
if (new Date(checkin) < new Date(new Date().toDateString())) return showToast("Check-in cannot be in the past", "error");
```

---

### [MINOR-7] index_fit.tripstore.html — Mobile number not validated on signup *(STILL OPEN)*
**File:** `index_fit.tripstore.html` — `handleSignup()` line 609

Mobile number only checked for non-empty. Any text passes.

**Fix:** Add `/^\d{10}$/.test(mobile)` before submitting.

---

### [MINOR-8] write_to_sheets.py — No retry on transient Sheets API errors *(STILL OPEN)*
**File:** `write_to_sheets.py` — `main()`

`ws.append_rows()` is called once with no retry. A transient 429 or 503 aborts the entire upload.

**Fix:** Wrap in a retry loop with exponential backoff (2s, 4s, 8s, 16s).

---

### [MINOR-9] write_to_sheets.py — New worksheet created with only 1000 rows *(STILL OPEN)*
**File:** `write_to_sheets.py` — `connect_sheet()` line 57

```python
ws = spreadsheet.add_worksheet(title=SHEET_NAME, rows=1000, cols=20)
```
If the archive grows past 1000 rows and the tab is recreated, appends silently truncate. Use `rows=5000`.

---

### [MINOR-10] index_fit.tripstore.html — Raw city name in onclick attribute risks single-quote injection *(NEW)*
**File:** `index_fit.tripstore.html` — `openHotelSwap()` line 1775

```javascript
oninput="applyHotelFilters(${routeId},'${city}')"
```
`city` is inserted without escaping single quotes. If a city in the Google Sheet contains an apostrophe (e.g. `L'Aquila`, `Côte d'Azur`), the onclick attribute is syntactically broken — the filter handler never fires and the hotel swap modal becomes non-functional for that city.

**Fix:**
```javascript
oninput="applyHotelFilters(${routeId},'${city.replace(/'/g, "\\'")}')"
```
Or better, store the city as a `data-city` attribute and read it from the handler rather than injecting it into the attribute string.

---

## Missing Files — Not Reviewed
The following files were listed for review but **do not exist in this repository**:

- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

**Recommendation:** Push these to a `/pipeline/` subfolder in this repo so they are version-controlled and included in future automated reviews.

---

## Action Items (Priority Order)

| # | Issue | File | Effort | Days Open |
|---|-------|------|--------|-----------|
| 1 | CRITICAL-2: Add checkLogin to doPost() | Code.gs | 5 min | 3 |
| 2 | CRITICAL-1: Hash passwords before storing | Code.gs | 30 min | 3 |
| 3 | MODERATE-6: Validate save response before success toast | index_fit.tripstore.html | 5 min | 3 |
| 4 | MODERATE-7: Add escHtml() and sanitise modal innerHTML | index_fit.tripstore.html | 20 min | 3 |
| 5 | MODERATE-3: Guard against duplicate banner row in setupSheets() | Pipeline.gs | 10 min | 3 |
| 6 | MODERATE-8: Move credentials/ID to env vars | write_to_sheets.py | 10 min | 3 |
| 7 | MODERATE-5: Add 5-min execution-time guard in pipeline | Pipeline.gs | 10 min | 3 |
| 8 | MODERATE-1: Implement login rate limiting | Code.gs | 45 min | 3 |
| 9 | MINOR-10: Escape city name in onclick attribute | index_fit.tripstore.html | 5 min | NEW |
| 10 | MINOR-3: Fix Quote ID collision risk | Quote_Intelligence.gs | 2 min | 3 |

---

*Report generated automatically — 2026-06-03. No fixes applied since 2026-05-31. Critical issues are now 3 days old — action recommended.*
