# TripStore Code Review Report
**Date:** 2026-05-29
**Reviewer:** Automated Daily Review
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py
**Files NOT Found in Repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3     |
| MODERATE | 14    |
| MINOR    | 8     |
| **Total**| **25**|

---

## CRITICAL Issues

### C1 — Code.gs: Plaintext passwords stored in Google Sheets
**File:** Code.gs, lines 261 & 289
**Risk:** Anyone with read access to the "Users" sheet (collaborators, accidental sharing, Google admin) can see all user passwords in plain text.
**Fix:** Hash passwords using a salt+hash before storing. Since Apps Script has no bcrypt, a minimum fix is `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + username)` stored as a hex string, with the same transformation applied at login time.

---

### C2 — Code.gs + index_fit.tripstore.html: Login sent as POST but checkLogin is only in doGet
**File:** Code.gs lines 18–41 (doGet handles checkLogin); index_fit.tripstore.html line 583 (sends POST)
**Risk:** The frontend sends `action: "checkLogin"` as a POST request body. `doPost()` in Code.gs does NOT handle `checkLogin` — it falls through to `return ContentService.createTextOutput('Invalid action')`. The frontend then shows "Invalid Credentials" for every login attempt. If the live site is currently working, the deployed Apps Script version must differ from the Code.gs file in this repo. Either way, the repo copy is broken and dangerous to redeploy without this fix.
**Fix:** Add the following block inside `doPost()` in Code.gs, before the final `return 'Invalid action'`:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### C3 — index_fit.tripstore.html: Stored XSS via direct innerHTML injection
**File:** index_fit.tripstore.html, lines 1286–1475 (renderTables), lines 1714–1726 (filterIntercityModal)
**Risk:** Hotel names, sightseeing tour names, transfer from/to values, and city names are injected directly into template-literal HTML strings using `hHtml +=` without any escaping. A malicious entry in the Google Sheet (e.g., a hotel name containing `</textarea><img onerror=alert(1) src=x>`) would execute JavaScript in every agent's browser the moment they load the page. This is a stored XSS vulnerability.
Additionally, in `filterIntercityModal` (line 1715), `JSON.stringify(item).replace(/"/g, '&quot;')` escapes double quotes but NOT single quotes — a city or route name containing `'` breaks the onclick handler and can be exploited.
**Fix:** Add a global HTML escape helper and apply it to all data-sourced values before injecting into innerHTML:
```javascript
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
```
Apply `esc()` to every sheet-sourced value in renderTables, filterIntercityModal, applyTransferFilters, refreshTransferList, etc.

---

## MODERATE Issues

### M1 — Code.gs: No authentication on saveItinerary endpoint
**File:** Code.gs, lines 342–365
**Risk:** Any POST to the Apps Script URL with `{action: "saveItinerary", paxName: "Someone", payload: {}}` silently overwrites a real client itinerary with blank data. No login token or session validation is performed. A competitor or malicious actor knowing the script URL can destroy all saved quotes.
**Fix:** Add a `user` + `sessionToken` field to the POST body and validate against the Users sheet before allowing any write operation.

---

### M2 — Code.gs: No authentication on getAllSaved and searchItinerary
**File:** Code.gs, lines 299–314 (getAllSaved), lines 321–335 (searchItinerary)
**Risk:** Any GET request to `?action=getAllSaved` returns all client pax names. `?action=search&name=X` returns the full itinerary JSON for any pax name — including cities, hotels, pricing, and pax counts. All client data is publicly accessible to anyone with the script URL.
**Fix:** Require a session token or admin credential parameter for these actions.

---

### M3 — Code.gs: Server error messages expose implementation details
**File:** Code.gs, lines 39 & 56
**Risk:** `'Server Error: ' + err.message` leaks internal function names, sheet names, and stack traces to any client making a request.
**Fix:** Log with `Logger.log(err)` and return only a generic `'Server Error'` string to the client.

---

### M4 — Pipeline.gs: setupSheets inserts banner row every run, corrupting sheets
**File:** Pipeline.gs, lines 777–787 (`_buildInputSheet`)
**Risk:** `ws.insertRowBefore(2)` is called unconditionally every time `setupSheets()` runs. Running setup on an existing sheet inserts a new blank row 2 every call, pushing all data rows down and breaking the pipeline's row indexing (data is expected at row 3+).
**Fix:** Check if the banner row already exists before inserting:
```javascript
if (!ws.getRange(2,1).getValue().toString().includes('ℹ️')) {
  ws.insertRowBefore(2);
}
```

---

### M5 — Pipeline.gs: No timeout handling for Claude API calls
**File:** Pipeline.gs, lines 564–598
**Risk:** Apps Script has a 6-minute execution limit. If Claude API is slow, the pipeline times out mid-run and rows remain stuck in PENDING state indefinitely — they are not flagged ERROR and will not be retried the next night.
**Fix:** Before each batch call, check elapsed time: if `(new Date() - start) > 300000` (5 minutes), stop processing and log a warning. Also add `deadline: 25` to the UrlFetchApp options to enforce a per-call timeout.

---

### M6 — Quote_Intelligence.gs: Recursive logQuote without depth limit
**File:** Quote_Intelligence.gs, lines 33–47
**Risk:** `logQuote` calls `setupQuoteLog()` if the sheet is missing, then calls `logQuote()` recursively. If `setupQuoteLog()` fails silently (quota exceeded, permissions error), this recurses indefinitely until a stack overflow, potentially crashing the entire `saveItinerary` operation.
**Fix:** Add a `_retried` flag:
```javascript
function logQuote(paxName, data, _retried = false) {
  ...
  if (!logSheet) {
    if (_retried) { Logger.log('Quote_Log setup failed — skipping log'); return; }
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
```

---

### M7 — Quote_Intelligence.gs: GST calculation uses stale field name — all Quote_Log financials wrong
**File:** Quote_Intelligence.gs, line 119
**Risk:** `const gstPct = d.gst || 5` reads a numeric `d.gst` field. But the frontend now saves `gstMode` (a string: '5pkg', '18svc', or 'none'), not a numeric `gst` field. So `d.gst` is always `undefined`, defaulting to 5. This means every quote in Quote_Log shows a 5% GST amount regardless of whether the agent selected No GST or 18% Service Charge. Quote_Log financials are systematically inaccurate for a significant portion of quotes.
**Fix:** Replace line 119 with:
```javascript
const gstMode = d.gstMode || (d.gst == 18 ? '18svc' : d.gst > 0 ? '5pkg' : 'none');
let gstAmt = 0;
if (gstMode === '5pkg')  gstAmt = Math.round((subTotal + markupAmt) * 0.05);
if (gstMode === '18svc') gstAmt = Math.round(markupAmt * 0.18);
```

---

### M8 — Quote_Intelligence.gs: backfillQuoteLog creates duplicates on re-run
**File:** Quote_Intelligence.gs, lines 278–309
**Risk:** Running `backfillQuoteLog()` a second time (to fix data or re-import after schema changes) appends all historical quotes again, creating hundreds of duplicate rows in Quote_Log. There is no check for already-imported entries.
**Fix:** Before appending, build a Set of existing Quote IDs or pax names from the Quote_Log sheet and skip rows already present.

---

### M9 — index_fit.tripstore.html: localStorage session never expires
**File:** index_fit.tripstore.html, line 649
**Risk:** `localStorage.setItem("tripstore_session", ...)` stores the session indefinitely — no TTL. If an agent logs in on a shared or public computer and doesn't click Logout, any person using the same browser later is automatically logged in as that agent, with full access to save/load itineraries.
**Fix:** Store a `loginTimestamp` in the session and check it in `checkAutoLogin`:
```javascript
if (Date.now() - s.loginTimestamp > 8 * 60 * 60 * 1000) {
  localStorage.removeItem("tripstore_session"); return;
}
```

---

### M10 — index_fit.tripstore.html: Stale pricingFactor baked into hotel cost override
**File:** index_fit.tripstore.html, line 1307
**Risk:** `currentPlan[idx].hotel.cost = Number(this.value) / (${nights} * ${config.pricingFactor})` — `config.pricingFactor` is a literal number baked in at render time. If the user changes adult/child count or room override after the table renders but before editing a hotel price cell, the formula uses the old factor and stores a silently wrong per-night cost, corrupting the quote total.
**Fix:** Replace the embedded literal with a live call:
```javascript
onchange="currentPlan[${planIdx}].hotel.cost = Number(this.value)/(${item.nights||1}*getTravelConfigs().pricingFactor); calculateBudgetInvestment();"
```

---

### M11 — write_to_sheets.py: No retry logic on Google Sheets API calls
**File:** write_to_sheets.py, lines 165–197
**Risk:** `ws.get_all_values()`, `ws.append_row()`, `ws.append_rows()` have no retry on failure. Google Sheets API rate-limits at 300 reads/minute and 60 writes/minute per project. A single 429 response aborts the entire script with no partial recovery.
**Fix:** Wrap API calls with exponential backoff retry:
```python
import time
def with_retry(fn, retries=3):
    for i in range(retries):
        try: return fn()
        except Exception as e:
            if i == retries - 1: raise
            time.sleep(2 ** i)
```

---

### M12 — write_to_sheets.py: get_all_values() called twice
**File:** write_to_sheets.py, lines 168 and 120
**Risk:** The sheet data is fetched once inside `sheet_is_empty` check (line 168) and again inside `build_existing_keys()` (line 120). Each call is a full Google Sheets API round-trip. For a large archive, this doubles latency and wastes API quota.
**Fix:** Fetch once, pass the result to both checks.

---

### M13 — write_to_sheets.py: Hardcoded Spreadsheet ID
**File:** write_to_sheets.py, line 27
**Risk:** `SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is hardcoded. If the spreadsheet changes or is moved, the script must be edited and recommitted. The ID is also visible in full version history.
**Fix:** Read from environment: `SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID", "1U3f6Ph...")`

---

### M14 — Pipeline.gs: Object.values() used for row normalisation — order not guaranteed
**File:** Pipeline.gs, line 243
**Risk:** `Object.values(r)` does not guarantee key insertion order when Claude returns an object instead of an array. If Claude returns `{city:"Paris", name:"Hotel Lutetia", ...}` with keys in unexpected order, columns are written to the master sheet in the wrong positions silently (e.g., hotel name goes into City column).
**Fix:** Define an explicit field-order array for each type and map from the object:
```javascript
const HOTEL_FIELDS = ['city','name','starRating','category','chain','roomType','jan','feb',...,'annualAvg'];
const rowArr = Array.isArray(r) ? r : HOTEL_FIELDS.map(k => r[k] ?? '');
```

---

## MINOR Issues

### N1 — Pipeline.gs: Hardcoded Claude model name
**File:** Pipeline.gs, line 39
`MODEL: 'claude-haiku-4-5-20251001'` — If this model is deprecated by Anthropic, the pipeline fails for every batch silently (rows marked ERROR). Store the model name in Script Properties so it can be updated without a code redeploy.

---

### N2 — Pipeline.gs: Rate-limit sleep too tight between batches
**File:** Pipeline.gs, line 252
`Utilities.sleep(1500)` is only 1.5 seconds between Claude batches. With 4 sheet types potentially running back-to-back, rate limit errors are possible under load. Increase to at least 3000ms, or implement exponential backoff on 429 responses.

---

### N3 — Quote_Intelligence.gs: Quote ID collision risk
**File:** Quote_Intelligence.gs, line 140
`'Q-' + new Date().getTime().toString().slice(-8)` — two saves within the same millisecond (e.g., double-click or batch backfill) produce the same Quote ID with no collision detection. Append `Math.random().toString(36).slice(2,6)` for additional uniqueness.

---

### N4 — Quote_Intelligence.gs: Deprecated substr usage
**File:** Quote_Intelligence.gs, line 315
`t.substr(1)` is deprecated. Replace with `t.substring(1)`.

---

### N5 — index_fit.tripstore.html: autoSaveThenDo silently ignores save failures
**File:** index_fit.tripstore.html, lines 2290–2292
`catch(e) { /* silent — don't block the export */ }` — if the cloud save before PDF/Excel export fails (network error, session expired), the agent is not informed. They receive the export thinking data is backed up, but it isn't. Add a non-blocking toast notification in the catch block.

---

### N6 — index_fit.tripstore.html: Google Fonts loaded from external CDN
**File:** index_fit.tripstore.html, line 12
Loading Inter from `fonts.googleapis.com` gives Google visibility into every page load. For a tool handling client travel data, consider self-hosting the font or using a system font stack.

---

### N7 — Code.gs: Notes vs Schedule column comment mismatch
**File:** Code.gs, line 203
`notes: String(r[13] || '').trim(), // Column N: Schedule` — the comment says "Schedule" but the field is named `notes`. Column index 13 (N) is "Schedule" in the Transfers sheet schema, not Notes (which is column O, index 14). Low-impact but causes confusion during schema changes.

---

### N8 — write_to_sheets.py: Hardcoded relative credentials path
**File:** write_to_sheets.py, line 29
`CREDENTIALS_PATH = Path("./sheets-credentials.json")` fails if the script is run from any directory other than the project root. Use `Path(__file__).parent / "sheets-credentials.json"` to make it script-relative.

---

## Files Not in Repository

The following 7 Python scripts were requested for review but are **not present** in this repository and could not be reviewed:

| File | Status |
|------|--------|
| extract_itineraries.py | NOT IN REPO |
| write_inputs_to_sheets.py | NOT IN REPO |
| cleanup_sheet.py | NOT IN REPO |
| clean_pipeline_data.py | NOT IN REPO |
| cross_reference.py | NOT IN REPO |
| enrich_hotels.py | NOT IN REPO |
| enrich_hotels_booking.py | NOT IN REPO |

These files likely exist only on the local machine at `/Users/Sumit/Desktop/Itinerary-Create/`. They should be committed to this repository so they can be reviewed, version-controlled, and are not permanently lost if the machine is replaced.

---

## Priority Action Items

| # | Priority | Issue | File | Action |
|---|----------|-------|------|--------|
| 1 | IMMEDIATE | C2 — checkLogin mismatch | Code.gs + Apps Script | Add checkLogin to doPost, redeploy Apps Script |
| 2 | IMMEDIATE | C1 — Plaintext passwords | Code.gs | Hash passwords with SHA-256 before storing |
| 3 | THIS WEEK | C3 — Stored XSS | index_fit.tripstore.html | Add esc() helper, apply to all renderTables injections |
| 4 | THIS WEEK | M7 — Wrong GST in Quote_Log | Quote_Intelligence.gs | Fix gstMode field name resolution |
| 5 | THIS WEEK | M1/M2 — No auth on write/read | Code.gs | Add session token validation |
| 6 | NEXT SPRINT | M4 — Banner row duplication | Pipeline.gs | Guard insertRowBefore with existence check |
| 7 | NEXT SPRINT | M6 — Recursive logQuote | Quote_Intelligence.gs | Add _retried flag |
| 8 | NEXT SPRINT | M9 — Session never expires | index_fit.tripstore.html | Add 8-hour TTL check |
| 9 | BACKLOG | All 7 missing Python files | Desktop only | Commit to repo |
