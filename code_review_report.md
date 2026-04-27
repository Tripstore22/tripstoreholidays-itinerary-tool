# TripStore Code Review Report — 2026-04-27

**Reviewer:** Claude (automated daily review)
**Commit range:** last 10 commits (see git log below)
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py
**Files not found in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py (likely in separate archive folder on Sumit's Mac)

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2     |
| MODERATE | 5     |
| MINOR    | 7     |

**Total issues found: 14**

---

## CRITICAL

### 1. Login is broken for new/fresh sessions
**Files:** `Code.gs:25` · `index_fit.tripstore.html:583`

The frontend `checkLogin()` sends credentials as a **POST** request with a JSON body:
```js
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })
```
But `Code.gs` handles `"checkLogin"` only in `doGet()` (line 25) — expecting URL query parameters (`e.parameter.user`, `e.parameter.pass`). `doPost()` does **not** handle `"checkLogin"` and returns `"Invalid action"`.

The frontend receives `"Invalid action"`, which doesn't match `"ADMIN"` or `"USER"`, so it shows `"❌ Invalid Credentials"` to the user even with correct credentials.

**Why it hasn't been noticed:** `checkAutoLogin()` reads a saved `localStorage` session. Users who were already logged in on their current browser still work silently via that cache. Anyone on a new browser, new device, or who clears storage cannot log in at all.

**Fix — add to `doPost()` in Code.gs:**
```js
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### 2. Passwords stored and compared in plaintext
**File:** `Code.gs:261, 289`

```js
const dbPass = String(data[i][1]).trim();
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) { ... }
// ...
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...]);
```

Passwords are written to and read from the Google Sheet as plain text. Any admin with sheet access, any accidental share, or any API credential leak exposes every user's password.

**Fix:** Hash with a salt before storing. GAS provides `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt)`. At minimum, compare a SHA-256 hash instead of the raw string.

---

## MODERATE

### 3. Save / load endpoints have no authentication check
**File:** `Code.gs:43–57, 299–365`

`saveItinerary`, `searchItinerary`, and `getAllSaved` do not verify any session token. Anyone who discovers the `/exec` URL can:
- List all saved pax names
- Load any saved itinerary
- Overwrite any saved itinerary with arbitrary data

**Fix:** Require a session token sent in the POST body, validated server-side (e.g., against a token column in the Users sheet set at login).

---

### 4. Hardcoded EUR/INR exchange rate will drift stale
**File:** `Pipeline.gs:463`

```js
const prompt = `...INR price at ₹110/€...`
```

The Claude trains-enrichment prompt uses a fixed `₹110/€` rate for back-calculating INR from EUR. As of April 2026 this rate has likely moved. Every back-calculated INR price will be systematically wrong.

**Fix:** Store the rate in Script Properties (`EUROINR_RATE`) and interpolate it into the prompt at runtime so it can be updated without a code change.

---

### 5. `setupSheets()` inserts duplicate banner row on each run
**File:** `Pipeline.gs:779`

```js
ws.insertRowBefore(2);  // adds info banner row
```

Called unconditionally every time `setupSheets()` runs. A second run inserts another banner row above the first, pushing data rows to row 4+. `getPendingRows()` starts reading from row 3 (hardcoded), so data rows would be silently skipped after any re-run of setup.

**Fix:** Check row 2 for an existing banner before inserting:
```js
if (!ws.getRange(2, 1).getValue().toString().includes('ℹ️')) {
  ws.insertRowBefore(2);
}
```

---

### 6. XSS via `innerHTML` in hotel and sightseeing modals
**File:** `index_fit.tripstore.html:1829, 1940`

Hotel names, categories, and sightseeing tour names from `masterData` (loaded directly from Google Sheets) are interpolated into raw HTML strings:
```js
`<div ...>${h.name}</div>`
`<span ...>${s.category}</span>`
```
If a sheet editor enters `<img src=x onerror=alert(1)>` as a hotel name, it executes in the browser of every user who opens that city's modal. This is a stored XSS vulnerability.

**Fix:** Escape before inserting, e.g.:
```js
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```
Then use `${esc(h.name)}` in all modal templates.

---

### 7. GST calculation in Quote Log uses stale field name
**File:** `Quote_Intelligence.gs:119`

```js
const gstPct = d.gst || 5;
```

The itinerary payload now stores `gstMode` (values: `5pkg`, `18svc`, `none`), not a numeric `d.gst`. For all itineraries saved after the GST-mode change, `d.gst` is `undefined`, so `gstPct` defaults to 5. The logged `gstAmt` and `grandTotal` will be wrong for 18% or "no GST" quotes — affecting the Quote_Log dashboard accuracy.

**Fix:**
```js
const gstPct = d.gstMode === '18svc' ? 18 : d.gstMode === 'none' ? 0 : 5;
```

---

## MINOR

### 8. No rate limiting on login attempts
**File:** `Code.gs:249`

No lockout or throttle after repeated failed logins. An attacker who knows a valid username can brute-force the password with unlimited attempts. Since GAS endpoints are publicly reachable and there is no CAPTCHA, this is trivially exploitable.

---

### 9. Hardcoded Spreadsheet ID
**File:** `write_to_sheets.py:28`

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
```

If the sheet is ever recreated, the ID must be hand-edited in code. Move to an environment variable or a `.env` config file.

---

### 10. Credentials file path is hardcoded — verify it is gitignored
**File:** `write_to_sheets.py:30`

```python
CREDENTIALS_PATH = Path("./sheets-credentials.json")
```

If `sheets-credentials.json` (service account key) is accidentally committed to the repo, it exposes full Google Cloud access to anyone who can read the repo. Confirm this file is in `.gitignore`.

---

### 11. Quote ID collision risk
**File:** `Quote_Intelligence.gs:141`

```js
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```

Two saves within the same millisecond produce the same ID. Very unlikely but possible on a double-click Save. Add a random suffix:
```js
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8) + '-' + Math.random().toString(36).slice(2,5);
```

---

### 12. Dead code in sheet-empty check
**File:** `write_to_sheets.py:168`

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```

`ws.row_count` returns the sheet's grid capacity (e.g. 1000), never 0. The first condition is always false and is dead code. Only `not ws.get_all_values()` performs the real check.

---

### 13. Claude model ID may be outdated
**File:** `Pipeline.gs:39`

```js
MODEL: 'claude-haiku-4-5-20251001',
```

This was the latest Haiku model in late 2025. As of April 2026, newer Haiku models may be available with better accuracy and lower cost. Check Anthropic's model page for current IDs.

---

### 14. Seven archive pipeline scripts are not tracked in this repo
The following files referenced in session notes are absent from this repository (likely in a separate local folder on Sumit's Mac):
- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

These should be committed to a repo so they are not at risk of loss and can be included in future reviews.

---

## Action Items (Priority Order)

| # | Priority | Action |
|---|----------|--------|
| 1 | CRITICAL | Fix `doPost` in Code.gs to handle `action === 'checkLogin'` — login is currently broken for new sessions |
| 2 | CRITICAL | Hash passwords before storing in Users sheet |
| 3 | MODERATE | Add auth-token validation to save/search/getAllSaved endpoints |
| 4 | MODERATE | Fix GST logging in Quote_Intelligence.gs — read `gstMode` not `d.gst` |
| 5 | MODERATE | Make EUR/INR rate a Script Property instead of hardcoding ₹110/€ |
| 6 | MODERATE | Guard `setupSheets()` against double banner-row insertion |
| 7 | MODERATE | Escape HTML in all modal innerHTML templates to prevent stored XSS |
| 8 | MINOR | Move `SPREADSHEET_ID` to env var in write_to_sheets.py |
| 9 | MINOR | Verify `sheets-credentials.json` is in `.gitignore` |
| 10 | MINOR | Add random suffix to Quote ID generation |

---

*Generated automatically by Claude Code — 2026-04-27*
