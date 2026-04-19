# TripStore Daily Code Review — 2026-04-19

**Reviewed by:** Claude (automated)
**Branch:** v2
**Last commit:** c11f1ee — Auto: daily code review

---

## Files Reviewed

| File | Status |
|------|--------|
| Code.gs | ✅ Reviewed |
| Pipeline.gs | ✅ Reviewed |
| Quote_Intelligence.gs | ✅ Reviewed |
| index_fit.tripstore.html | ✅ Reviewed |
| write_to_sheets.py | ✅ Reviewed |
| archive_to_input.py | ✅ Reviewed |
| extract_itineraries.py | ❌ Not found in repo |
| write_inputs_to_sheets.py | ❌ Not found in repo |
| cleanup_sheet.py | ❌ Not found in repo |
| clean_pipeline_data.py | ❌ Not found in repo |
| cross_reference.py | ❌ Not found in repo |
| enrich_hotels.py | ❌ Not found in repo |
| enrich_hotels_booking.py | ❌ Not found in repo |

> The 7 missing Python files are likely in a separate local repository (tripstore-itinerary-archive) and are not tracked in this GitHub repo.

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 4 |
| 🟠 MODERATE | 8 |
| 🟡 MINOR | 6 |

---

## 🔴 CRITICAL Issues

### C1 — `Code.gs`: Passwords stored and compared in plain text
**File:** `Code.gs` — `checkLogin()` (line 249), `handleSignup()` (line 276)

Passwords are stored as raw text in the Google Sheet "Users" tab and compared character-for-character. Any person with sheet edit access — or who steals a sheet export — instantly has all agent passwords.

**Fix:** Hash passwords client-side with SHA-256 before sending, and store only the hash in the sheet. Compare hashes only.

---

### C2 — `Code.gs`: `saveItinerary` has zero authentication
**File:** `Code.gs` — `saveItinerary()` (line 342), `doPost()` (line 43)

Any external HTTP POST to the API with `action: "saveItinerary"` and any `paxName` can overwrite or inject a saved itinerary. There is no session token, no login check, and no rate limiting. A bad actor can corrupt or delete every saved itinerary.

**Fix:** Require a signed token or secret in every POST. In the simplest form, include the logged-in user's password hash as a verification field and validate it before writing.

---

### C3 — `index_fit.tripstore.html`: Auth bypass via `localStorage`
**File:** `index_fit.tripstore.html` — `checkAutoLogin()` (line 641)

On page load, the app reads `tripstore_session` from localStorage and immediately grants full access — including admin — without any server-side re-verification. Opening DevTools and running:
```js
localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true, isAdmin:true, modeText:"ADMIN MODE"}))
```
…then reloading the page gives anyone full admin access with no credentials.

**Fix:** On auto-login, re-verify with the server (call `checkLogin` with stored credentials, or use a short-lived server-issued session token). Never trust client-side state for access control.

---

### C4 — `Code.gs` + `index_fit.tripstore.html`: Login action routing mismatch
**File:** `Code.gs` `doPost()` (line 43) vs `index_fit.tripstore.html` (line 583)

The HTML sends login as a **POST** request:
```js
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })
```
But `doPost()` in Code.gs only handles `signup` and `saveItinerary`. The `checkLogin` function is wired in `doGet()` (URL parameters). A POST with `action: "checkLogin"` returns `"Invalid action"` — meaning login may be broken in the current code (relies on a separately-deployed Apps Script version).

**Fix:** Move `checkLogin` handling into `doPost` to accept JSON body credentials, then redeploy. This also avoids passwords appearing in URL query parameters or server logs.

---

## 🟠 MODERATE Issues

### M1 — `Pipeline.gs`: Claude JSON response parsing is brittle
**File:** `Pipeline.gs` — `callClaudeAPI()` (line 587)

```js
const cleaned = text.replace(/```json|```/g, '').trim();
```
Only strips lowercase ` ```json ` and ` ``` `. Claude sometimes returns ` ```JSON ` (uppercase), extra whitespace, or variation in fencing. Any mismatch throws a JSON parse error and marks all rows in the batch as ERROR.

**Fix:**
```js
const cleaned = text.replace(/```[a-zA-Z]*\n?/g, '').trim();
```
Also wrap `JSON.parse(cleaned)` in a try/catch that returns individual error objects per row rather than failing the whole batch.

---

### M2 — `Pipeline.gs`: No `max_tokens` truncation detection
**File:** `Pipeline.gs` — `callClaudeAPI()` (line 564), `CFG.MAX_TOKENS = 4096`

A batch of 5 complex rows with long prompts can exceed 4096 output tokens, silently truncating the JSON mid-array. The partial JSON throws a parse error and all 5 rows are marked ERROR. There is no detection, no automatic reduction of batch size, and no retry.

**Fix:** Check `responseData.stop_reason === 'max_tokens'` and retry the batch with `BATCH_SIZE = 1`. Consider increasing `MAX_TOKENS` to 8192.

---

### M3 — `Pipeline.gs`: Undefined rows written to master sheet on unexpected Claude responses
**File:** `Pipeline.gs` — `processSheet()` (line 239)

```js
const masterRows = Array.isArray(res.rows) ? res.rows : [res.row];
```
If Claude returns a valid JSON object but with neither a `rows` nor a `row` key, this evaluates to `[undefined]`. The call to `mst.appendRow([undefined])` writes a corrupt blank row to the master sheet with no way to detect or remove it automatically.

**Fix:** Add a guard before appending:
```js
if (!res.row && !res.rows) { /* mark as error and continue */ return; }
```

---

### M4 — `Pipeline.gs`: `setupSheets()` inserts duplicate banner rows on each re-run
**File:** `Pipeline.gs` — `_buildInputSheet()` (line 779)

```js
ws.insertRowBefore(2);
```
This inserts a new row unconditionally every time `setupSheets()` is called. Running setup twice pushes all data down by one row per call, breaking column alignment and duplicating the info banner.

**Fix:** Check if row 2 is already a merged info banner cell before inserting; only insert on a truly new sheet.

---

### M5 — `Quote_Intelligence.gs`: Infinite recursion risk in `logQuote()`
**File:** `Quote_Intelligence.gs` — `logQuote()` (line 29)

```js
if (!logSheet) {
    setupQuoteLog();
    return logQuote(paxName, data); // unlimited recursion if setup fails
}
```
If `setupQuoteLog()` silently fails (quota exceeded, permission error) and the sheet is still not created, `logQuote()` calls itself infinitely and crashes Apps Script with a stack overflow — also breaking the originating `saveItinerary()` call.

**Fix:** After calling `setupQuoteLog()`, re-fetch the sheet into a local variable and return early if still null, rather than recursing.

---

### M6 — `write_to_sheets.py` + `archive_to_input.py`: Spreadsheet ID hardcoded in public repo
**Files:** `write_to_sheets.py` (line 28), `archive_to_input.py` (line 32)

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
```
This ID is committed to a public GitHub repository. Combined with the service account credentials file (`./sheets-credentials.json`) that must exist locally to run these scripts, it makes the attack surface clearly visible to anyone viewing the repo.

**Fix:** Load from environment variable: `SPREADSHEET_ID = os.environ.get("TRIPSTORE_SHEET_ID")`. Add a `.env.example` and ensure `sheets-credentials.json` is in `.gitignore`.

---

### M7 — `Code.gs`: `getAllSaved` returns full client list without authentication
**File:** `Code.gs` — `getAllSaved()` (line 299)

A public GET to `?action=getAllSaved` returns a JSON list of every client/pax name ever saved — no login required. This leaks the full customer list to anyone with the API URL (which is hardcoded in the public HTML file).

**Fix:** Require an admin token parameter or move to `doPost` with credential verification.

---

### M8 — `Code.gs`: `searchItinerary` returns full itinerary payload without authentication
**File:** `Code.gs` — `searchItinerary()` (line 321)

A public GET to `?action=search&name=<paxName>` returns the full saved itinerary for any matching name — all pricing, hotels, destinations. Combined with the name list from M7, all client itinerary data is publicly readable without login.

**Fix:** Same as M7 — require authentication before returning itinerary data.

---

## 🟡 MINOR Issues

### N1 — `Code.gs`: Server error messages expose internal details
**File:** `Code.gs` — `doGet()` (line 39), `doPost()` (line 57)

```js
return ContentService.createTextOutput('Server Error: ' + err.message);
```
Raw error messages (sheet names, column counts, variable names) are returned to any caller.

**Fix:** Return a generic `"An error occurred"` to the client; log the full error via `Logger.log(err)`.

---

### N2 — `Pipeline.gs`: `Object.values()` does not guarantee column order
**File:** `Pipeline.gs` — `processSheet()` (line 242)

If Claude returns an object instead of an array, `Object.values()` returns values in key-insertion order, which may not match the expected column order in the master sheet, silently writing data into the wrong columns.

**Fix:** Log a warning and mark the row as ERROR rather than guessing the column order.

---

### N3 — `Quote_Intelligence.gs`: Quote ID collision risk
**File:** `Quote_Intelligence.gs` — `buildQuoteLogRow()` (line 140)

```js
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```
Only the last 8 digits of a Unix timestamp are used, cycling every ~2.7 days. Multiple saves within the same millisecond share identical Quote IDs.

**Fix:**
```js
const quoteId = 'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
```

---

### N4 — `Quote_Intelligence.gs`: Deprecated `substr()` usage
**File:** `Quote_Intelligence.gs` — `_titleCase()` (line 315)

`String.prototype.substr()` is deprecated. **Fix:** Replace `t.substr(1)` with `t.substring(1)`.

---

### N5 — `archive_to_input.py`: Transfer city extraction uses hardcoded IATA codes
**File:** `archive_to_input.py` — `parse_transfers_cell()` (line 155)

The regex for city extraction contains a hardcoded list (cdg, lhr, ams, fra, vie, bcn, fco). New European cities not in this list produce garbled city names in INPUT_Transfers.

**Fix:** Extend with common codes: muc, mad, zrh, ath, cph, dub, lis, bru, hel, arn, osl, waw, prg, bud.

---

### N6 — `index_fit.tripstore.html`: No `maxlength` on login fields
**File:** `index_fit.tripstore.html` — login inputs (lines 73–74)

No character limit on username/password fields. Very large inputs could trigger Apps Script execution time limits.

**Fix:** Add `maxlength="100"` to both input fields.

---

## Action Items (Priority Order)

| # | Issue | Severity | File |
|---|-------|----------|------|
| 1 | Verify login on live site; move checkLogin to doPost and redeploy | 🔴 CRITICAL | Code.gs + HTML |
| 2 | Add server re-verification on auto-login; remove localStorage-only trust | 🔴 CRITICAL | index_fit.tripstore.html |
| 3 | Implement client-side password hashing before sending/storing | 🔴 CRITICAL | Code.gs + HTML |
| 4 | Add authentication check to saveItinerary | 🔴 CRITICAL | Code.gs |
| 5 | Add auth to getAllSaved and searchItinerary endpoints | 🟠 MODERATE | Code.gs |
| 6 | Fix infinite recursion in logQuote() | 🟠 MODERATE | Quote_Intelligence.gs |
| 7 | Harden Claude JSON parsing; detect max_tokens truncation | 🟠 MODERATE | Pipeline.gs |
| 8 | Guard against undefined rows before appending to master sheets | 🟠 MODERATE | Pipeline.gs |
| 9 | Move SPREADSHEET_ID to environment variable | 🟠 MODERATE | write_to_sheets.py, archive_to_input.py |
| 10 | Fix Quote ID collision risk | 🟡 MINOR | Quote_Intelligence.gs |
| 11 | Extend IATA code list in transfer city parser | 🟡 MINOR | archive_to_input.py |
| 12 | Add maxlength to login inputs | 🟡 MINOR | index_fit.tripstore.html |

---

*7 files listed in the review request were not found in this repository and could not be reviewed. They should be reviewed from the separate pipeline/archive repository.*
