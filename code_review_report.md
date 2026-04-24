# TripStore Code Review Report
**Date:** 2026-04-24  
**Reviewer:** Claude (automated daily review)  
**Scope:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py, backup_chats.sh  
**Note:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py — **not found in this repository** (likely in the separate `tripstore-itinerary-archive` repo).

---

## Recent Commits
```
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
```

---

## CRITICAL Issues — Fix Immediately

### [CRITICAL-1] Login is broken: `checkLogin` routed to wrong HTTP handler
**File:** `Code.gs` (line 25) + `index_fit.tripstore.html` (line 583)

The frontend sends login credentials via **POST**:
```javascript
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But `doPost()` in Code.gs has **no handler for `"checkLogin"`** — it only handles `"signup"` and `"saveItinerary"`. The request falls through to `return ContentService.createTextOutput('Invalid action')`. As a result, login always fails.

The `checkLogin` handler exists only in `doGet()` (line 25), which is never reached by the frontend's POST call.

**Fix:** Add a `checkLogin` handler inside `doPost()`:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### [CRITICAL-2] Auth bypass via browser localStorage
**File:** `index_fit.tripstore.html` — `checkAutoLogin()` function (lines 641–652)

The auto-login on page load reads a session object from `localStorage` and directly grants access — including ADMIN access — without re-verifying with the server:
```javascript
const s = JSON.parse(saved);
isAdmin = s.isAdmin;
launchApp(s.modeText); // grants full access, no server check
```
Anyone can open browser DevTools and run:
```javascript
localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:"ADMIN MODE"}))
```
This gives instant admin access — ability to load all saved itineraries — with no password.

**Fix:** On auto-login, re-verify credentials with the server before granting access, or store a server-issued token and validate it rather than trusting client-supplied role values.

---

### [CRITICAL-3] Infinite recursion risk in `logQuote`
**File:** `Quote_Intelligence.gs` — `logQuote()` function (lines 29–47)

If `setupQuoteLog()` fails to create the sheet (quota exceeded, permission error), the function calls itself again with no depth guard:
```javascript
if (!logSheet) {
  setupQuoteLog();
  return logQuote(paxName, data); // recurses forever if setup keeps failing
}
```
This causes a stack overflow that can crash the entire `saveItinerary` call.

**Fix:** Add a retry flag:
```javascript
function logQuote(paxName, data, _retried = false) {
  ...
  if (!logSheet) {
    if (_retried) { Logger.log('Quote_Log missing and setup failed — skipping log'); return; }
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
```

---

## MODERATE Issues — Fix Soon

### [MODERATE-1] GST amount always calculates at 5% regardless of user selection
**File:** `Quote_Intelligence.gs` — `buildQuoteLogRow()` (line 119)

The frontend saves `gstMode` (a string: `"5pkg"`, `"18svc"`, `"none"`), but `buildQuoteLogRow` reads `d.gst` (a number that is never in the saved payload):
```javascript
const gstPct = d.gst || 5; // d.gst is always undefined → always 5
```
Every quote with 18% service charge or no GST will show wrong financial totals in the dashboard.

**Fix:**
```javascript
const gstMode = d.gstMode || 'none';
const gstPct  = gstMode === '18svc' ? 18 : gstMode === '5pkg' ? 5 : 0;
```

---

### [MODERATE-2] Plaintext passwords in Google Sheets
**File:** `Code.gs` — `handleSignup()` (line 289), `checkLogin()` (line 261)

Passwords are stored and compared in plaintext. If the sheet is ever shared or accessed by a script, all user passwords are exposed.

**Fix:** Hash passwords before storing using `Utilities.computeDigest()`:
```javascript
function hashPassword(pass) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
```

---

### [MODERATE-3] No rate limiting on login — brute force possible
**File:** `Code.gs` — `checkLogin()` (line 249)

No lockout or delay after failed login attempts. An attacker can make unlimited rapid requests to guess passwords.

**Fix:** Track failed attempts per username in the Users sheet. After 5 failures, lock the account for 15 minutes.

---

### [MODERATE-4] `appendRow` to master sheet has no error handling — partial batch writes
**File:** `Pipeline.gs` — `processSheet()` (lines 241–248)

Inside the enrichment batch loop, `mst.appendRow(rowArr)` has no try/catch. If one row fails (quota exceeded, row too large), an exception marks the entire batch as errored — but rows already appended in that batch remain in the master sheet. On the next run, those rows re-process as new, creating duplicates.

**Fix:** Wrap each `appendRow` in a try/catch. On failure, mark only that row as ERROR and continue.

---

### [MODERATE-5] Vehicle type change fires `runOptimizer` before a plan exists
**File:** `index_fit.tripstore.html` — vehicle select (line 187)

```html
<select id="vehicleTypeSelect" onchange="runOptimizer(false, false)" ...>
```
If changed while `selectedRoute` is empty, `runOptimizer` clears `currentPlan`, `selectedTransfers`, and `selectedIntercity`. A loaded itinerary could be accidentally wiped.

**Fix:** Guard inside `runOptimizer` — only clear state if a route was previously built. Or change `onchange` to re-render costs only, not regenerate the plan.

---

### [MODERATE-6] Brittle pipe-delimiter parsing in `archive_to_input.py`
**File:** `archive_to_input.py` — all four `parse_*_cell()` functions

All parsers assume rigid field grouping (hotels = groups of 4, sightseeing = 3, trains/transfers = 2). One extra or missing `|` in any cell silently misaligns all subsequent field reads in that cell, producing wrong city/name/price without any error.

**Fix:** Validate field count per group and skip/warn on malformed entries:
```python
for i in range(0, len(parts), 4):
    group = parts[i:i+4]
    if len(group) < 4:
        print(f"  WARNING: Incomplete hotel entry, skipping: {group}")
        continue
```

---

### [MODERATE-7] Hardcoded Spreadsheet ID committed to repository
**File:** `write_to_sheets.py` (line 28), `archive_to_input.py` (line 32)

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
```
If the repo is ever made public, this is a direct link to the live data store.

**Fix:** Move to an environment variable:
```python
import os
SPREADSHEET_ID = os.environ["TRIPSTORE_SHEET_ID"]
```

---

### [MODERATE-8] `backup_chats.sh` hardcoded paths — silently fails everywhere except one machine
**File:** `backup_chats.sh` (lines 5–6)

```bash
SOURCE="/Users/Sumit/.claude/projects/-Users-Sumit-Desktop-Itinerary-Create"
DEST="/Users/Sumit/Desktop/Itinerary-Create/chat_backups"
```
Hard-coded to one specific MacBook. No `set -e`, so failures produce no error output.

**Fix:**
```bash
#!/bin/bash
set -e
SOURCE="$HOME/.claude/projects/-Users-Sumit-Desktop-Itinerary-Create"
DEST="$HOME/Desktop/Itinerary-Create/chat_backups"
[ -d "$SOURCE" ] || { echo "ERROR: Source not found: $SOURCE"; exit 1; }
mkdir -p "$DEST"
cp -rf "$SOURCE/." "$DEST/"
echo "Backup done: $(date '+%Y-%m-%d %H:%M')" > "$DEST/last_backup.txt"
```

---

## MINOR Issues — Fix When Convenient

### [MINOR-1] Dead variable: `headers` in `getQuoteLog`
**File:** `Code.gs` — `getQuoteLog()` (line 380)
```javascript
const headers = rows[0]; // declared but never used
```
**Fix:** Remove the line.

---

### [MINOR-2] `checkLogin` password exposed in URL if called via GET
**File:** `Code.gs` — `doGet()` (line 25)

If anyone calls the Apps Script URL with `?action=checkLogin&user=X&pass=Y`, the password appears in server logs. The GET handler for `checkLogin` should be removed now that the frontend uses POST.

**Fix:** Remove the `checkLogin` branch from `doGet()`.

---

### [MINOR-3] Quote ID collision risk on concurrent saves
**File:** `Quote_Intelligence.gs` — `buildQuoteLogRow()` (line 140)
```javascript
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```
Two saves within the same millisecond get identical quote IDs.

**Fix:**
```javascript
const quoteId = 'Q-' + Date.now().toString().slice(-8) + '-' + Math.random().toString(36).slice(2,5).toUpperCase();
```

---

### [MINOR-4] Pipeline trigger timezone may not be IST midnight
**File:** `Pipeline.gs` — `setupTrigger()` (line 841)

`atHour(0)` runs at midnight in the Apps Script project's configured timezone. If not set to `Asia/Kolkata`, the pipeline runs at the wrong time.

**Fix:** Set the Apps Script project timezone to `Asia/Kolkata` under Project Settings → General Settings → Time zone.

---

### [MINOR-5] `ws.row_count == 0` is always False — misleading dead code
**File:** `write_to_sheets.py` (line 168)
```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```
`ws.row_count` returns allocated row capacity (default 1000), never 0. Only the second condition works.

**Fix:** Use only `not ws.get_all_values()`.

---

### [MINOR-6] No guard against saving an empty plan
**File:** `index_fit.tripstore.html` — `saveItinerary()` (line 695)

A user can click Save with only a pax name, overwriting a valid saved itinerary with empty data.

**Fix:**
```javascript
if (!currentPlan || currentPlan.length === 0) return showToast("Generate a quote before saving", "error");
```

---

### [MINOR-7] Silent parse failures in `archive_to_input.py`
**File:** `archive_to_input.py`

When a cell has unexpected format, it is silently skipped with no counter or warning printed.

**Fix:** Add a `skipped` counter per category and print totals in the summary output.

---

## Summary Table

| # | File | Severity | Issue |
|---|------|----------|-------|
| 1 | Code.gs + HTML | CRITICAL | `checkLogin` not handled in `doPost` — login broken |
| 2 | index_fit.tripstore.html | CRITICAL | localStorage auth bypass — anyone can fake ADMIN session |
| 3 | Quote_Intelligence.gs | CRITICAL | `logQuote` infinite recursion if sheet setup fails |
| 4 | Quote_Intelligence.gs | MODERATE | GST always 5% regardless of user's selection |
| 5 | Code.gs | MODERATE | Plaintext passwords in Google Sheet |
| 6 | Code.gs | MODERATE | No rate limiting on login — brute force possible |
| 7 | Pipeline.gs | MODERATE | `appendRow` errors cause partial batch writes → duplicates |
| 8 | index_fit.tripstore.html | MODERATE | Vehicle type change can wipe an existing plan |
| 9 | archive_to_input.py | MODERATE | Brittle pipe-delimiter parsing corrupts data silently |
| 10 | write_to_sheets.py / archive_to_input.py | MODERATE | Hardcoded Spreadsheet ID in committed code |
| 11 | backup_chats.sh | MODERATE | Hardcoded absolute paths, silent failure |
| 12 | Code.gs | MINOR | Dead `headers` variable in `getQuoteLog` |
| 13 | Code.gs | MINOR | Password exposed in URL if `checkLogin` called via GET |
| 14 | Quote_Intelligence.gs | MINOR | Quote ID collision risk |
| 15 | Pipeline.gs | MINOR | Trigger timezone may not be IST midnight |
| 16 | write_to_sheets.py | MINOR | `ws.row_count == 0` is always False |
| 17 | index_fit.tripstore.html | MINOR | No guard against saving empty plan |
| 18 | archive_to_input.py | MINOR | Silent parse failures with no logging |

**Total: 3 CRITICAL · 8 MODERATE · 7 MINOR**

---

## Priority Action Items

1. **[URGENT] Fix login** — add `checkLogin` handler to `doPost()` in Code.gs and redeploy the Apps Script
2. **[URGENT] Fix auth bypass** — re-validate session server-side on auto-login; do not trust localStorage role values
3. **[URGENT] Add recursion guard** to `logQuote` in Quote_Intelligence.gs
4. **Fix GST field name** in `buildQuoteLogRow` — read `gstMode` string, not `d.gst` number
5. **Hash passwords** — store SHA-256 hashes in the Users sheet, not plaintext
6. **Verify pipeline timezone** — set Apps Script timezone to `Asia/Kolkata`
7. **Add try/catch** around `mst.appendRow()` in Pipeline.gs
8. **Fix pipe parser guards** in archive_to_input.py
9. **Move Spreadsheet ID** to environment variable in Python scripts
10. **Fix backup_chats.sh** — use `$HOME`, add `set -e`, check source exists
