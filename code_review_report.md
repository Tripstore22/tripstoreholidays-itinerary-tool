# TripStore Code Review Report
**Date:** 2026-04-18
**Reviewed by:** Claude (Automated Daily Review)
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py

> **Note:** 7 files requested for review do not exist in this repository:
> extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py,
> cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py.
> Only the 6 files listed above were reviewed.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| MODERATE | 9 |
| MINOR | 5 |
| **Total** | **17** |

---

## CRITICAL Issues

---

### C1 — Login Is Completely Broken (Code.gs + index_fit.tripstore.html)

**File:** `Code.gs` line 25, `index_fit.tripstore.html` line 583

**Problem:** The frontend sends login credentials as a POST request with a JSON body:
```javascript
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })
```
But `doPost()` in Code.gs does NOT handle the `"checkLogin"` action — only `"signup"` and `"saveItinerary"` are handled there. The `"checkLogin"` handler only exists in `doGet()`, which reads credentials from URL query parameters (`e.parameter.user`, `e.parameter.pass`).

**Result:** Every login attempt returns `"Invalid action"`, shown to the user as "Invalid Credentials". New users cannot log in at all. Only users with an existing `tripstore_session` already in `localStorage` can still access the app.

**Fix:** Add `"checkLogin"` to `doPost()`:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```
And remove it from `doGet()` since sending passwords as URL parameters is insecure (URLs are logged by browsers, CDNs, and proxy servers).

---

### C2 — localStorage Session Can Be Forged to Get ADMIN Access (index_fit.tripstore.html)

**File:** `index_fit.tripstore.html` lines 641–652

**Problem:** On page load, `checkAutoLogin()` reads `localStorage.tripstore_session` and — without any server-side validation — calls `launchApp()` with whatever role is stored:
```javascript
const s = JSON.parse(saved);
isAdmin = s.isAdmin;     // trusted blindly from localStorage
launchApp(s.modeText);
```
Anyone can open the browser console and type:
```javascript
localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:"ADMIN MODE"}))
```
...then reload the page to gain full admin access without any credentials.

**Fix:** The session in localStorage should only store an opaque token. On auto-login, send that token to the backend to re-verify the role. Never trust `isAdmin: true` stored client-side.

---

### C3 — Stored XSS: City Names Injected Directly into innerHTML (index_fit.tripstore.html)

**File:** `index_fit.tripstore.html` line 841

**Problem:** User-supplied city names are inserted directly into innerHTML without sanitisation:
```javascript
document.getElementById('routeList').innerHTML = selectedRoute.map(r => `
    <span><b>${r.city}</b> (${r.nights}N)</span>
    <button onclick="removeRoute(${r.id})" ...>
`).join('');
```
A malicious city name like `</b><img src=x onerror=alert(document.cookie)>` would execute JavaScript. Since itineraries are saved to the server and can be loaded by the Admin panel, a payload saved by one user executes in the Admin's browser — this is a stored XSS attack.

**Fix:** Use `textContent` for user-supplied values, or escape HTML entities before injecting into innerHTML.

---

## MODERATE Issues

---

### M1 — Plain-Text Passwords in Google Sheets (Code.gs)

**File:** `Code.gs` lines 249–268, 289

Passwords are stored and compared as plain text in the "Users" sheet. A Google Sheets data breach, accidental share, or rogue admin exposes all credentials.

**Fix:** Hash passwords before storing. In Apps Script, use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` as a minimum, or move to Google OAuth.

---

### M2 — No Authentication on saveItinerary or getAllSaved (Code.gs)

**File:** `Code.gs` lines 51–57, 299–313

`saveItinerary` and `getAllSaved` accept requests from anyone who knows the Apps Script URL — no session or token is required. Anyone can overwrite any client's itinerary or retrieve all saved pax names.

**Fix:** Require a session token on every protected endpoint, validated server-side.

---

### M3 — No Rate Limiting on Login Endpoint (Code.gs)

**File:** `Code.gs` lines 249–268

No brute-force protection exists on `checkLogin`. Once C1 is fixed, an attacker could enumerate usernames and try common passwords in a loop with no lockout.

**Fix:** Log failed attempts per username with a timestamp and lock for N minutes after 5 failures.

---

### M4 — Pipeline Leaves Rows in Inconsistent State on Timeout (Pipeline.gs)

**File:** `Pipeline.gs` lines 224–252

Apps Script has a 6-minute execution limit. If the pipeline times out mid-batch, some rows will already have been written to master sheets but their INPUT status will still show `PENDING`. On the next run those rows are re-sent to Claude, creating duplicates in master data.

**Fix:** Write a `PROCESSING` status to each row before sending to Claude. On re-run, skip rows in `PROCESSING` state or treat them as errors to review.

---

### M5 — Claude API Response Parsing Has No Fallback for Partial JSON (Pipeline.gs)

**File:** `Pipeline.gs` lines 583–597

If Claude returns a truncated response (e.g., hitting `MAX_TOKENS: 4096`) or unexpected markdown, `JSON.parse(cleaned)` throws and the outer catch marks all rows in the batch as errors — valid rows are lost. There is also no null-check before accessing `responseData.content[0].text`.

**Fix:** Validate `responseData.content?.[0]?.text` before accessing. Consider increasing `MAX_TOKENS` or reducing `BATCH_SIZE` for large hotel batches.

---

### M6 — `backfillQuoteLog` Creates Duplicates if Run Twice (Quote_Intelligence.gs)

**File:** `Quote_Intelligence.gs` lines 278–309

`backfillQuoteLog()` appends all rows from `Saved_Itineraries` to `Quote_Log` with no duplicate check. Running it a second time will double all historical quotes and corrupt analytics.

**Fix:** Before appending, build a set of existing pax+timestamp combinations from `Quote_Log` and skip rows already present.

---

### M7 — Hardcoded Spreadsheet ID in Python Scripts (write_to_sheets.py, archive_to_input.py)

**File:** `write_to_sheets.py` line 28, `archive_to_input.py` line 32

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
```
This is committed to the Git repository. If the repo is ever made public, this ID — combined with a leaked `sheets-credentials.json` — gives full write access to all master data.

**Fix:** Move to a `.env` file, add `.env` to `.gitignore`, and load with `python-dotenv`.

---

### M8 — archive_to_input.py Silently Drops Hotels with Unexpected Format (archive_to_input.py)

**File:** `archive_to_input.py` lines 63–76

`parse_hotels_cell` expects exactly 4 pipe-delimited fields per hotel (`city | name | nights | cost`). If the archive data has a slightly different format, the loop silently skips the entry — data is lost with no warning.

**Fix:** Add a counter for malformed entries and print a warning at the end of each run.

---

### M9 — Transfer Rows Written to INPUT_Transfers Are Missing Required Fields (archive_to_input.py)

**File:** `archive_to_input.py` lines 275–289

`make_transfer_row` leaves `row[2]` (Airport Code) and `row[6]` (Direction: ARRIVAL/DEPARTURE) blank. Pipeline.gs validates that `airport` is a recognisable IATA code — since it is blank, all transfers generated by this script will be flagged ERROR by Claude and never enriched.

**Fix:** Infer Direction from the description ("Airport to Hotel" = ARRIVAL) and populate it. Allow blank airport code or handle it in the Claude prompt.

---

## MINOR Issues

---

### N1 — `logQuote` Recursive Call Can Stack Overflow (Quote_Intelligence.gs)

**File:** `Quote_Intelligence.gs` lines 29–47

If `setupQuoteLog()` fails, `logQuote` calls itself again with no guard, potentially looping or stack-overflowing.

**Fix:** Add a `created` boolean parameter and only retry once.

---

### N2 — `_titleCase` Uses Deprecated `substr` (Quote_Intelligence.gs)

**File:** `Quote_Intelligence.gs` line 315

`t.substr(1)` is deprecated. Use `t.slice(1)` instead.

---

### N3 — `getTransfers` Field Name / Comment Mismatch (Code.gs)

**File:** `Code.gs` line 203

The `notes` field is populated from column index 13 but the comment says "Column N: Schedule". The field name and comment disagree.

**Fix:** Either rename the field to `schedule` or correct the comment.

---

### N4 — write_to_sheets.py Creates Sheet with Only 1000 Rows (write_to_sheets.py)

**File:** `write_to_sheets.py` line 57

A large archive export could exceed 1000 rows. Google Sheets will silently stop accepting appends when full.

**Fix:** Use a larger row count (5000+) or expand dynamically before appending.

---

### N5 — No Content-Type Header on POST Fetch Requests (index_fit.tripstore.html)

**File:** `index_fit.tripstore.html` lines 583, 612, 720

All POST fetch calls that send JSON bodies omit `Content-Type: application/json`.

**Fix:** Add `headers: { 'Content-Type': 'application/json' }` to all POST fetch calls.

---

## Action Items (Priority Order)

1. **[URGENT]** Fix login: add `"checkLogin"` to `doPost()` in Code.gs
2. **[URGENT]** Fix localStorage admin bypass: validate session server-side on auto-login
3. **[URGENT]** Fix stored XSS: escape city names and all user-supplied values before innerHTML injection
4. **[HIGH]** Hash passwords in the Users sheet
5. **[HIGH]** Add auth checks to `saveItinerary` and `getAllSaved` endpoints
6. **[HIGH]** Fix archive_to_input.py: populate Direction and Airport Code on transfer rows
7. **[MEDIUM]** Move SPREADSHEET_ID to `.env` in both Python scripts
8. **[MEDIUM]** Add duplicate guard to `backfillQuoteLog`
9. **[MEDIUM]** Add `PROCESSING` status to pipeline to prevent duplicates on timeout
10. **[LOW]** Fix `_titleCase` substr deprecation, add Content-Type headers, expand sheet row limit

---

*Generated automatically by Claude Code — TripStore Daily Review — 2026-04-18*
