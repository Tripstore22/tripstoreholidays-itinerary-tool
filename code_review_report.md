# TripStore Daily Code Review — 2026-06-16

**Files reviewed:** app/index.html, write_to_sheets.py, archive_to_input.py, check_html.py, check_pipeline.py, qa/smoke.py, qa/invariants.py, qa/nightly.py, qa/gen_scenarios.py
**Files absent from repo (cannot inspect):** Code.gs, Pipeline.gs, Quote_Intelligence.gs, extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count | New Today | Carried From 2026-06-15 |
|----------|-------|-----------|--------------------------|
| CRITICAL | 3     | 0 new     | C1, C2, C3 carried open |
| MODERATE | 7     | 2 new     | M1–M5 carried |
| MINOR    | 10    | 2 new     | N1–N8 carried |
| **Total**| **20**| **4 new** | **16 still open** |

> ⚠️ **Zero fixes landed since the 2026-06-15 report.** All 16 prior issues remain open. The four new findings today bring the open count to 20. C3 (DEV credentials exposed on live site) and C1 (login broken on re-deploy) remain highest priority.

---

## CRITICAL

### C1 (CARRIED) — Login handler missing from `doPost` in Code.gs
**File:** `Code.gs` (not in repo)

`doPost` does not handle `action=checkLogin`. Any re-deploy of Code.gs as-is will lock all users out permanently. **Unchanged from prior reports. Fix immediately before next re-deploy.**

**Fix:** Add the missing case to `doPost`:
```javascript
if (action === 'checkLogin') return checkLogin(data.user || '', data.pass || '');
```

---

### C2 (CARRIED) — Plaintext passwords in Google Sheet
**File:** `Code.gs` (not in repo)

Passwords are stored and compared in plaintext. Any team member with sheet access can read all user credentials.

**Fix:** Use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` and store/compare the digest.

---

### C3 (CARRIED — NOT FIXED) — DEV credentials exposed in production HTML comments
**File:** `app/index.html:1–8`

Confirmed still present today. The production app at `fit.tripstoreholidays.com/app/` opens with:
```html
<!--
  DEV FILE — index_fit.tripstore.DEV.html
  DO NOT OVERWRITE WITH LIVE FILE. This has features live doesn't.
  DEV Sheet: 1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4
  DEV API: AKfycbz3dpvTIrQ0gQWqmO3cGZ9fHoJ2oHOahZmvLBk-oy7x1ShyNacqhQhjsIVQJ2bYbXuqrQ
-->
```
Anyone viewing page source sees the DEV Sheet ID and DEV deployment ID. Third day open.

**Fix:** Delete lines 1–8 from `app/index.html` and push.

---

## MODERATE

### M1 (CARRIED) — GST 0% silently replaced with 5%
**File:** `Quote_Intelligence.gs:119` (not in repo)

`const gstPct = d.gst || 5;` treats `gst: 0` as falsy, silently billing 5% GST on zero-rated services.

**Fix:** `const gstPct = d.gst != null ? Number(d.gst) : 5;`

---

### M2 (CARRIED) — `logQuote` infinite recursion risk
**File:** `Quote_Intelligence.gs:33–37` (not in repo)

Recursive retry without a guard. If `setupQuoteLog()` fails, the function recurses until stack overflow.

**Fix:** After `setupQuoteLog()`, look up the sheet again; if still null, log and return instead of recursing.

---

### M3 (CARRIED) — Formula injection via `USER_ENTERED` in both Python sheet writers
**Files:** `write_to_sheets.py:196`, `archive_to_input.py:390`

Both scripts write CSV data with `value_input_option="USER_ENTERED"`. Any cell beginning with `=`, `+`, `-`, or `@` executes as a Google Sheets formula.

**Fix:** Use `value_input_option="RAW"` for all data rows in both scripts.

---

### M4 (CARRIED) — `edge_date_month_boundary` scenario still has past travel date
**File:** `qa/gen_scenarios.py:168`

`travelStartDate="2026-05-29"` is 18 days in the past. The engine may reject this, producing false PASS or false FAIL in nightly smoke. Third day open.

**Fix:** Change to `"2027-05-29"` or derive at runtime.

---

### M5 (CARRIED) — `innerHTML` injecting unescaped API/user data
**File:** `app/index.html:4900, 4903, 4908`

`intel.nextCity`, `r.city` inserted raw into innerHTML. `_e()` escape helper exists but not applied here. Still open.

**Fix:** Apply `_e()` (or define globally) to every API/user value interpolated into innerHTML template literals.

---

### M6 (NEW) — Swiss Pass section injects five unescaped API strings into `innerHTML`
**File:** `app/index.html:5101, 5131, 5154, 5173`

The `loadSwissPassDetails()` function (added in the Swiss Pass sprint) interpolates API-sourced strings directly into innerHTML without escaping:

```javascript
// line 5101 — swiss_legs[].from and .to
`<span>${l.from} → ${l.to}: …</span>`

// line 5131 — pass_tours_used[].tour_name
const renderTourRow = t => `<span>${t.tour_name}: …</span>`

// line 5154 — missing_price_flags[].tour_name
`…${missingFlags.map(m => m.tour_name).slice(0,3).join(', ')}…`

// line 5173 — pass_duration
`<div …>${data.pass_duration}-day Swiss Travel Pass</div>`
```

If the Apps Script returns a malicious or corrupted value (e.g. a hotel/tour name containing `<script>` or a CSS injection via `style="...">`), it executes in the browser. The `l.from`/`l.to` values come from the Trains sheet city names — a poisoned sheet row would trigger XSS for every user who opens the Swiss Pass panel.

**Fix:** Run all five values through the `_e()` escape helper before interpolation, or switch the entire block to DOM construction (`document.createElement`, `textContent`).

---

### M7 (NEW) — All six P07 seasonal-pair scenarios now have past travel dates
**File:** `qa/gen_scenarios.py:186–190`

Today (2026-06-16) the `2026-06-15` June dates crossed into the past, joining the April 2026 dates which have been past since before yesterday's review:

```python
# pair_season_01/02/03 — all six scenarios affected
travelStartDate="2026-04-15"   # April — past since April 16
travelStartDate="2026-06-15"   # June  — became past TODAY (June 16)
```

The seasonal comparison depends on testing identical routes in two different months to measure the seasonal multiplier. With both dates in the past, the engine may reject them or apply past-date fallback logic, making the P07 ratio check (`seam_pricing` + `compare_P07_pair`) either silently SKIP or produce a false signal.

**Fix:** Update all six `travelStartDate` values to future dates (e.g. April 2027 and June 2027), or generate them dynamically at runtime relative to `datetime.date.today()`.

---

## MINOR

### N1 (CARRIED) — `doGet` login exposes password in URL
**File:** `Code.gs` (not in repo). GET-based login bakes credentials into Apps Script execution logs. **Fix:** Remove GET login path; use `doPost` exclusively.

---

### N2 (CARRIED) — No brute-force protection on login
**File:** `Code.gs` (not in repo). No rate limiting or lockout on failed attempts. **Fix:** `Utilities.sleep(500)` on every login call; log repeated failures.

---

### N3 (CARRIED) — Dead code: `ws.row_count == 0` always false
**File:** `write_to_sheets.py:168`

`ws.row_count` returns the sheet's grid dimension (default 1000), never 0. First clause is dead.

**Fix:** `sheet_is_empty = not ws.get_all_values()`

---

### N4 (CARRIED) — Hardcoded live Spreadsheet IDs
**Files:** `write_to_sheets.py:28`, `archive_to_input.py:32`

No safeguard against accidentally running these scripts against live data during testing.

**Fix:** Read from `os.environ.get("SPREADSHEET_ID")` with a fallback.

---

### N5 (CARRIED) — 7 Python scripts absent from repository
Still missing: `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`. If in active local use, commit them.

---

### N6 (CARRIED) — Hardcoded year 2026 in `smoke.py` default start date
**File:** `qa/smoke.py:73`

```python
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
```
On January 1, 2027 this will generate past dates for every scenario that doesn't override `travelStartDate`, silently breaking the entire smoke gate.

**Fix:** `yr = datetime.date.today().year` and use `f"{yr}-..."`.

---

### N7 (CARRIED) — `ADOBE_PDF_API` URL not validated by `check_html.py`
**File:** `app/index.html:8476`, `check_html.py:53–95`

The main `API_URL` is validated; `ADOBE_PDF_API` is not. If the PDF deployment is redeployed, PDF generation silently breaks with no validator catching it.

**Fix:** Add `ADOBE_PDF_API` fragment to the `REQUIRED` list in `check_html.py`.

---

### N8 (CARRIED) — `check_pipeline.py` hardcoded to Sumit's Mac path
**File:** `check_pipeline.py:16`

```python
CLASP_LIVE_ROOT = os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live')
```
Exits on any other machine (cloud sessions, CI, second developer).

**Fix:** `CLASP_LIVE_ROOT = os.environ.get('CLASP_LIVE_ROOT') or os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live')`

---

### N9 (NEW) — API_URL comment says "DEV @18" — conflicts with CLAUDE.md live URL spec
**File:** `app/index.html:3285`

```javascript
const API_URL = "https://script.google.com/macros/s/AKfycbwP9KQH39hcBcLQsPsOL_c4hKIuV3TTlm1XW2CT2e72W-TYVP01-adjsVAKtAAArhGQWA/exec";
// DEV @18 — 2026-05-04 RBAC 5-role + getAllUsers (prev pinned @5 AKfycbwRr9k5...)
```

CLAUDE.md states the live URL should contain the fragment `AKfycbzAbIgzRoN_MNs377jm3u`. The actual URL in `app/index.html` does not contain that fragment, and its inline comment explicitly says "DEV @18". Two interpretations:

1. **Stale comment**: The URL was promoted from DEV to production but the "DEV @18" comment was never updated. CLAUDE.md's fragment is the outdated one. `check_html.py` already validates this URL as correct.
2. **Wrong URL**: The production app is actually hitting the DEV Apps Script backend. Users are on DEV data.

If interpretation 2 is correct, this is a CRITICAL data-integrity issue (all production saves go to DEV sheet). Recommend confirming which deployment this ID belongs to in the Apps Script console.

**Fix:** Open Apps Script → Deploy → Manage Deployments, verify which environment `AKfycbwP9KQH39...` belongs to. If DEV, replace with the live deployment ID. Update CLAUDE.md and the inline comment to match.

---

### N10 (NEW) — `nightly.py` only compares `pair_01` for P01 and P07; pair_02/03 silently skipped
**File:** `qa/nightly.py:69–72`

```python
for a, b, fn in [("pair_child_01_a", "pair_child_01_b", inv.compare_P01_pair),
                 ("pair_season_01_apr", "pair_season_01_jun", inv.compare_P07_pair)]:
```

`gen_scenarios.py` generates three child pairs (`pair_child_01`, `02`, `03`) and three season pairs (`pair_season_01`, `02`, `03`). `nightly.py` only runs the first pair of each type. `pair_child_02/03` (Rome/Prague child ratio) and `pair_season_02/03` (Rome/Barcelona seasonal ratio) are fetched but never compared — if they diverge, nightly produces no signal.

**Fix:** Extend the list to include all six pairs:
```python
for a, b, fn in [
    ("pair_child_01_a",   "pair_child_01_b",   inv.compare_P01_pair),
    ("pair_child_02_a",   "pair_child_02_b",   inv.compare_P01_pair),
    ("pair_child_03_a",   "pair_child_03_b",   inv.compare_P01_pair),
    ("pair_season_01_apr","pair_season_01_jun", inv.compare_P07_pair),
    ("pair_season_02_apr","pair_season_02_jun", inv.compare_P07_pair),
    ("pair_season_03_apr","pair_season_03_jun", inv.compare_P07_pair),
]:
```

---

## Action Items (Priority Order)

1. **[C3 — URGENT, 3 DAYS OPEN]** Delete lines 1–8 (DEV credentials comment) from `app/index.html` and push to v2. Takes 2 minutes.
2. **[C1 — URGENT]** Add `checkLogin` to `doPost` in Code.gs before any re-deploy — live login will break otherwise.
3. **[C2 — HIGH]** Hash passwords in Code.gs.
4. **[N9 — TODAY]** Verify `AKfycbwP9KQH39...` in Apps Script console to confirm live vs. DEV environment. If DEV, this is a critical escalation.
5. **[M6 — THIS WEEK]** Escape `l.from`, `l.to`, `t.tour_name`, `m.tour_name`, `data.pass_duration` in Swiss Pass innerHTML block.
6. **[M7 — TODAY]** Update all six `pair_season_*/pair_season_*_apr/jun` dates to 2027 in `gen_scenarios.py` and re-run to regenerate `scenarios.json`.
7. **[M4 — TODAY]** Update `edge_date_month_boundary` `travelStartDate` to `2027-05-29`.
8. **[N6 — BEFORE JAN 2027]** Fix hardcoded 2026 in `smoke.py:73`.
9. **[M3 — THIS WEEK]** Change `USER_ENTERED` to `RAW` in `write_to_sheets.py:196` and `archive_to_input.py:390`.
10. **[M5 — THIS WEEK]** Apply `_e()` globally to all innerHTML interpolations in `app/index.html`.
11. **[N10]** Add pair_02/03 comparisons to `nightly.py`.
12. **[N7]** Add `ADOBE_PDF_API` URL check to `check_html.py`.
13. **[N3, N4, N8]** Dead code, hardcoded IDs, CLASP path — low-effort fixes.
14. **[N5]** Commit the 7 missing Python scripts.

---

*Generated automatically — 2026-06-16*
