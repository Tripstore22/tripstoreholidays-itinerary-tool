# TripStore Code Review — 2026-05-13

**Reviewer:** Automated (Claude)
**Scope:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Files requested but NOT found in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py — these 7 files were not present; they may live only on the local machine.

---

## Recent Commits Reviewed
```
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main
e6a35d9 Merge v2 into main
f3b87ad Sync index.html with index_fit.tripstore.html
a105e1d Fix security issues and add budget suggestion hints
```

---

## CRITICAL ISSUES (fix immediately)

### C1 — Passwords stored and compared in plaintext (Code.gs · checkLogin)
**File:** Code.gs · lines 254–268
**Problem:** Passwords are stored as raw strings in the Users sheet and compared directly with `dbPass === pass.trim()`. A breach of the Google Sheet (e.g., sharing accident, Google admin access) immediately exposes all user credentials.
**Fix:** Implement one-way hashing (e.g., SHA-256 via Utilities.computeDigest in Apps Script) before storing and before comparing. Existing passwords must be migrated.

### C2 — No rate limiting on the login endpoint (Code.gs · doGet)
**File:** Code.gs · lines 25–27
**Problem:** `checkLogin` is exposed as a public GET endpoint with no rate limiting, lockout, or CAPTCHA. Anyone who knows (or guesses) the Apps Script URL can brute-force credentials indefinitely.
**Fix:** Add a per-user exponential backoff lockout using Script Properties (store failed attempt counts + timestamps). After 5 failures, lock for 15 minutes.

### C3 — Login action mismatch between frontend and backend
**File:** index_fit.tripstore.html · line 583 vs Code.gs · doPost lines 43–57
**Problem:** The frontend sends `checkLogin` via HTTP POST (`method: "POST", body: JSON.stringify({action:"checkLogin",...})`). However, `doPost` in Code.gs only handles `signup` and `saveItinerary` — it returns `"Invalid action"` for `checkLogin`. The `checkLogin` function is only wired in `doGet`. This means the repo copy of Code.gs and the live deployment are out of sync, or login is silently failing.
**Fix:** Either (a) move `checkLogin` into `doPost` so credentials are never exposed in query strings, or (b) verify the live deployed Code.gs handles this correctly and sync the repo copy.

### C4 — XSS via unescaped innerHTML in renderTables (index_fit.tripstore.html)
**File:** index_fit.tripstore.html · lines 1287, 1294, 1352, 1403, 1604, 1719–1720
**Problem:** Hotel names, city names, tour info, transfer from/to fields, and intercity routes from masterData are interpolated directly into HTML strings and written to `innerHTML` with no encoding. Example: `${t.from} ➔ ${t.to}` on line 1604. If any master sheet cell contained `<img src=x onerror=alert(1)>`, it would execute in every user's browser.
**Risk level:** Lower than a fully public app (only admins edit the sheet), but any team member or a Claude enrichment error could inadvertently inject HTML into sheet cells.
**Fix:** Wrap all dynamic values in a simple escape helper before inserting into HTML:
```js
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
```
Apply to all fields inside template literals used in innerHTML.

---

## MODERATE ISSUES (fix within the week)

### M1 — No authentication on getAllSaved, getQuoteLog, searchItinerary endpoints
**File:** Code.gs · lines 299–314, 372–418, 321–335
**Problem:** `getAllSaved` returns every pax name in the system. `getQuoteLog` returns every quote including financial details, pax names, cities. `searchItinerary` loads full itinerary JSON for any pax name. All three are accessible to anyone who knows the Apps Script URL — no session token or login check.
**Fix:** Add a simple token check: require a `token` parameter in all GET requests, validate it against an admin-set Script Property. Non-admin endpoints should at minimum require the authenticated user's token.

### M2 — saveItinerary has no auth check — any user can overwrite any other user's data
**File:** Code.gs · lines 342–365
**Problem:** `saveItinerary` via POST accepts any `paxName` and overwrites the matching row. User A can overwrite User B's saved itinerary by knowing (or guessing) the pax name, since there is no ownership or session check.
**Fix:** Pass the authenticated username in the save payload and check it server-side.

### M3 — Session restored from localStorage without re-validating server-side
**File:** index_fit.tripstore.html · lines 641–652
**Problem:** On page load, `checkAutoLogin()` reads the session from localStorage and immediately grants access without verifying the token is still valid on the server. If a user's account is suspended or password changed, their cached session continues to work indefinitely until they manually log out or clear localStorage.
**Fix:** On `checkAutoLogin`, make a lightweight ping to the server (e.g. a `validateSession` action) before granting access.

### M4 — Stale hardcoded EUR/INR conversion rate in Pipeline.gs prompt
**File:** Pipeline.gs · line 463
**Problem:** The trains enrichment prompt hardcodes `₹110/€` as the EUR-to-INR conversion rate. As of May 2026, the actual market rate may differ significantly. If the rate has drifted, Claude will silently back-calculate incorrect INR prices from EUR columns, and those stale prices will be written to the master Trains sheet.
**Fix:** Fetch the current rate from a free FX API (e.g. open.er-api.com) at the start of `runMidnightEnrichment()` and pass it dynamically into the prompt string.

### M5 — Claude API JSON parse failure silently retries the entire batch forever
**File:** Pipeline.gs · lines 585–597
**Problem:** `callClaudeAPI` strips markdown fences and calls `JSON.parse` on Claude's response. If Claude returns partial JSON, a trailing comma, or non-JSON text, `JSON.parse` throws and the catch block marks every row in the batch as an error. After `resetErrorRows()`, they are requeued. If Claude consistently fails on these inputs, the loop never terminates.
**Fix:** Add a max-retry counter per row (stored as `"RETRY:2 ..."` prefix in the Error_Reason column) and stop reprocessing rows after 3 consecutive Claude failures.

### M6 — archive_to_input.py silently drops trailing items in multi-entry cells
**File:** archive_to_input.py · lines 70, 86
**Problem:** `parse_hotels_cell` uses `range(0, len(parts) - 3, 4)`. If a cell has 7 pipe-delimited tokens (representing 1.75 hotels worth of data), the last partial entry is silently dropped. `parse_sightseeing_cell` has the same issue with step 3. Data that should be queued for enrichment is never seen.
**Fix:** Change to `range(0, len(parts), 4)` (and `range(0, len(parts), 3)`) and guard each field access with `if i + N < len(parts)`.

### M7 — archive_to_input.py append_rows has no error handling — partial runs create duplicates
**File:** archive_to_input.py · lines 386–392
**Problem:** `ss.worksheet(sheet_name).append_rows(rows, ...)` has no try/except. On a network error or Google Sheets quota limit, the script crashes mid-way. A re-run starts fresh and re-appends items already written before the crash (since `seen` is in-memory only), creating duplicate INPUT rows that then go to the master on enrichment.
**Fix:** Wrap `append_rows` in a try/except with retry logic, and/or checkpoint written items to a local file between categories.

### M8 — setupSheets inserts a duplicate info-banner row every time it is run
**File:** Pipeline.gs · line 779
**Problem:** `_buildInputSheet` unconditionally calls `ws.insertRowBefore(2)` without checking whether the banner already exists. Running `setupSheets()` a second time (e.g. after adding a column) pushes all existing data rows down by one and corrupts the column alignment expected by `getPendingRows`.
**Fix:** Check whether row 2 already contains the expected banner text before inserting.

---

## MINOR ISSUES (address in next maintenance window)

### N1 — Budget suggestion ranges are stale hardcoded INR values
**File:** index_fit.tripstore.html · lines 782–784
**Problem:** `BUDGET_RANGES` is set to `hotel: {low:2500, high:7500}` and `land: {low:1200, high:2800}` in INR per room/pax per night. These values have not been updated with European hotel pricing trends and may no longer reflect current market rates for Indian HNI clients.
**Fix:** Move these thresholds to a dedicated row in the Google Sheet (e.g. a "Config" tab) so they can be updated without a code push.

### N2 — Quote ID collision risk in Quote_Intelligence.gs
**File:** Quote_Intelligence.gs · line 139
**Problem:** `'Q-' + new Date().getTime().toString().slice(-8)` produces an 8-digit suffix that repeats every ~27 hours. During batch backfill operations, two quotes saved in the same millisecond would collide.
**Fix:** Use the full 13-digit timestamp, or append a random 4-character suffix.

### N3 — archive_to_input.py mode detection defaults Bus/Coach to "Train"
**File:** archive_to_input.py · lines 107–108
**Problem:** `parse_trains_cell` detects Ferry keywords but everything else defaults to `"Train"`. Bus and Coach routes from the archive are imported as `mode="Train"` which then writes incorrect mode data to the master Trains sheet.
**Fix:** Add bus/coach/shuttle keyword detection before defaulting to Train.

### N4 — legId interpolated into oninput attribute — apostrophe risk
**File:** index_fit.tripstore.html · line 1691
**Problem:** `filterIntercityModal('${legId}')` interpolates `legId` (which includes city names like `ic-paris-brussels`) directly into an `oninput` attribute string. A city name with an apostrophe (e.g. `ic-l'aquila-rome`) would break the attribute string and throw a JS error.
**Fix:** Use a data attribute instead: `data-legid="${legId}"` and read it with `dataset.legid` in the handler.

### N5 — Hotels annual average hardcoded as column index 18 in two places
**File:** Code.gs · line 99; Pipeline.gs · Section 6 prompt
**Problem:** Column S (Annual Avg) is referenced as `r[18]` in Code.gs `getHotels` and expected at array position [18] in the Claude output prompt. If a column is ever inserted in the Hotels sheet, both break silently with wrong pricing.
**Fix:** Add a comment documenting this coupling and read the column by header name rather than by index where possible.

### N6 — write_to_sheets.py uses unreliable sheet emptiness check
**File:** write_to_sheets.py · line 168
**Problem:** `ws.row_count == 0` relies on an internal gspread property that is not always accurate for sheets with existing structure. The code already calls `get_all_values()` for duplicate detection, so that result can be reused.
**Fix:** Replace `ws.row_count == 0 or not ws.get_all_values()` with simply `not ws.get_all_values()`.

---

## SUMMARY TABLE

| ID | Severity | File | Description |
|----|----------|------|-------------|
| C1 | CRITICAL | Code.gs | Plaintext passwords in Google Sheets |
| C2 | CRITICAL | Code.gs | No rate limiting on login — brute-force possible |
| C3 | CRITICAL | Code.gs + HTML | checkLogin POST/GET routing mismatch — repo may be out of sync with live |
| C4 | CRITICAL | index_fit.tripstore.html | XSS via unescaped innerHTML in renderTables |
| M1 | MODERATE | Code.gs | No auth on getAllSaved / getQuoteLog / searchItinerary |
| M2 | MODERATE | Code.gs | saveItinerary allows any user to overwrite any pax data |
| M3 | MODERATE | HTML | Auto-login restores session without server re-validation |
| M4 | MODERATE | Pipeline.gs | Hardcoded EUR/INR = ₹110 rate is likely stale |
| M5 | MODERATE | Pipeline.gs | Claude JSON parse failures lead to infinite retry loop |
| M6 | MODERATE | archive_to_input.py | Off-by-one silently drops last hotel/tour in multi-entry cells |
| M7 | MODERATE | archive_to_input.py | No error handling on append_rows — partial runs create duplicates |
| M8 | MODERATE | Pipeline.gs | setupSheets inserts duplicate info-banner row on re-run |
| N1 | MINOR | HTML | Budget suggestion ranges are stale hardcoded INR values |
| N2 | MINOR | Quote_Intelligence.gs | Quote ID collision risk in high-frequency saves |
| N3 | MINOR | archive_to_input.py | Bus/Coach defaults to "Train" mode |
| N4 | MINOR | HTML | legId interpolated into oninput attribute — apostrophe risk |
| N5 | MINOR | Code.gs + Pipeline.gs | Hotels annual avg hardcoded at column index 18 in two places |
| N6 | MINOR | write_to_sheets.py | Unreliable sheet emptiness check |

**Total: 4 CRITICAL · 8 MODERATE · 6 MINOR**

---

## PRIORITISED ACTION ITEMS

**Immediate (CRITICAL):**
1. Hash passwords before storing and comparing in Users sheet (C1)
2. Add login rate limiting via Script Properties (C2)
3. Verify live Code.gs handles POST checkLogin — sync repo if not (C3)
4. Add `esc()` helper to all renderTables innerHTML interpolations (C4)

**This week (MODERATE):**
5. Add session token validation to public GET endpoints (M1)
6. Add ownership check to saveItinerary (M2)
7. Add server-side session re-validation on auto-login (M3)
8. Fetch live EUR/INR rate dynamically in Pipeline.gs (M4)
9. Add Claude retry counter to prevent infinite error loops (M5)
10. Fix off-by-one in archive_to_input.py cell parsers (M6)
11. Add try/except + retry to archive_to_input.py append_rows (M7)
12. Guard setupSheets against duplicate banner row insertion (M8)

**Next maintenance window (MINOR):**
13–18. See N1–N6 above.

---

*Generated automatically on 2026-05-13. 7 files requested were not found in this repo and were not reviewed: extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py.*
