# TripStore Code Review Report
**Date:** 2026-05-20
**Reviewed by:** Automated Daily Review
**Files reviewed:** Code.gs · Pipeline.gs · Quote_Intelligence.gs · index_fit.tripstore.html · write_to_sheets.py · archive_to_input.py
**Missing files (not in repo):** extract_itineraries.py · write_inputs_to_sheets.py · cleanup_sheet.py · clean_pipeline_data.py · cross_reference.py · enrich_hotels.py · enrich_hotels_booking.py

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 5 |
| 🟡 MODERATE | 11 |
| 🟢 MINOR | 7 |
| **Total** | **23** |

---

## 🔴 CRITICAL Issues

### C1 — Code.gs: Plaintext passwords stored in Google Sheets
**File:** `Code.gs:260–261`
Passwords are compared as plain strings directly from the sheet. A Google Sheet breach, accidental share, or admin user exposes every account password immediately. No hashing, no salting.
**Fix:** Hash passwords with SHA-256 (at minimum) before storage. Use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` in Apps Script.

---

### C2 — Code.gs: Login exposed via GET endpoint with credentials in URL
**File:** `Code.gs:25–28`
`doGet` handles `action=checkLogin&user=X&pass=Y` as URL parameters. Any access log, browser history, CDN log, or referrer header will contain the plaintext password. The login route should be POST-only.
**Fix:** Remove `checkLogin` from `doGet`. Handle it only in `doPost` (see C3).

---

### C3 — index_fit.tripstore.html: Login POST mismatch — login is silently broken
**File:** `index_fit.tripstore.html:583`, `Code.gs:43–58`
The frontend sends login as a POST request with `{ action: "checkLogin", user, pass }`. However, `doPost` in Code.gs only handles `signup` and `saveItinerary` — it returns `"Invalid action"` for any other action. This means login always fails unless the *deployed* script differs from what is in this repo. The repo and live deployment are out of sync.
**Fix:** Add a `checkLogin` handler inside `doPost` so credentials travel in the POST body, not the URL. This also resolves C2.

```javascript
// In doPost:
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.password || '');
}
```

---

### C4 — Quote_Intelligence.gs: `setupQuoteLog()` silently destroys all existing Quote_Log data
**File:** `Quote_Intelligence.gs:196`
`ws.clear()` wipes the entire sheet unconditionally. If this function is ever re-run (e.g. accidentally from the Apps Script IDE), all historical quote records are permanently deleted. There is no confirmation prompt and no backup step.
**Fix:** Add a guard: if the sheet already has data rows (more than 1 row), show an alert and abort rather than clearing.

---

### C5 — index_fit.tripstore.html + Code.gs: Unescaped Google Sheets data injected into innerHTML — XSS risk
**File:** `index_fit.tripstore.html:1277–1315`, `1585–1614`, `1714–1726`, `1829–1841`
Hotel star ratings, categories, tour categories, durations, city names, and transfer from/to values from `masterData` are inserted directly into `innerHTML` via template literals with no HTML escaping. If anyone with write access to the Google Sheet inserts `<img src=x onerror=alert(document.cookie)>` into a Category or Star Rating cell, it executes in every logged-in user's browser.
**Fix:** Create a helper `esc(str)` that replaces `<`, `>`, `"`, `'`, `&` with HTML entities and use it on every value from `masterData` before inserting into innerHTML.

---

## 🟡 MODERATE Issues

### M1 — Code.gs: No authentication on save/load/admin APIs
**File:** `Code.gs:299–365`
`saveItinerary`, `searchItinerary`, and `getAllSaved` require no login token. Anyone who knows the Apps Script URL can read or overwrite any saved itinerary, and list all client names.
**Fix:** Pass a session token on save/load requests (set during login) and validate it server-side against the Users sheet, or at minimum against a short-lived properties store.

---

### M2 — Code.gs: No brute-force protection on login
**File:** `Code.gs:249–269`
There is no rate limiting, lockout, or attempt counter. An attacker can try thousands of passwords per minute against any account.
**Fix:** Track failed attempts per username in a ScriptProperties key. Lock the account for 15 minutes after 5 consecutive failures.

---

### M3 — Pipeline.gs: `setupSheets()` inserts a duplicate banner row on every run
**File:** `Pipeline.gs:778`
`ws.insertRowBefore(2)` runs unconditionally. Running `setupSheets()` twice adds a second (then third) info banner row, shifting all data rows down and corrupting the `statusColIndex` offset used by `getPendingRows`.
**Fix:** Check if row 2 is already the banner before inserting. Only insert if the current row 2 does not already start with `ℹ️`.

---

### M4 — Pipeline.gs: Claude response JSON parsing has no resilience
**File:** `Pipeline.gs:585–596`
If Claude returns partial or malformed JSON (e.g. truncated at `MAX_TOKENS: 4096` or containing markdown), `JSON.parse(cleaned)` throws and the *entire batch* is marked as API error — not just the bad row. All valid rows in the batch are discarded and retried unnecessarily.
**Fix:** Wrap `JSON.parse` in a try/catch at the batch level and return individual error results per row. Consider increasing `MAX_TOKENS` to 8192 for safety with 5-row batches.

---

### M5 — Quote_Intelligence.gs: Infinite recursion risk in `logQuote`
**File:** `Quote_Intelligence.gs:29–37`
`logQuote` calls `setupQuoteLog()` if the sheet is missing, then recursively calls `logQuote` again. If `setupQuoteLog()` itself fails (e.g. quota exceeded), this creates an infinite call stack and crashes the save operation.
**Fix:** Add a `retried` boolean parameter: `function logQuote(paxName, data, retried = false)` and return immediately if `retried` is true.

---

### M6 — Quote_Intelligence.gs: GST mode incompatible with frontend — all GST amounts in Quote_Log are wrong
**File:** `Quote_Intelligence.gs:119`
`const gstPct = d.gst || 5` — the frontend stores `gstMode` as a string (`'5pkg'`, `'18svc'`, `'none'`), not a number. So `d.gst` is always undefined, and this calculation always applies 5% GST even when the agent selected 18% or No GST. Quote_Log financial totals are incorrect for every quote where GST mode is not "5% Full Package".
**Fix:**
```javascript
let gstPct = 0;
if (d.gstMode === '5pkg')  gstPct = 5;
if (d.gstMode === '18svc') gstPct = 18;
const gstAmt = Math.round(markupAmt * gstPct / 100);
```

---

### M7 — Quote_Intelligence.gs: `backfillQuoteLog()` creates duplicate rows if run more than once
**File:** `Quote_Intelligence.gs:278–308`
There is no deduplication check against existing Quote_Log entries before importing. Running backfill a second time doubles every row in the log.
**Fix:** Before importing, build a set of existing `paxName` values from Quote_Log and skip any that already exist.

---

### M8 — archive_to_input.py: Archived sightseeing items will always fail Pipeline enrichment
**File:** `archive_to_input.py:245–254`
`make_sightseeing_row` writes the cost to index 5 (`Avg Price` column). But `enrichSightseeing` in Pipeline.gs validates: *"Both gyg_price and viator_price are 0 or missing → valid=false"*. Avg Price alone does not satisfy this — so every archived sightseeing item will be marked ERROR by the pipeline and never added to the master sheet.
**Fix:** Write the cost to index 6 (GYG Price) instead of (or in addition to) index 5, so Claude has a valid price to validate against.

---

### M9 — index_fit.tripstore.html: `pricingFactor` baked into `onchange` handler at render time
**File:** `index_fit.tripstore.html:1307`
```js
onchange="currentPlan[${planIdx}].hotel.cost = Number(this.value)/(${item.nights||1}*${config.pricingFactor});"
```
`config.pricingFactor` is a literal value embedded at render time. If the agent changes adult/child counts *after* the table is rendered but without re-running the optimizer, manually editing a hotel price back-calculates using a stale factor, silently corrupting `hotel.cost`.
**Fix:** Use a named function and call `getTravelConfigs().pricingFactor` at event time instead of embedding the value at render.

---

### M10 — index_fit.tripstore.html: Sessions never expire
**File:** `index_fit.tripstore.html:588`
`localStorage.setItem("tripstore_session", ...)` — no expiry timestamp is stored. A shared or lost device gives permanent access to any saved itinerary.
**Fix:** Store a `loginTime` in the session object and check it in `checkAutoLogin`. Log out automatically after 8 hours (or configurable timeout).

---

### M11 — write_to_sheets.py / archive_to_input.py: Hardcoded Spreadsheet ID
**File:** `write_to_sheets.py:28`, `archive_to_input.py:32`
`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` is hardcoded in two files. If the spreadsheet is replaced or the ID changes, both scripts break silently with no helpful error.
**Fix:** Read from an environment variable: `os.environ.get("TRIPSTORE_SHEET_ID")` with a clear error message if it is missing.

---

## 🟢 MINOR Issues

### N1 — Code.gs: Redundant `type` field duplicates `roomType`
**File:** `Code.gs:109`
`type: String(r[5] || '').trim()` is an exact copy of `roomType`. Comment says "kept for backward compatibility". Identify frontend usages of `.type` and replace with `.roomType`, then remove the field.

---

### N2 — Pipeline.gs: Batch sleep hardcoded at 1500ms (probably too conservative)
**File:** `Pipeline.gs:252`
`Utilities.sleep(1500)` — no comment explaining the value. Anthropic's Haiku rate limit is much higher. This adds unnecessary idle time (90 seconds for a 60-row batch).
**Fix:** Reduce to 500ms and add a comment referencing the API rate limit being protected against.

---

### N3 — Quote_Intelligence.gs: Quote IDs can theoretically collide
**File:** `Quote_Intelligence.gs:140`
`'Q-' + new Date().getTime().toString().slice(-8)` — last 8 digits of a millisecond timestamp cycle every ~11.5 days. Two saves within the same millisecond window produce identical IDs.
**Fix:** Use full timestamp plus a random suffix: `'Q-' + Date.now() + '-' + Math.random().toString(36).slice(-4)`.

---

### N4 — index_fit.tripstore.html: `autoSaveThenDo` silently swallows save errors
**File:** `index_fit.tripstore.html:2292`
The catch block is `/* silent — don't block the export */`. If the auto-save consistently fails (API down, quota exceeded), agents export without cloud backup and never know.
**Fix:** Log to console and show a brief non-blocking toast: `showToast("Auto-save failed — cloud backup not updated", "error")`.

---

### N5 — index_fit.tripstore.html: Budget suggestion ranges are hardcoded and stale
**File:** `index_fit.tripstore.html:782–784`
```js
const BUDGET_RANGES = { hotel: { low: 2500, high: 7500 }, land: { low: 1200, high: 2800 } }
```
These flat values don't reflect actual master data pricing. As hotel costs in the sheet change, the suggestions will mislead agents.
**Fix:** Derive `low`/`high` from actual `masterData.hotels` cost percentiles after data loads in `init()`.

---

### N6 — index_fit.tripstore.html: `removeRoute()` destroys the entire quote without confirmation
**File:** `index_fit.tripstore.html:850–856`
Clicking ✕ on any city in the route list immediately clears `currentPlan`, `selectedTransfers`, and `selectedIntercity`. There is no undo. A misclick on a fully-built quote wipes hours of work.
**Fix:** Add a `confirm("Remove city and reset the quote?")` guard, consistent with the undo pattern already used for transfer deletion.

---

### N7 — archive_to_input.py: Transfer city extraction regex is brittle
**File:** `archive_to_input.py:154–161`
The regex split to extract the city name from transfer descriptions uses a hardcoded list of airport/landmark keywords (`cdg`, `lhr`, `ams`, `fra`, `vie`, `bcn`, `fco`…). Any European destination not in this list returns a blank city or a wrong city, causing pipeline errors.
**Fix:** Attempt IATA code extraction as the primary method; fall back to first token of `from_loc` only as a last resort.

---

## Missing Files Notice

The following 7 files were listed for review but are **not present in the repository**:
- `extract_itineraries.py`
- `write_inputs_to_sheets.py`
- `cleanup_sheet.py`
- `clean_pipeline_data.py`
- `cross_reference.py`
- `enrich_hotels.py`
- `enrich_hotels_booking.py`

If these contain production logic, they must be committed to the repo so they can be reviewed, version-controlled, and deployed consistently.

---

## Prioritised Action Items

| Priority | Issue | Action |
|----------|-------|--------|
| TODAY | C3 — Login POST/GET mismatch | Check deployed Code.gs vs repo; sync immediately |
| TODAY | M6 — GST mode bug in Quote_Log | Fix `gstPct` calculation in Quote_Intelligence.gs |
| TODAY | C4 — `setupQuoteLog` destroys data | Add guard before `ws.clear()` |
| THIS WEEK | C1 — Plaintext passwords | Hash passwords using Apps Script SHA-256 |
| THIS WEEK | C2 + C5 — GET login + XSS | Remove from doGet; add HTML escaping to frontend |
| THIS WEEK | M8 — Sightseeing archive import broken | Write price to GYG Price column (index 6) |
| THIS WEEK | M3 — Duplicate banner rows | Guard `insertRowBefore` in `setupSheets()` |
| THIS WEEK | M5 — Infinite recursion in logQuote | Add `retried` guard parameter |
| NEXT SPRINT | M1, M2, M10 | Auth tokens, brute-force protection, session expiry |
| NEXT SPRINT | Missing files | Commit all production Python scripts to repo |

---

*Automated daily review — TripStore Holidays — 2026-05-19*
