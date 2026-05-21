# TripStore Code Review Report
**Date:** 2026-05-21
**Reviewed by:** Automated Daily Review
**Files reviewed:** Code.gs · Pipeline.gs · Quote_Intelligence.gs · index_fit.tripstore.html · write_to_sheets.py · archive_to_input.py
**Missing files (not in repo):** extract_itineraries.py · write_inputs_to_sheets.py · cleanup_sheet.py · clean_pipeline_data.py · cross_reference.py · enrich_hotels.py · enrich_hotels_booking.py

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 5 |
| 🟡 MODERATE | 14 |
| 🟢 MINOR | 7 |
| **Total** | **26** |

---

## 🔴 CRITICAL Issues

### C1 — Code.gs: Plaintext passwords stored in Google Sheets
**File:** `Code.gs:289`  
`sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...])` writes passwords as plain text into the Users sheet. Anyone with Viewer access to the spreadsheet can read every user's password immediately.  
**Fix:** Hash passwords before storage using `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` in Apps Script.

---

### C2 — Code.gs: Login credentials exposed via GET endpoint (URL parameters)
**File:** `Code.gs:25–28`  
`doGet` handles `action=checkLogin&user=X&pass=Y` as URL query parameters. Passwords appear in browser history, Apps Script execution logs, CDN access logs, and HTTP referrer headers in plaintext.  
**Fix:** Remove `checkLogin` from `doGet`. Handle it only in `doPost` so credentials travel in the POST body.

---

### C3 — index_fit.tripstore.html + Code.gs: Login POST handler missing — login is broken or repo is out of sync
**File:** `index_fit.tripstore.html:583`, `Code.gs:43–58`  
The frontend sends login as a POST request with `{ action: "checkLogin", user, pass }`. However, `doPost` in Code.gs only handles `signup` and `saveItinerary` — it returns `"Invalid action"` for any other action including checkLogin. Login should always fail unless the deployed script differs from what is in this repo.  
**Fix:** Add a `checkLogin` handler inside `doPost`:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.password || '');
}
```

---

### C4 — Quote_Intelligence.gs: `setupQuoteLog()` silently destroys all existing Quote_Log data
**File:** `Quote_Intelligence.gs:196`  
`ws.clear()` runs unconditionally. Re-running `setupQuoteLog()` from the Apps Script IDE permanently deletes all historical quote records with no confirmation prompt and no backup.  
**Fix:** Guard the clear: if the sheet already has more than 1 row of data, show an alert and abort rather than clearing.

---

### C5 — index_fit.tripstore.html: Unescaped Google Sheets data injected into innerHTML — XSS
**File:** `index_fit.tripstore.html` — 28 innerHTML assignment sites  
Hotel names, star ratings, city names, tour categories, and transfer descriptions from `masterData` are inserted via `innerHTML` template literals with no HTML escaping. Anyone with write access to the Google Sheet can inject `<img src=x onerror=alert(document.cookie)>` into any cell and it executes in every logged-in agent's browser.  
**Fix:** Create a helper `esc(str)` that replaces `<`, `>`, `"`, `'`, `&` with HTML entities, and use it on every value from `masterData` before inserting into innerHTML.

---

## 🟡 MODERATE Issues

### M1 — Code.gs: No authentication on save/load/admin APIs
**File:** `Code.gs:299–365`  
`saveItinerary`, `searchItinerary`, and `getAllSaved` require no login token. Anyone who knows the Apps Script `/exec` URL can read or overwrite any saved itinerary and list all client names.  
**Fix:** Issue a short-lived token during login, store it in ScriptProperties, and validate it on every save/load/admin call.

---

### M2 — Code.gs: No brute-force protection on login
**File:** `Code.gs:249–269`  
No rate limiting, lockout, or attempt counter. An attacker can try thousands of passwords per minute against any username.  
**Fix:** Track failed attempts per username in a ScriptProperties key. Lock the account for 15 minutes after 5 consecutive failures.

---

### M3 — Code.gs: No server-side input length validation
**File:** `Code.gs:276–291`  
`handleSignup()` and `saveItinerary()` accept unlimited-length strings directly into Sheets rows. A large payload could corrupt sheet structure or exceed Apps Script memory limits.  
**Fix:** Add length guards (e.g., `if (username.length > 50) return ContentService.createTextOutput('Input too long')`).

---

### M4 — Pipeline.gs: `setupSheets()` inserts a duplicate banner row on every run
**File:** `Pipeline.gs:778`  
`ws.insertRowBefore(2)` runs unconditionally. Running `setupSheets()` twice inserts a second (then third) info banner row, shifting all data rows down and corrupting the `statusColIndex` offset used by `getPendingRows`.  
**Fix:** Check if row 2 is already the banner before inserting; only insert if it does not start with `ℹ️`.

---

### M5 — Pipeline.gs: Claude response JSON parsing has no resilience
**File:** `Pipeline.gs:585–596`  
If Claude returns partial or malformed JSON (e.g., truncated at `MAX_TOKENS: 4096`), `JSON.parse(cleaned)` throws and the *entire batch* is marked as API error — not just the bad row. All valid rows in the batch are discarded and retried unnecessarily.  
**Fix:** Wrap `JSON.parse` in a try/catch at the batch level and return individual error results per row. Consider increasing `MAX_TOKENS` to 8192 for 5-row batches.

---

### M6 — Pipeline.gs: Apps Script 6-minute execution timeout risk
With `Utilities.sleep(1500)` between every batch plus multiple `getDataRange()` calls, large INPUT sheets will hit the 6-minute limit mid-run with no partial-save state — rows are left unprocessed without notification.  
**Fix:** Store the last-processed row index in a ScriptProperty and resume from there on the next trigger invocation.

---

### M7 — Pipeline.gs: `appendRow` in a loop instead of `appendRows`
**File:** `Pipeline.gs:242–244`  
`mst.appendRow(rowArr)` fires a separate Sheets API call per enriched row. For large batches this is slow and increases quota consumption.  
**Fix:** Collect all valid rows and call `mst.appendRows(allRows)` once per batch.

---

### M8 — Quote_Intelligence.gs: Infinite recursion risk in `logQuote`
**File:** `Quote_Intelligence.gs:29–37`  
If the Quote_Log sheet is missing, `logQuote` calls `setupQuoteLog()` then calls itself. If `setupQuoteLog()` fails (quota exceeded), the recursion continues until Apps Script's stack limit crashes the entire save operation.  
**Fix:** Add a retry guard: `function logQuote(paxName, data, retried = false)` — if `retried` is `true`, log the error and return without recursing.

---

### M9 — Quote_Intelligence.gs: GST mode field mismatch — all GST amounts in Quote_Log are wrong
**File:** `Quote_Intelligence.gs:119`  
`const gstPct = d.gst || 5` — the frontend saves `gstMode` as a string (`'5pkg'`, `'18svc'`, `'none'`), not a number. `d.gst` is always `undefined`, so this always applies 5% GST even when the agent selected 18% or No GST. All logged quote totals are incorrect.  
**Fix:**
```javascript
let gstPct = 0;
if (d.gstMode === '5pkg')  gstPct = 5;
if (d.gstMode === '18svc') gstPct = 18;
const gstAmt = Math.round(markupAmt * gstPct / 100);
```

---

### M10 — Quote_Intelligence.gs: `backfillQuoteLog()` creates duplicate rows if run more than once
**File:** `Quote_Intelligence.gs:278–308`  
No deduplication check against existing Quote_Log entries before importing. Running backfill a second time doubles every row.  
**Fix:** Build a set of existing paxName values from Quote_Log and skip any that already exist.

---

### M11 — Quote_Intelligence.gs: Quote ID collision risk
**File:** `Quote_Intelligence.gs:140`  
`'Q-' + new Date().getTime().toString().slice(-8)` keeps only the last 8 digits of a 13-digit millisecond timestamp. Two quotes created within ~2.7 hours share the same ID, breaking dashboard lookups.  
**Fix:** Use the full timestamp plus a random suffix: `` `Q-${Date.now()}-${Math.random().toString(36).slice(-4).toUpperCase()}` ``

---

### M12 — archive_to_input.py: Archived sightseeing items will always fail Pipeline enrichment
**File:** `archive_to_input.py:245–254`  
`make_sightseeing_row` writes the cost to index 5 (Avg Price column). But `enrichSightseeing` in Pipeline.gs validates that both `gyg_price` and `viator_price` are non-zero — Avg Price alone fails this check. Every archived sightseeing item will be marked ERROR by the pipeline and never added to the master sheet.  
**Fix:** Write the cost to index 6 (GYG Price) instead of (or in addition to) index 5.

---

### M13 — write_to_sheets.py / archive_to_input.py: Formula injection via `USER_ENTERED`
**File:** `write_to_sheets.py:196`, `archive_to_input.py:390`  
`append_rows(..., value_input_option="USER_ENTERED")` tells Sheets to interpret cell values as formulas. If any CSV field starts with `=`, `+`, or `-`, Sheets executes it as a formula.  
**Fix:** Use `value_input_option="RAW"` on all `append_rows` calls.

---

### M14 — write_to_sheets.py: `ws.row_count == 0` check is always False
**File:** `write_to_sheets.py:168`  
`ws.row_count` returns the configured max rows (default 1000), not the number of rows with data. The "empty sheet" branch is unreachable — the header row is never written to a brand-new sheet.  
**Fix:** Replace with `not ws.get_all_values()`.

---

## 🟢 MINOR Issues

### m1 — Pipeline.gs: Model frozen to dated version string
**File:** `Pipeline.gs:39`  
`MODEL: 'claude-haiku-4-5-20251001'` — when Anthropic retires this snapshot version, all enrichment will fail with a 404 overnight.  
**Fix:** Use the undated alias `claude-haiku-4-5` so routing follows the latest stable version automatically.

---

### m2 — Pipeline.gs: Blank-key rows silently dropped with no audit log entry
**File:** `Pipeline.gs:611`  
`if (!keyVal) continue` skips rows where City is blank, but nothing is written to AUDIT_LOG. These rows disappear without trace.

---

### m3 — Quote_Intelligence.gs: Budget fallthrough bug when `totalBudget === 0`
**File:** `Quote_Intelligence.gs:125–127`  
`(Number(d.totalBudget) || 0) || (...)` — JavaScript's falsy `0` causes the expression to fall through to summing component budgets when an agent explicitly enters ₹0 budget.  
**Fix:** `const budgetEntered = (d.totalBudget != null) ? Number(d.totalBudget) : (...)`

---

### m4 — index_fit.tripstore.html: Admin access bypass via localStorage manipulation
**File:** `index_fit.tripstore.html:641–652`  
`checkAutoLogin()` reads `isAdmin` from localStorage and grants admin access without re-validating with the server. Any user can run `localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true,isAdmin:true,modeText:"ADMIN MODE"}))` in the browser console to get admin UI access.  
**Fix:** Re-validate the session role against the backend on auto-login, or use a signed server token rather than a client-settable flag.

---

### m5 — index_fit.tripstore.html: Session never expires
`localStorage.setItem("tripstore_session", ...)` stores no expiry timestamp. An agent on a shared computer stays permanently logged in.  
**Fix:** Store `loginAt` and reject sessions older than 8 hours in `checkAutoLogin()`.

---

### m6 — write_to_sheets.py / archive_to_input.py: Credentials file not in `.gitignore`
**File:** `write_to_sheets.py:32`, `archive_to_input.py:34`  
`CREDENTIALS_PATH = Path("./sheets-credentials.json")`. This file is not listed in `.gitignore`. Accidental `git add -A` would commit the service account key to version control permanently.  
**Fix:** Add `sheets-credentials.json` to `.gitignore` immediately.

---

### m7 — archive_to_input.py: Transfer city extraction regex is brittle
**File:** `archive_to_input.py:153–162`  
The regex splits on keywords including `city`, `central`, `hotel`. Hotel names like "Hotel City Inn" or "Amsterdam City Centre Hotel" produce empty or wrong city values, causing Pipeline.gs to assign the wrong IATA code or mark rows ERROR.

---

## Action Items (Priority Order)

| # | File | Issue | Severity |
|---|------|-------|----------|
| 1 | Code.gs | Hash passwords before storing | CRITICAL |
| 2 | Code.gs | Add `checkLogin` to `doPost`; remove from `doGet` | CRITICAL |
| 3 | index_fit.tripstore.html | Sanitise all 28 innerHTML insertions with `esc()` helper | CRITICAL |
| 4 | Quote_Intelligence.gs | Add retry guard to `logQuote` to prevent infinite recursion | CRITICAL |
| 5 | Quote_Intelligence.gs | Guard `setupQuoteLog()` — never clear existing data | CRITICAL |
| 6 | Quote_Intelligence.gs | Fix GST mode field mismatch (`gstMode` string vs number) | MODERATE |
| 7 | archive_to_input.py | Write archive cost to GYG Price column (index 6) not Avg Price | MODERATE |
| 8 | write_to_sheets.py & archive_to_input.py | Change `USER_ENTERED` to `RAW` | MODERATE |
| 9 | write_to_sheets.py | Fix `ws.row_count == 0` → `not ws.get_all_values()` | MODERATE |
| 10 | write_to_sheets.py & archive_to_input.py | Add `sheets-credentials.json` to `.gitignore` | MINOR |
| 11 | Pipeline.gs | Add execution-time guard for 6-minute timeout | MODERATE |
| 12 | Pipeline.gs | Wrap Claude JSON parse per-row; log raw response on failure | MODERATE |
| 13 | Pipeline.gs | Fix `setupSheets()` duplicate banner row | MODERATE |
| 14 | Pipeline.gs | Switch to undated model alias `claude-haiku-4-5` | MINOR |
| 15 | Code.gs | Add server-side input length validation | MODERATE |

---

*Report generated automatically by daily code review job — 2026-05-21*
