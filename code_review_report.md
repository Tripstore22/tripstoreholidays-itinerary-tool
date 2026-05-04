# TripStore Code Review Report
**Date:** 2026-05-04  
**Reviewed by:** Claude (Automated Daily Review)  
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Files requested but NOT in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| MODERATE | 8 |
| MINOR    | 9 |
| **Total**| **19** |

---

## CRITICAL Issues

---

### [CRITICAL-1] Login is completely broken — POST/GET mismatch  
**File:** Code.gs (lines 25–28) + index_fit.tripstore.html (line 583)

**What's wrong:**  
The frontend sends login credentials as a **POST** request with a JSON body:
```javascript
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But in Code.gs, `checkLogin` is only handled inside `doGet()`, using **query parameters** (`e.parameter.user`, `e.parameter.pass`). The `doPost()` function has no handler for `"checkLogin"` and falls through to:
```javascript
return ContentService.createTextOutput('Invalid action');
```

**Effect:** Any user whose session is NOT cached in localStorage will always get "❌ Invalid Credentials" when attempting to log in. New logins and logouts followed by re-login are silently broken. Only users with a valid `tripstore_session` cookie still in their browser can access the tool.

**Fix:** Add a `checkLogin` handler to `doPost()` in Code.gs:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.username || data.user || '', data.password || data.pass || '');
}
```
And update the `checkLogin()` function to accept arguments (it already does), rather than reading from `e.parameter`.

---

### [CRITICAL-2] Passwords stored and compared in plain text  
**File:** Code.gs (lines 249–268, 276–291)

**What's wrong:**  
`handleSignup()` saves raw passwords directly to Google Sheets:
```javascript
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...]);
```
`checkLogin()` compares the plain-text password directly:
```javascript
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) {
```

**Effect:** Any person who gains access to the Google Sheet (e.g., a Sheets collaborator, a leaked service account credential, or a Google account compromise) instantly has every user's password in clear text. Since users may reuse passwords, this creates a broader security risk beyond just this tool.

**Fix (short-term):** Use a deterministic hash (SHA-256 + a static salt stored in Script Properties) before saving and comparing passwords. Apps Script has `Utilities.computeDigest()` available.  
**Fix (proper):** Use Google's OAuth-based login so no passwords are stored at all.

---

## MODERATE Issues

---

### [MODERATE-1] Client-side admin privilege bypass via localStorage  
**File:** index_fit.tripstore.html (lines 585–589, 641–652)

**What's wrong:**  
On successful login, the session is stored in localStorage:
```javascript
localStorage.setItem("tripstore_session", JSON.stringify({ isLoggedIn: true, isAdmin: status === "ADMIN", ... }));
```
On page reload, `checkAutoLogin()` reads this value and restores the session — including the `isAdmin` flag — **without re-verifying with the server**. Any user can open DevTools → Application → localStorage, change `isAdmin` to `true`, reload, and get full Admin UI access (ability to load any saved itinerary by name).

**Fix:** Do not store the role in localStorage. On reload, re-validate the session against the server, or at minimum do not show admin UI based solely on a localStorage flag.

---

### [MODERATE-2] XSS via innerHTML with unescaped data  
**File:** index_fit.tripstore.html (lines 1285–1386, 1396–1476)

**What's wrong:**  
`renderTables()` builds large HTML strings using template literals and inserts them via `innerHTML`. Data from `masterData` (fetched from Google Sheets) is inserted directly without HTML-escaping:
```javascript
hHtml += `...<td class="...">${item.city}</td>...`;
hHtml += `...<textarea ...>${item.hotel?.name || ''}</textarea>...`;
```
If a city name or hotel name in the Google Sheet contains `</textarea><script>alert(1)</script>`, it would execute in the browser.

**Risk level:** Requires access to modify the Google Sheet to trigger, but this is a realistic vector (a rogue data entry, a compromised sheet-writer script, or a malicious pipeline enrichment result from Claude). All content inserted into innerHTML should be HTML-escaped.

**Fix:** Add an escape helper and apply it to all dynamic values:
```javascript
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
```

---

### [MODERATE-3] Claude API response not validated before array access  
**File:** Pipeline.gs (lines 585–597)

**What's wrong:**  
```javascript
const responseData = JSON.parse(response.getContentText());
const text = responseData.content[0].text;
```
If the Anthropic API returns an error response (rate limit, token quota, malformed request), the response body may not contain `content[0]`. This throws a `TypeError`, which is caught and treated as a generic error, hiding the real cause (rate limit vs. bad key vs. model unavailable).

**Fix:**
```javascript
if (!responseData.content || !responseData.content[0]) {
  throw new Error(`Unexpected API response: ${JSON.stringify(responseData).slice(0, 200)}`);
}
```

---

### [MODERATE-4] setupSheets() inserts duplicate banner row on repeated runs  
**File:** Pipeline.gs (lines 760–798)

**What's wrong:**  
`_buildInputSheet()` always calls `ws.insertRowBefore(2)` to add an info banner. If `setupSheets()` is run again (e.g., to add a new sheet or after a reset), it inserts a new banner before the existing one, pushing all data rows down. The `getPendingRows()` function expects data to start at row 3 — after a double-setup, data starts at row 4+, causing the entire sheet to be silently skipped.

**Fix:** Check if the banner already exists before inserting:
```javascript
const existingBanner = ws.getRange(2, 1).getValue();
if (!String(existingBanner).includes('ℹ️')) {
  ws.insertRowBefore(2);
  // ... set banner
}
```

---

### [MODERATE-5] No rate limiting or brute-force protection on login  
**File:** Code.gs (lines 249–268) + index_fit.tripstore.html (lines 574–598)

**What's wrong:**  
The Apps Script `/exec` URL is publicly accessible. There is no IP blocking, no CAPTCHA, no lockout after N failed attempts, and no delay. An attacker can brute-force credentials with thousands of requests per minute.

**Fix (short-term):** Add a `PropertiesService` counter per username — if 5 failures within 10 minutes, return a `LOCKED` status. Flush the counter on success.

---

### [MODERATE-6] archive_to_input.py omits Direction and Airport Code — all transfers fail enrichment  
**File:** archive_to_input.py (lines 275–289)

**What's wrong:**  
`make_transfer_row()` creates a 21-column row but leaves `row[6]` (Direction: ARRIVAL/DEPARTURE) and `row[2]` (Airport Code / IATA) blank. The Claude enrichment prompt in Pipeline.gs validates: *"airport is not a recognisable IATA code"* — with a blank airport code, all archive-imported transfers will be marked ERROR and never enter the master sheet.

**Fix:** Add heuristic direction detection in `parse_transfers_cell()` — if "airport" or known IATA codes appear in `from_loc`, mark as ARRIVAL; if in `to_loc`, mark as DEPARTURE. Extract the airport code from the description. Set `row[2]` and `row[6]` accordingly.

---

### [MODERATE-7] BUDGET_RANGES suggestion values are unrealistically low for European travel  
**File:** index_fit.tripstore.html (lines 782–785)

**What's wrong:**  
```javascript
const BUDGET_RANGES = {
    hotel: { low: 2500, high: 7500 },  // ₹/room/night
    land:  { low: 1200, high: 2800 }   // ₹/pax/night
};
```
₹2,500–7,500/room/night ≈ €23–€68/night. A mid-range hotel in Paris/Amsterdam costs €150–300/night (₹16,500–33,000). These suggestions will massively underquote European luxury packages — the "Suggested: ₹X – ₹Y" hint will mislead agents into setting budgets 4–5× too low.

**Fix:** Update to realistic European HNI ranges:
```javascript
hotel: { low: 15000, high: 45000 },   // ₹/room/night (3★ to 5★)
land:  { low: 3500,  high: 8000  }    // ₹/pax/night
```

---

### [MODERATE-8] No error handling on Google Sheets write in archive_to_input.py  
**File:** archive_to_input.py (lines 386–393)

**What's wrong:**  
```python
ss.worksheet(sheet_name).append_rows(rows, value_input_option="USER_ENTERED")
```
If this fails (network timeout, quota exceeded, permission denied), the exception is unhandled — the script either crashes mid-loop or silently skips. In either case, data may be lost with no indication to the user.

**Fix:**
```python
try:
    ss.worksheet(sheet_name).append_rows(rows, value_input_option="USER_ENTERED")
    print(f"  {sheet_name}: {len(rows)} rows added")
except Exception as e:
    print(f"  ERROR writing to {sheet_name}: {e}")
    sys.exit(1)
```

---

## MINOR Issues

---

### [MINOR-1] Hardcoded Claude model ID may become stale  
**File:** Pipeline.gs (line 39)  
`MODEL: 'claude-haiku-4-5-20251001'` — as of May 2026, Claude Haiku 4.5 is one generation behind. The pipeline will still function but newer models offer better accuracy. Consider making this a Script Property so it can be updated without code edits.

---

### [MINOR-2] Quote ID collision risk for saves within same millisecond window  
**File:** Quote_Intelligence.gs (line 140)  
`'Q-' + new Date().getTime().toString().slice(-8)` — takes only the last 8 digits of a millisecond timestamp, which wraps every ~11.6 days. Two quotes created 11.6 days apart could get the same ID, causing silent overwrite in analytics.  
**Fix:** Use full timestamp or append a short random suffix: `+ '-' + Math.random().toString(36).slice(2,5)`.

---

### [MINOR-3] backfillQuoteLog() creates duplicate entries if run twice  
**File:** Quote_Intelligence.gs (lines 278–309)  
There is no check for whether a pax name has already been imported before appending. Running the function a second time duplicates every entry in Quote_Log.  
**Fix:** Build a Set of existing Quote_Log quote IDs or pax names first and skip duplicates.

---

### [MINOR-4] Column comment mismatch in getTransfers()  
**File:** Code.gs (line 203)  
```javascript
notes: String(r[13] || '').trim(), // Column N: Schedule
```
Column N (index 13, 0-based) is labeled "Schedule" in the sheet schema, but the field is named `notes`. It surfaces as `details` in the frontend. Not a bug but creates maintenance confusion.

---

### [MINOR-5] New sheet row cap too low in write_to_sheets.py  
**File:** write_to_sheets.py (line 57)  
```python
ws = spreadsheet.add_worksheet(title=SHEET_NAME, rows=1000, cols=20)
```
The archive already has 800+ rows and will grow. If appends exceed 1000 rows, Google Sheets silently stops writing. Use `rows=5000`.

---

### [MINOR-6] Intercity price edit double-multiplies pax count  
**File:** index_fit.tripstore.html (~line 1464)  
The intercity price input field shows the total (`ic.price * totalPax`), but `editIntercity()` stores whatever the agent types directly as `ic.price` without dividing by `totalPax`. When `calculateBudgetInvestment()` then does `ic.price * totalPax` again, the total is multiplied by pax count twice.  
**Fix:** In `editIntercity()` for the price field, divide by totalPax before storing: `selectedIntercity[idx].price = Number(value) / getPaxCount()`.

---

### [MINOR-7] Vehicle type dropdown fires optimizer before plan exists  
**File:** index_fit.tripstore.html (line 187)  
`onchange="runOptimizer(false, false)"` fires on every vehicle type change. If the agent loaded a plan from cloud and then changes vehicle type, `runOptimizer` runs with the current `selectedRoute` — which may clear and rebuild the plan unexpectedly.  The button label says "Generate Quote" but vehicle type should be a re-price, not a full replan.

---

### [MINOR-8] Claude API rate-limit sleep between batches too short  
**File:** Pipeline.gs (line 252)  
`Utilities.sleep(1500)` — 1.5 seconds between batches of 5 API calls. With high INPUT queue volumes, this can hit Claude's rate limit. Increase to `Utilities.sleep(3000)` for safety.

---

### [MINOR-9] logQuote() recursive retry has no depth guard  
**File:** Quote_Intelligence.gs (lines 29–47)  
```javascript
if (!logSheet) {
    setupQuoteLog();
    return logQuote(paxName, data); // retry
}
```
If `setupQuoteLog()` fails silently (sheet quota exceeded), this recurses until a stack overflow, breaking the save operation that called it.  
**Fix:** Add a `retried = false` parameter and guard: `if (retried) return; return logQuote(paxName, data, true);`

---

## Missing Files Note

The following files were requested for review but **do not exist** in the repository:
`extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`

These may exist in the `tripstore-itinerary-archive` local folder on Sumit's Mac (referenced in SESSIONS.md) but have not been pushed to GitHub.

---

## Action Items (Priority Order)

| # | Priority | Issue | Action |
|---|----------|-------|--------|
| 1 | IMMEDIATE | CRITICAL-1: Login broken (POST/GET mismatch) | Add `checkLogin` to `doPost()` in Code.gs, redeploy |
| 2 | IMMEDIATE | CRITICAL-2: Plain-text passwords | Hash passwords using `Utilities.computeDigest()` before storing |
| 3 | HIGH | MODERATE-7: Budget hints 5× too low | Update `BUDGET_RANGES` to European luxury levels |
| 4 | HIGH | MODERATE-3: Claude API crash on error response | Add `content[0]` existence check before accessing |
| 5 | HIGH | MODERATE-4: Duplicate banner row breaks pipeline | Add banner-existence check to `_buildInputSheet()` |
| 6 | HIGH | MODERATE-6: Archive transfers fail enrichment | Add direction + airport heuristics to `parse_transfers_cell()` |
| 7 | MEDIUM | MODERATE-1: Admin bypass via localStorage | Re-validate session on reload; don't trust localStorage role |
| 8 | MEDIUM | MODERATE-2: XSS in innerHTML | HTML-escape all dynamic sheet data before inserting |
| 9 | MEDIUM | MODERATE-8: Silent data loss on sheet write failure | Wrap `append_rows()` in try/except with sys.exit |
| 10 | LOW | MINOR-6: Intercity price double-multiplied | Divide by paxCount when storing edited intercity price |
| 11 | LOW | MINOR-3: backfill creates duplicates | Add deduplication check before appending to Quote_Log |
| 12 | LOW | MINOR-1/8/9 | Model ID, sleep duration, recursion guard — quick fixes |

---

*Generated automatically by Claude Code — TripStore Daily Review — 2026-05-04*
