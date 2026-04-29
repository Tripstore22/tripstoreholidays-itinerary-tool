# TripStore Code Review Report
**Date:** 2026-04-29
**Reviewed by:** Claude (Automated Daily Review)
**Commit reviewed:** d64a756

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| MODERATE | 8 |
| MINOR    | 8 |

**Files in scope (present):** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py

**Files requested but NOT FOUND in this repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py — these may live in the separate `tripstore-itinerary-archive` folder on Sumit's Mac, not tracked here. Review those separately.

---

## CRITICAL Issues

### C-1 — Login is broken for new sessions (Code.gs + index_fit.tripstore.html)

**File:** `index_fit.tripstore.html` line ~583 | `Code.gs` lines 43–58

**Problem:** The frontend `checkLogin()` function sends credentials as a **POST** request:
```javascript
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But `doPost()` in Code.gs only handles `signup` and `saveItinerary`. The `checkLogin` action is handled in `doGet()` only (which reads from URL parameters). A POST with `action: "checkLogin"` falls through to:
```javascript
return ContentService.createTextOutput('Invalid action');
```
The frontend receives `"Invalid action"`, which doesn't match `"ADMIN"` or `"USER"`, so every new login attempt shows **"❌ Invalid Credentials"** even with correct credentials.

Existing users whose session is cached in `localStorage` are unaffected (they bypass the login call entirely via `checkAutoLogin()`), which is likely why this has gone undetected.

**Fix:** Add `checkLogin` handling to `doPost` in Code.gs:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### C-2 — Passwords stored in plaintext (Code.gs)

**File:** `Code.gs` lines 257–268, 289

**Problem:** Passwords are compared and stored as plain text in Google Sheets:
```javascript
const dbPass = String(data[i][1]).trim();
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) { ...
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...]);
```
Anyone with read access to the Users sheet (Sheet collaborators, Google Workspace admins, a compromised account) can see all user passwords in plain text.

**Fix:** Hash passwords before storing. Apps Script has `Utilities.computeDigest()`:
```javascript
function hashPassword(pass) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass);
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}
// Store: hashPassword(password.trim())
// Compare: dbPass === hashPassword(pass.trim())
```
Migrate existing rows by hashing them on first successful login.

---

### C-3 — GST always calculated at 5% in Quote Log regardless of user selection (Quote_Intelligence.gs)

**File:** `Quote_Intelligence.gs` line 119

**Problem:**
```javascript
const gstPct = d.gst || 5;
```
The frontend saves the GST setting as `gstMode` (string: `"5pkg"`, `"18svc"`, or `"none"`), not as `d.gst`. The field `d.gst` does not exist in saved payloads. So `d.gst` is always `undefined`, making `gstPct` always `5`. The Grand Total in the Quote Log is always inflated by 5% GST — even when the agent selected "No GST" or "18% Service Charge".

**Fix:**
```javascript
const gstMode = d.gstMode || (d.gst == 18 ? '18svc' : d.gst > 0 ? '5pkg' : 'none');
let gstPct = 0;
if (gstMode === '5pkg')  gstPct = 5;
if (gstMode === '18svc') gstPct = 18;
const gstBase = gstMode === '18svc' ? subTotal : markupAmt;
const gstAmt  = Math.round(gstBase * gstPct / 100);
```

---

## MODERATE Issues

### M-1 — setupSheets() inserts a duplicate banner row every time it is run (Pipeline.gs)

**File:** `Pipeline.gs` line 779

**Problem:**
```javascript
ws.insertRowBefore(2);
```
This always inserts a new row 2 before the existing row 2. If `setupSheets()` is run again (e.g., to add a new column to a tab), the banner row is inserted again, pushing all existing data rows down. Banner rows keep accumulating on each run.

**Fix:** Check whether row 2 already contains a banner before inserting:
```javascript
const existingBanner = ws.getRange(2, 1).getValue();
if (!String(existingBanner).startsWith('ℹ️')) {
  ws.insertRowBefore(2);
}
```

---

### M-2 — setupQuoteLog() silently destroys all Quote Log data when run again (Quote_Intelligence.gs)

**File:** `Quote_Intelligence.gs` line 196

**Problem:**
```javascript
ws.clear();
```
If an admin reruns `setupQuoteLog()` to refresh headers or formatting, all historical quote data is permanently deleted. No warning is shown.

**Fix:** Add a guard before clearing:
```javascript
const existingRows = ws.getLastRow();
if (existingRows > 1) {
  SpreadsheetApp.getUi().alert(
    'WARNING: Quote_Log has ' + (existingRows - 1) + ' existing quotes.\n' +
    'Running setup will DELETE all data. Archive the sheet first, then re-run.'
  );
  return;
}
```

---

### M-3 — Claude API error fallback uses shared object reference for all rows (Pipeline.gs)

**File:** `Pipeline.gs` lines 593–596

**Problem:**
```javascript
return Array(expectedCount).fill({
  valid: false,
  error_reason: `Claude API error: ${e.message}`,
});
```
`Array.fill` fills every slot with the **same object reference**. Mutating one error object (e.g., adding a retry timestamp) mutates all of them.

**Fix:**
```javascript
return Array.from({ length: expectedCount }, () => ({
  valid: false,
  error_reason: `Claude API error — will retry next run: ${e.message}`,
}));
```

---

### M-4 — Hotel cost back-calculation uses stale pricingFactor captured at render time (index_fit.tripstore.html)

**File:** `index_fit.tripstore.html` line ~1307

**Problem:** The hotel price override `onchange` handler embeds `config.pricingFactor` as a hardcoded literal in the HTML at render time:
```html
onchange="currentPlan[${planIdx}].hotel.cost = Number(this.value)/(${item.nights||1}*${config.pricingFactor}); calculateBudgetInvestment();"
```
If the user changes adult/child counts after the quote renders, this embedded factor is stale. The back-calculated per-night rate will be wrong, leading to incorrect totals on the next `calculateBudgetInvestment()` call.

**Fix:** Read the factor fresh at change time instead of embedding it:
```html
onchange="const _f=getTravelConfigs().pricingFactor; currentPlan[${planIdx}].hotel.cost = Number(this.value)/(${item.nights||1}*_f); calculateBudgetInvestment();"
```

---

### M-5 — localStorage sessions never expire (index_fit.tripstore.html)

**File:** `index_fit.tripstore.html` lines 641–652

**Problem:** The session object is stored in `localStorage` with no expiry. A user on a shared computer, or a user whose account is later deactivated, remains permanently logged in until they manually click Logout.

**Fix:** Save a `loginTime` and check it on auto-login:
```javascript
// On save:
const session = { isLoggedIn: true, isAdmin: ..., modeText: ..., loginTime: Date.now() };
// In checkAutoLogin:
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
if (!s.loginTime || Date.now() - s.loginTime > SESSION_TTL) {
  localStorage.removeItem("tripstore_session"); return;
}
```

---

### M-6 — USER_ENTERED can misformat structured data (write_to_sheets.py)

**File:** `write_to_sheets.py` line 196

**Problem:**
```python
ws.append_rows(new_rows, value_input_option="USER_ENTERED")
```
`USER_ENTERED` causes Sheets to interpret values as if a user typed them. Strings like `"3/4"` become dates; Indian number formats like `"1,00,000"` may be parsed unpredictably. Archive data should be written as-is.

**Fix:** Use `value_input_option="RAW"` for structured data rows. Only use `USER_ENTERED` when you specifically want Sheets to evaluate formulas or auto-type.

---

### M-7 — Cell parsers fail silently on unexpected formats (archive_to_input.py)

**File:** `archive_to_input.py` lines 63–171

**Problem:** `parse_hotels_cell`, `parse_sightseeing_cell`, `parse_trains_cell`, and `parse_transfers_cell` assume strict pipe-delimited formats with fixed field counts. If an archive cell has a hotel name containing `|`, or the pipeline that generated the archive used a slightly different separator, the city/name fields shift by one. Corrupted rows are silently inserted into the INPUT sheets with no warning.

**Fix:** Add a post-parse check for required fields before appending:
```python
for h in parse_hotels_cell(row.get("Hotels Used", "")):
    if not h["city"] or not h["name"]:
        print(f"  WARNING: skipped unparseable hotel entry")
        continue
    # ... rest of dedup logic
```

---

### M-8 — No rate limiting or lockout on login endpoint (Code.gs)

**File:** `Code.gs` lines 249–268

**Problem:** The login endpoint has no rate limiting and no lockout after repeated failures. An attacker who knows a valid username (e.g., `admin`) can brute-force passwords by sending repeated requests directly to the Apps Script URL.

**Short-term fix:** In `doPost`, track failed attempts per username in `PropertiesService` (temporary lockout after 5 failures in 5 minutes). In the frontend, disable the login button for 3 seconds after each failed attempt. Longer-term: consider moving to OAuth.

---

## MINOR Issues

### m-1 — Misleading comment: "Column N: Schedule" is the Notes field (Code.gs)

**File:** `Code.gs` line 203

```javascript
notes: String(r[13] || '').trim(), // Column N: Schedule
```
The schema comment at line 176 shows column N is "Notes", not "Schedule". Schedule is in a different column. Misleading when debugging.

---

### m-2 — Quote Log column mapping is fragile to schema changes (Code.gs)

**File:** `Code.gs` lines 382–413

`getQuoteLog()` maps columns by hard-coded index (`r[0]`, `r[1]`, etc.). If `setupQuoteLog()` ever adds or reorders a column, every field after the change will silently return the wrong value. Consider reading the header row and building a dynamic column-name-to-index map.

---

### m-3 — City names injected into innerHTML without escaping (index_fit.tripstore.html)

**File:** `index_fit.tripstore.html` line 686

```javascript
document.getElementById('cityList').innerHTML = cities.map(c => `<option value="${c}">`).join('');
```
City names from the Sheet are inserted directly into HTML. A name containing `"` or `>` would break the DOM. Use `textContent` or an escape helper instead.

---

### m-4 — City/date inputs not cleared after adding a stop (index_fit.tripstore.html)

**File:** `index_fit.tripstore.html` lines 828–837

After `addCityToRoute()` succeeds, the city input and date pickers still hold the previous values. A user who quickly clicks "+ Add Stop" twice will add the same city with the same dates twice. Clear inputs on successful add:
```javascript
document.getElementById('cityInput').value = '';
document.getElementById('checkinInput').value = '';
document.getElementById('checkoutInput').value = '';
```

---

### m-5 — gspread.authorize() is deprecated (write_to_sheets.py + archive_to_input.py)

**File:** `write_to_sheets.py` line 51 | `archive_to_input.py` line 310

`gspread.authorize(creds)` was deprecated in gspread ≥ 5.0. Use the newer pattern:
```python
client = gspread.Client(auth=creds)
```
Or use `gspread.service_account(filename=str(CREDENTIALS_PATH))` which handles auth internally.

---

### m-6 — No network retry logic on Google Sheets API calls (write_to_sheets.py + archive_to_input.py)

A transient 500, quota error, or network hiccup will crash the script with no recovery. Add a simple retry wrapper (3 attempts, exponential backoff 2s→4s→8s) around `append_rows()` and `get_all_values()`.

---

### m-7 — Pipeline batch size may hit Apps Script 6-minute execution limit (Pipeline.gs)

**File:** `Pipeline.gs` lines 41, 252

With `BATCH_SIZE: 5` and `sleep(1500)` per batch, processing 250 pending rows takes ~75 Claude API batches = ~112 seconds of sleep alone, plus API response time. On very large queues this risks hitting the 6-minute hard limit, leaving remaining rows PENDING with no indication of how far the run got. Consider increasing `BATCH_SIZE` to 10 and adding a time-check guard:
```javascript
if (new Date() - start > 300000) { // 5-minute safety limit
  auditLog(ss, 'TIME LIMIT: stopping early, remaining rows will process next run');
  break;
}
```

---

### m-8 — 7 requested files not found in this repository

The following files were requested for review but are **absent from this repo**:
- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

These are likely in the local `tripstore-itinerary-archive` folder on Sumit's Mac. They should be reviewed separately. Consider adding them to this repo (or a private repo) so they are version-controlled and reviewable.

---

## Action Items (Priority Order)

| # | Priority | File | Action |
|---|----------|------|--------|
| 1 | CRITICAL — today | Code.gs `doPost` | Add `checkLogin` handler — new logins are broken |
| 2 | CRITICAL — today | Quote_Intelligence.gs line 119 | Fix `d.gst` → `d.gstMode` so GST is calculated correctly |
| 3 | CRITICAL — near-term | Code.gs | Hash passwords before storing in Users sheet |
| 4 | MODERATE — next deploy | Pipeline.gs `setupSheets` | Guard against duplicate banner row insertion |
| 5 | MODERATE — next deploy | Quote_Intelligence.gs `setupQuoteLog` | Add confirmation guard before `ws.clear()` |
| 6 | MODERATE — next deploy | index_fit.tripstore.html | Fix stale `pricingFactor` in hotel cost override handler |
| 7 | MODERATE — next deploy | index_fit.tripstore.html | Add session TTL to localStorage auto-login |
| 8 | MODERATE — next run | write_to_sheets.py | Change `USER_ENTERED` to `RAW` |
| 9 | MINOR — backlog | archive_to_input.py | Add parse-failure warnings for malformed archive cells |
| 10 | MINOR — backlog | index_fit.tripstore.html | Escape city names before setting `innerHTML` |
| 11 | MINOR — backlog | Python files | Update `gspread.authorize()` to non-deprecated API |
| 12 | MINOR — backlog | All | Add the 7 missing pipeline files to version control |

---

*Generated automatically by Claude Code — 2026-04-29*
