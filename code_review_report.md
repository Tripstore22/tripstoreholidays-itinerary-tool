# TripStore Code Review Report
**Date:** 2026-04-10  
**Reviewer:** Claude (Automated Daily Review)  
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Files requested but NOT FOUND in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 3     |
| MODERATE  | 10    |
| MINOR     | 8     |
| **TOTAL** | **21** |

---

## CRITICAL Issues

---

### [CRITICAL-1] Login action mismatch — logins likely broken in production
**File:** `index_fit.tripstore.html` (line 583) + `Code.gs` (lines 43–58)

The frontend sends `checkLogin` as a **POST** request with JSON body:
```js
await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But `Code.gs doPost()` only handles `signup` and `saveItinerary`. It does **not** handle `checkLogin`. The `doGet()` handles `checkLogin`, but reads credentials from URL query parameters (`e.parameter.user`, `e.parameter.pass`), not from a POST body.

**Result:** Every login attempt returns "Invalid action" from the server → UI shows "Invalid Credentials" even for correct passwords.

**Likely cause:** The "Fix security issues" commit (a105e1d) changed the frontend fetch from GET to POST (correct security practice) but `Code.gs doPost()` was never updated to match.

**Fix:** Add this to `doPost()` in Code.gs, before the `return 'Invalid action'` line:
```js
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### [CRITICAL-2] Plaintext password storage and comparison
**File:** `Code.gs` (lines 261, 289)

Passwords are stored as plain text in the Google Sheets `Users` tab and compared directly:
```js
// Signup:
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...]);
// Login:
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) {
```
Anyone with view access to the Google Sheet (co-admins, accidental share) can read all user passwords.

**Fix:** Hash passwords with SHA-256 before storing. In Apps Script:
```js
function hashPassword(pass) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass);
  return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
```
Store and compare the hash. Force a password reset for all existing users.

---

### [CRITICAL-3] localStorage session bypass — admin privilege escalation
**File:** `index_fit.tripstore.html` (lines 641–652)

`checkAutoLogin()` trusts `isAdmin` from localStorage without server re-validation:
```js
const s = JSON.parse(saved);
isAdmin = s.isAdmin;  // no server check
launchApp(s.modeText);
```
Any user can run in browser DevTools:
```js
localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:"ADMIN MODE"}))
```
Then reload to get full admin access (list and load any user's saved itinerary).

**Fix:** On auto-login, re-call the server to verify credentials/role before granting admin. Or: store only a server-issued token in localStorage, not the role itself.

---

## MODERATE Issues

---

### [MODERATE-1] Unauthenticated itinerary access
**File:** `Code.gs` (lines 321–335) + `index_fit.tripstore.html` (line 733)

`getAllSaved` and `searchItinerary` are open GET endpoints — no authentication required. The Apps Script URL is hardcoded in the frontend HTML (publicly visible). Anyone can:
```
GET .../exec?action=getAllSaved          → list all pax names
GET .../exec?action=search&name=<name>  → load any itinerary
```
This exposes client travel plans, pricing, and budget data.

**Fix:** Require a `token` parameter (a per-agent session key stored server-side after login) on all data endpoints.

---

### [MODERATE-2] Pipeline execution timeout risk — rows silently stuck as PENDING
**File:** `Pipeline.gs` (lines 146–161)

`runMidnightEnrichment()` processes all 4 sheet types synchronously. Google Apps Script enforces a **6-minute execution limit** for triggers. With large backlogs, the run times out silently — rows stay PENDING forever with no error flag.

**Fix:** Add a time-budget check inside the processing loop:
```js
const start = new Date();
// ... before each batch:
if (new Date() - start > 300000) {  // 5 min safety cutoff
  auditLog(ss, 'TIMEOUT SAFETY CUT — resuming next run');
  break;
}
```

---

### [MODERATE-3] Claude API response shorter than batch — rows silently dropped
**File:** `Pipeline.gs` (lines 227–249)

If Claude returns fewer results than `expectedCount` (token limit truncation), the extra batch rows stay PENDING with no error flag and no audit entry. The `if (!row) return` guard only skips `undefined` entries on the results side — it does not detect missing results for input rows.

**Fix:** After the results loop, check:
```js
if (results.length < batch.length) {
  batch.slice(results.length).forEach(row => {
    markRow(inp, row.rowIndex, CFG.STATUS.ERROR, 'Claude response truncated — retry next run', cfg.col);
    stats.errors++;
  });
}
```

---

### [MODERATE-4] Hardcoded model name will break silently when deprecated
**File:** `Pipeline.gs` (line 39)

```js
MODEL: 'claude-haiku-4-5-20251001',
```
When this model version is retired, API calls will fail. Because `callClaudeAPI` catches all errors and returns "will retry next run", this will fail every night silently without alerting.

**Fix:** Use the non-dated alias `claude-haiku-4-5` for automatic version following, or add a startup model-validation ping that fails loudly (email alert) if the model is unavailable.

---

### [MODERATE-5] No login rate limiting — brute-force possible
**File:** `Code.gs` (lines 249–269)

`checkLogin` does a full sheet scan on every call with no lockout. A bot can try thousands of passwords per minute against any username.

**Fix:** Log the last 5 failure timestamps per username in a `Login_Log` sheet. If 5+ failures in 10 minutes, return a "Too many attempts — try later" response without checking the password.

---

### [MODERATE-6] Spreadsheet ID hardcoded in Python scripts
**File:** `write_to_sheets.py` (line 28), `archive_to_input.py` (line 32)

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
```
Real Sheet ID committed to the repo. If the repo goes public or is leaked, the Sheet is discoverable and targetable.

**Fix:**
```python
import os
SPREADSHEET_ID = os.environ["TRIPSTORE_SHEET_ID"]
```
Also verify `sheets-credentials.json` is in `.gitignore` and has **never** been committed.

---

### [MODERATE-7] Formula injection via USER_ENTERED
**File:** `write_to_sheets.py` (line 196), `archive_to_input.py` (line 390)

Both use `value_input_option="USER_ENTERED"` when appending rows. Any cell starting with `=`, `+`, `-`, or `@` will be executed as a Google Sheets formula.

**Fix:** Use `value_input_option="RAW"` for all data append calls.

---

### [MODERATE-8] GST in Quote_Log calculated on markup only — tax reporting incorrect
**File:** `Quote_Intelligence.gs` (lines 119–121)

```js
const gstAmt = Math.round(markupAmt * gstPct / 100);
```
Indian 5% GST on a travel package is typically applied to the full package value, not just the margin. This under-reports GST in every Quote_Log entry.

**Fix:** Confirm the correct GST base with your CA. If 5% of full package: `Math.round(subTotal * gstPct / 100)`. Also ensure the Quote_Log formula matches what `calculateBudgetInvestment()` computes in the frontend.

---

### [MODERATE-9] XSS via unescaped sheet data injected into innerHTML
**File:** `index_fit.tripstore.html` (renderTables sections)

Hotel names, tour names, and notes from the Google Sheet are injected directly into `innerHTML`. If a Sheet row contains `<img src=x onerror=alert(1)>`, it executes when the page renders.

**Fix:** Replace `innerHTML` assignments for sheet-sourced strings with `textContent`, or sanitize with `DOMPurify` before insertion.

---

### [MODERATE-10] No session expiry — shared computers stay logged in forever
**File:** `index_fit.tripstore.html` (line 588)

`localStorage.setItem("tripstore_session", ...)` never expires. On a shared agency computer, any colleague who opens the browser is auto-logged in as the previous user.

**Fix:** Store `loginTime: Date.now()` in the session object. In `checkAutoLogin()`, reject sessions older than 8 hours:
```js
if (Date.now() - s.loginTime > 8 * 60 * 60 * 1000) {
  localStorage.removeItem("tripstore_session");
  return;
}
```

---

## MINOR Issues

---

### [MINOR-1] Hardcoded column indices — silent breakage if columns shift
**File:** `Code.gs` (line 99, 154, 185)

`r[18]` for Annual Avg, `r[10]` for Attraction Tags, etc. If a column is inserted in the Sheet, wrong data is read silently.

**Fix:** Read the header row and build a name→index map, or add a bold comment: "DO NOT INSERT COLUMNS — column indices are hardcoded in Code.gs".

---

### [MINOR-2] logQuote recursive retry without guard
**File:** `Quote_Intelligence.gs` (lines 33–37)

If `setupQuoteLog()` runs but the sheet isn't returned immediately, `logQuote` calls itself recursively. Low risk in practice (Apps Script flushes synchronously), but add a depth guard:
```js
function logQuote(paxName, data, _retried = false) {
  if (!logSheet) {
    if (_retried) { Logger.log('Quote log: sheet still missing after setup'); return; }
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
}
```

---

### [MINOR-3] buildMasterKey comment/logic mismatch
**File:** `Pipeline.gs` (lines 276–280)

Comment says `// Master: col1=City, col2=Hotel Name` but the return is `row[1]|row[0]` (Name first). Confusing for future maintainers. No functional bug since both master and input keys are built consistently, but fix the comment.

---

### [MINOR-4] Quote ID collision risk
**File:** `Quote_Intelligence.gs` (line 140)

```js
'Q-' + new Date().getTime().toString().slice(-8)
```
Two quotes created in the same millisecond get the same ID. Low probability in practice.

**Fix:** `'Q-' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 5).toUpperCase()`

---

### [MINOR-5] parse_hotels_cell silently drops partial groups
**File:** `archive_to_input.py` (line 70)

`range(0, len(parts) - 3, 4)` silently skips any trailing tokens that don't form a complete 4-field hotel entry. No warning is logged.

**Fix:** After the loop: `if len(parts) % 4 != 0: print(f"WARNING: partial hotel group in cell (tokens={len(parts)})")`

---

### [MINOR-6] PENDING rows not protected against double-processing on timeout
**File:** `Pipeline.gs` (Section 4)

If the pipeline times out mid-run (see MODERATE-2), rows already fetched but not yet written to master stay PENDING. On the next run, they are sent to Claude again and appended to master a second time — creating duplicate master entries.

**Fix:** Mark rows as `PROCESSING` immediately when dequeued, and only process `PENDING` rows (not `PROCESSING`) in subsequent runs. Reset `PROCESSING` rows after 24 hours if they haven't advanced.

---

### [MINOR-7] Missing Content-Type header on all POST requests
**File:** `index_fit.tripstore.html` (lines 583, 612, 720)

All `fetch` POST calls omit `Content-Type: application/json`. Apps Script currently handles this, but it is incorrect per HTTP spec and could break with intermediary changes.

**Fix:** Add `headers: { "Content-Type": "application/json" }` to every POST fetch call.

---

### [MINOR-8] getVehicleCount returns 0 for 0 paxCount
**File:** `index_fit.tripstore.html` (line 447)

`Math.ceil(0 / 3) = 0` vehicles — produces a ₹0 transfer cost with no error. `getTravelConfigs()` enforces `adults >= 1` so this shouldn't trigger, but `getVehicleCount` doesn't validate independently.

**Fix:** Return `Math.max(1, Math.ceil(paxCount / 3))` as a floor.

---

## Missing Files (Not in Repo)

These 7 files were requested for review but do not exist in the repository. They may be on the local machine only:

| File | Status |
|------|--------|
| extract_itineraries.py | NOT IN REPO |
| write_inputs_to_sheets.py | NOT IN REPO |
| cleanup_sheet.py | NOT IN REPO |
| clean_pipeline_data.py | NOT IN REPO |
| cross_reference.py | NOT IN REPO |
| enrich_hotels.py | NOT IN REPO |
| enrich_hotels_booking.py | NOT IN REPO |

**Action required:** Commit these scripts to the repo so they are version-controlled and can be reviewed.

---

## Action Items — Priority Order

| # | Issue | Effort |
|---|-------|--------|
| 1 | **CRITICAL-1**: Add `checkLogin` to `doPost()` in Code.gs — login is broken | 5 min |
| 2 | **CRITICAL-3**: Remove `isAdmin` from localStorage; re-verify on auto-login | 30 min |
| 3 | **CRITICAL-2**: Hash passwords before storing (plan migration carefully) | 2 hrs |
| 4 | **MODERATE-1**: Add token auth to `search` + `getAllSaved` endpoints | 1 hr |
| 5 | **MODERATE-7**: Change `USER_ENTERED` → `RAW` in Python scripts | 5 min |
| 6 | **MODERATE-6**: Move Spreadsheet ID to environment variable | 15 min |
| 7 | **MODERATE-2**: Add execution timeout guard to pipeline | 15 min |
| 8 | **MODERATE-9**: Sanitize sheet data before DOM injection | 30 min |
| 9 | **MODERATE-10**: Add 8-hour session expiry | 15 min |
| 10 | **MINOR-7**: Add Content-Type headers to POST fetches | 10 min |
| — | Commit all 7 missing Python scripts to repo | — |

---

*Auto-generated by Claude Code daily review — 2026-04-10*
