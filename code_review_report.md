# TripStore Code Review Report
**Date:** 2026-06-06
**Reviewed by:** Automated Daily Review
**Scope:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py

---

## Recent Commits (last 10)
```
a5e4a7f Auto: daily code review
56edcaa Auto: daily code review
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main
e6a35d9 Merge v2 into main — sync all app files to production
```

---

## FILES NOT FOUND IN REPO
The following files were requested but do not exist in this repository:
- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

These may exist locally on your machine but have not been pushed to GitHub. Consider adding them so future reviews can cover them.

---

## ISSUE SUMMARY

| Severity | Count |
|----------|-------|
| CRITICAL | 6 |
| MODERATE | 9 |
| MINOR    | 8 |

---

## Code.gs — Backend API

### CRITICAL-1: Passwords Stored and Compared in Plaintext
**Location:** `checkLogin` lines 259–261, `handleSignup` line 289

Passwords are stored as raw text in the Google Sheet "Users" tab and compared directly with `===`. Anyone who can open the sheet (mis-configured sharing, rogue staff, leaked share link) sees all passwords immediately.

```js
const dbPass = String(data[i][1]).trim();
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) { ... }
```

**Fix:** Hash passwords before storing. In Apps Script: `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` — store and compare hex digests, never raw strings.

---

### CRITICAL-2: No Authentication on `saveItinerary` — Anyone Can Overwrite Any Client's Data
**Location:** `doPost` lines 43–57, `saveItinerary` lines 342–365

`doPost` calls `saveItinerary(paxName, payload)` with zero authentication. Anyone who sends a POST with a known (or guessed) pax name can overwrite that client's itinerary with junk data. The API URL is visible in the HTML source.

```js
if (action === 'saveItinerary') {
    return saveItinerary(data.paxName || '', data.payload || {});
}
```

**Fix:** Issue a server-side session token at login and require it on every write operation. Validate the token before executing any save.

---

### CRITICAL-3: No Authentication on `searchItinerary` and `getAllSaved` — Client Data Freely Readable
**Location:** `doGet` lines 26–30, `getAllSaved` lines 299–313, `searchItinerary` lines 321–335

`?action=getAllSaved` returns every saved client name. `?action=search&name=X` returns the complete itinerary JSON for any name. No login or token required. Anyone with the API URL (visible in HTML source) can enumerate all clients and read their financial itineraries.

**Fix:** Require a validated session token on all data-read actions, not just the UI login screen.

---

### CRITICAL-4: Admin Function `getAllSaved` Has No Role Check on the Backend
**Location:** `getAllSaved` lines 299–313

The UI hides this for non-admin users, but the backend applies no role check at all. Anyone can call the URL directly to get the full client list.

**Fix:** Check a passed token's role server-side before executing; never rely solely on the UI hiding a button.

---

### CRITICAL-5: Login Sends Credentials via POST but `doPost` Does NOT Handle `checkLogin`
**Location:** HTML line 583 (fetch call), `doPost` lines 43–57, `doGet` lines 25–27

The frontend sends `{ action: "checkLogin", user, pass }` as a JSON POST body. `doPost` only handles `signup` and `saveItinerary` — it falls through to `return ContentService.createTextOutput('Invalid action')` for any `checkLogin` POST.

`checkLogin` only lives in `doGet`, which reads `e.parameter.user` and `e.parameter.pass` from the URL query string — meaning credentials go in the URL/server logs if this path is used.

This creates a real problem: either (a) every login returns "Invalid action" and auth is silently broken, or (b) a GAS redirect converts the POST to a GET, placing credentials in plaintext in URL logs.

**Fix:** Move the `checkLogin` block into `doPost` and read `data.user` / `data.pass` from the parsed JSON body. Remove the GET-based handler.

---

### CRITICAL-6: Session Admin Status Stored in localStorage — Trivially Bypassed
**Location:** HTML lines 641–652

Login session is stored in localStorage with no server-side token:
```js
localStorage.setItem("tripstore_session", JSON.stringify({ isLoggedIn: true, isAdmin: true, modeText: "ADMIN MODE" }));
```
Anyone can open browser dev tools and paste that one line to get the full admin UI — load any client's itinerary, no password needed.

**Fix:** Issue a short-lived server-side token (store in Script Properties keyed by token, expire after 24h). Store only the token in localStorage; validate it server-side on every sensitive request.

---

## Pipeline.gs — Enrichment Pipeline

### MODERATE-7: ERROR Status Means "Retry Never" Despite Error Message Saying Otherwise
**Location:** `callClaudeAPI` lines 592–596

When Claude returns any non-200 response, rows are marked ERROR with message `"Claude API error — will retry next run"`. But rows marked ERROR are never retried automatically — `resetErrorRows()` must be run manually. The misleading message will cause confusion.

**Fix:** Either change error reason text to: `"Claude API error — run resetErrorRows() to retry"`, or set status to PENDING for transient HTTP errors so they genuinely retry next night.

---

### MODERATE-8: Risk of Exceeding Apps Script 6-Minute Limit on Large Import Runs
**Location:** `runMidnightEnrichment` lines 146–161, `processSheet` lines 224–252

All four sheet types are processed sequentially. With a 1500ms sleep between each 5-row Claude batch, Apps Script's 6-minute execution limit can be hit on large batches — silently cutting off mid-run and leaving rows without status updates.

**Fix:** Process one sheet type per trigger invocation and rotate through them; or track progress in Script Properties and resume across multiple runs.

---

### MODERATE-9: `setupSheets()` Adds a Duplicate Banner Row Every Time It Is Run
**Location:** `_buildInputSheet` lines 776–788

`ws.insertRowBefore(2)` runs unconditionally. Running `setupSheets()` twice stacks banner rows, pushing all real data down and breaking the `getPendingRows` offset.

**Fix:** Check if row 2 is already a merged banner cell before inserting.

---

### MINOR-10: Model ID Has No Upgrade Reminder
**Location:** `CFG` line 39

```js
MODEL: 'claude-haiku-4-5-20251001',
```

Model ID is correct today but has no comment noting when to review. New model versions are released regularly.

**Fix:** Add comment: `// Review quarterly — check console.anthropic.com for newer Haiku versions`.

---

## Quote_Intelligence.gs — Quote Logging

### MODERATE-11: Every Save Appends a New Row — No Update Deduplication
**Location:** `logQuote` lines 29–47

`logQuote()` is called on every `saveItinerary()`, including updates. An itinerary revised 10 times creates 10 rows in Quote_Log with different Quote IDs. The log is unreliable for counting unique quotes.

**Fix:** Before appending, search for an existing row with the same `paxName`. If found, update it; only append for genuinely new clients.

---

### MODERATE-12: GST Calculation in Quote Log Always Defaults to 5% — Wrong for Most Quotes
**Location:** `buildQuoteLogRow` lines 119–120

```js
const gstPct = d.gst || 5;
```

The frontend saves `gstMode` as a string (`'5pkg'`, `'18svc'`, `'none'`), never a numeric `gst` field. So `d.gst` is always `undefined`, and GST always defaults to 5% — even for "No GST" or "18% Service Charge" quotes. Grand Total in Quote_Log is wrong for any non-5pkg quote.

**Fix:**
```js
const gstPct = d.gstMode === '18svc' ? 18 : d.gstMode === '5pkg' ? 5 : (Number(d.gst) || 0);
const gstBase = d.gstMode === '18svc' ? markupAmt : (subTotal + markupAmt);
const gstAmt  = Math.round(gstBase * gstPct / 100);
```

---

### MINOR-13: Quote ID Has Collision Risk in Bulk Operations
**Location:** Line 140

```js
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```

Two saves within the same millisecond (backfill) produce identical IDs.

**Fix:** `'Q-' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(-3).toUpperCase()`

---

## write_to_sheets.py

### MODERATE-14: Live Spreadsheet ID Hardcoded in Source Code (Public Repo)
**Location:** Line 29

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
```

The real production spreadsheet ID is committed to a public GitHub repository. While Sheets permissions still protect the data, publishing the ID enables targeted API abuse attempts.

**Fix:** `SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID")`. Add `.env.example` with placeholder.

---

### MINOR-15: Sheet Empty Check Contains Dead Code
**Location:** Lines 168–172

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```

`ws.row_count` is the sheet's row capacity (default 1000), never 0. The first condition is dead code.

**Fix:** `sheet_is_empty = not ws.get_all_values()`

---

### MINOR-16: No Rate-Limit Handling for Google Sheets API
**Location:** Lines 195–196

Large CSV files can trigger Google Sheets API 429 quota errors. No retry or backoff logic — script crashes mid-write leaving the sheet partially written.

**Fix:** Wrap `append_rows` in a retry loop with exponential backoff on `gspread.exceptions.APIError`.

---

## archive_to_input.py

### MODERATE-17: Same Hardcoded Production Spreadsheet ID
**Location:** Line 32

Same issue as MODERATE-14. Same fix applies.

---

### MINOR-18: Transfer City Extraction Is Brittle and Fails Silently
**Location:** `parse_transfers_cell` lines 155–162

City is extracted by splitting on a keyword list. Any description containing "City Inn", "Park Hotel", or an unlisted keyword produces a blank/wrong city — silently.

**Fix:** Log a warning when `city` comes back blank. Consider a structured CSV format instead of pipe-delimited free text.

---

### MINOR-19: Malformed Archive Rows Are Silently Dropped
**Location:** All `parse_*_cell` functions

Parse failures skip rows with no warning. No output shows how many rows were malformed.

**Fix:** Add a `parse_errors` counter; print count and sample bad values in the summary.

---

## index_fit.tripstore.html

### MODERATE-20: XSS via City Name in `renderRouteInputs`
**Location:** Lines 841–845

```js
document.getElementById('routeList').innerHTML = selectedRoute.map(r =>
    `<div ...><span><b>${r.city}</b> (${r.nights}N)</span>...`).join('');
```

`r.city` injected directly into `innerHTML`. A crafted itinerary loaded from the server with `<img src=x onerror=alert(document.cookie)>` as a city name executes in the agent's browser.

**Fix:** Escape the value: `${r.city.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}`

---

### MODERATE-21: Save Response Not Checked — Silent Failures Show "Saved Successfully"
**Location:** Lines 719–724

```js
await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
showToast("Saved Successfully");
```

Response never inspected. Any backend error results in "Saved Successfully" while nothing was written.

**Fix:**
```js
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
const txt = await res.text();
if (!txt.includes("Successfully")) throw new Error(txt);
showToast("Saved Successfully");
```

---

### MINOR-22: `autoSaveThenDo` Hides Pre-Export Save Failures
**Location:** Lines 2288–2293

```js
} catch(e) { /* silent — don't block the export */ }
```

If auto-save fails before PDF/Excel export, the user exports an unsaved version with no indication.

**Fix:** `catch(e) { console.warn('Auto-save before export failed:', e.message); }`

---

## ACTION ITEMS (Priority Order)

| # | Issue | File | Severity |
|---|-------|------|----------|
| 1 | Fix `checkLogin` routing — move to `doPost`, read from JSON body | Code.gs | CRITICAL |
| 2 | Hash passwords before storing in Users sheet | Code.gs | CRITICAL |
| 3 | Add server-side auth tokens to protect `saveItinerary`, `search`, `getAllSaved` | Code.gs | CRITICAL |
| 4 | Never trust `isAdmin` from localStorage — validate server-side token | index_fit | CRITICAL |
| 5 | Fix GST calculation in `buildQuoteLogRow` to use `gstMode` string | Quote_Intelligence.gs | MODERATE |
| 6 | Stop appending duplicate Quote Log rows on every save | Quote_Intelligence.gs | MODERATE |
| 7 | Move `SPREADSHEET_ID` to environment variable (both Python files) | .py files | MODERATE |
| 8 | Fix misleading "will retry" error message — ERROR rows need manual reset | Pipeline.gs | MODERATE |
| 9 | Escape city name in `renderRouteInputs` to prevent XSS | index_fit | MODERATE |
| 10 | Check fetch response in `saveItinerary` before showing success toast | index_fit | MODERATE |

---

*Report generated automatically on 2026-06-06. Files not present in the repository were noted but not reviewed.*
