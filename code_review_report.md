# TripStore Code Review Report
**Date:** 2026-04-11
**Reviewed by:** Claude (automated daily review)
**Total issues:** 3 CRITICAL · 12 MODERATE · 7 MINOR

---

## Files Reviewed
- Code.gs
- Pipeline.gs
- Quote_Intelligence.gs
- index_fit.tripstore.html
- write_to_sheets.py
- archive_to_input.py

## Files Not Found in Repo (skipped)
The following files requested for review do not exist in this repository. They may live in a separate local folder (`tripstore-itinerary-archive`) not committed here:
- extract_itineraries.py
- write_inputs_to_sheets.py
- cleanup_sheet.py
- clean_pipeline_data.py
- cross_reference.py
- enrich_hotels.py
- enrich_hotels_booking.py

---

## CRITICAL Issues

### [CRITICAL-1] Login is broken — checkLogin sent as POST but only handled in doGet
**Files:** `index_fit.tripstore.html` (~line 583), `Code.gs` (lines 25, 49)

The frontend `checkLogin()` sends credentials via `fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", ... }) })`. However, `doPost()` in Code.gs only handles `signup` and `saveItinerary` — it does **not** handle `checkLogin`. Only `doGet()` handles it, and that reads credentials from URL parameters, not a POST body. Any POST with `action: "checkLogin"` falls through to `return ContentService.createTextOutput('Invalid action')`, which the client interprets as "Invalid Credentials".

If Code.gs has been redeployed since this mismatch was introduced, **no user can log in**. If it hasn't been redeployed yet, login still works on the old deployment but will break on the next deploy.

**Fix:** In `doPost()`, add a branch for checkLogin reading from the POST body:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### [CRITICAL-2] Passwords stored and compared in plaintext
**File:** `Code.gs` (lines 258–261, 289)

`checkLogin()` compares `dbPass === pass.trim()` directly. `handleSignup()` writes `password.trim()` straight to the Google Sheet. Anyone with read access to the sheet (co-admins, accidental share, leaked credential) can read all user passwords.

**Fix:** Hash passwords before storing using Apps Script's built-in `Utilities.computeDigest()`. Store and compare the SHA-256 hash. Force a password reset for all existing users on next login.

---

### [CRITICAL-3] No authentication on saveItinerary, search, and getAllSaved endpoints
**File:** `Code.gs` (lines 299, 322, 342)

These endpoints perform **no login check**. The `/exec` URL is visible in the HTML source. Any external party can:
- POST `{ action: "saveItinerary", paxName: "...", payload: {} }` to overwrite any itinerary.
- GET `?action=search&name=...` to exfiltrate any saved itinerary payload.
- GET `?action=getAllSaved` to enumerate all pax names.

**Fix:** Pass a signed session token on login (HMAC of username + server secret stored in Script Properties) and validate it on every protected endpoint.

---

## MODERATE Issues

### [MOD-1] Pipeline can double-process rows if triggered twice simultaneously
**File:** `Pipeline.gs` (line 146)

No execution guard around `runMidnightEnrichment()`. If the trigger fires while a manual run is in progress, both instances pick up the same PENDING rows, call Claude twice, and write duplicate entries to master sheets.

**Fix:** Wrap with `LockService.getScriptLock()`:
```javascript
function runMidnightEnrichment() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) { Logger.log('Pipeline already running — skipping.'); return; }
  try { /* existing code */ } finally { lock.releaseLock(); }
}
```

---

### [MOD-2] Claude response parsing is brittle — entire batch silently marked as errors
**File:** `Pipeline.gs` (lines 587–588)

`text.replace(/\`\`\`json|\`\`\`/g, '').trim()` only strips markdown fences. If Claude adds any preamble text (e.g., "Here are the results:"), `JSON.parse()` throws. Every row in the batch is then marked as an error to retry — silently losing a full night's worth of processing.

**Fix:** Extract the first `[...]` block from the response using a regex before parsing, and log the raw response to AUDIT_LOG on failure.

---

### [MOD-3] setupSheets() inserts an extra banner row every time it's run
**File:** `Pipeline.gs` (lines 778–780)

`_buildInputSheet()` calls `ws.insertRowBefore(2)` unconditionally. Running `setupSheets()` twice inserts a duplicate banner at row 2, shifting all data rows down by one — corrupting pipeline row index tracking for any existing data.

**Fix:** Check for the banner before inserting:
```javascript
const existingBanner = ws.getRange(2, 1).getValue();
if (!String(existingBanner).startsWith('ℹ️')) { ws.insertRowBefore(2); }
```

---

### [MOD-4] Quote_Log undercounts hotel net cost — missing pricing factor
**File:** `Quote_Intelligence.gs` (lines 85–86)

```javascript
const cost = (h.cost || 0) * (p.nights || 0);
```
`h.cost` is the per-night rate for one room. The actual charged amount depends on rooms, adults, and children (the `pricingFactor` from `getTravelConfigs()`). The Quote_Log consistently under-reports hotel net, making Grand Total in the log diverge from what agents see — unreliable for revenue tracking.

**Fix:** Store `pricingFactor` in the saved payload and use it in `buildQuoteLogRow()`.

---

### [MOD-5] Infinite recursion risk in logQuote()
**File:** `Quote_Intelligence.gs` (lines 33–37)

```javascript
if (!logSheet) {
  setupQuoteLog();
  return logQuote(paxName, data); // no depth guard
}
```
If `setupQuoteLog()` creates the sheet but `getSheetByName()` still returns null on retry (caching lag, name mismatch), this recurses until Apps Script's stack limit is hit — throwing an unhandled error that aborts `saveItinerary()` and loses the user's save.

**Fix:** Add a `_retried` flag parameter and bail on second attempt.

---

### [MOD-6] Vehicle type silent omission in Quote_Log when vehiclePrice is 0
**File:** `Quote_Intelligence.gs` (lines 100–108)

When both `eco` and `vp` are 0, the `if (eco > 0)` guard skips the entire vehicle type detection — nothing is pushed to `vehicleTypes`. The `vehicleMix` column in Quote_Log will be blank even when a transfer leg exists, silently corrupting vehicle mix analytics.

**Fix:** Add `else { vehicleTypes.push('Not Priced'); }` after the `if (eco > 0)` block.

---

### [MOD-7] saveItinerary() response never validated — always shows "Saved Successfully"
**File:** `index_fit.tripstore.html` (~line 720)

```javascript
await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
showToast("Saved Successfully");
```
The response body is never read. If the server returns an error (sheet missing, quota exceeded), the agent sees a green toast and believes their work is safe when it is not.

**Fix:** Read the response text and conditionally show error toast if it contains "Error" or "Failed".

---

### [MOD-8] No CSRF protection on POST endpoints
**File:** `Code.gs` / `index_fit.tripstore.html`

Apps Script Web Apps accept cross-origin POST requests from any website. A malicious page could submit fake signup requests or overwrite itineraries on behalf of logged-in users.

**Fix:** Require a server-side HMAC token in all POST payloads; reject requests missing it.

---

### [MOD-9] Session stored in localStorage — admin flag client-controllable
**File:** `index_fit.tripstore.html` (~line 641)

`checkAutoLogin()` trusts `isAdmin` from localStorage without re-validation. Any user can run in DevTools: `localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:"ADMIN MODE"}))` and reload to gain admin access.

**Fix:** Validate role server-side on page load rather than trusting the localStorage copy.

---

### [MOD-10] Hardcoded EUR/INR exchange rate in Claude prompt — already stale
**File:** `Pipeline.gs` (line 463)

`"INR price at ₹110/€"` is baked in. The April 2026 ₹/€ rate is ~₹89–92, meaning Claude back-fills INR prices from Euro data ~20% too high.

**Fix:** Store in Script Properties as `EUR_INR_RATE` and inject dynamically into the prompt.

---

### [MOD-11] Flawed empty-sheet check in write_to_sheets.py
**File:** `write_to_sheets.py` (line 168)

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```
`ws.row_count` is never 0 for a real Google Sheet (pre-allocated rows). Only the second condition does useful work but makes a redundant API call. If the check fails and the sheet already has headers, a duplicate header row is appended.

**Fix:** `sheet_is_empty = len(ws.get_all_values()) == 0` and reuse the result.

---

### [MOD-12] No write error handling in archive_to_input.py — partial writes silent
**File:** `archive_to_input.py` (lines 387–393)

`append_rows()` has no try/except. A rate limit, network error, or quota issue crashes the script mid-write with no record of which rows succeeded. The next run re-detects all unwritten rows as new but some may already be partially written.

**Fix:** Wrap each `append_rows()` in try/except with retry logic and partial-write logging.

---

## MINOR Issues

### [MIN-1] parsePrice() silently returns 0 — no logging
**File:** `Code.gs` (line 426)

Invalid or blank prices return 0 with no logging. In getHotels() a `<= 0` guard filters them out, but in transfers and intercity a 0-cost result passes through unchanged.

---

### [MIN-2] Transfer `notes` field maps to Schedule column (label mismatch)
**File:** `Code.gs` (line 203)

`// Column N: Schedule` but field named `notes` in the object. Minor naming inconsistency; no functional bug.

---

### [MIN-3] markRow() stores date as ISO string — won't auto-format in Sheets
**File:** `Pipeline.gs` (line 627)

`setValue(new Date().toISOString())` writes a plain text string. Google Sheets won't recognise it as a date, making date-based filtering on the column impossible.

**Fix:** `setValue(new Date())` — Apps Script converts Date objects to Sheets date values automatically.

---

### [MIN-4] Hotel seasonal multipliers hardcoded in prompt string
**File:** `Pipeline.gs` (lines 366–370)

`Jan=0.80 Feb=0.82 ...` embedded in the Claude prompt. Any adjustment requires editing inside a long string rather than a named constant.

---

### [MIN-5] parse_hotels_cell() silently skips trailing partial entries
**File:** `archive_to_input.py` (line 70)

`for i in range(0, len(parts) - 3, 4)` — if a cell has 7 parts (one complete 4-field entry + 3 leftover), the last 3 fields are silently dropped. Same issue in `parse_sightseeing_cell()`.

---

### [MIN-6] Hardcoded SPREADSHEET_ID in Python scripts
**Files:** `write_to_sheets.py` (line 28), `archive_to_input.py` (line 32)

Sheet ID committed to the public repo. Move to an environment variable.

---

### [MIN-7] buildMasterKey() comment uses 1-based numbers with 0-based code
**File:** `Pipeline.gs` (line 276)

`// Master: col1=City, col2=Hotel Name` while code uses `row[0]` and `row[1]`. Ambiguous for future editors.

---

## Priority Action Items

| # | Issue | File | Action |
|---|-------|------|--------|
| 1 | Login broken — wrong POST/GET handler | Code.gs + HTML | Fix routing before next deploy |
| 2 | Plaintext passwords | Code.gs | Hash before storing |
| 3 | No auth on save/search/list | Code.gs | Add session token validation |
| 4 | Admin flag trusted from localStorage | index_fit.tripstore.html | Validate role server-side |
| 5 | Pipeline double-run risk | Pipeline.gs | Add LockService guard |
| 6 | Quote_Log hotel cost undercount | Quote_Intelligence.gs | Add pricingFactor to payload |
| 7 | Save response not checked | index_fit.tripstore.html | Validate response before toast |
| 8 | setupSheets() not idempotent | Pipeline.gs | Check banner before insert |
| 9 | Stale EUR/INR rate in prompt | Pipeline.gs | Move to Script Properties |
| 10 | markRow() date stored as string | Pipeline.gs | Use new Date() not .toISOString() |

---

*Generated by Claude automated review — 2026-04-11*
