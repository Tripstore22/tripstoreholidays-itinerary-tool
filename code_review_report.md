# TripStore Code Review — 2026-06-04

**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Files requested but not found in repo:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py  
**Total issues:** 2 CRITICAL · 9 MODERATE · 8 MINOR

---

## CRITICAL

### C1 — Login POST/GET mismatch (Code.gs + index_fit.tripstore.html)
**File:** `index_fit.tripstore.html` line ~582 · `Code.gs` line ~25  
The frontend sends login credentials as a **POST** request with a JSON body:
```js
fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```
But `doPost()` in Code.gs **only handles `signup` and `saveItinerary`** — there is no `checkLogin` case. The backend's `checkLogin` action lives in `doGet()` and reads from URL query parameters (`e.parameter.user`, `e.parameter.pass`), not from the POST body.

Result: every login attempt returns "Invalid action" from the server, which the frontend displays as "Invalid Credentials." Existing users are unaffected because `checkAutoLogin()` restores sessions from `localStorage`, masking the bug. New users or anyone who clears browser storage **cannot log in**.

**Fix:** Add `checkLogin` to `doPost()` reading from the JSON body, or change the frontend to send login as a GET request with URL parameters. POST + JSON body is safer.

---

### C2 — Passwords stored in plain text (Code.gs)
**File:** `Code.gs` lines ~289, ~260  
```js
sheet.appendRow([username, password.trim(), 'PENDING', ...]);   // signup
if (dbPass === pass.trim()) { ... }                               // login check
```
Passwords are written to and read from Google Sheets as plain text. Anyone with spreadsheet editor access (or a leaked `sheets-credentials.json`) can read every user's password.

**Fix:** Hash passwords before storing. Since Apps Script has no native bcrypt, a practical minimum is SHA-256 via `Utilities.computeDigest()` with a per-user salt stored in a separate column.

---

## MODERATE

### M1 — No brute-force / rate-limit protection on login (Code.gs)
**File:** `Code.gs` line ~249  
`checkLogin()` performs a linear scan of the Users sheet on every call with no lockout after repeated failures. An automated script can make unlimited login attempts.

**Fix:** Add a failed-attempt counter column in the Users sheet. Lock the account for 15 minutes after 5 consecutive failures. Reset on successful login.

---

### M2 — No input-length validation on signup fields (Code.gs)
**File:** `Code.gs` line ~276  
`handleSignup()` accepts all fields without length limits. Extremely long inputs could corrupt sheet formatting or hit Apps Script string-size quotas.

**Fix:** Add guard: `if (username.length > 50 || password.length > 128) return ContentService.createTextOutput('Input too long');`

---

### M3 — Claude API calls have no timeout; 6-minute Apps Script limit at risk (Pipeline.gs)
**File:** `Pipeline.gs` line ~566  
`UrlFetchApp.fetch()` is called with no `deadline` option. Claude can take 30–60 seconds per call. With BATCH_SIZE=5 batches and 1.5 s sleep between them, a slow run can exceed the Apps Script 6-minute execution limit. When this happens, rows mid-batch are abandoned without being marked ERROR — they stay PENDING and no audit entry is written.

**Fix:** Add `deadline: 55` to the fetch options. Add a wall-clock guard at the start of each batch iteration and break early with an audit log entry if less than 90 seconds remain.

---

### M4 — Brittle Claude response parsing; entire batch fails on unexpected output (Pipeline.gs)
**File:** `Pipeline.gs` line ~587  
```js
const cleaned = text.replace(/```json|```/g, '').trim();
return JSON.parse(cleaned);
```
If Claude returns anything other than a pure JSON array (a partial JSON, an apology paragraph, or a JSON object), `JSON.parse` throws. The catch block marks **every row in the batch** as an error with no partial recovery.

**Fix:** Wrap individual item processing in a per-item try-catch. Extract the JSON array with a regex fallback before parsing. Log raw response to AUDIT_LOG on failure.

---

### M5 — GST always logged as 5% regardless of user selection (Quote_Intelligence.gs)
**File:** `Quote_Intelligence.gs` line ~119  
```js
const gstPct = d.gst || 5;
```
The frontend saves `gstMode` (string: `'5pkg'`, `'18svc'`, `'none'`), **not** `gst` (number). So `d.gst` is always `undefined`, and `gstPct` is always 5. For quotes with "18% service charge" or "No GST," the Quote_Log records incorrect GST amounts, making financial analytics unreliable.

**Fix:**
```js
const gstMode = d.gstMode || 'none';
const gstAmt  = gstMode === '5pkg'  ? Math.round((subTotal + markupAmt) * 0.05)
              : gstMode === '18svc' ? Math.round(markupAmt * 0.18)
              : 0;
```

---

### M6 — XSS risk: masterData values injected into innerHTML without sanitisation (index_fit.tripstore.html)
**File:** `index_fit.tripstore.html` lines ~1285–1386, ~1585–1614  
Hotel names, city names, tour names, and transfer routes from Google Sheets are interpolated directly into innerHTML template strings. The `esc()` helper only protects `onclick` attribute values — values placed as HTML content (inside `<p>`, `<td>`, `<textarea>`) are not escaped. If a Sheet row contains `<script>alert(1)</script>` as a hotel name, it executes in every agent's browser.

**Fix:** Add an HTML-escape helper and apply it to all Sheet-sourced values before innerHTML insertion:
```js
const h = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
```

---

### M7 — Admin role stored in localStorage; never re-validated server-side (index_fit.tripstore.html)
**File:** `index_fit.tripstore.html` line ~585  
```js
localStorage.setItem("tripstore_session", JSON.stringify({ isAdmin: true, ... }));
```
On page load, `checkAutoLogin()` reads `isAdmin` from localStorage with no server re-verification. Any user can run `localStorage.setItem(...)` in DevTools to grant themselves Admin mode. Combined with M6, this is a privilege escalation path.

**Fix:** Re-validate role from the server on every page load (a lightweight `checkLogin` or `getRole` call). Do not trust localStorage for permission gating.

---

### M8 — Date timezone bug: check-in dates can display one day early for IST users (index_fit.tripstore.html)
**File:** `index_fit.tripstore.html` line ~2028  
`new Date('2025-06-15')` (ISO date string from `<input type="date">`) is parsed as UTC midnight. In IST (UTC+5:30), this is 05:30 on June 15, so display is correct — but anywhere `new Date(dateString)` is used in date arithmetic and then formatted, rounding errors can produce off-by-one-day display. The pattern is fragile for agents in non-IST timezones.

**Fix:** Force local-time parsing: `const d = new Date(str + 'T00:00:00')` throughout all date constructions.

---

### M9 — Hardcoded SPREADSHEET_ID in both Python scripts (write_to_sheets.py, archive_to_input.py)
**File:** `write_to_sheets.py` line ~28 · `archive_to_input.py` line ~32  
```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
```
If the Google Sheet is recreated or the ID changes, both scripts silently write to the wrong sheet. No validation that the opened spreadsheet contains the expected tabs.

**Fix:** Move to a `.env` file or `config.json`. Add a startup check that required sheet tabs exist before writing any data.

---

## MINOR

### m1 — `setupSheets()` inserts duplicate banner row on every run (Pipeline.gs)
**File:** `Pipeline.gs` line ~778  
`ws.insertRowBefore(2)` is called unconditionally. Running `setupSheets()` twice creates two banner rows, pushing data down and breaking `getPendingRows`'s `for (let i = 2; ...)` skip logic.

**Fix:** Check `ws.getRange(2,1).getValue()` for the `ℹ️` prefix before inserting a new row.

---

### m2 — `sendSummaryEmail` not wrapped in try-catch; failure breaks audit trail (Pipeline.gs)
**File:** `Pipeline.gs` line ~709  
If `GmailApp.sendEmail` fails (quota exceeded, auth lapsed), the exception propagates out of `runMidnightEnrichment`. The final `auditLog("PIPELINE COMPLETE")` line never executes, making the run appear incomplete even though all data was enriched.

**Fix:** Wrap `sendSummaryEmail()` call inside a try-catch in `runMidnightEnrichment`.

---

### m3 — Recursive call risk in `logQuote` if `setupQuoteLog` itself fails (Quote_Intelligence.gs)
**File:** `Quote_Intelligence.gs` lines ~33–37  
```js
if (!logSheet) {
    setupQuoteLog();
    return logQuote(paxName, data);  // infinite loop if setupQuoteLog keeps failing
}
```
If `setupQuoteLog` throws, the retry call re-enters `logQuote`, which calls `setupQuoteLog` again, until Apps Script hits its stack depth limit.

**Fix:** Add a `retried = false` flag parameter; return a Logger error instead of retrying a second time.

---

### m4 — Quote ID collision risk (Quote_Intelligence.gs)
**File:** `Quote_Intelligence.gs` line ~140  
```js
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```
Only the last 8 digits of epoch milliseconds (~46-day window) are used. Two saves in the same millisecond, or saves ~46 days apart, produce identical IDs.

**Fix:** Use `Utilities.getUuid()` (built into Apps Script) for guaranteed uniqueness.

---

### m5 — `setupQuoteLog()` silently wipes existing data (Quote_Intelligence.gs)
**File:** `Quote_Intelligence.gs` line ~196  
`ws.clear()` runs without any confirmation check. Running `setupQuoteLog()` accidentally on a live sheet destroys all historical quote data with no warning and no recovery path.

**Fix:** Check `ws.getLastRow() > 1` and throw `throw new Error("Sheet has data...")` rather than clearing silently.

---

### m6 — Budget range hints are hardcoded; will become stale over time (index_fit.tripstore.html)
**File:** `index_fit.tripstore.html` line ~782  
```js
const BUDGET_RANGES = { hotel: { low: 2500, high: 7500 }, land: { low: 1200, high: 2800 } };
```
These price-per-room and price-per-pax ranges are static. As hotel prices in Europe shift year over year, agents receive inaccurate budget suggestions.

**Fix:** On `init()`, compute the 25th–75th percentile of `masterData.hotels.map(h => h.cost)` and use those as the dynamic range bounds.

---

### m7 — Transfer city extraction brittle for complex airport names (archive_to_input.py)
**File:** `archive_to_input.py` line ~155  
The regex splits on a keyword list (`cdg`, `lhr`, `ams`, etc.). "Rome Fiumicino Airport" contains no listed keyword, so the entire string "Rome Fiumicino Airport" is returned as the city. Entries like this push garbage city values into the INPUT_Transfers sheet.

**Fix:** Expand the keyword list with common European airport names/codes, or use a dedicated city lookup from the Transfers master sheet.

---

### m8 — Empty cost string written to sheet when archive cell has no price digits (archive_to_input.py)
**File:** `archive_to_input.py` line ~73  
```python
cost = re.sub(r"[^\d.]", "", parts[i + 3])
```
If the price token is "N/A" or missing, `cost` becomes `""` and is written as the price field. Pipeline.gs will then receive a blank price, likely causing Claude to mark the row as invalid with no informative error.

**Fix:** Validate `cost.strip() != ""` before appending the row; skip or log a warning if price is absent.

---

## Summary Action List

| Priority | Issue | File(s) |
|----------|-------|----------|
| CRITICAL | C1: Fix login POST/GET mismatch — add checkLogin to doPost | Code.gs + HTML |
| CRITICAL | C2: Hash passwords before storing in Google Sheets | Code.gs |
| MODERATE | M5: Fix GST logging — read `gstMode` not `gst` | Quote_Intelligence.gs |
| MODERATE | M6: Escape Sheet-sourced strings before innerHTML | index_fit.tripstore.html |
| MODERATE | M7: Re-validate role from server on page load | index_fit.tripstore.html |
| MODERATE | M3: Add deadline:55 to Claude fetch + batch time guard | Pipeline.gs |
| MODERATE | M4: Per-item try-catch in Claude response processing | Pipeline.gs |
| MODERATE | M1: Add login lockout after 5 failed attempts | Code.gs |
| MODERATE | M9: Move SPREADSHEET_ID to config; validate sheet tabs | .py files |
| MINOR | m4: Replace slice(-8) Quote ID with Utilities.getUuid() | Quote_Intelligence.gs |
| MINOR | m1: Guard setupSheets() banner insertion | Pipeline.gs |
| MINOR | m2: Wrap sendSummaryEmail in try-catch | Pipeline.gs |
| MINOR | m5: Guard setupQuoteLog() from wiping live data | Quote_Intelligence.gs |
| MINOR | m7/m8: Improve archive_to_input.py city extraction + price validation | archive_to_input.py |

---

*Generated: 2026-06-04 | Reviewer: Claude Code (automated daily review)*
