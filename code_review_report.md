# TripStore Code Review — 2026-05-30

**Reviewer:** Automated daily review  
**Commit reviewed:** 56edcaa (Auto: daily code review)  
**Files reviewed:** Code.gs · Pipeline.gs · Quote_Intelligence.gs · index_fit.tripstore.html · write_to_sheets.py · archive_to_input.py  
**Missing (not in repo):** extract_itineraries.py · write_inputs_to_sheets.py · cleanup_sheet.py · clean_pipeline_data.py · cross_reference.py · enrich_hotels.py · enrich_hotels_booking.py

---

## Severity Summary

| Severity  | Count |
|-----------|------:|
| CRITICAL  |     5 |
| MODERATE  |    17 |
| MINOR     |    18 |

---

## Code.gs

### CRITICAL

**C1 — Plain-text passwords in Google Sheets**  
`checkLogin()` (line 261) compares passwords as raw strings stored in the Users sheet. Any person with view access to the spreadsheet sees every user's password. No hashing, no bcrypt, no token.  
**Fix:** Store a SHA-256 or bcrypt hash in the sheet; hash the input before comparing, or switch to Google OAuth / Apps Script session tokens.

**C2 — Unauthenticated write: anyone can overwrite any itinerary**  
`doPost` routes `saveItinerary` (line 51-52) without verifying the caller's session or identity. The `paxName` is simply the string sent in the POST body. Any actor who knows the web-app URL can overwrite or create itinerary records for any pax name.  
**Fix:** Require a signed session token or at minimum validate the caller's username/password before allowing writes.

**C3 — Unauthenticated read: full pax-name list exposed**  
`doGet?action=getAllSaved` (lines 299-314) returns every saved pax name with no auth check. Combined with the unauthenticated search, an attacker can enumerate and download every saved itinerary.  
**Fix:** Add a session/token check at the top of `getAllSaved` and `searchItinerary`.

### MODERATE

**M1 — Login credentials can travel via GET URL**  
`doGet` (lines 25-26) handles the `checkLogin` action, meaning credentials can be sent as `?action=checkLogin&user=X&pass=Y`. GET params appear in server logs and browser history. The JS frontend uses POST, but the GET route is live and dangerous.  
**Fix:** Remove `checkLogin` from `doGet` entirely; keep it only in `doPost`.

**M2 — No signup input length or format validation**  
`handleSignup` (line 289) appends raw user-supplied strings directly to the sheet with no length checks. Very long inputs can break sheet cell limits or cause display issues.  
**Fix:** Enforce `username.length <= 50`, `password.length >= 8`, validate mobile is 10 digits and email contains `@`.

**M3 — No brute-force protection on login**  
`checkLogin` performs a full O(n) sheet scan on every attempt with no rate limiting, lockout, or CAPTCHA. The public web-app URL makes automated credential stuffing trivial.  
**Fix:** Add an attempt counter in Script Properties per IP or username; lock after 5 failures for 15 minutes.

### MINOR

**m1 — Column comment mislabelled in `getTransfers`**  
Line 203: `notes: String(r[13] || '').trim()` is labelled "Column N: Schedule" in the comment but the column header at position N is "Schedule" and position O is "Notes". Minor documentation drift.

**m2 — `parsePrice` silently returns 0 for undefined columns**  
If a sheet row has fewer columns than expected (e.g., `r[18]` in `getHotels`), `parsePrice` receives `undefined` and returns 0, silently excluding the hotel. No warning is logged.

**m3 — `doGet` returns plain-text errors, not JSON**  
Error responses like `'Server Error: ' + err.message` (line 39) break JSON parsers on the frontend and can leak internal error details publicly.

**m4 — No CORS headers**  
If the web app URL is ever embedded in a third-party page, the lack of explicit CORS headers could cause unexpected behaviour depending on Apps Script deployment settings.

---

## Pipeline.gs

### MODERATE

**M4 — `setupSheets()` inserts banner row unconditionally on every run**  
`_buildInputSheet` (line 779) calls `ws.insertRowBefore(2)` every time. Running `setupSheets()` twice pushes all existing data down by one row each time, corrupting INPUT sheets silently.  
**Fix:** Check whether row 2 is already a merged banner cell before inserting.

**M5 — Claude response not validated for expected array length**  
`callClaudeAPI` (lines 585-588) parses the Claude JSON but does not verify that the returned array length equals `expectedCount`. If Claude omits a result item, `batch[idx]` returns `undefined` and that row is silently skipped—no error, no audit log entry.  
**Fix:** After parsing, check `result.length === expectedCount`; fill missing indices with error entries.

**M6 — Hardcoded EUR→INR exchange rate will go stale**  
The Trains enrichment prompt (line 463) hardcodes `"INR price at ₹110/€"`. As of mid-2026 the rate is materially different. Stale rate produces wrong INR estimates for all train prices back-calculated from EUR.  
**Fix:** Store the rate in Script Properties (`EUR_INR_RATE`) and inject it into the prompt dynamically.

### MINOR

**m5 — Enrichment pipeline uses Haiku model**  
`CFG.MODEL = 'claude-haiku-4-5-20251001'` (line 39). For a luxury travel brand, hotel category inference, seasonal price derivation, and destination validation would benefit from Sonnet or better. Haiku may produce lower-quality enrichment.

**m6 — 1.5 s sleep between Claude batches may not be enough**  
`Utilities.sleep(1500)` (line 252). Anthropic's API rate limits for Haiku are higher per minute, but large INPUT sheets could still hit token-per-minute limits with no backoff on failure.

**m7 — `auditLog` silently swallows all exceptions**  
Lines 657-664: `catch (e) { }` — any sheet write error in the audit log is completely invisible. A full disk or quota error would leave no trace.

**m8 — `sendSummaryEmail` has no try/catch**  
`GmailApp.sendEmail` (line 708) throws if the `SUMMARY_EMAIL` property has an invalid address. The pipeline would crash on the summary step even if all enrichment succeeded, leaving no email and an incomplete audit log entry.

---

## Quote_Intelligence.gs

### MODERATE

**M7 — `totalBudget` field never saved by the frontend**  
`buildQuoteLogRow` (line 125) reads `d.totalBudget`, but `saveItinerary` in Code.gs saves `hotelBudget` and `sightBudget` separately—never `totalBudget`. `transferBudget` is also absent. As a result `budgetEntered` is almost always 0, making the utilisation % and over/under budget flag useless for every quote.  
**Fix:** In Code.gs `saveItinerary`, also save `totalBudget: Number(hotelBudget) + Number(sightBudget)`.

**M8 — Quote ID collision window**  
`quoteId = 'Q-' + new Date().getTime().toString().slice(-8)` (line 141) keeps only the last 8 digits of the Unix timestamp in milliseconds. These digits repeat every ~27 hours. Two quotes saved within the same millisecond (or the same last-8-digit value within the window) will collide.  
**Fix:** Use the full 13-digit timestamp, or append a 4-digit random suffix.

### MINOR

**m9 — `backfillQuoteLog` has no duplicate guard**  
Running `backfillQuoteLog` a second time imports all historical quotes again, doubling every row in the Quote_Log sheet. No check against existing Quote IDs.

**m10 — GST defaults to 5% even for 18% service-charge quotes**  
Line 119: `const gstPct = d.gst || 5`. Old saves that used 18% GST stored the mode as a string (`'18svc'`) in the frontend but `d.gst` is never written to the saved payload. So logged GST amounts are always calculated at 5% regardless of what the agent selected.

**m11 — Recursive retry in `logQuote` can loop indefinitely**  
Lines 35-36: if `setupQuoteLog()` fails to create the sheet (quota, permission), `logQuote` calls itself again, causing a stack overflow or Apps Script 6-minute timeout with no diagnostic output. Add a `retried` guard flag.

---

## index_fit.tripstore.html

### CRITICAL

**C4 — XSS in city datalist via sheet data**  
Line 686: `cities.map(c => \`<option value="${c}">\`).join('')` is injected directly into `innerHTML`. If a city name in the Hotels sheet contains a `"` or `>` character, it breaks the HTML context and can execute injected scripts.  
**Fix:** Create `<option>` elements via `document.createElement('option')` and set `option.value = c` using `setAttribute`, not `innerHTML`.

**C5 — Admin flag stored in and trusted from localStorage**  
`checkAutoLogin` (lines 641-652) reads `isAdmin` from localStorage. Any user can open DevTools and set `localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true,isAdmin:true,...}))` to show the Admin panel. Because `getAllSaved` on the backend has no auth check (see C3), this exposes all pax names without real admin credentials.  
**Fix:** Never trust client-side role flags. Validate admin role server-side on every privileged request.

### MODERATE

**M9 — POST body sent without Content-Type header**  
`fetch(API_URL, { method: "POST", body: JSON.stringify(...) })` (line 583) does not set `"Content-Type": "application/json"`. Apps Script still processes the raw body correctly via `JSON.parse(e.postData.contents)`, but this is non-standard and may break if the Apps Script deployment is updated.

**M10 — `saveItinerary` does not check HTTP response status**  
Line 720: the `fetch` result is never inspected. If the Apps Script returns a 500 error, `showToast("Saved Successfully")` still fires. The user believes the data was saved when it was not.  
**Fix:** Inspect `res.ok` or the response text before showing the success toast.

**M11 — City name injected into innerHTML in route list**  
Line 841: `` `<span><b>${r.city}</b>` `` is inserted into `innerHTML`. A city name containing `<script>` or similar would execute. Use `createElement` + `textContent` instead.

### MINOR

**m12 — Hard-coded Apps Script deployment URL**  
Line 426: `API_URL` is a literal string. Redeploying the Apps Script generates a new URL that must be manually updated in this file.

**m13 — No loading indicator during init data fetch**  
`init()` fetches all master data silently. On a slow connection the city dropdown appears empty for several seconds with no loading feedback.

**m14 — Mobile field not validated on the client at signup**  
`handleSignup` only checks `!mobile` (non-empty). The 10-digit format constraint is absent client-side.

**m15 — Logout clears unsaved itinerary with no warning**  
Clicking Logout immediately reloads the page via `location.reload()`. Any partially built itinerary that hasn't been saved is lost with no confirmation dialog.

---

## write_to_sheets.py

### MODERATE

**M12 — `ws.row_count == 0` is always False for default sheets**  
Line 168: `gspread.Worksheet.row_count` returns the grid size (default 1000), not the number of filled rows. The condition `ws.row_count == 0` is never True. The actual guard is `not ws.get_all_values()` on the right side of the `or`. The first condition is dead code that misleads future developers.

**M13 — No retry / backoff on Google Sheets API calls**  
`ws.append_rows` (line 196) and `ws.get_all_values` (line 120) have no retry logic. Google Sheets API has rate limits (60 req/min). Bulk appends on large CSVs will fail intermittently with `APIError 429` with no recovery.

**M14 — `SPREADSHEET_ID` hardcoded**  
Line 27: hardcoded spreadsheet ID with no environment-variable fallback. Cloning to a staging spreadsheet requires editing source code.

### MINOR

**m16 — `apply_header_style` never re-applied on subsequent runs**  
Formatting is applied only when the sheet was empty. If a user clears row formatting, it is never restored.

**m17 — No log file output**  
All diagnostics go to stdout via `print()`. When run from a cron job without output capture, all diagnostic information is lost.

**m18 — `CREDENTIALS_PATH` is a relative path**  
`Path("./sheets-credentials.json")` depends on the working directory at execution time. Running the script from a different directory produces a misleading "not found" error.

---

## archive_to_input.py

### MODERATE

**M15 — `parse_transfers_cell` city extraction is brittle**  
Lines 153-162: the city is guessed by regex-splitting `from_loc` on airport/landmark keywords. Input like `"City Centre to Hotel"` would split on the word "city" and produce an empty city string. Rows with an empty city pass the duplicate check and queue with no city value, which confuses Claude enrichment downstream.  
**Fix:** Require city to be non-empty; log and skip rows where extraction fails.

**M16 — No validation of expected CSV column names**  
Lines 340-375: `row.get("Hotels Used", "")` returns empty silently if the archive CSV uses a different column name. An entire data category would be skipped with no warning or error.

**M17 — No summary counter for parse failures**  
The stats dict only tracks `found / already_exists / queued`. Parse failures (missing `" to "` in a trains cell, empty city in transfers) are silently dropped. A `parse_errors` counter would surface data-quality issues.

### MINOR

**m19 — `SPREADSHEET_ID` hardcoded**  
Line 32: same issue as write_to_sheets.py.

**m20 — `ADDED_BY = "ARCHIVE_IMPORT"` is hardcoded**  
No way to pass a custom source label without editing source code.

---

## Missing Files (not committed to repo)

The following files were listed for review but **do not exist in this repository**:

- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

These likely live on Sumit's Desktop and have never been committed. If they are active parts of the data pipeline, they should be added to the repo for version control and future review.

---

## Priority Action Items

| # | Priority | Finding | File | Effort |
|---|----------|---------|------|--------|
| 1 | URGENT | Hash passwords — plain-text in Sheets is the highest-severity risk | Code.gs | High |
| 2 | URGENT | Add auth checks to `getAllSaved` and `saveItinerary` | Code.gs | Medium |
| 3 | HIGH | Fix XSS in city datalist (`innerHTML` → `createElement`) | index_fit.tripstore.html | Low |
| 4 | HIGH | Save `totalBudget` in payload so Quote Log budget tracking works | Code.gs | Low |
| 5 | HIGH | Remove `checkLogin` from `doGet` | Code.gs | Low |
| 6 | MEDIUM | Guard against duplicate banner row in `_buildInputSheet` | Pipeline.gs | Low |
| 7 | MEDIUM | Wrap `sendSummaryEmail` in try/catch | Pipeline.gs | Low |
| 8 | MEDIUM | Move EUR/INR rate to Script Properties | Pipeline.gs | Low |
| 9 | MEDIUM | Check fetch response status in `saveItinerary` JS | index_fit.tripstore.html | Low |
| 10 | LOW | Commit missing Python scripts to this repo | — | Medium |

---

*Generated by automated daily review — 2026-05-30*
