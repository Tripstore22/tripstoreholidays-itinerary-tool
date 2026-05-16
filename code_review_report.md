# TripStore Code Review — 2026-05-16

**Files reviewed:** Code.gs · Pipeline.gs · Quote_Intelligence.gs · index_fit.tripstore.html · write_to_sheets.py · archive_to_input.py  
**Files not found in repo (skipped):** extract_itineraries.py · write_inputs_to_sheets.py · cleanup_sheet.py · clean_pipeline_data.py · cross_reference.py · enrich_hotels.py · enrich_hotels_booking.py

---

## CRITICAL Issues (4)

### C1 — Login is broken: `checkLogin` sent as POST but only handled in `doGet` (Code.gs + HTML)
**Code.gs lines 25–28 / HTML line 583**  
`doPost` only handles `signup` and `saveItinerary`. The frontend sends `{ action: "checkLogin", user, pass }` as a **POST** request. Since `checkLogin` is wired only into `doGet`, every fresh login attempt gets back the string `"Invalid action"`, which the frontend displays as "Invalid Credentials." Existing users survive via cached `localStorage` sessions, masking the breakage.

**Fix:** Add `checkLogin` to `doPost` (or change the frontend to use GET with params — but avoid passing credentials in the URL).

---

### C2 — Passwords stored in plaintext in Google Sheets (Code.gs line 261)
`checkLogin` does a string-equality comparison against raw passwords in the "Users" sheet. Anyone with Viewer access to the spreadsheet can read every user's password. There is no hashing at any point.

**Fix:** Hash passwords server-side on signup. Do not compare raw plaintext.

---

### C3 — Admin role is client-controlled via `localStorage` (HTML lines 586–589, 641–649)
The `isAdmin` flag and `modeText` string are written to and read from `localStorage`. Any user can open DevTools and paste:
`localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true,isAdmin:true,modeText:"ADMIN MODE"}))`
This instantly reveals the Admin panel and lets them load any user's saved itinerary.

**Fix:** The admin check must happen server-side. Return only a signed session token from the backend; never store a raw `isAdmin` boolean in client storage.

---

### C4 — Spreadsheet ID hardcoded in Python scripts (write_to_sheets.py line 27 / archive_to_input.py line 32)
`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is committed to the repo in two files. If this repo is ever made public or cloned externally, the entire master data spreadsheet is exposed by ID.

**Fix:** Move the ID to an environment variable (`TRIPSTORE_SHEET_ID`) or a `.env` file that is `.gitignore`d.

---

## MODERATE Issues (10)

### M1 — No login rate-limiting or lockout (Code.gs lines 249–268)
`checkLogin` iterates every row in the Users sheet on every call with no failed-attempt counter, no delay, and no IP check. The Apps Script endpoint is publicly accessible, making it trivially brute-forceable.

**Fix:** Log failed attempts per username in a separate sheet; block for 15 minutes after 5 consecutive failures.

---

### M2 — `_buildInputSheet` inserts an extra banner row on every call (Pipeline.gs lines 778–788)
`ws.insertRowBefore(2)` runs unconditionally each time `setupSheets()` is called. Running setup twice creates two banner rows, pushing data down and breaking the `getPendingRows` offset (which skips exactly 2 rows).

**Fix:** Check whether row 2 already contains the info banner before inserting.

---

### M3 — EUR/INR exchange rate hardcoded at Rs110/EUR (Pipeline.gs line 463)
The trains enrichment prompt hard-codes `INR price at Rs110/EUR`. As of mid-2026 the rate is materially different. Claude will back-calculate wrong INR prices for new train routes where only a EUR price is supplied.

**Fix:** Pull the rate from a Script Property (`EUR_INR_RATE`) so it can be updated without a code change.

---

### M4 — Claude response parsing is brittle (Pipeline.gs lines 587–588)
Claude occasionally wraps output in different markdown fences or adds trailing explanation text. Any variation causes `JSON.parse` to throw and the entire batch is marked ERROR.

**Fix:** Use a regex extractor: `const match = text.match(/\[[\s\S]*\]/); JSON.parse(match[0])`, or at minimum strip markdown case-insensitively.

---

### M5 — Long pipelines can exceed Apps Script's 6-minute execution limit (Pipeline.gs line 252)
`Utilities.sleep(1500)` is called after every batch of 5 rows. With 50 pending rows across 4 sheet types, sleep alone consumes 60 seconds. Add Claude API latency and the script can time out mid-run, leaving rows in limbo with no error status written.

**Fix:** Record a checkpoint (last processed rowIndex) after each batch and resume from it on restart.

---

### M6 — Claude API error result missing idx field causes silent row skip (Pipeline.gs lines 593–596)
If Claude returns fewer results than the batch size (partial response), `batch[N]` is `undefined` for the missing rows and they are silently skipped — staying PENDING forever without an error marker.

**Fix:** After the API call, validate `results.length === batch.length`; pad with error objects if the count is short.

---

### M7 — Recursive `logQuote` infinite loop risk (Quote_Intelligence.gs lines 33–47)
If `setupQuoteLog()` creates the sheet but `ss.getSheetByName('Quote_Log')` still returns `null` (Apps Script cache lag), `logQuote` recurses infinitely until the call stack overflows, crashing the parent save operation.

**Fix:** Add a `retried = false` guard parameter and abort if already retried.

---

### M8 — Quote ID collision risk (Quote_Intelligence.gs line 140)
Taking only the last 8 digits of a millisecond timestamp wraps every ~27 seconds. Two quotes saved within the same window get identical IDs, silently duplicating log rows.

**Fix:** Use the full 13-digit timestamp or append a short random suffix.

---

### M9 — Off-by-one in `parse_sightseeing_cell` skips last valid entry (archive_to_input.py line 86)
`for i in range(0, len(parts) - 2, 3)` cuts off valid groups when `len(parts)` is a multiple of 3.

**Fix:**
```python
for i in range(0, len(parts), 3):
    if i + 2 >= len(parts): break
```

---

### M10 — `ws.row_count == 0` is unreliable for empty-sheet detection (write_to_sheets.py line 168)
`gspread`'s `Worksheet.row_count` returns the allocated row count (default 1000), not rows with data. An empty sheet still returns 1000, so the header row is never written on a brand-new empty sheet.

**Fix:** Replace with `not ws.get_all_values()` to detect an empty sheet.

---

## MINOR Issues (6)

### N1 — `getAllSaved` returns all pax names to any authenticated user (Code.gs lines 299–313)
Any logged-in USER (not just ADMIN) can enumerate every client in the system.

**Fix:** Add a role guard — check that the caller is ADMIN before returning the full list.

---

### N2 — Claude-returned array length not validated before `appendRow` (Pipeline.gs lines 240–244)
If Claude returns a row with fewer columns than expected, the row is appended with blank trailing cells, silently corrupting the Annual Avg column so the hotel becomes invisible to `getHotels()`.

**Fix:** Assert `rowArr.length === expectedColumnCount`; mark as ERROR if wrong.

---

### N3 — GST "No GST" mode may still log 5% GST (Quote_Intelligence.gs line 119)
`const gstPct = d.gst || 5` — if frontend saves `{gst: 0}`, `0 || 5` evaluates to `5`, overstating Grand Total in Quote_Log.

**Fix:** `const gstPct = (d.gst != null && d.gst !== '') ? Number(d.gst) : 5;`

---

### N4 — No CSRF protection on API endpoints (HTML + Code.gs)
The Apps Script endpoint accepts POST requests from any origin with no session token or origin check.

**Fix:** Generate a per-session CSRF token on login; include it in every POST body and verify it server-side.

---

### N5 — Transfer dedup key uses empty `to` field (archive_to_input.py lines 220–225)
When `to` is empty, the key `(city, from_loc, "")` incorrectly matches any other transfer from the same origin with no destination, causing legitimate new transfers to be skipped as duplicates.

**Fix:** When `to` is empty, use a sentinel value like `"__UNKNOWN__"`.

---

### N6 — No retry logic for transient Sheets API errors (write_to_sheets.py / archive_to_input.py)
A single transient 500 from Google aborts the entire run with no partial-success summary.

**Fix:** Wrap `append_rows` calls in a retry decorator with exponential back-off (3 attempts: 2 s / 4 s / 8 s).

---

## Action Items — Priority Order

| # | Action | Severity | File |
|---|--------|----------|------|
| 1 | Add `checkLogin` to `doPost` so fresh logins work | CRITICAL | Code.gs |
| 2 | Hash passwords on signup; compare hashes, never plaintext | CRITICAL | Code.gs |
| 3 | Move admin/role check server-side; remove isAdmin from localStorage | CRITICAL | HTML |
| 4 | Move Spreadsheet ID to env var / gitignored config | CRITICAL | write_to_sheets.py, archive_to_input.py |
| 5 | Add login rate-limiting (5 attempts then 15-min block) | MODERATE | Code.gs |
| 6 | Guard _buildInputSheet against duplicate banner row on re-run | MODERATE | Pipeline.gs |
| 7 | Move EUR/INR rate to Script Property | MODERATE | Pipeline.gs |
| 8 | Improve Claude JSON extraction to handle markdown variants | MODERATE | Pipeline.gs |
| 9 | Add pipeline execution checkpoint to survive 6-min timeout | MODERATE | Pipeline.gs |
| 10 | Validate batch/result length alignment after Claude API call | MODERATE | Pipeline.gs |
| 11 | Add retried guard to logQuote to prevent infinite recursion | MODERATE | Quote_Intelligence.gs |
| 12 | Fix Quote ID collision (full timestamp + random suffix) | MODERATE | Quote_Intelligence.gs |
| 13 | Fix parse_sightseeing_cell off-by-one in loop range | MODERATE | archive_to_input.py |
| 14 | Fix sheet_is_empty detection using get_all_values() | MODERATE | write_to_sheets.py |
| 15 | Restrict getAllSaved to ADMIN role only | MINOR | Code.gs |
| 16 | Validate Claude row column count before appendRow | MINOR | Pipeline.gs |
| 17 | Fix GST 0 falsy bug in Quote_Log | MINOR | Quote_Intelligence.gs |
| 18 | Add CSRF token to all POST API calls | MINOR | HTML + Code.gs |
| 19 | Fix transfer dedup key when to is empty | MINOR | archive_to_input.py |
| 20 | Add retry logic for transient Sheets API errors | MINOR | write_to_sheets.py, archive_to_input.py |

---

*Generated: 2026-05-16 | Automated Daily Code Review*
