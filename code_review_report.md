# TripStore Code Review Report
**Date:** 2026-04-08
**Reviewed by:** Automated Daily Review (Claude)
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py

**Files requested but NOT found in repo:**
- extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py
- These appear to live on a local machine only. Consider adding them to the repo for tracking.

**Recent git commits (last 10):**
- fdd2f17 Sync main with v2: fix budget hints (inline style)
- 07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
- d74b3bd Remove CNAME from main
- e6a35d9 Merge v2 into main
- f3b87ad Sync index.html with index_fit.tripstore.html
- a105e1d Fix security issues and add budget suggestion hints

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3     |
| MODERATE | 6     |
| MINOR    | 5     |
| **Total**| **14**|

---

## CRITICAL Issues

---

### C1 — Login is Broken for Users Without a Cached Session
**File:** `index_fit.tripstore.html` line 583 + `Code.gs` lines 25-27

**The bug:** The frontend sends login credentials via `POST` with a JSON body:
```javascript
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })
```
But `doPost()` in `Code.gs` only handles `signup` and `saveItinerary`. It does **not** handle `"checkLogin"` — it returns `"Invalid action"` for that case. The backend only handles `checkLogin` in `doGet()` using URL query parameters (`e.parameter.user`, `e.parameter.pass`).

**Impact:** Every login attempt via the form will display "❌ Invalid Credentials" regardless of correct password. Only users who already have a valid session stored in `localStorage` (from a previous login) can access the app. New users and users who've cleared their browser data are permanently locked out.

**Fix:** Either update `doPost()` to handle `"checkLogin"`:
```javascript
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```
OR change the frontend to send login as a GET request with URL parameters (less secure — see C2).

---

### C2 — Passwords Stored in Plain Text in Google Sheet
**File:** `Code.gs` lines 261, 289

**The bug:** `handleSignup()` stores the user's password as a raw string:
```javascript
sheet.appendRow([username.trim(), password.trim(), 'PENDING', ...])
```
`checkLogin()` compares passwords directly:
```javascript
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim())
```

**Impact:** Anyone with view access to the `Users` tab in the Google Sheet — including any collaborator, or if the sheet is accidentally shared — can see every user's password. Passwords also appear in Apps Script execution logs. If users reuse passwords on other services, those accounts are at risk.

**Fix:** Hash passwords before storing. A minimal improvement using SHA-256 via Apps Script:
```javascript
function hashPass(pass) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass);
  return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
```
Store `hashPass(password.trim())` and compare `hashPass(pass.trim())` at login.

---

### C3 — Admin Privilege Escalation via localStorage Manipulation
**File:** `index_fit.tripstore.html` lines 641-652, 626-633

**The bug:** The session is stored in localStorage as:
```javascript
localStorage.setItem("tripstore_session", JSON.stringify({
  isLoggedIn: true, isAdmin: false, modeText: "USER MODE"
}))
```
On page reload, `checkAutoLogin()` trusts this stored value completely — no re-validation with the server:
```javascript
const s = JSON.parse(saved);
isAdmin = s.isAdmin;
launchApp(s.modeText);  // grants admin UI if isAdmin=true
```

**Impact:** Any logged-in user can open DevTools → Application → Local Storage → change `isAdmin` to `true` → reload the page → gain full Admin Panel access, including the ability to load any saved itinerary by name.

**Fix:** The session should store only a server-issued token. On auto-login, re-verify the token with the backend before granting access. Alternatively, the server should check a session token on every admin action rather than trusting client-side state.

---

## MODERATE Issues

---

### M1 — No Auth on `getAllSaved()` and `searchItinerary()` — Anyone Can Read All Itineraries
**File:** `Code.gs` lines 299-314, 321-335

**The bug:** Both functions are accessible via GET with no authentication check:
- `?action=getAllSaved` — returns all pax names ever saved
- `?action=search&name=XYZ` — returns the full itinerary JSON for any pax name

Anyone who has the API URL (which is hardcoded in the HTML file, so visible to anyone who views source) can enumerate all saved client names and read their complete itineraries.

**Fix:** Require a session token parameter on these requests, verify it server-side against the Users sheet before returning data.

---

### M2 — Duplicate Quote_Log Entries on Every Re-Save
**File:** `Quote_Intelligence.gs` lines 29-47; `Code.gs` lines 356, 362-364

**The bug:** `logQuote(paxName, payload)` is called from `saveItinerary()` on **both** new saves and updates:
```javascript
// Update path:
sheet.getRange(i + 1, 2).setValue(payloadStr);
sheet.getRange(i + 1, 3).setValue(now);
logQuote(paxName, payload);    // ← logs again

// New record path:
sheet.appendRow([paxName.trim(), payloadStr, now]);
logQuote(paxName, payload);    // ← logs again
```
Every time a user refines and re-saves an itinerary, a new row is added to `Quote_Log`. A quote saved 10 times generates 10 log entries with 10 different Quote IDs.

**Impact:** Quote_Log data (conversion rates, budget analysis) is inflated and unreliable.

**Fix:** On updates, only log if key financial figures changed, or log only once per `paxName` (skip logging if the name already exists in Quote_Log and the grand total hasn't changed significantly).

---

### M3 — GST Amount in Quote_Log Always Wrong for New Itineraries
**File:** `Quote_Intelligence.gs` lines 116-121

**The bug:** GST is calculated as:
```javascript
const gstPct = d.gst || 5;
const gstAmt = Math.round(markupAmt * gstPct / 100);
```
But the frontend now saves `d.gstMode` (values: `"5pkg"`, `"18svc"`, `"none"`) — not `d.gst`. The field `d.gst` is never set by the frontend. So `d.gst` is always `undefined`, and `gstPct` always defaults to `5`.

**Impact:**
- If user selected `18svc` mode: Quote_Log records 5% GST instead of 18%
- If user selected `none` mode: Quote_Log records 5% GST instead of 0
- Grand total in Quote_Log will be wrong in both these cases

**Fix:** Read and interpret `d.gstMode`:
```javascript
const gstModeMap = { '5pkg': 5, '18svc': 18, 'none': 0 };
const gstPct = gstModeMap[d.gstMode] ?? d.gst ?? 5;
const gstBase = d.gstMode === '5pkg' ? subTotal + markupAmt : markupAmt;
const gstAmt  = Math.round(gstBase * gstPct / 100);
```

---

### M4 — Execution Timeout Risk in Pipeline with Large Queues
**File:** `Pipeline.gs` lines 224-253

**The bug:** `Utilities.sleep(1500)` is called between every batch of 5 rows. With even 50 pending rows (10 batches), that's 15 seconds of sleep alone — before Claude API latency. A 100-row queue (20 batches) + 3-5s Claude response time per batch = ~90-120 seconds, approaching the 6-minute hard limit.

**Impact:** If execution times out, rows already-written to the master sheet but not yet marked PROCESSED in the INPUT sheet will be re-processed next run, creating **duplicate master rows**.

**Fix:** Add a time-guard around the inner batch loop:
```javascript
const SAFE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const start = Date.now();
for (let i = 0; i < toEnrich.length; i += CFG.BATCH_SIZE) {
  if (Date.now() - start > SAFE_TIMEOUT_MS) {
    auditLog(ss, `TIMEOUT GUARD: stopping at row ${i}. Remaining rows will process next run.`);
    break;
  }
  // ... rest of loop
}
```

---

### M5 — `write_to_sheets.py`: No Error Handling for API Rate Limits
**File:** `write_to_sheets.py` line 196

**The bug:** `ws.append_rows(new_rows, ...)` is called as a single batch with no error handling for `gspread.exceptions.APIError`. Google Sheets API has a rate limit of 300 requests per minute per project. A large CSV append can trigger quota errors, causing the entire script to crash with a Python traceback and partial data written.

**Fix:**
```python
import time
try:
    ws.append_rows(new_rows, value_input_option="USER_ENTERED")
except gspread.exceptions.APIError as e:
    if "RESOURCE_EXHAUSTED" in str(e):
        print("Rate limit hit — waiting 60s then retrying")
        time.sleep(60)
        ws.append_rows(new_rows, value_input_option="USER_ENTERED")
    else:
        raise
```

---

### M6 — `archive_to_input.py`: `gspread.authorize()` is Deprecated
**File:** `archive_to_input.py` line 309; `write_to_sheets.py` line 50

**The bug:** Both scripts use `gspread.authorize(creds)` which has been deprecated since gspread v5 and **removed** in gspread v6. Running either script with a recent gspread installation will raise `AttributeError: module 'gspread' has no attribute 'authorize'`.

**Fix:** Replace in both files:
```python
# OLD (broken in gspread >= 6):
client = gspread.authorize(creds)

# NEW:
client = gspread.Client(auth=creds)
```
Or use the convenience method:
```python
client = gspread.service_account(filename=str(CREDENTIALS_PATH))
```

---

## MINOR Issues

---

### N1 — Quote ID Collision Risk
**File:** `Quote_Intelligence.gs` line 140

`'Q-' + new Date().getTime().toString().slice(-8)` uses only the last 8 digits of a Unix millisecond timestamp. These 8 digits repeat every ~11.57 days (10^8 ms ÷ 86,400,000 ms/day). Two itineraries saved within the same millisecond (or exactly 11.57 days apart) will share the same Quote ID. Use `.toString(36)` for a more unique ID, or use `.getTime().toString()` in full.

---

### N2 — `transferBudget` Field Missing from Saved Payload
**File:** `Quote_Intelligence.gs` line 126; `index_fit.tripstore.html` line 700-717

`buildQuoteLogRow()` sums `d.hotelBudget + d.sightBudget + d.transferBudget` for `budgetEntered`. But the frontend save payload never includes `transferBudget` — only `hotelBudget` and `sightBudget`. `d.transferBudget` is always `undefined` (treated as 0). The `budgetEntered` value in Quote_Log will be lower than what the agent actually had in mind, making `utilPct` appear inflated.

---

### N3 — Hardcoded Column Index for Annual Avg in `getHotels()`
**File:** `Code.gs` line 99

`const annualAvg = parsePrice(r[18])` — column index 18 (0-based) is hardcoded with a comment saying "Column S = Annual Avg (INR)". If a column is ever inserted or deleted in the Hotels sheet, this silently reads the wrong column with no error. Consider reading the header row once to find the correct column index by name.

---

### N4 — Unescaped City Names Injected into HTML
**File:** `index_fit.tripstore.html` line 686

```javascript
document.getElementById('cityList').innerHTML = cities.map(c => `<option value="${c}">`).join('');
```
City names from the Google Sheet are injected as raw HTML attribute values without escaping. A city name containing `"` or `>` (e.g. from a data entry error) would break the datalist HTML or could create an XSS vector if the sheet is ever compromised. Use `document.createElement('option')` with `.value` assignment instead.

---

### N5 — `BUDGET_RANGES` Hardcoded in Frontend
**File:** `index_fit.tripstore.html` lines 782-784

```javascript
const BUDGET_RANGES = {
    hotel: { low: 2500, high: 7500 },  // ₹/room/night
    land:  { low: 1200, high: 2800 }   // ₹/pax/night
};
```
These budget suggestion thresholds are baked into the HTML. Adjusting them requires a code change and GitHub push. Consider storing them as a named range in the Google Sheet (e.g. "Config" tab) and reading them via `getData()`, so non-technical users can update them without a deployment.

---

## Action Items Summary

| # | Priority | File | Action |
|---|----------|------|--------|
| C1 | 🔴 CRITICAL | Code.gs | Add `checkLogin` handler inside `doPost()` — login is broken for new sessions |
| C2 | 🔴 CRITICAL | Code.gs | Hash passwords before storing (SHA-256 minimum) |
| C3 | 🔴 CRITICAL | index_fit.tripstore.html | Replace localStorage role-trust with server-side token re-validation |
| M1 | 🟠 MODERATE | Code.gs | Add auth token check to `getAllSaved()` and `searchItinerary()` |
| M2 | 🟠 MODERATE | Quote_Intelligence.gs | Deduplicate Quote_Log — only log on first save, not every update |
| M3 | 🟠 MODERATE | Quote_Intelligence.gs | Read `d.gstMode` to calculate correct GST in quote log |
| M4 | 🟠 MODERATE | Pipeline.gs | Add time-guard in batch loop to prevent timeout + duplicate master rows |
| M5 | 🟠 MODERATE | write_to_sheets.py | Add `APIError` exception handling with retry for rate limits |
| M6 | 🟠 MODERATE | archive_to_input.py + write_to_sheets.py | Replace deprecated `gspread.authorize()` with `gspread.Client(auth=creds)` |
| N1 | 🟡 MINOR | Quote_Intelligence.gs | Use full timestamp or UUID for Quote ID to avoid collisions |
| N2 | 🟡 MINOR | Quote_Intelligence.gs | Remove `transferBudget` from `budgetEntered` sum or add it to the save payload |
| N3 | 🟡 MINOR | Code.gs | Replace hardcoded column index `18` in `getHotels()` with header lookup |
| N4 | 🟡 MINOR | index_fit.tripstore.html | Use `createElement` for datalist options — don't inject city names as raw HTML |
| N5 | 🟡 MINOR | index_fit.tripstore.html | Move `BUDGET_RANGES` to Google Sheet Config tab so they can be updated without a deploy |

---

*Generated: 2026-04-08 | TripStore Automated Code Review*
