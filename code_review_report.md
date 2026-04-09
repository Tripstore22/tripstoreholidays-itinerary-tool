# TripStore Holidays — Automated Code Review
**Date:** 2026-04-09
**Reviewed by:** Claude (automated)
**Branch:** v2

---

## Recent Commits Reviewed
```
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main — sync all app files to production
f3b87ad Sync index.html with index_fit.tripstore.html
a105e1d Fix security issues and add budget suggestion hints
```

---

## Summary

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 4     |
| MODERATE  | 14    |
| MINOR     | 9     |
| **TOTAL** | **27**|

---

## Files Reviewed

### 1. Code.gs

**[CRITICAL] Login is broken — frontend sends POST, backend handles GET only**
- `index_fit.tripstore.html` line 583: `fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })`
- `Code.gs doPost()` handles only `signup` and `saveItinerary`. `checkLogin` is handled in `doGet()` via URL params.
- Every login attempt returns `"Invalid action"` from `doPost`, which the frontend interprets as `"❌ Invalid Credentials"`.
- **Action:** Either add `checkLogin` handling to `doPost`, or verify that the deployed Apps Script version differs from this file. If deploying this file, `doPost` must handle `checkLogin` from the POST body.

**[CRITICAL] Passwords stored as plain text in Google Sheets**
- `Code.gs` line 261: `dbPass === pass.trim()` — direct string comparison against Sheet column.
- Google Sheet is accessible to anyone with editor access. A data leak exposes all passwords.
- **Action:** Hash passwords with SHA-256 (or bcrypt via a Node proxy) before storing. At minimum, note this risk explicitly.

**[CRITICAL] `getAllSaved()` and `searchItinerary()` have no authentication**
- `Code.gs` lines 299–334: These functions return all saved pax names and full itinerary payloads to any caller.
- Anyone who discovers the API URL (it is hardcoded in the public HTML) can enumerate all client names and load their itineraries.
- **Action:** Add a shared API key or session token check before serving any data-read endpoints.

**[MODERATE] No rate limiting on login — brute force possible**
- `checkLogin()` accepts unlimited attempts with no lockout or delay.
- **Action:** Track failed attempts per username in the sheet. After 5 failures, set a cooldown column and reject for 15 mins.

**[MODERATE] `saveItinerary()` has no ownership check**
- Any authenticated user can overwrite any other user's itinerary by supplying a matching `paxName`.
- **Action:** Associate saved records with the logged-in username and validate on save.

**[MINOR] `getHotels()` hardcodes column index `r[18]` for Annual Avg**
- Brittle — if the Hotels sheet gains or loses a column, silently reads wrong data.
- **Action:** Read by header name, not positional index.

---

### 2. Pipeline.gs

**[MODERATE] Hardcoded EUR→INR exchange rate is stale**
- `enrichTrains` prompt (line 463): `"INR price at ₹110/€"` — current rate is ~₹92/€.
- Claude will back-calculate INR from EUR at the wrong rate, overstating train costs by ~20%.
- **Action:** Update to `₹92/€` or, better, pass it as a config constant `CFG.EUR_TO_INR` so it's easy to update.

**[MODERATE] `mst.appendRow(rowArr)` — no column-count validation**
- `Pipeline.gs` line 243: Claude occasionally returns fewer fields than expected (noted in the comment at line 241). If `rowArr` has fewer elements than the master sheet has columns, the row is inserted with blank trailing cells — silently misaligning all subsequent column reads.
- **Action:** Pad `rowArr` to the expected column count before appending, or log a warning and skip if length is wrong.

**[MODERATE] `buildMasterKeySet()` loads full master sheet on every pipeline run**
- For large datasets (hundreds of hotels), this is slow and may hit Apps Script memory limits.
- **Action:** Consider caching the key set in `CacheService` with a short TTL (e.g., 1 hour).

**[MINOR] `sendSummaryEmail` uses `GmailApp.sendEmail()` — limited to 500/day**
- If the pipeline runs and errors on many rows, repeated alert emails could exhaust the quota.
- **Action:** Use `MailApp.sendEmail()` (100/day personal, but quota-tracked differently) or batch digest.

**[MINOR] `Utilities.sleep(1500)` is hardcoded**
- Rate-limit buffer between Claude API calls. If Claude's rate limits change, this needs manual adjustment.
- **Action:** Make `CFG.API_SLEEP_MS = 1500` so it's visible and easy to change.

---

### 3. Quote_Intelligence.gs

**[MODERATE] GST calculation always uses 5% — ignores the actual GST mode selected by agent**
- `buildQuoteLogRow()` line 119: `const gstPct = d.gst || 5`
- The frontend now stores `gstMode` as a string (`'5pkg'`, `'18svc'`, `'none'`), not a numeric `d.gst` field.
- Result: every row in Quote_Log records `gstAmt` calculated at 5%, regardless of what the agent actually selected (18% service charge or no GST).
- **Action:**
  ```javascript
  // Replace line 119:
  const gstPct = d.gstMode === '18svc' ? 18 : d.gstMode === '5pkg' ? 5 : (Number(d.gst) || 0);
  ```

**[MODERATE] `logQuote()` has infinite recursion risk**
- `logQuote()` calls `setupQuoteLog()` and then recursively calls `logQuote()` if the sheet is missing.
- If `setupQuoteLog()` fails (e.g., quota exceeded), the recursive call will fail again → infinite loop until stack overflow.
- **Action:** Add a `retried` flag parameter or use a `return` after `setupQuoteLog()` without recursion.

**[MINOR] Quote ID collision possible**
- `'Q-' + new Date().getTime().toString().slice(-8)` — two saves within the same millisecond produce the same ID.
- **Action:** Append a random 4-digit suffix: `'Q-' + Date.now().toString().slice(-8) + '-' + Math.floor(Math.random()*9000+1000)`.

---

### 4. index_fit.tripstore.html

**[CRITICAL] Admin access can be granted via DevTools — no server-side session validation**
- `checkAutoLogin()` line 641–651: reads `isAdmin` directly from `localStorage`.
- Any user can open DevTools console and run:
  ```javascript
  localStorage.setItem("tripstore_session", JSON.stringify({isAdmin:true, modeText:"ADMIN MODE"}));
  location.reload();
  ```
  This grants admin panel access without any credentials.
- The `getAllSaved()` backend endpoint has no auth check (see Code.gs finding above), so this escalation is fully functional.
- **Action:** Admin-gated actions must be re-validated server-side. The backend must require an admin token or re-verify the username before serving `getAllSaved`.

**[MODERATE] `saveItinerary()` shows success toast even on server-side error**
- Line 719–723: `fetch()` only throws on network errors, not HTTP 4xx/5xx. If the backend returns an error response, `"Saved Successfully"` is still shown.
- **Action:**
  ```javascript
  const result = await (await fetch(API_URL, { method: "POST", ... })).text();
  if (!result.includes("Successfully")) throw new Error(result);
  showToast("Saved Successfully");
  ```

**[MODERATE] No CSRF protection on POST endpoints**
- `signup` and `saveItinerary` accept POST with no origin check.
- Any page on the internet can submit requests to the Apps Script URL.
- **Action:** Add a CSRF token in the payload (generated at page load, stored in sessionStorage, verified server-side).

**[MINOR] Budget hint ranges are hardcoded with no version date**
- `BUDGET_RANGES = { hotel: { low: 2500, high: 7500 }, land: { low: 1200, high: 2800 } }` (lines 783–785)
- These figures will silently become stale as hotel costs change.
- **Action:** Add a comment with the date last reviewed, e.g., `// Last reviewed: April 2026`.

**[MINOR] No input length limits on paxName**
- A very long pax name could exceed Google Sheets cell character limits (50,000 chars) or break the itinerary JSON blob.
- **Action:** Add `maxlength="100"` to `#paxNameInput`.

---

### 5. write_to_sheets.py

**[MODERATE] Spreadsheet ID hardcoded in source**
- Line 28: `SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"`
- Committing production sheet IDs to a public repo exposes the asset.
- **Action:** Move to environment variable: `SPREADSHEET_ID = os.environ["TRIPSTORE_SHEET_ID"]`

**[MODERATE] Empty-sheet detection is unreliable**
- Line 168: `ws.row_count == 0` — gspread's `row_count` reflects the grid size (default 1000 rows), not the number of rows with data. This condition is never True for a new sheet, so the header may never be written.
- **Action:** Replace with: `sheet_is_empty = not ws.get_all_values()`

**[MINOR] No retry on transient API failures**
- `gspread` calls can fail with `APIError` (429 rate limit, 503). A single failure aborts the run.
- **Action:** Wrap `ws.append_rows()` in a retry loop with exponential backoff.

---

### 6. archive_to_input.py

**[MODERATE] Spreadsheet ID hardcoded in source**
- Line 32: same issue as `write_to_sheets.py`. Both files use the same ID — make it a shared env var.

**[MODERATE] `parse_hotels_cell()` silently drops malformed entries**
- The function iterates in steps of 4 (`range(0, len(parts) - 3, 4)`). If a hotel entry has a misplaced pipe character, the stride is off and subsequent entries are silently read from the wrong offsets — wrong city paired with wrong hotel name.
- **Action:** Add a warning log when `len(parts) % 4 != 0`.

**[MINOR] Transfer city extraction is brittle**
- Lines 155–161: city is extracted by splitting on a hardcoded keyword list. New European city names not in the list will extract incorrectly.
- **Action:** Add a fallback that uses the full `from_loc` string as the city if no keyword matches.

---

## Files Requested But Not Found in Repo

The following files were in the review scope but do not exist in the repository:

| File | Status |
|------|--------|
| extract_itineraries.py | Not found |
| write_inputs_to_sheets.py | Not found |
| cleanup_sheet.py | Not found |
| clean_pipeline_data.py | Not found |
| cross_reference.py | Not found |
| enrich_hotels.py | Not found |
| enrich_hotels_booking.py | Not found |

These may have been deleted, renamed, or never committed. If they exist locally, they should be committed or their absence confirmed intentional.

---

## Prioritised Action Items

### Fix Immediately (CRITICAL)
1. **Login mismatch** — `doPost` in Code.gs must handle `checkLogin`. Add it now or login will be broken.
2. **Admin escalation via localStorage** — Backend must re-verify admin status server-side on every admin request.
3. **Unauthenticated API endpoints** — `getAllSaved` and `searchItinerary` must require auth.
4. **Plain-text passwords** — Plan a migration to hashed storage.

### Fix This Week (MODERATE)
5. **GST calculation bug** in Quote_Intelligence.gs — one-line fix, affects all quote log data.
6. **EUR/INR rate** in Pipeline.gs — update from ₹110 to ₹92.
7. **`saveItinerary` false success toast** — check response before showing "Saved".
8. **`sheet_is_empty` bug** in write_to_sheets.py — header row never written for new sheets.
9. **Spreadsheet IDs** — Move to environment variables in both Python scripts.
10. **`saveItinerary` ownership** — Users should only overwrite their own records.

### Fix When Convenient (MINOR)
11. Add `maxlength` to paxName input.
12. Add date comment to `BUDGET_RANGES`.
13. Add retry loop to gspread calls.
14. Fix Quote ID collision risk.
15. Add `logQuote` recursion guard.

---

*Generated automatically by Claude on 2026-04-09*
