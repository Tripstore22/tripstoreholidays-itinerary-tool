# TripStore Holidays — Automated Code Review
**Date:** 2026-04-12
**Reviewed by:** Claude (automated)
**Branch:** v2

> ⚠️ **4 CRITICAL issues remain unresolved from last review (2026-04-09). No critical or moderate fixes were shipped since then.**

---

## Recent Commits Reviewed
```
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main
e6a35d9 Merge v2 into main — sync all app files to production
f3b87ad Sync index.html with index_fit.tripstore.html
a105e1d Fix security issues and add budget suggestion hints
2b3c62c Auto: Claude edit 2026-04-06 18:20
16f846c Auto: Claude edit 2026-04-06 17:45
ee5c74b Auto: Claude edit 2026-04-06 17:34
```

---

## Summary

| Severity  | Count | New This Run | Repeat / Unresolved |
|-----------|-------|--------------|---------------------|
| CRITICAL  | 4     | 0            | 4 ⚠️ |
| MODERATE  | 10    | 1            | 9 |
| MINOR     | 7     | 2            | 5 |
| **TOTAL** | **21**| **3**        | **18** |

---

## Files Reviewed

### 1. Code.gs

**[CRITICAL] ⚠️ REPEAT — Login is broken: frontend sends POST, backend handles GET only**
- `index_fit.tripstore.html` line 583: `fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })`
- `Code.gs doPost()` handles only `signup` and `saveItinerary`. `checkLogin` lives in `doGet()` via URL params.
- Every login attempt returns `"Invalid action"` from `doPost`, which the UI interprets as invalid credentials.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** Add `checkLogin` handling to `doPost`, or move the check to read from `e.postData`.

**[CRITICAL] ⚠️ REPEAT — Passwords stored as plain text in Google Sheets**
- `Code.gs` line 261: `dbPass === pass.trim()` — direct string comparison against the sheet.
- A sheet export or accidental sharing exposes all user passwords.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** Hash passwords with SHA-256 before storing. At minimum, document the risk.

**[CRITICAL] ⚠️ REPEAT — `getAllSaved()` and `searchItinerary()` have no authentication**
- `Code.gs` lines 299–334: any caller with the public API URL can enumerate all client names and load full itinerary payloads.
- The URL is hardcoded in the public HTML file.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** Add a shared API key or session token check before serving any data-read endpoints.

**[MINOR] Transfers `notes` column is mislabelled in getTransfers()**
- `Code.gs` line 203: `notes: String(r[13] || '').trim(), // Column N: Schedule`
- Column N (r[13]) is "Schedule", not "Notes". The field is named `notes` but contains schedule text. Column O (r[14]) is the actual Notes column and is never read.
- **Action:** Either rename the field to `schedule`, or add `notes: String(r[14] || '').trim()` to expose both.

---

### 2. Pipeline.gs

**[MODERATE] ⚠️ REPEAT — Hardcoded EUR→INR exchange rate is stale**
- Line 463: `"INR price at ₹110/€"` — EUR/INR spot rate as of April 2026 is approximately ₹89–91/€.
- Claude back-calculates INR from EUR prices using this rate, overestimating train costs by ~20%.
- The same line also instructs Claude: `back-calculate: round(inr_price / 110, 1)`, amplifying the error when EUR columns are blank.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** Change both `₹110/€` references to `₹90/€` and add `CFG.EUR_TO_INR = 90` to make future updates a single-line change.

**[MODERATE] ⚠️ REPEAT — `mst.appendRow(rowArr)` has no column-count validation**
- `Pipeline.gs` line 243: if Claude returns fewer fields than the master sheet has columns, trailing cells are silently blank — misaligning the row for all downstream reads.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** Before `mst.appendRow(rowArr)`, check `if (rowArr.length < expectedColCount) { markRow(...ERROR...); return; }`.

**[MODERATE] NEW — `Array(n).fill({…})` in callClaudeAPI shares a single error object**
- `Pipeline.gs` line 593: `return Array(expectedCount).fill({ valid: false, error_reason: … })`
- JavaScript's `.fill()` with an object sets every slot to the *same* reference. If any downstream code mutates one element, all elements in the array are mutated simultaneously.
- **Fix:** `Array.from({ length: expectedCount }, () => ({ valid: false, error_reason: … }))`

**[MODERATE] ⚠️ REPEAT — No execution-time guard in `processSheet()`**
- Apps Script has a hard 6-minute execution limit. If a large batch of PENDING rows causes the pipeline to approach the limit, enrichment stops mid-run with no indication in the sheet — some rows remain PENDING without an error marker.
- **Fix:** Add a start-time check inside the outer loop and exit cleanly (with an audit log entry) if `(new Date() - start) > 300000` (5 minutes).

**[MINOR] NEW — No UrlFetchApp timeout configured for Claude API calls**
- `Pipeline.gs` line 566: `UrlFetchApp.fetch(…)` has no `timeout` option set.
- Default is 60 seconds, but a hung Claude response near the end of a batch could consume all remaining execution time.
- **Fix:** Add `timeout: 30` to the options object (alongside the existing `muteHttpExceptions: true`).

---

### 3. Quote_Intelligence.gs

**[MODERATE] ⚠️ REPEAT — GST calculation uses wrong field, ignores agent's actual selection**
- `buildQuoteLogRow()` line 119: `const gstPct = d.gst || 5`
- The frontend stores GST mode as `gstMode` (string: `'5pkg'`, `'18svc'`, `'none'`), not a numeric `d.gst` field.
- Every Quote_Log entry records 5% GST regardless of whether the agent selected 18% or no GST.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix (one line):**
  ```javascript
  const gstPct = d.gstMode === '18svc' ? 18 : d.gstMode === '5pkg' ? 5 : (Number(d.gst) || 0);
  ```

**[MODERATE] ⚠️ REPEAT — `logQuote()` has infinite recursion risk**
- `Quote_Intelligence.gs` line 36: if `Quote_Log` sheet is missing, `setupQuoteLog()` is called and then `logQuote()` is called again recursively.
- If `setupQuoteLog()` fails (quota exceeded, permissions error), the recursive call fails again → infinite loop until Apps Script stack overflow.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** Add a `retried` boolean parameter: `function logQuote(paxName, data, retried = false)` and replace the recursive call with `if (!retried) { setupQuoteLog(); return logQuote(paxName, data, true); }`.

**[MINOR] ⚠️ REPEAT — Quote ID collision possible**
- Line 140: `'Q-' + new Date().getTime().toString().slice(-8)` — two saves within the same millisecond produce identical IDs.
- **Fix:** `'Q-' + Date.now().toString().slice(-8) + '-' + Math.floor(Math.random() * 9000 + 1000)`

---

### 4. index_fit.tripstore.html

**[CRITICAL] ⚠️ REPEAT — Admin access grantable via DevTools without credentials**
- `checkAutoLogin()` line 641–651: reads `isAdmin` directly from `localStorage`.
- Any user can open DevTools console and run:
  ```javascript
  localStorage.setItem("tripstore_session", JSON.stringify({isAdmin:true, modeText:"ADMIN MODE"}));
  location.reload();
  ```
  This grants full admin panel access. Because `getAllSaved()` has no auth check server-side, the escalation is fully functional.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** Admin-gated actions must be re-validated server-side. The backend must verify username before serving `getAllSaved`.

**[MODERATE] ⚠️ REPEAT — `saveItinerary()` shows success toast even on server-side error**
- Line 720–721: `fetch()` resolves successfully even when Apps Script returns an error string. The toast always shows "Saved Successfully".
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:**
  ```javascript
  const result = await (await fetch(API_URL, { method: "POST", ... })).text();
  if (!result.includes("Successfully")) throw new Error(result);
  showToast("Saved Successfully");
  ```

**[MODERATE] ⚠️ REPEAT — No CSRF protection on POST endpoints**
- `signup` and `saveItinerary` accept POST with no origin check. Any external page can submit requests to the public Apps Script URL.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** Add a CSRF token in the payload (generated at page load, stored in sessionStorage, verified server-side).

**[MINOR] ⚠️ REPEAT — `BUDGET_RANGES` has no review date**
- Lines 782–784: `hotel: { low: 2500, high: 7500 }` — these figures will silently become stale.
- **Fix:** Add `// Last reviewed: April 2026` above the constant.

**[MINOR] ⚠️ REPEAT — No `maxlength` on `paxNameInput`**
- Line 129: `<input type="text" id="paxNameInput" …>` — a very long name could hit Google Sheets cell limits or break the JSON blob.
- **Fix:** Add `maxlength="100"` to the input.

---

### 5. write_to_sheets.py

**[MODERATE] ⚠️ REPEAT — Spreadsheet ID hardcoded in source**
- Line 28: `SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"`
- Production asset identifier committed to a repository.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** `SPREADSHEET_ID = os.environ["TRIPSTORE_SHEET_ID"]`

**[MODERATE] ⚠️ REPEAT — Empty-sheet detection is unreliable**
- Line 168: `ws.row_count == 0` — gspread's `row_count` returns the grid size (default 1000), never 0. The header row is never written for new sheets.
- **First flagged:** 2026-04-09. **Status: UNRESOLVED.**
- **Fix:** `sheet_is_empty = not ws.get_all_values()`

---

### 6. Files Requested But Not Found in Repo

| File | Status |
|------|--------|
| extract_itineraries.py | Not found |
| write_inputs_to_sheets.py | Not found |
| cleanup_sheet.py | Not found |
| clean_pipeline_data.py | Not found |
| cross_reference.py | Not found |
| enrich_hotels.py | Not found |
| enrich_hotels_booking.py | Not found |

These may exist locally but have never been committed. If they are part of the active pipeline, they should be committed to the repo.

---

## Prioritised Action Items

### Fix Immediately (CRITICAL — all 4 are repeat, unresolved since 2026-04-09)
1. **Login mismatch** — `doPost` in Code.gs must handle `checkLogin`. Until fixed, every login attempt on the live site fails.
2. **Admin escalation via localStorage** — Backend must re-verify admin status server-side before serving `getAllSaved`.
3. **Unauthenticated API endpoints** — `getAllSaved` and `searchItinerary` must require an auth token before returning data.
4. **Plain-text passwords** — Plan a hashed-storage migration.

### Fix This Week (MODERATE)
5. **GST calculation bug** in Quote_Intelligence.gs — one-line fix; all Quote_Log data since 2026-04-09 has incorrect GST amounts.
6. **EUR/INR rate** in Pipeline.gs — update `₹110/€` to `₹90/€` in trains enrichment prompt (two occurrences on lines 463 and 478).
7. **`saveItinerary` false success toast** — check response text before showing "Saved Successfully".
8. **`sheet_is_empty` bug** in write_to_sheets.py — header row never written for new sheets.
9. **Spreadsheet ID** — move to environment variable in write_to_sheets.py.
10. **`Array(n).fill({})` shared reference** in callClaudeAPI — use `Array.from` instead.

### Fix When Convenient (MINOR)
11. Add `logQuote` recursion guard (retried parameter).
12. Fix Quote ID collision risk (append random suffix).
13. Add `maxlength="100"` to paxNameInput.
14. Add review-date comment to `BUDGET_RANGES`.
15. Add `timeout: 30` to UrlFetchApp.fetch in callClaudeAPI.
16. Fix Transfers `notes`/`schedule` semantic mislabel in Code.gs.
17. Commit missing pipeline Python scripts or confirm they are intentionally excluded.

---

*Generated automatically by Claude on 2026-04-12*
