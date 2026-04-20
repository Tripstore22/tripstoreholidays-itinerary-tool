# TripStore Daily Code Review
**Date:** 2026-04-20
**Reviewer:** Claude (Automated)
**Scope:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Note:** 7 files requested (extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py) were **not found** in this repository. They may exist only on the local machine at ~/Desktop/Itinerary-Create/. These should be committed or reviewed separately.

---

## Recent Commits (last 10)
```
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main — sync all app files to production
f3b87ad Sync index.html with index_fit.tripstore.html
a105e1d Fix security issues and add budget suggestion hints
2b3c62c Auto: Claude edit 2026-04-06 18:20
16f846c Auto: Claude edit 2026-04-06 17:45
ee5c74b Auto: Claude edit 2026-04-06 17:34
```

---

## CRITICAL Issues (3)

### [CRITICAL-1] Code.gs — Login endpoint mismatch: checkLogin in doGet but frontend sends POST
**File:** Code.gs lines 25-28 and index_fit.tripstore.html line 583

Code.gs.doGet() handles the checkLogin action, but the frontend sends credentials via HTTP POST. doPost() only handles signup and saveItinerary. A POST with action checkLogin returns "Invalid action". Login is broken in the committed code — the live deployment must be running an older version.

**Action:** Move checkLogin handling into doPost() and redeploy.

---

### [CRITICAL-2] index_fit.tripstore.html — Admin access from localStorage alone (no server re-verification)
**File:** index_fit.tripstore.html lines 641-652

checkAutoLogin() reads isAdmin from localStorage and launches the admin panel without any server check. Anyone can run in the browser console:
  localStorage.setItem('tripstore_session', JSON.stringify({isLoggedIn:true,isAdmin:true,modeText:'ADMIN MODE'}))
Then reload — full admin access with no password.

**Action:** Do not store isAdmin in localStorage. Re-verify with the server on every page load before granting admin access.

---

### [CRITICAL-3] Code.gs — Passwords stored and compared in plaintext
**File:** Code.gs lines 257-261 and line 289

Passwords are stored as raw text in the Users sheet and compared character-for-character. Anyone with sheet access sees all passwords.

**Action:** Hash passwords with SHA-256 + salt before storing. Compare hashes on login.

---

## MODERATE Issues (8)

### [MODERATE-1] Code.gs — No rate limiting or lockout on login
No attempt counter, no lockout, no delay. Scripts can brute-force thousands of attempts per second.
**Action:** Count failed attempts per username; block for M minutes after N failures.

---

### [MODERATE-2] Code.gs — getAllSaved and searchItinerary have no authorization check
Both functions are accessible to any caller who knows the /exec URL. Anonymous users can enumerate all saved pax names and download any itinerary.
**Action:** Require a session token and validate server-side before returning data.

---

### [MODERATE-3] Pipeline.gs — Claude API errors mark rows ERROR instead of leaving them PENDING
**File:** Pipeline.gs lines 591-597

When Claude's API fails, every row in the batch is marked ERROR. resetErrorRows() must be run manually to re-queue them. Comment says "will retry" but code prevents that.
**Action:** On API error, do not call markRow at all — leave rows PENDING so they auto-retry next night.

---

### [MODERATE-4] Pipeline.gs — No timeout on Claude API calls
No deadline parameter on UrlFetchApp.fetch(). If Claude's API hangs, the pipeline may exceed Apps Script's 6-minute limit, leaving sheets in a partial state.
**Action:** Add deadline: 30 to fetch options. Add timeout error logging to AUDIT_LOG.

---

### [MODERATE-5] Quote_Intelligence.gs — setupQuoteLog() calls getUi() from a trigger
**File:** Quote_Intelligence.gs lines 33-37

logQuote() auto-creates the sheet by calling setupQuoteLog() which calls SpreadsheetApp.getUi().alert(). getUi() throws an exception when called from a time-based trigger (no UI context). If Quote_Log is deleted, the next nightly run fails silently.
**Action:** Wrap getUi().alert() in try/catch: try { SpreadsheetApp.getUi().alert(...) } catch(e) { Logger.log(...) }

---

### [MODERATE-6] index_fit.tripstore.html — XSS risk: unsanitized master data in innerHTML
Multiple places inject data from masterData directly into innerHTML template literals. If a hotel name or city in the Sheet contains script tags, it executes in every user's browser.
**Action:** Add: const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
Apply esc() to all masterData fields before inserting into innerHTML.

---

### [MODERATE-7] write_to_sheets.py — ws.row_count == 0 check never triggers
**File:** write_to_sheets.py line 168

In gspread, ws.row_count returns total allocated rows (default 1000), never 0. That clause is dead code.
**Action:** Remove ws.row_count == 0; rely only on not ws.get_all_values().

---

### [MODERATE-8] archive_to_input.py — Cell parsers silently skip the last entry
**File:** archive_to_input.py lines 69-76 and 86-92

  for i in range(0, len(parts) - 3, 4):  # Hotels
  for i in range(0, len(parts) - 2, 3):  # Sightseeing

A complete group at the end of the list can be skipped without any warning.
**Action:** Change to range(0, len(parts), N) with an inner completeness check.

---

## MINOR Issues (6)

### [MINOR-1] Code.gs — Transfer field notes actually contains schedule text (naming confusion)
**File:** Code.gs line 203 — notes: String(r[13] || '').trim(), // Column N: Schedule
**Action:** Rename to schedule or add a clarifying comment.

---

### [MINOR-2] Pipeline.gs — _buildInputSheet() inserts duplicate banner row on re-run
No check if banner already exists — running setupSheets() twice inserts a second banner and shifts all data down.
**Action:** Check row 2 content before inserting.

---

### [MINOR-3] index_fit.tripstore.html — Hotel cost formula bakes in pricingFactor at render time
**File:** index_fit.tripstore.html line 1307

pricingFactor is a literal number frozen at render time. If pax count changes after editing the hotel price, the stored per-night cost is stale.
**Action:** Divide by live pricingFactor inside calculateBudgetInvestment() instead.

---

### [MINOR-4] index_fit.tripstore.html — Missing Content-Type header on POST requests
**File:** Lines 583, 612, 720 — all POST fetch calls omit headers: { 'Content-Type': 'application/json' }
**Action:** Add the header to all POST fetch calls.

---

### [MINOR-5] Quote_Intelligence.gs — Quote ID collision risk
**File:** Quote_Intelligence.gs line 140 — 'Q-' + new Date().getTime().toString().slice(-8)
Two saves within the same millisecond produce identical IDs (realistic during backfill).
**Action:** Add random component: 'Q-' + Date.now().toString(36) + Math.random().toString(36).slice(2,5)

---

### [MINOR-6] archive_to_input.py — Verify sheets-credentials.json is gitignored
Spreadsheet ID is committed (acceptable — it is in the browser URL anyway), but a leaked credentials file alongside it would be immediately actionable.
**Action:** Confirm sheets-credentials.json is in .gitignore.

---

## Missing Files (not in this repository)
The following 7 files were requested but do not exist in this repo:
- extract_itineraries.py
- write_inputs_to_sheets.py
- cleanup_sheet.py
- clean_pipeline_data.py
- cross_reference.py
- enrich_hotels.py
- enrich_hotels_booking.py

**Action:** Commit these to this repo (e.g., a scripts/ subfolder) so they are tracked, backed up, and reviewable.

---

## Action Items Summary

| # | Severity | File | Action |
|---|----------|------|--------|
| 1 | CRITICAL | Code.gs | Move checkLogin to doPost() and redeploy |
| 2 | CRITICAL | index_fit.tripstore.html | Re-verify session server-side on auto-login; remove admin flag from localStorage |
| 3 | CRITICAL | Code.gs | Hash passwords (SHA-256 + salt) before storing in Sheets |
| 4 | MODERATE | Code.gs | Add login rate limiting / failed-attempt lockout |
| 5 | MODERATE | Code.gs | Add auth check to getAllSaved and searchItinerary |
| 6 | MODERATE | Pipeline.gs | On API error, leave rows PENDING — do not mark as ERROR |
| 7 | MODERATE | Pipeline.gs | Add deadline:30 to Claude API fetch to prevent pipeline stall |
| 8 | MODERATE | Quote_Intelligence.gs | Wrap getUi().alert() in try/catch for trigger safety |
| 9 | MODERATE | index_fit.tripstore.html | Sanitize all masterData fields before innerHTML injection |
| 10 | MODERATE | write_to_sheets.py | Remove dead ws.row_count == 0 check |
| 11 | MODERATE | archive_to_input.py | Fix cell parser range to avoid skipping last entry |
| 12 | MINOR | Code.gs | Rename transfer notes field to schedule for clarity |
| 13 | MINOR | Pipeline.gs | Guard against duplicate banner row in _buildInputSheet() |
| 14 | MINOR | index_fit.tripstore.html | Fix hotel cost formula — don't bake in pricingFactor at render time |
| 15 | MINOR | index_fit.tripstore.html | Add Content-Type application/json header to POST fetch calls |
| 16 | MINOR | Quote_Intelligence.gs | Add randomness to quoteId to prevent collisions |
| 17 | MINOR | archive_to_input.py | Verify sheets-credentials.json is in .gitignore |
| 18 | INFO | — | Commit the 7 missing Python scripts to this repository |

**Total: 3 Critical · 8 Moderate · 6 Minor · 1 Info**

---

Generated automatically by Claude — 2026-04-20
