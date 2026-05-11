# TripStore Code Review Report
**Date:** 2026-05-11
**Reviewer:** Claude (Automated Daily Review)
**Branch:** v2
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py

> **Files requested but NOT found in repo:**
> extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py
> These may exist locally on your machine but have not been committed to GitHub. They cannot be reviewed until pushed.

---

## SUMMARY

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 5 |
| 🟠 MODERATE | 10 |
| 🟡 MINOR | 12 |

> **New findings 2026-05-11 (added to Minor section below):** N8–N12 are new today.

---

## 🔴 CRITICAL ISSUES

### [C1] Code.gs + index_fit.tripstore.html — Login action mismatch: login is broken in current repo code

**File:** `Code.gs` (line 43–58) + `index_fit.tripstore.html` (line 583)

The HTML sends login credentials via HTTP **POST** with `action: "checkLogin"` in the JSON body:
```javascript
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```

But `doPost()` in Code.gs only handles `"signup"` and `"saveItinerary"`. The `checkLogin` handler exists only in `doGet()` (reading from URL query parameters). Any login attempt via the current frontend would receive `"Invalid action"` from the server and show `"❌ Invalid Credentials"`.

**If the live site is working, the deployed Apps Script is a different version from the one in this repo.** The repo version is out of sync with production. If Code.gs is ever redeployed from the repo, login will stop working immediately.

**Fix:** Add a `checkLogin` case to `doPost()`:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### [C2] Code.gs — Passwords stored in plain text in Google Sheets

**File:** `Code.gs` (lines 261, 289)

Both `checkLogin()` and `handleSignup()` compare and store passwords as plain strings in the "Users" sheet. Anyone with read access to the Google Sheet (admin, support staff, accidental share) can see every user's password.

**Fix:** Hash passwords with SHA-256 before storing. Apps Script has `Utilities.computeDigest()` for this:
```javascript
function hashPass(p) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, p)
    .map(b => ('0'+(b & 0xff).toString(16)).slice(-2)).join('');
}
```

---

### [C3] index_fit.tripstore.html — Admin privilege escalation via localStorage

**File:** `index_fit.tripstore.html` (lines 641–653)

`checkAutoLogin()` restores the session from `localStorage` including `isAdmin = s.isAdmin`. Any user can open the browser console and type:
```javascript
localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:"ADMIN MODE"}))
```
then reload to gain full admin access with no server verification whatsoever.

**Fix:** Never derive admin status from localStorage. Re-verify role with the server on every page load, or issue a signed server-side token that the client cannot forge.

---

### [C4] Code.gs — doGet exposes login credentials in URL

**File:** `Code.gs` (line 26–27)

The `doGet` handler accepts `?action=checkLogin&user=X&pass=Y`. GET parameters appear in:
- Google's server-side request logs
- Browser history
- Any proxy or corporate network logs

Even with HTTPS, credentials in query strings are logged at the server level.

**Fix:** Remove the `checkLogin` branch from `doGet` entirely. Login must only be accepted via POST with credentials in the request body.

---

### [C5] index_fit.tripstore.html — XSS via unescaped innerHTML from spreadsheet data

**File:** `index_fit.tripstore.html` (`renderTables()` ~line 1285, `applyTransferFilters()` ~line 1604, `filterIntercityModal()` ~line 1714)

Data from Google Sheets (hotel names, city names, from/to fields) is injected directly into `innerHTML` without escaping:
```javascript
hHtml += `...<td class="font-bold">${item.city}</td>...`
```
If a hotel name or city in the spreadsheet contains `<img src=x onerror=alert(1)>`, it executes in every agent's browser — and the attacker only needs write access to the spreadsheet.

**Fix:** Add an escape helper and use it everywhere spreadsheet data enters the DOM:
```javascript
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
```

---

## 🟠 MODERATE ISSUES

### [M1] Code.gs — No authentication on data-retrieval endpoints

**File:** `Code.gs` (lines 29–34, 299–334)

`getAllSaved`, `searchItinerary`, `getQuoteLog`, and `saveItinerary` are all accessible with zero credentials. Anyone who knows the Apps Script URL can list all pax names, load any saved itinerary, read the full quote log, or overwrite any itinerary.

**Fix:** Add a shared API secret to Script Properties and require it as a header or parameter on all non-public endpoints.

---

### [M2] Quote_Intelligence.gs — GST field mismatch: always logs 5% regardless of user selection

**File:** `Quote_Intelligence.gs` (line 119)

```javascript
const gstPct = d.gst || 5;
```

The HTML saves `gstMode` (a string: `"5pkg"`, `"18svc"`, or `"none"`), not `d.gst` (a number). Since `d.gst` is always `undefined` in new saves, `gstPct` always defaults to 5. The Quote_Log always shows 5% GST regardless of what the agent actually selected — "No GST" and "18% service charge" quotes are both logged incorrectly.

**Fix:**
```javascript
const gstModeStr = d.gstMode || 'none';
const isServiceCharge = gstModeStr === '18svc';
const gstPct  = gstModeStr === '5pkg' ? 5 : (isServiceCharge ? 18 : 0);
const gstBase = isServiceCharge ? markupAmt : (netTotal + markupAmt);
const gstAmt  = Math.round(gstBase * gstPct / 100);
```

---

### [M3] Pipeline.gs — EUR/INR exchange rate is hardcoded and stale (₹110/€)

**File:** `Pipeline.gs` (line 463)

```javascript
`INR price at ₹110/€.`
```

The EUR/INR rate was around ₹110 in 2022–2023. As of May 2026 the actual rate is approximately ₹92–95/€. Train and intercity prices back-calculated from EUR will be ~15–18% overquoted, leading to agents presenting inflated intercity costs to clients.

**Fix:** Store the rate in Script Properties (`EUR_INR_RATE`) and pull it at runtime:
```javascript
const eurRate = Number(PropertiesService.getScriptProperties().getProperty('EUR_INR_RATE')) || 93;
```

---

### [M4] Pipeline.gs — `_buildInputSheet` corrupts sheets on repeated runs

**File:** `Pipeline.gs` (line 779)

```javascript
ws.insertRowBefore(2);
```

This inserts a new info banner row every single time `setupSheets()` is run. Running it twice leaves two banner rows at row 2–3, pushing all data rows down by 1. `getPendingRows()` starts reading from row 3 (index 2), so the first data row becomes invisible to the pipeline.

**Fix:** Check row 2 before inserting:
```javascript
const r2 = ws.getRange(2, 1).getValue();
if (!r2 || !String(r2).startsWith('ℹ️')) ws.insertRowBefore(2);
```

---

### [M5] Pipeline.gs — Claude API response count mismatch silently drops rows

**File:** `Pipeline.gs` (lines 228–249)

```javascript
results.forEach((res, idx) => {
  const row = batch[idx];
  if (!row) return;
```

If Claude returns fewer results than the batch size (JSON truncation, token limit hit), rows beyond the last result silently go unprocessed — not PROCESSED, not ERROR, still PENDING. They are re-sent to Claude every night forever, wasting API quota.

**Fix:** After the forEach, detect and mark orphan rows:
```javascript
if (results.length < batch.length) {
  batch.slice(results.length).forEach(row => {
    markRow(inp, row.rowIndex, CFG.STATUS.ERROR, 'Claude returned fewer results than expected', cfg.col);
    stats.errors++;
  });
}
```

---

### [M6] Quote_Intelligence.gs — Infinite recursion risk in logQuote

**File:** `Quote_Intelligence.gs` (lines 33–37)

```javascript
if (!logSheet) {
  setupQuoteLog();
  return logQuote(paxName, data); // recursive — no depth guard
}
```

If `setupQuoteLog()` fails silently (quota exceeded, permissions issue), the sheet won't exist after setup and `logQuote` recurses infinitely, crashing `saveItinerary` and losing the user's save.

**Fix:**
```javascript
function logQuote(paxName, data, _retrying = false) {
  const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Quote_Log');
  if (!logSheet) {
    if (_retrying) { Logger.log('Quote_Log missing after setup — logging skipped'); return; }
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
  ...
}
```

---

### [M7] index_fit.tripstore.html — Session never expires

**File:** `index_fit.tripstore.html` (lines 641–653)

`localStorage.setItem("tripstore_session", ...)` has no TTL. An agent who uses a shared device (office PC, travel fair laptop) and forgets to log out stays permanently authenticated — forever.

**Fix:** Store `loginTime: Date.now()` in the session object and reject sessions older than 24 hours in `checkAutoLogin()`.

---

### [M8] write_to_sheets.py + archive_to_input.py — Hardcoded Spreadsheet ID in source code

**File:** `write_to_sheets.py` (line 27), `archive_to_input.py` (line 32)

`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is committed to the repo. If this repo is ever made public (even briefly), the sheet ID is exposed. The credentials file path is also hardcoded.

**Fix:**
```python
import os
SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID", "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM")
CREDENTIALS_PATH = Path(os.environ.get("GOOGLE_CREDENTIALS", "./sheets-credentials.json"))
```

---

### [M9] index_fit.tripstore.html — autoSaveThenDo silently swallows all errors before export

**File:** `index_fit.tripstore.html` (lines 2288–2294)

```javascript
} catch(e) { /* silent — don't block the export */ }
```

If the auto-save before PDF or Excel export fails (network error, API down, quota exceeded), the user gets no warning. They may assume the quote was saved when it wasn't, leading to lost data.

**Fix:** Show a non-blocking warning toast if auto-save fails, then proceed with export:
```javascript
} catch(e) { showToast("⚠️ Auto-save failed — export continuing", "error"); }
```

---

### [M10] index_fit.tripstore.html — Hotel cost manual override accumulates floating-point error

**File:** `index_fit.tripstore.html` (line 1307)

```javascript
onchange="currentPlan[${planIdx}].hotel.cost = Number(this.value)/(${item.nights||1}*${config.pricingFactor}); ..."
```

`config.pricingFactor` is a floating-point number (e.g., `1.5` for 3 adults in 1 room). Storing an unrounded per-night rate and then re-multiplying in `calculateHotelPrice()` causes ₹1–₹5 drift in the grand total per city.

**Fix:** Round the stored cost to the nearest rupee:
```javascript
currentPlan[${planIdx}].hotel.cost = Math.round(Number(this.value)/(${item.nights||1}*${config.pricingFactor}));
```

---

## 🟡 MINOR ISSUES

### [N1] Pipeline.gs — Model ID could become stale when Anthropic retires it

**File:** `Pipeline.gs` (line 39)

`MODEL: 'claude-haiku-4-5-20251001'` is hardcoded. When this version is retired, the pipeline fails at runtime with an opaque API error and no overnight enrichment runs until manually fixed.

**Fix:** Move to Script Properties: `CLAUDE_MODEL = claude-haiku-4-5-20251001`.

---

### [N2] Pipeline.gs — No per-call timeout on UrlFetchApp

**File:** `Pipeline.gs` (line 566)

No `deadline` option is set. If Claude's API is slow (>30s per call) and the batch is 5 rows × 4 sheet types, total call time can exceed the 6-minute Apps Script execution limit, leaving some sheets half-processed with no audit log entry.

**Fix:** Add `deadline: 30` to the UrlFetchApp options object.

---

### [N3] Quote_Intelligence.gs — Quote ID collision window is narrow

**File:** `Quote_Intelligence.gs` (line 141)

```javascript
'Q-' + new Date().getTime().toString().slice(-8)
```

The last 8 digits of epoch-ms wrap every ~27 hours. Two quotes saved in the same millisecond get identical IDs. Low probability but makes Quote_Log queries ambiguous for analytics.

**Fix:** `'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()`

---

### [N4] index_fit.tripstore.html — formatDate renders "Invalid Date" on bad strings

**File:** `index_fit.tripstore.html` (line 2028)

```javascript
function formatDate(d) {
  if (!d) return '---';
  return new Date(d).toLocaleDateString('en-GB', ...);
}
```

A non-empty but malformed date string (e.g., corrupted localStorage) passes the `!d` check and produces "Invalid Date" visible in the PDF header and tables.

**Fix:** `if (!d || isNaN(new Date(d).getTime())) return '---';`

---

### [N5] archive_to_input.py — No retry on Google Sheets API calls

**File:** `archive_to_input.py` (lines 313–319, 390)

All `get_all_values()` and `append_rows()` calls are single-attempt with no retry. A transient Google quota error (HTTP 429) crashes the entire import with zero rows written.

**Fix:** Use `tenacity` or a simple backoff loop around Sheet API calls.

---

### [N6] Code.gs — Error responses expose raw internal error messages to clients

**File:** `Code.gs` (lines 39, 57)

```javascript
return ContentService.createTextOutput('Server Error: ' + err.message);
```

Raw exception messages (including sheet names, column indices, Apps Script internals) are returned to the browser. These can help an attacker map backend structure.

**Fix:** Return a generic message, log details server-side: `Logger.log(err.stack); return ContentService.createTextOutput('Server Error');`

---

### [N7] index_fit.tripstore.html — API URL hardcoded in frontend source

**File:** `index_fit.tripstore.html` (line 426)

Every new Apps Script deployment generates a new `/exec` URL. Updating it requires manually editing the HTML and re-pushing. Easily missed after a Code.gs redeployment.

**Fix:** Document this as a required step in a comment directly above the API_URL line, and include the date it was last updated.

---

### [N8] Code.gs — `getHotels` silently drops hotels with zero or blank annual average

**File:** `Code.gs` (line 100)

```javascript
if (annualAvg <= 0) continue;
```

Hotels where pricing was never filled are silently excluded from the app with no log entry. A data-entry operator who leaves prices blank will not see any error — the hotel simply disappears from the optimizer.

**Fix:** Add `Logger.log('Skipping hotel with no price: ' + r[1])` when skipping, or write to an ERRORS_LOG sheet entry so data-quality gaps surface automatically.

---

### [N9] Code.gs — `getIntercity` response omits seasonal Euro price columns

**File:** `Code.gs` (lines 229–239)

The Trains sheet stores seasonal Euro prices in columns 6–10 (May€, Aug€, Oct€, Dec€, Avg€), but `getIntercity()` only returns `price` (the INR column). If any downstream report or future frontend feature references `may_e`, `aug_e` etc., it will get `undefined` silently.

**Fix:** Include the Euro columns in the returned object:
```javascript
intercity.push({ ..., may_e: parsePrice(r[6]), aug_e: parsePrice(r[7]), oct_e: parsePrice(r[8]), dec_e: parsePrice(r[9]), avg_e: parsePrice(r[10]) });
```

---

### [N10] Pipeline.gs — Fixed 1,500 ms sleep between Claude batches does not scale

**File:** `Pipeline.gs` (line 252)

`Utilities.sleep(1500)` is a fixed delay with no awareness of actual token usage or rate-limit headers. With large hotel prompts, a single batch can consume 4,000–6,000 tokens. Under high load, sustained calls may still trigger 429 errors with no backoff.

**Fix:** Increase to 3,000 ms as a minimum viable fix. Ideal fix: parse the `retry-after` header from any 429 response and sleep that duration before retrying.

---

### [N11] write_to_sheets.py — `ws.row_count == 0` is dead code

**File:** `write_to_sheets.py` (line 168)

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```

`gspread.Worksheet.row_count` returns the sheet's allocated row count (default 1,000), never 0. The first condition is always False.

**Fix:** `sheet_is_empty = not ws.get_all_values()`

---

### [N12] archive_to_input.py — Pipe character inside a hotel name breaks the 4-token stride

**File:** `archive_to_input.py` (lines 70–76)

`parse_hotels_cell` splits on `|` and steps in groups of 4. If any hotel name contains a `|` (e.g. "Radisson Blu | Hotel"), the stride goes out of phase and all subsequent hotels in that cell are mis-parsed — wrong city matched to wrong name — silently queued to INPUT_Hotels.

**Fix:** Validate that `parts[i+2]` matches the nights pattern (`r'^\d+N$'`) before treating the group as a hotel record. Skip with a warning if not.

---

## MISSING FILES (Cannot Be Reviewed)

The following 7 files were requested for review but are **not present in the GitHub repo**:

- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

These are likely in a local folder on your Mac. Run `git add <file> && git commit && git push origin v2` for each to include them in future reviews.

---

## PRIORITY ACTION ITEMS

| # | Action | File | Severity |
|---|--------|------|----------|
| 1 | Add `checkLogin` to `doPost()` — fixes broken login in repo code | Code.gs | 🔴 |
| 2 | Hash passwords before storing in Users sheet | Code.gs | 🔴 |
| 3 | Remove client-controlled `isAdmin` from localStorage | index_fit.tripstore.html | 🔴 |
| 4 | Remove `checkLogin` from `doGet()` | Code.gs | 🔴 |
| 5 | Add HTML-escape helper for all spreadsheet data in innerHTML | index_fit.tripstore.html | 🔴 |
| 6 | Fix GST field mismatch — read `gstMode` not `gst` in Quote_Intelligence | Quote_Intelligence.gs | 🟠 |
| 7 | Update EUR/INR rate from ₹110 to ~₹93 in Pipeline prompt | Pipeline.gs | 🟠 |
| 8 | Guard `_buildInputSheet` against inserting duplicate banner row | Pipeline.gs | 🟠 |
| 9 | Mark orphan batch rows as ERROR when Claude returns fewer results | Pipeline.gs | 🟠 |
| 10 | Add recursion guard to `logQuote` | Quote_Intelligence.gs | 🟠 |
| 11 | Add 24-hour session expiry to `checkAutoLogin` | index_fit.tripstore.html | 🟠 |
| 12 | Move Spreadsheet ID to environment variable in Python scripts | write_to_sheets.py, archive_to_input.py | 🟠 |
| 13 | Show warning toast if auto-save fails before export | index_fit.tripstore.html | 🟠 |
| 14 | Commit the 7 missing Python files to the repo | local machine | 🟠 |

---

*Generated automatically by Claude Code — TripStore Daily Review*
*Next review: 2026-05-12*
