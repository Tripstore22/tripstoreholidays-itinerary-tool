# TripStore Daily Code Review
**Date:** 2026-05-24
**Reviewed by:** Automated Claude Review
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py
**Files NOT found in repo (skipped):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Recent Commits
```
56edcaa Auto: daily code review
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main
e6a35d9 Merge v2 into main
f3b87ad Sync index.html with index_fit.tripstore.html
```

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 7     |
| MODERATE | 12    |
| MINOR    | 10    |

---

## CRITICAL Issues

### C1 — archive_to_input.py: All hotel rows will fail Pipeline validation
**File:** archive_to_input.py, lines 232–242 (`make_hotel_row`)

`make_hotel_row` only populates city and name. All 12 monthly price columns remain empty. The `cost_inr` parsed from the archive is **never placed into any column of the output row**.

Pipeline.gs `enrichHotels` sends these to Claude with all monthly prices = 0. Claude validation: *"All monthly prices are 0 (at least 4 months must be provided)"* → every hotel row imported via archive_to_input.py will be flagged ERROR. The tool is effectively broken for hotels.

**Fix:** `row[18] = h["cost_inr"]` (Annual Avg column) so Claude has a price to work with.

---

### C2 — archive_to_input.py: All sightseeing rows will fail Pipeline validation
**File:** archive_to_input.py, lines 245–257 (`make_sightseeing_row`)

`make_sightseeing_row` places `cost_inr` at index 5 (0-based) = Avg Price column. But `enrichSightseeing` reads `gyg_price` from index 6 and `viator_price` from index 8. Both are 0 in archive-imported rows. Claude validation: *"Both gyg_price and viator_price are 0 or missing"* → every sightseeing row will be flagged ERROR.

**Fix:** `row[6] = s.get("cost_inr", "")` — put cost in GYG Price column (index 6, 0-based).

---

### C3 — index_fit.tripstore.html: Admin access via localStorage manipulation
**File:** index_fit.tripstore.html, lines 641–653 (`checkAutoLogin`)

Session is restored entirely from `localStorage` with no server-side token validation:
```js
const s = JSON.parse(saved);
isAdmin = s.isAdmin;
launchApp(s.modeText);
```
Anyone can run in browser console:
```js
localStorage.setItem('tripstore_session', JSON.stringify({isLoggedIn:true,isAdmin:true,modeText:'ADMIN MODE'}))
```
→ Instant admin panel access with no login. Admin actions load real client itineraries because the server has no session check either.

**Fix:** Issue a server-side session token at login. Validate the token before serving admin actions (getAllSaved, search).

---

### C4 — index_fit.tripstore.html + Code.gs: Login POST/GET mismatch — new logins broken
**File:** index_fit.tripstore.html line 583, Code.gs lines 25–28

Frontend sends `checkLogin` as POST body. `doPost` only handles `signup` and `saveItinerary` — returns "Invalid action" for `checkLogin`. The working handler is in `doGet` (URL params). New logins permanently fail on any device without a cached localStorage session.

**Fix:** Add to `doPost` in Code.gs: `if (action === 'checkLogin') return checkLogin(data.user||'', data.pass||'');`

---

### C5 — Code.gs: Passwords stored and compared in plaintext
**File:** Code.gs, lines 258–261, 289

Passwords written to Users sheet as plaintext, compared with `dbPass === pass.trim()`. Any viewer of the spreadsheet can read every password.

**Fix:** Use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` before storing. Compare digests on login.

---

### C6 — Code.gs: saveItinerary has no authentication
**File:** Code.gs, lines 342–365

Any POST with `action: saveItinerary` and any `paxName` can overwrite any itinerary record. No auth check of any kind. A script could wipe or corrupt the entire Saved_Itineraries sheet.

**Fix:** Require a session token in the POST body, validated server-side before any write.

---

### C7 — Pipeline.gs: Claude response consumed by positional index — silent misalignment
**File:** Pipeline.gs, lines 228–249

```js
results.forEach((res, idx) => { const row = batch[idx]; ...
```
Assumes Claude always returns results in the same count and order as input. If Claude reorders or drops items, the wrong rows get PROCESSED/ERROR status, and enriched data from hotel A gets written to hotel B's slot in the master sheet silently.

**Fix:** Match each result to its batch entry by `res.idx` field (already included in every prompt), not by array position.

---

## MODERATE Issues

### M1 — Pipeline.gs: EUR/INR rate hardcoded as ₹110/€ (stale by ~20%)
Line 463. Current rate ≈ ₹91/€. All back-calculated train prices are overstated by ~18%.

### M2 — Pipeline.gs: setupSheets inserts banner row on every call
Line 778: `ws.insertRowBefore(2)` runs even on existing sheets. A second call shifts all data down, breaking row-3 data start assumption.

### M3 — Pipeline.gs: AUDIT_LOG grows without bound
Lines 657–665. No cleanup or rotation. Will hit Sheets row limits over time and slow reads.

### M4 — Quote_Intelligence.gs: GST always logged as 5% regardless of actual mode
Line 119: `const gstPct = d.gst || 5`. Frontend stores `gstMode` as string ("18svc", "none"), not numeric `d.gst`. All financial logging is wrong for 18% and no-GST quotes.

### M5 — Quote_Intelligence.gs: Budget utilization comparison is misleading
Lines 129–133: `grandTotal / budgetEntered` — grandTotal includes markup + GST; budgetEntered is net costs. On-budget quotes appear at 120–125% utilization.

### M6 — Quote_Intelligence.gs: backfillQuoteLog creates duplicates on repeat runs
Lines 278–309. No deduplication guard. Running twice doubles every entry in Quote_Log.

### M7 — index_fit.tripstore.html: XSS via innerHTML with user-entered city name
Lines 841–846: `r.city` inserted directly into innerHTML without escaping. A crafted city name executes JavaScript. Risk escalates when admin loads malicious saved itineraries.

### M8 — index_fit.tripstore.html: CDN libraries without subresource integrity
Lines 7–11: html2canvas, jsPDF, ExcelJS, FileSaver loaded from cdnjs without `integrity` hashes. CDN compromise = silent attacker code execution for all users.

### M9 — Code.gs: getAllSaved and getQuoteLog have no authentication
Lines 299–314, 372–418. Full client pax list and financial quote history accessible without any auth to anyone with the script URL.

### M10 — write_to_sheets.py: ws.row_count check is dead code + double API call
Line 168: `ws.row_count` always returns 1000 (gspread default), never 0. First condition is dead. `get_all_values()` called twice, doubling quota usage.

### M11 — write_to_sheets.py + archive_to_input.py: Spreadsheet ID hardcoded in source
Lines 28, 31. Should be environment variable, not committed to repo.

### M12 — archive_to_input.py: Transfer city extraction is fragile
Lines 153–161. Regex splits on airport keywords to guess city name — fails for city names containing those keywords.

---

## MINOR Issues

**N1** — Quote ID collides every ~11.5 days if two saves occur within 100ms (last 8 digits of epoch ms).

**N2** — Code.gs `getHotels`: magic column index `r[18]` — brittle if sheet columns reordered.

**N3** — Pipeline.gs: no guard on prompt input length vs. context limit (MAX_TOKENS controls output only).

**N4** — HTML: `new Date("YYYY-MM-DD")` parses as UTC midnight — IST timezone edge cases may give wrong night counts.

**N5** — HTML: `optimizeTransfers` and `optimizeIntercity` accept `tBudgetTotal` parameter that is never used.

**N6** — HTML: `BUDGET_RANGES` (₹2,500–7,500/room/night) may be stale for current European hotel prices. Review annually.

**N7** — archive_to_input.py: Malformed CSV cells silently skipped with no counter or warning.

**N8** — write_to_sheets.py: `value_input_option="USER_ENTERED"` for data rows — Sheets may coerce numeric strings or dates. Use `"RAW"`.

**N9** — Quote_Intelligence.gs: `logQuote` auto-creates sheet and retries — potential infinite recursion if setup succeeds but logging fails again.

**N10** — Pipeline.gs: `setupTrigger()` calls `getUi().alert()` — fails silently in headless execution.

---

## Priority Action List

| # | Action | Severity | File |
|---|--------|----------|------|
| 1 | Fix `make_hotel_row` — put cost_inr into annual avg (row[18]) | CRITICAL | archive_to_input.py |
| 2 | Fix `make_sightseeing_row` — put cost_inr at row[6] (GYG), not row[5] | CRITICAL | archive_to_input.py |
| 3 | Add checkLogin to doPost in Code.gs | CRITICAL | Code.gs |
| 4 | Hash passwords before storing in Users sheet | CRITICAL | Code.gs |
| 5 | Add auth token requirement to saveItinerary | CRITICAL | Code.gs |
| 6 | Validate Claude response by res.idx, not positional array index | CRITICAL | Pipeline.gs |
| 7 | Fix GST logging — parse gstMode string | MODERATE | Quote_Intelligence.gs |
| 8 | Fix budget utilization — compare at net level | MODERATE | Quote_Intelligence.gs |
| 9 | Update EUR/INR rate in trains enrichment prompt (₹110 → ₹91) | MODERATE | Pipeline.gs |
| 10 | Add AUDIT_LOG rotation (keep last 90 days) | MODERATE | Pipeline.gs |

---

*Automated review generated 2026-05-24 | 6 of 13 requested files were available in repo*
