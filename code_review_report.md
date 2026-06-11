# TripStore Code Review — 2026-06-11

**Reviewed files:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Missing files (not in repo):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py  
**Recent commits:** 6 consecutive "Auto: daily code review" commits — no app code changes in recent history.

---

## CRITICAL (3 issues — fix before next release)

---

### CRIT-1 · Code.gs · Plaintext passwords in Google Sheets

**Location:** `handleSignup()` line 289, `checkLogin()` line 261  
Passwords are stored and compared in plaintext. If the Google Sheet is ever accessed by anyone with viewer permission (admin, auditor, accidental share), all user credentials are fully exposed.

**Fix:** Hash passwords before saving. Apps Script supports `Utilities.computeDigest()` with SHA-256:
```javascript
function hashPassword(pass) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    pass + 'tripstore2024_salt', Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
```
Store and compare the hash, never the raw password. Existing users will need a one-time reset.

---

### CRIT-2 · Code.gs + index_fit.tripstore.html · Login POST/GET mismatch

**Location:** `doGet()` handles `checkLogin`, but the frontend `checkLogin()` sends a `fetch(API_URL, { method: "POST", ... })` at HTML line 583.

`doPost()` has no `checkLogin` handler and returns "Invalid action". The status check on the frontend never gets "ADMIN" or "USER", so it shows "Invalid Credentials" for every new login attempt.

Existing users are unaffected because `checkAutoLogin()` restores their session from `localStorage` without calling the API. But **any user who clears browser data, switches device, or tries to log in fresh cannot log in**.

**Fix (two options):**
- Option A: Move the `checkLogin` handler into `doPost` (read `data.user` and `data.pass` from POST body). Preferred.
- Option B: Change the frontend `checkLogin()` to send a GET request. Avoid this — passwords in URLs appear in browser history and Google server logs.

---

### CRIT-3 · Code.gs · No authentication on backend endpoints

**Location:** `getAllSaved()`, `searchItinerary()`, `saveItinerary()`, `getQuoteLog()` — all reachable by anyone who knows the Apps Script URL.

- Anyone can enumerate all saved pax names (`getAllSaved`).
- Anyone can load any saved itinerary by guessing a pax name (`searchItinerary`).
- Anyone can overwrite any saved itinerary (`saveItinerary`).
- Anyone can read the full quote log with financials, pax names, and travel details (`getQuoteLog`).

**Fix:** On login, generate a UUID token, store it in Script Properties, return it to the frontend. Require that token on every subsequent request. Frontend stores token in `localStorage` alongside the session.

---

## MODERATE (9 issues — fix in next sprint)

---

### MOD-1 · Pipeline.gs · Hardcoded exchange rate

**Location:** `enrichTrains()` prompt line ~463: `"INR price at ₹110/€"`  
The EUR/INR rate changes daily. Claude uses this stale rate to back-calculate missing € prices, potentially producing systematically wrong values as the rate drifts.

**Fix:** Pull the rate from Script Properties (`EUROINR_RATE`). Admin can update it monthly. Default to 110 if not set.

---

### MOD-2 · Pipeline.gs · No execution time guard

**Location:** `processSheet()` — processes all PENDING rows in one run with `Utilities.sleep(1500)` between every 5-row batch.  
A queue of 500 rows = ~150 API calls × ~2 seconds = ~5 minutes per data type. With 4 types running sequentially, the pipeline can hit Apps Script's 6-minute execution wall, leaving rows half-processed with no indication.

**Fix:** Add a start-time check before each batch:
```javascript
const deadline = start.getTime() + 5 * 60 * 1000;
if (new Date().getTime() > deadline) {
  auditLog(ss, 'TIME LIMIT: stopping early — resume next run');
  break;
}
```

---

### MOD-3 · Pipeline.gs · `_buildInputSheet()` inserts duplicate banner rows

**Location:** `_buildInputSheet()` line 778: `ws.insertRowBefore(2)` runs unconditionally.  
If `setupSheets()` is run more than once (e.g., to rebuild a missing tab), a new banner row is inserted each time. Data rows shift down and the status dropdown validation on rows 3–2000 no longer aligns with actual data rows.

**Fix:** Check whether row 2 is already the info banner before inserting.

---

### MOD-4 · Quote_Intelligence.gs · `backfillQuoteLog()` has no deduplication

**Location:** `backfillQuoteLog()` line 289.  
Running this function a second time appends every historical quote again, doubling all records. There is no check against existing Quote_Log entries.

**Fix:** Build a set of existing (pax name + logged_at) pairs from Quote_Log before appending, and skip any match.

---

### MOD-5 · Quote_Intelligence.gs · Quote ID collision window

**Location:** `buildQuoteLogRow()` line 140: `'Q-' + new Date().getTime().toString().slice(-8)`  
The last 8 decimal digits of a Unix timestamp cycle every ~27.7 hours. Two quotes saved at the same offset on different days get the same Quote ID. A bulk backfill run generates many rows in rapid sequence and will produce duplicates in the same run.

**Fix:** `'Q-' + Date.now() + '-' + Math.floor(Math.random() * 9999).toString().padStart(4, '0')`

---

### MOD-6 · index_fit.tripstore.html · Stale `pricingFactor` baked into rendered HTML

**Location:** `renderTables()` line 1307:
```javascript
onchange="currentPlan[${planIdx}].hotel.cost = Number(this.value)/(${item.nights||1}*${config.pricingFactor});"
```
`config.pricingFactor` is computed once at render time and baked as a literal number into the `onchange` attribute. If the user changes adult/child counts after a table is rendered, editing a hotel price cell uses the old factor and stores a wrong per-night cost.

**Fix:** Replace the literal with a live call: `getTravelConfigs().pricingFactor`.

---

### MOD-7 · index_fit.tripstore.html · No brute-force protection on login

**Location:** Frontend `checkLogin()` — no attempt counter, no lockout, no rate limit anywhere in Code.gs.  
With the API URL, an attacker can try unlimited password combinations. This becomes less dangerous after CRIT-1 (hashing) is fixed, but rate limiting is still good practice.

**Fix:** Track failed attempts per username in Script Properties. Lock out for 15 minutes after 10 failures.

---

### MOD-8 · archive_to_input.py · Hardcoded airport keyword list for city extraction

**Location:** `parse_transfers_cell()` lines 155–160: regex split uses a fixed list `(airport|cdg|lhr|ams|fra|...)`.  
Any transfer description for a destination not in the list (Athens ATH, Lisbon LIS, Dubrovnik DBK, etc.) will produce empty or wrong city values in INPUT_Transfers, which Claude will then reject as invalid.

**Fix:** Treat everything before the first mention of "Airport" (case-insensitive) as the city — simpler and more general. Or load the IATA codes list from the Transfers master sheet dynamically.

---

### MOD-9 · write_to_sheets.py · `append_rows()` uses `USER_ENTERED` for raw data

**Location:** Line 196: `ws.append_rows(new_rows, value_input_option="USER_ENTERED")`  
`USER_ENTERED` tells Google Sheets to interpret values as if typed by a user — numeric strings that look like dates get auto-formatted, strings starting with `=` become formulas. Archive data can contain strings like "2024-01-01" or values with leading `=` from Excel exports.

**Fix:** Use `value_input_option="RAW"` to prevent any automatic interpretation.

---

## MINOR (7 issues — fix when convenient)

---

### MIN-1 · Pipeline.gs · `GmailApp.sendEmail()` has no try/catch

**Location:** `sendSummaryEmail()` line 708. Daily Gmail quota is 100 emails/day for free accounts. If the quota is hit, an unhandled exception will be thrown. Won't break the pipeline (called last) but produces noisy errors in the Apps Script execution log.

**Fix:** Wrap in `try/catch` and log the failure via `auditLog()`.

---

### MIN-2 · Quote_Intelligence.gs · Potential infinite recursion in `logQuote()`

**Location:** `logQuote()` lines 33–37. If `setupQuoteLog()` throws mid-way and the sheet is only partially created, the recursive call will attempt `setupQuoteLog()` again in a loop.

**Fix:** Add a retry guard: `function logQuote(paxName, data, _isRetry = false)` and skip the recursive call if `_isRetry` is true, logging the error instead.

---

### MIN-3 · write_to_sheets.py · Relative path for credentials

**Location:** Line 32: `CREDENTIALS_PATH = Path("./sheets-credentials.json")`  
If run from a different working directory (e.g., a cron job), the file won't be found.

**Fix:** `CREDENTIALS_PATH = Path(__file__).parent / "sheets-credentials.json"`

---

### MIN-4 · write_to_sheets.py · `ws.get_all_values()` called twice

**Location:** Lines 120 and 168. `build_existing_keys()` and the empty-sheet check both call `ws.get_all_values()` independently — two round-trips to the Sheets API for the same data.

**Fix:** Call `ws.get_all_values()` once at the top of `main()` and pass the result to both consumers.

---

### MIN-5 · archive_to_input.py · Stride parsers silently drop partial entries

**Location:** `parse_hotels_cell()` uses `range(0, len(parts) - 3, 4)`. If the cell has 7 parts instead of 8 (missing one field), the last hotel entry is silently dropped. Same issue in `parse_sightseeing_cell()` with stride 3.

**Fix:** After parsing, if `len(parts) % expected_stride != 0`, log a warning with the raw cell value for manual review.

---

### MIN-6 · index_fit.tripstore.html · `autoSaveThenDo()` fails silently

**Location:** Line 2292: `catch(e) { /* silent — don't block the export */ }`  
If auto-save fails (network error, Apps Script timeout), the user gets a PDF/Excel but their cloud save is silently lost. They may assume it was saved.

**Fix:** Show a non-blocking warning toast: `showToast("Export done — cloud save failed, save manually", "error")`.

---

### MIN-7 · index_fit.tripstore.html · Add Tour list capped at 20

**Location:** `openAddTourDirect()` line 2058: `.slice(0, 20)` — cities with many tours (Paris, Rome, London) silently hide options beyond the first 20. Users must know to search to find them.

**Fix:** Remove the arbitrary cap or replace with a label: "Showing top 20 — search to see more".

---

## Files Not Found

The following files were requested for review but do not exist in this repository:

| File | Status |
|---|---|
| extract_itineraries.py | NOT IN REPO |
| write_inputs_to_sheets.py | NOT IN REPO |
| cleanup_sheet.py | NOT IN REPO |
| clean_pipeline_data.py | NOT IN REPO |
| cross_reference.py | NOT IN REPO |
| enrich_hotels.py | NOT IN REPO |
| enrich_hotels_booking.py | NOT IN REPO |

These likely exist in a separate local folder (e.g., `/Users/Sumit/Desktop/tripstore-itinerary-archive/`) that is not committed to this repository. If they need to be reviewed, they should be added to the repo or reviewed from the local machine.

---

## Action Items Summary

| Priority | Count | Action |
|---|---|---|
| CRITICAL | 3 | Fix before any new users sign up or share the API URL |
| MODERATE | 9 | Fix in next development sprint |
| MINOR | 7 | Fix when convenient |

**Top 3 to fix immediately:**
1. **CRIT-1** — Hash passwords in Google Sheets (current plaintext is a data breach waiting to happen)
2. **CRIT-2** — Fix login POST routing so new users can actually log in (currently broken for fresh logins)
3. **CRIT-3** — Add token auth on all data endpoints (itineraries, quote log, and pax names are currently public)

---

*Generated by automated daily code review — 2026-06-11*
