# TripStore Code Review Report
**Date:** 2026-05-28  
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Files Not Found (referenced in task):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py  

**Summary:** 6 CRITICAL · 12 MODERATE · 9 MINOR

---

## Code.gs

### CRITICAL — Passwords stored as plaintext in Google Sheets
**Line:** 258–261, 289  
Passwords are compared and saved using raw string comparison. If anyone gains read access to the Users sheet (e.g., a disgruntled employee or accidental sharing), all agent passwords are exposed. No hashing is applied at any stage.  
**Fix:** Hash passwords with SHA-256 before storing and use the same hash for login comparison. In Apps Script, `Utilities.computeDigest()` produces SHA-256 hashes.

### CRITICAL — No auth check on saveItinerary, searchItinerary, getAllSaved, getQuoteLog
**Lines:** doGet (18–41), doPost (43–58)  
Any anonymous HTTP caller can:
- Fetch all saved pax names (getAllSaved)
- Load any saved itinerary by name (searchItinerary)
- Overwrite anyone else's itinerary (saveItinerary) — no ownership verification
- Read all quote financial data including grand totals, markup %, hotel nets (getQuoteLog)

No session token, API key, or user identity is verified for any of these endpoints. The Google Apps Script URL is embedded in the frontend source and visible to anyone who views the page source.  
**Fix:** Require a logged-in username + session token in every POST action and validate it against the Users sheet before performing the operation. Enforce admin-role check server-side for admin actions.

### CRITICAL — doGet accepts credentials in URL query params (GET login endpoint)
**Lines:** 25–27  
`checkLogin` is accessible via `?action=checkLogin&user=...&pass=...` (GET request). GET params appear in browser history, server logs, and CDN access logs. The frontend uses POST which is correct, but the GET route remains exploitable by anyone who crafts a direct URL.  
**Fix:** Remove `checkLogin` from `doGet`. Only allow it via `doPost`.

---

## Pipeline.gs

### CRITICAL — Unchecked Claude API response structure causes unhandled crash
**Line:** 586–587  
`responseData.content[0].text` assumes Claude always returns a message with at least one content block of type "text". If Claude returns a tool_use block, a stop_reason of "max_tokens", or an empty content array, this throws an unhandled exception that propagates up and silently marks all rows in the batch as errors.  
**Fix:** Add a guard: `if (!responseData.content || !responseData.content[0] || responseData.content[0].type !== 'text') throw new Error('Unexpected API response structure');`

### CRITICAL — Unvalidated Claude output written directly to master sheets
**Line:** 242–244  
`mst.appendRow(rowArr)` appends whatever Claude returned without validating column count, value types, or formula injection risk. A single malformed Claude response can silently corrupt the master Hotels, Sightseeing, Trains, or Transfers sheet.  
**Fix:** Before `appendRow`, validate `rowArr.length` matches the expected column count. Strip any value starting with `=`, `+`, `-`, or `@`. Reject rows where required numeric fields are non-numeric.

### MODERATE — Pipeline execution may exceed Apps Script 6-minute time limit
**Line:** 224–253  
With `BATCH_SIZE = 5` and `Utilities.sleep(1500)` between batches, a large backlog across all 4 sheets can cause the trigger to time out mid-run, leaving rows partially processed with no indication of where it stopped.  
**Fix:** Check `(new Date() - start) / 1000 < 300` before each batch and break early if approaching the limit. Log a "TIMEOUT — resume needed" audit entry.

### MODERATE — SUMMARY_EMAIL error silently breaks pipeline
**Lines:** 673–708  
If `SUMMARY_EMAIL` script property contains an invalid address, `GmailApp.sendEmail()` throws an uncaught exception. Apps Script marks the trigger as failed with no useful error message.  
**Fix:** Wrap `sendSummaryEmail` in a try/catch block in `runMidnightEnrichment`.

### MINOR — CFG.MODEL may reference a deprecated model ID
**Line:** 39  
`'claude-haiku-4-5-20251001'` — as of 2026-05-28 this may have been superseded. Calls to retired model IDs return 404, silently failing all enrichment.  
**Fix:** Verify the current Haiku model ID in the Anthropic console and update. Store the model name in Script Properties so it can be updated without code changes.

---

## Quote_Intelligence.gs

### MODERATE — Potential infinite recursion in logQuote
**Lines:** 32–37  
If `setupQuoteLog()` creates the sheet but it isn't immediately visible to `getSheetByName()` (Apps Script cache), the retry call `logQuote(paxName, data)` recurses indefinitely until Apps Script kills the trigger.  
**Fix:** Replace the recursive retry with a single `return` after `setupQuoteLog()` completes, with a `Logger.log` warning that the first log entry was skipped.

### MODERATE — GST calculation uses stale field name
**Line:** 119  
`const gstPct = d.gst || 5;` — the frontend now saves `gstMode` (string: `"5pkg"`, `"18svc"`, or `"none"`), not a numeric `gst` field. `d.gst` is always `undefined`, so `gstPct` always defaults to `5`. The Quote_Log records incorrect GST for all quotes not using 5%.  
**Fix:** `const gstPct = d.gstMode === '18svc' ? 18 : d.gstMode === '5pkg' ? 5 : 0;`

### MINOR — Quote ID collision risk
**Line:** 140  
`'Q-' + new Date().getTime().toString().slice(-8)` — only the last 8 digits of a ms timestamp. Wraps every ~11.5 days; concurrent saves produce identical IDs.  
**Fix:** `` `Q-${Date.now()}-${Math.floor(Math.random()*1000)}` ``

---

## index_fit.tripstore.html

### CRITICAL — Stored XSS via unsanitised sheet data rendered as innerHTML
**Lines:** ~841, ~1287, ~1601–1604, ~1718–1720  
Hotel names, city names, transfer From/To fields, and tour names from `masterData` are interpolated directly into HTML template strings assigned to `innerHTML`. Since masterData comes from Google Sheets (any registered agent can influence the INPUT sheets via Pipeline), an agent could inject `<script>` or `<img onerror="...">` payloads that execute in every other agent's browser.  
**Fix:** `function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }` — wrap all Sheet-sourced values in `escHtml()` before insertion. For input/textarea values, set `.value =` (DOM property) rather than innerHTML.

### MODERATE — No server-side validation of payload size
**Lines:** 697–719  
The `payload` saved to Google Sheets can exceed the 50,000 character per-cell limit for large itineraries, causing the save to silently fail or truncate.  
**Fix:** `if (JSON.stringify(payload).length > 45000) { showToast("Itinerary too large — reduce stops or activities", "error"); return; }`

### MODERATE — localStorage session has no expiry
**Lines:** 643–651  
Session persists indefinitely. A shared or stolen browser has permanent access with no forced re-login.  
**Fix:** Store `loginTime` in the session. In `checkAutoLogin()`, reject sessions older than 8 hours.

### MODERATE — Mobile number not validated on signup
**Lines:** 601–623  
Only empty-field check is performed. Agents can sign up with "0" or "N/A" as mobile.  
**Fix:** `/^[6-9]\d{9}$/.test(mobile)` before submitting.

### MINOR — formatDate has timezone ambiguity
**Line:** 2029–2031  
`new Date("2024-12-01")` is parsed as UTC midnight. For IST users it is correct, but for any UTC-negative timezone, dates render one day early.  
**Fix:** `const [y,m,day] = String(d).split('-'); return new Date(y,m-1,day).toLocaleDateString('en-GB', {...})`

### MINOR — Seasonal pricing not used in optimizer
**Lines:** 898–904  
Hotels sheet stores 12 monthly price columns but `getHotels()` only returns `annualAvg`. Optimizer uses this single figure regardless of travel month — systematic underquoting in peak season (July/August Paris: ~30–40% above annual average).  
**Fix:** Return the monthly column matching the travel month from the API; use that rate in the optimizer.

---

## write_to_sheets.py

### MODERATE — Formula injection via USER_ENTERED mode
**Line:** 196  
`ws.append_rows(new_rows, value_input_option="USER_ENTERED")` — CSV cells starting with `=`, `+`, `-`, or `@` are interpreted as formulas in the sheet.  
**Fix:** Change to `value_input_option="RAW"`.

### MODERATE — Hardcoded Spreadsheet ID
**Line:** 28  
`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` hardcoded in two files.  
**Fix:** Consolidate to a shared `config.py` or `.env` file.

### MINOR — No retry logic for transient API failures
**Lines:** 165, 175, 195  
A single 429 or 503 from Google Sheets API aborts the entire run with no data written.  
**Fix:** Exponential backoff retry (max 3 attempts, 2/4/8 second delays).

---

## archive_to_input.py

### CRITICAL — Formula injection via USER_ENTERED mode
**Line:** 390  
`ss.worksheet(sheet_name).append_rows(rows, value_input_option="USER_ENTERED")` — same issue as write_to_sheets.py. Archive hotel names or city names starting with `=` execute as formulas.  
**Fix:** Change to `value_input_option="RAW"`.

### MODERATE — Missing sheets silently skip duplicate checks
**Lines:** 316–319  
`load()` returns `[]` with only a warning if a sheet tab is not found. An empty key set means everything appears "new" — floods the INPUT sheets with duplicates.  
**Fix:** Raise an exception and abort if a required master sheet cannot be found.

### MODERATE — Transfer city extraction heuristic is brittle
**Lines:** 154–161  
City is extracted by splitting on a hardcoded list of airport keywords. Airports like MUC, ZRH, CPH, DUB, LIS are missing. Unrecognised airports fall back to the first word of the from-string, which may be wrong.  
**Fix:** Add a lookup dict `IATA_TO_CITY = {"MUC": "Munich", "ZRH": "Zurich", "CPH": "Copenhagen", ...}`.

### MINOR — Hardcoded Spreadsheet ID (same as write_to_sheets.py)
**Lines:** 32–34 — same maintenance risk.  
**Fix:** Shared `config.py`.

### MINOR — No validation that extracted cost values are numeric
**Lines:** 73, 89, 104, 143  
`re.sub(r"[^\d.]", "", ...)` on "TBD" or "N/A" returns `""`, which Pipeline.gs flags as ERROR because `inr_price` is required.  
**Fix:** `if not cost or not cost.replace('.','').isdigit(): cost = "0"` and emit a warning.

---

## Missing Files

The following files were listed in the review task but **do not exist** in the repository:

| File | Status |
|---|---|
| extract_itineraries.py | Not found |
| write_inputs_to_sheets.py | Not found |
| cleanup_sheet.py | Not found |
| clean_pipeline_data.py | Not found |
| cross_reference.py | Not found |
| enrich_hotels.py | Not found |
| enrich_hotels_booking.py | Not found |

---

## Action Items (Priority Order)

| # | Severity | File | Action |
|---|---|---|---|
| 1 | CRITICAL | Code.gs | Hash passwords with SHA-256 before storing in Users sheet |
| 2 | CRITICAL | Code.gs | Add server-side auth check (session token) to all API actions |
| 3 | CRITICAL | Code.gs | Remove checkLogin from doGet — POST only |
| 4 | CRITICAL | index_fit.tripstore.html | Escape all Sheet-sourced values before innerHTML insertion |
| 5 | CRITICAL | Pipeline.gs | Validate Claude API response structure before parsing |
| 6 | CRITICAL | archive_to_input.py & write_to_sheets.py | Change USER_ENTERED to RAW in all append_rows calls |
| 7 | MODERATE | Pipeline.gs | Validate column count + value types before writing to master sheets |
| 8 | MODERATE | Quote_Intelligence.gs | Fix GST to read gstMode instead of stale gst field |
| 9 | MODERATE | Code.gs | Add auth to getQuoteLog, searchItinerary, getAllSaved |
| 10 | MODERATE | Pipeline.gs | Add execution time guard to prevent trigger timeout |
| 11 | MODERATE | index_fit.tripstore.html | Add 8-hour expiry to localStorage session |
| 12 | MODERATE | archive_to_input.py | Raise error (not warning) when master sheet tab not found |
| 13 | MODERATE | write_to_sheets.py | Consolidate SPREADSHEET_ID to shared config |
| 14 | MINOR | Pipeline.gs | Verify and update Haiku model ID |
| 15 | MINOR | Quote_Intelligence.gs | Fix Quote ID generation to avoid collision |
| 16 | MINOR | index_fit.tripstore.html | Fix seasonal pricing in optimizer (use monthly rates not annual avg) |
| 17 | MINOR | index_fit.tripstore.html | Fix formatDate timezone ambiguity |
| 18 | MINOR | write_to_sheets.py | Add retry logic for Google API transient failures |
| 19 | MINOR | archive_to_input.py | Extend airport-to-city keyword list for transfer heuristic |

---
*Generated by automated daily code review — 2026-05-28*
