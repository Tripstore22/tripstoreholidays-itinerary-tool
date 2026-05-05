# TripStore Automated Code Review
**Date:** 2026-05-05  
**Reviewer:** Claude (automated)  
**Branch:** v2  
**Recent commits reviewed:**
```
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main — sync all app files to production
f3b87ad Sync index.html with index_fit.tripstore.html
a105e1d Fix security issues and add budget suggestion hints
```

**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Files NOT FOUND (requested but absent from repo):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## CRITICAL ISSUES (3)

### CR-01 — Passwords stored and compared as plaintext [Code.gs]
**Location:** `handleSignup()` line 289, `checkLogin()` lines 260–261  
**Risk:** If the Google Sheet is ever shared, exported, or accessed by anyone with spreadsheet permissions, all user passwords are exposed in clear text. An attacker with read access to the "Users" sheet can log in as any agent.  
**Fix:** Use Google's built-in `Utilities.computeDigest()` with SHA-256 to hash passwords before storing. Compare hashes on login.
```js
// Store:
const hashed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
// Compare: hash the incoming pass and compare with stored hash
```

### CR-02 — Unauthenticated GET endpoints expose all business data [Code.gs]
**Location:** `doGet()` lines 28–32: `getAllSaved`, `getQuoteLog`, `search`  
**Risk:** Anyone who knows or discovers the Apps Script `/exec` URL can call `?action=getAllSaved` to get all saved pax names, `?action=getQuoteLog` to get full financial data (grand totals, markup %, budgets), and `?action=search&name=X` to download any complete itinerary. No session token is checked.  
**Fix:** Require a secret token in Script Properties and validate it on every GET request for sensitive actions. Or move `getAllSaved` and `getQuoteLog` to POST-only with a session token.

### CR-03 — DOM XSS via unescaped user data in innerHTML [index_fit.tripstore.html]
**Location:** `renderRouteInputs()` line 841, `renderTables()` lines 1285–1350 (hotel city, name, category; sightseeing category, duration; transfer from/to/details)  
**Risk:** City name, hotel name, category, sightseeing info, and transfer fields are interpolated directly into template-literal `innerHTML`. A malicious value such as `<img src=x onerror=alert(document.cookie)>` entered as a city name (or returned from the server) would execute arbitrary JavaScript in the agent's browser.  
**Fix:** Use `textContent` for plain text, or escape all interpolated strings with a helper:
```js
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// Then: `<span><b>${esc(r.city)}</b></span>`
```

---

## MODERATE ISSUES (11)

### MO-01 — `action=checkLogin` reachable via GET with credentials in URL [Code.gs]
**Location:** `doGet()` line 26: `if (action === 'checkLogin') return checkLogin(e.parameter.user...`  
**Risk:** Credentials passed in a GET URL appear in Google server access logs, browser history, and referrer headers. The frontend correctly uses POST, but the GET endpoint remains open.  
**Fix:** Remove the `checkLogin` case from `doGet()` entirely. Force all auth through POST.

### MO-02 — Transfer `notes` field maps to Schedule column, not Notes [Code.gs]
**Location:** `getTransfers()` line 203: `notes: String(r[13] || '').trim(), // Column N: Schedule`  
**Risk:** The Transfers sheet column layout is: r[13]=Schedule, r[14]=Notes. Code maps r[13] to `notes`, so the actual Notes column (r[14]) is never read and the field name `notes` in the served object actually contains Schedule text. Causes confusion when Pipeline.gs enriches Schedule text (col 13) and it gets served as `notes` to the frontend.  
**Fix:** Rename the field to `schedule`, or add a separate `notes: String(r[14]||'').trim()`.

### MO-03 — GST in Quote_Log always 5%, ignores gstMode [Quote_Intelligence.gs]
**Location:** `buildQuoteLogRow()` line 119: `const gstPct = d.gst || 5;`  
**Risk:** The saved payload stores `gstMode: '18svc'` or `gstMode: 'none'` (a string), not `gst` (a number). So `d.gst` is always `undefined` and `gstPct` defaults to 5% regardless of what the agent selected. All Quote_Log GST amounts are wrong for quotes using 18% service charge or no GST.  
**Fix:**
```js
const gstMode = d.gstMode || (d.gst === 18 ? '18svc' : d.gst > 0 ? '5pkg' : 'none');
const gstPct  = gstMode === '18svc' ? 18 : gstMode === '5pkg' ? 5 : 0;
const gstBase = gstMode === '18svc' ? markupAmt : gstMode === '5pkg' ? (subTotal + markupAmt) : 0;
const gstAmt  = Math.round(gstBase * gstPct / 100);
```

### MO-04 — Quote ID cycles every ~27.8 hours, will produce duplicates [Quote_Intelligence.gs]
**Location:** `buildQuoteLogRow()` line 140: `'Q-' + new Date().getTime().toString().slice(-8)`  
**Risk:** The last 8 digits of a Unix millisecond timestamp repeat every 100,000,000 ms ≈ 27.8 hours. Any Quote_Log kept for more than two days will have colliding Quote IDs.  
**Fix:**
```js
const quoteId = 'Q-' + new Date().getTime().toString(36).toUpperCase()
    + Math.random().toString(36).slice(-4).toUpperCase();
```

### MO-05 — Pipeline trigger fires at midnight US/UTC time, not IST [Pipeline.gs]
**Location:** `setupTrigger()` line 841: `.atHour(0).everyDays(1)`  
**Risk:** Apps Script triggers use the script project's timezone. If not set to IST (Asia/Kolkata), the trigger fires at midnight US Eastern (= 10:30 AM IST) or midnight UTC (= 5:30 AM IST), running enrichment during business hours.  
**Fix:** In Apps Script → Project Settings → set Time Zone to "Asia/Kolkata". No code change required.

### MO-06 — No retry on Claude API rate-limit (429/529) responses [Pipeline.gs]
**Location:** `callClaudeAPI()` lines 564–598  
**Risk:** A 429 or 529 response causes ALL rows in the batch to be marked ERROR immediately. Manual `resetErrorRows()` is then required. During peak API usage this could fail large batches every night.  
**Fix:** Add a retry loop for 429/529 with exponential backoff (2s, 4s, 8s, max 3 retries) before declaring error.

### MO-07 — No per-run row cap; large queues can hit Apps Script 6-min timeout [Pipeline.gs]
**Location:** `processSheet()` line 170 — fetches all pending rows with no limit  
**Risk:** If someone accidentally marks hundreds of rows as PENDING, the run times out mid-batch, leaving some rows PROCESSED and others stranded. The partial state is difficult to resume.  
**Fix:** Add `const MAX_PER_RUN = 50;` and: `const allPending = getPendingRows(inp, cfg.col.STATUS).slice(0, MAX_PER_RUN);`

### MO-08 — `setupSheets()` inserts an extra banner row on each invocation [Pipeline.gs]
**Location:** `_buildInputSheet()` line 779: `ws.insertRowBefore(2);`  
**Risk:** Running `setupSheets()` a second time inserts a new blank row 2 each time, pushing all data rows down, and breaking `getPendingRows()` which expects data to start at row 3.  
**Fix:**
```js
const existingBanner = ws.getRange(2,1).getValue().toString().trim();
if (!existingBanner.startsWith('ℹ️')) { ws.insertRowBefore(2); }
```

### MO-09 — Hardcoded Spreadsheet ID committed to source control [write_to_sheets.py, archive_to_input.py]
**Location:** `write_to_sheets.py` line 28, `archive_to_input.py` line 32  
**Risk:** `SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is hardcoded in git history. If this repo is made public or shared, the sheet ID is exposed. Credentials-in-code is a security antipattern.  
**Fix:** Move to an environment variable: `SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID")` and add a `.env` file to `.gitignore`.

### MO-10 — Transfer city extraction in archive parser is brittle [archive_to_input.py]
**Location:** `parse_transfers_cell()` lines 154–162  
**Risk:** City name is extracted by regex-splitting on keywords (airport, hotel, city, central, hub, downtown). If a hotel name contains any of these words (e.g. "Hotel City Inn", "Grand Central Hotel"), the city extracted will be wrong or empty. The row is pushed to INPUT_Transfers with a garbage city name that Claude cannot validate.  
**Fix:** Require city as an explicit first field in the archive cell format, or take the first word only as a safer heuristic.

### MO-11 — `sheet_is_empty` check always False for new Google Sheets [write_to_sheets.py]
**Location:** `main()` line 168: `ws.row_count == 0 or not ws.get_all_values()`  
**Risk:** Google Sheets always initialises with 1,000 rows, so `ws.row_count == 0` is never True. The check accidentally works only because of the `or` clause. If refactored naively, the header row would never be written.  
**Fix:**
```python
sheet_is_empty = not ws.get_all_values()
```

---

## MINOR ISSUES (5)

### MI-01 — Unused variable `headers` in `getQuoteLog()` [Code.gs]
**Location:** Line 380: `const headers = rows[0];`  
Assigned but never used. Remove it.

### MI-02 — `backfillQuoteLog()` is not idempotent [Quote_Intelligence.gs]
**Location:** `backfillQuoteLog()` line 288  
Running it twice creates duplicate rows in Quote_Log with no detection. Add a check: read existing Quote IDs from the log before appending and skip any paxName already present.

### MI-03 — Claude API code-fence stripping misses uppercase variants [Pipeline.gs]
**Location:** `callClaudeAPI()` line 587: `` text.replace(/```json|```/g, '') ``  
Does not handle ` ```JSON ` (uppercase) or ` ```js ` variants. Fix: `` .replace(/```[a-z]*/gi, '') ``

### MI-04 — `parse_hotels_cell` step loop can silently skip last hotel entry [archive_to_input.py]
**Location:** `parse_hotels_cell()` line 70: `for i in range(0, len(parts) - 3, 4)`  
If the archive cell has a trailing `|`, the last valid hotel group falls outside the loop range. Use explicit bounds guards or change to `range(0, len(parts), 4)` with a guard on `i+3 < len(parts)`.

### MI-05 — Archive sightseeing cost placed in Avg Price field with empty GYG/Viator [archive_to_input.py]
**Location:** `make_sightseeing_row()` line 253: `row[5] = s.get("cost_inr", "")`  
Claude's sightseeing validation rejects rows where both GYG and Viator prices are 0. However, Avg Price (row[5]) is pre-filled from the archive cost while GYG (row[6]) and Viator (row[8]) stay blank. Claude may still validate and enrich these, but it bypasses the intended enrichment flow. Put archive cost into row[6] (GYG Price) as a reference value instead, so the validation passes correctly.

---

## SUMMARY TABLE

| ID | Severity | File | Description |
|----|----------|------|-------------|
| CR-01 | CRITICAL | Code.gs | Plaintext passwords in Google Sheet |
| CR-02 | CRITICAL | Code.gs | Unauthenticated GET exposes all itineraries & financials |
| CR-03 | CRITICAL | index_fit.tripstore.html | DOM XSS via unescaped innerHTML interpolation |
| MO-01 | MODERATE | Code.gs | checkLogin accessible via GET URL (credentials in logs) |
| MO-02 | MODERATE | Code.gs | Transfer notes field maps to Schedule column |
| MO-03 | MODERATE | Quote_Intelligence.gs | GST always 5% regardless of gstMode setting |
| MO-04 | MODERATE | Quote_Intelligence.gs | Quote ID repeats after 27.8 hours |
| MO-05 | MODERATE | Pipeline.gs | Midnight trigger fires at US time, not IST |
| MO-06 | MODERATE | Pipeline.gs | No retry on Claude 429/529 API errors |
| MO-07 | MODERATE | Pipeline.gs | No row cap — large queues hit 6-min timeout |
| MO-08 | MODERATE | Pipeline.gs | setupSheets() inserts extra banner row each run |
| MO-09 | MODERATE | write_to_sheets.py / archive_to_input.py | Spreadsheet ID hardcoded in source |
| MO-10 | MODERATE | archive_to_input.py | Transfer city extraction breaks on hotel name keywords |
| MO-11 | MODERATE | write_to_sheets.py | sheet_is_empty check always False |
| MI-01 | MINOR | Code.gs | Unused `headers` variable in getQuoteLog() |
| MI-02 | MINOR | Quote_Intelligence.gs | backfillQuoteLog() not idempotent |
| MI-03 | MINOR | Pipeline.gs | Code-fence strip regex misses uppercase JSON |
| MI-04 | MINOR | archive_to_input.py | Hotel parser can skip trailing entry |
| MI-05 | MINOR | archive_to_input.py | Archive cost in wrong sightseeing column |

**Total: 3 Critical · 11 Moderate · 5 Minor = 19 issues**

### Top 5 fixes (highest impact, lowest effort):
1. **Set Apps Script timezone to IST** — Project Settings → no code change (MO-05)
2. **Remove checkLogin from doGet()** — delete 2 lines (MO-01)
3. **Fix GST calculation** in Quote_Intelligence.gs — ~5 lines, fixes all Quote_Log financials (MO-03)
4. **Add `esc()` helper** and apply to all innerHTML interpolations (CR-03)
5. **Hash passwords** with Utilities.computeDigest (CR-01)

---

## MISSING FILES NOTE
7 of 12 files requested for review were not found in this repository. These were likely in a separate local pipeline folder on Sumit's Mac. If these scripts are part of the active workflow, they should be committed to this repo for version control and future review coverage.

---
*Generated automatically by Claude — TripStore v2 — 2026-05-05*
