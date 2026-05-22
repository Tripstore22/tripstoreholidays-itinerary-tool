# TripStore Code Review Report
**Date:** 2026-05-22
**Reviewer:** Automated (Claude)
**Scope:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py

> **Note:** The following files listed in the review spec were NOT found in the repository and could not be reviewed:
> `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`
> These may exist outside the repo or have been renamed/removed.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3     |
| MODERATE | 9     |
| MINOR    | 9     |
| **TOTAL**| **21**|

---

## Code.gs

### CRITICAL — Passwords stored in plaintext
**Location:** `checkLogin()` line 256–261, `handleSignup()` line 289

Passwords are stored as plain text in the "Users" Google Sheet and compared directly:
```js
if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim())
```
If the spreadsheet is ever shared, exported, or accessed by another script/person, all credentials are immediately compromised. Passwords should be hashed using `Utilities.computeDigest()`.

---

### CRITICAL — No authentication check on saveItinerary
**Location:** `doPost()` line 52–53, `saveItinerary()` line 342

Any unauthenticated HTTP POST to the Apps Script URL with `{ action: "saveItinerary" }` can create or overwrite itinerary records without any session token or login verification. An attacker could spam or corrupt the Saved_Itineraries sheet.

**Fix:** Add a session token to the payload at login time and verify it server-side on every write operation.

---

### CRITICAL — Login sent via POST but backend only handles it via GET
**Location:** `index_fit.tripstore.html` line 583, `Code.gs` `doPost()` line 43

The frontend sends login credentials via POST but `doPost()` only handles `"signup"` and `"saveItinerary"`. The `checkLogin` function is wired in `doGet()` and expects URL parameters. A POST with `action: "checkLogin"` returns `"Invalid action"`. New users cannot log in unless the deployed Apps Script has been manually patched after this repo was last updated.

**Fix:** Move `checkLogin` to `doPost` and read credentials from `data.user` / `data.pass`.

---

### MODERATE — getAllSaved() and getQuoteLog() have no auth check
**Location:** `doGet()` lines 29–35

Both endpoints are accessible to anyone who knows the Apps Script URL. `getAllSaved` leaks every passenger name; `getQuoteLog` leaks full financial details of every quote.

---

### MODERATE — No brute-force protection on login
**Location:** `checkLogin()` line 249

No rate-limiting, lockout, or attempt counter. An attacker can try unlimited passwords programmatically.

---

### MINOR — getHotels() uses hardcoded column index 18 for Annual Avg
**Location:** `Code.gs` line 99

`const annualAvg = parsePrice(r[18])` — if the sheet ever gains a column before column S, this silently returns wrong data.

---

## Pipeline.gs

### MODERATE — Hardcoded model ID may become invalid
**Location:** `CFG.MODEL` line 39

`MODEL: 'claude-haiku-4-5-20251001'` is hardcoded with no fallback. If Anthropic retires this model, the entire pipeline silently fails (all rows become ERROR with no alert).

---

### MODERATE — Array.fill() shares a single error object across all batch items
**Location:** `callClaudeAPI()` line 593

`Array(expectedCount).fill({ valid: false, error_reason: ... })` fills all elements with the **same object reference**. Any mutation to one result mutates all. Should be `Array.from({ length: expectedCount }, () => ({ ... }))`.

---

### MODERATE — Apps Script 6-minute timeout risk for large batches
**Location:** `processSheet()` line 224

With `BATCH_SIZE = 5` and 1.5s sleep between batches, 100 rows = ~30s sleep + API latency. Large backlogs will fail mid-run leaving rows in inconsistent state.

**Fix:** Add `if (new Date() - start > 300000) break;` inside the loop.

---

### MINOR — auditLog silently swallows all exceptions
**Location:** `auditLog()` line 659

The catch block has no `Logger.log(e)`. If the AUDIT_LOG sheet is missing, errors disappear entirely.

---

### MINOR — buildMasterKey returns empty string for unknown types
**Location:** `buildMasterKey()` line 274

The `default` case returns `''`. A new data type added without updating this switch will silently allow all duplicates through (isDuplicate returns false for empty key).

---

## Quote_Intelligence.gs

### MODERATE — GST rate hardcoded; mismatch with frontend gstMode field
**Location:** `buildQuoteLogRow()` line 119

`const gstPct = d.gst || 5` — the frontend saves `gstMode` as a string (`'5pkg'`, `'18svc'`, `'none'`), not a number. `d.gst` is always undefined, so this always applies 5% GST even when the agent selected 18% or No GST. All logged quote totals for GST are incorrect.

**Fix:**
```js
let gstPct = 0;
if (d.gstMode === '5pkg') gstPct = 5;
else if (d.gstMode === '18svc') gstPct = 18;
```

---

### MINOR — Quote ID collision risk
**Location:** `buildQuoteLogRow()` line 140

`'Q-' + new Date().getTime().toString().slice(-8)` — two quotes saved in the same millisecond (e.g. backfill loop) get identical IDs.

---

### MINOR — Potential infinite recursion in logQuote
**Location:** `logQuote()` line 33–37

If `setupQuoteLog()` fails silently and the sheet still doesn't exist, `logQuote` calls itself recursively until stack overflow. Add a `retried` flag guard.

---

## index_fit.tripstore.html

### CRITICAL (XSS) — User input rendered unsanitised via innerHTML
**Location:** `renderRouteInputs()` line 841

```js
`<span><b>${r.city}</b> (${r.nights}N)</span>`
```
`r.city` is raw user input. Typing `<img src=x onerror=alert(1)>` as a city name executes script. Becomes stored XSS if the itinerary is saved and loaded by an admin.

**Fix:** Use DOM API `.textContent` or sanitise before innerHTML insertion.

---

### MODERATE — Session stored in localStorage with no expiry
**Location:** `checkAutoLogin()` line 641

`localStorage.setItem("tripstore_session", ...)` never expires. Shared/kiosk devices remain authenticated indefinitely. Add a `loginTime` field and reject sessions older than 24 hours.

---

### MODERATE — API URL is public with no CSRF or API-key protection
**Location:** Line 426

The Apps Script URL is visible in page source. Combined with no server-side auth on write endpoints, anyone can send arbitrary POST requests to the API.

---

### MINOR — No input length validation on pax name and city fields
**Location:** `addCityToRoute()` line 828, `saveItinerary()` line 695

No length cap on any field. Extremely long inputs could bloat the spreadsheet.

---

## write_to_sheets.py

### MODERATE — Sheet emptiness check is unreliable
**Location:** Line 168

`ws.row_count == 0` always returns False (row_count = grid capacity, not data rows). Header is only applied via `not ws.get_all_values()` which makes a redundant API call.

**Fix:** `sheet_is_empty = len(ws.get_all_values()) == 0`

---

### MINOR — Hardcoded SPREADSHEET_ID
**Location:** `write_to_sheets.py` line 28, `archive_to_input.py` line 32

`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` — if the spreadsheet is migrated, this silently writes to the old one. Use an environment variable.

---

## archive_to_input.py

### MODERATE — parse_hotels_cell misses last entry when count is not a multiple of 4
**Location:** `parse_hotels_cell()` line 70, `parse_sightseeing_cell()` line 85

```python
for i in range(0, len(parts) - 3, 4):  # stops early
```
The last hotel/tour in a cell is silently dropped if the cell doesn't have exactly 4N pipe-delimited fields.

**Fix:** `range(0, len(parts), 4)` with `i+3 < len(parts)` bounds check inside loop.

---

### MINOR — parse_transfers_cell city extraction is fragile
**Location:** Lines 155–161

The regex relies on a hardcoded list of airport keywords. Any description not matching (e.g. "Basel Mulhouse Airport") produces a wrong or empty city, silently corrupting the master sheet.

---

## Action Items (Priority Order)

1. **[CRITICAL]** Fix login flow — add `checkLogin` to `doPost`, read `data.user` / `data.pass`
2. **[CRITICAL]** Hash passwords before storing in Users sheet (`Utilities.computeDigest`)
3. **[CRITICAL]** Add server-side session token verification to `saveItinerary`
4. **[CRITICAL XSS]** Fix `renderRouteInputs()` — use `.textContent` instead of innerHTML for `r.city`
5. **[MODERATE]** Fix GST calculation in Quote_Intelligence.gs — `d.gstMode` not `d.gst`
6. **[MODERATE]** Protect `getAllSaved` and `getQuoteLog` behind an API key
7. **[MODERATE]** Add execution time guard in Pipeline.gs batch loop (prevent 6-min timeout)
8. **[MODERATE]** Fix `Array.fill()` → `Array.from()` in `callClaudeAPI` error path
9. **[MODERATE]** Add localStorage session expiry (24 hrs)
10. **[MODERATE]** Fix `sheet_is_empty` check in write_to_sheets.py
11. **[MODERATE]** Fix off-by-one loops in `parse_hotels_cell` / `parse_sightseeing_cell`
12. **[MINOR]** Add `Logger.log(e)` to `auditLog` catch block
13. **[MINOR]** Alert on model-not-found API errors in Pipeline.gs
14. **[MINOR]** Fix Quote ID collision risk — use full timestamp or UUID
15. **[MINOR]** Move SPREADSHEET_ID to environment variable in Python scripts

---

*Report generated automatically on 2026-05-22. Review all CRITICAL items before next production deployment.*
