# TripStore Daily Code Review — 2026-06-18

**Files reviewed:** app/index.html, write_to_sheets.py, archive_to_input.py, check_html.py, check_pipeline.py, qa/smoke.py, qa/invariants.py, qa/nightly.py, qa/gen_scenarios.py
**Files absent from repo (cannot inspect):** Code.gs, Pipeline.gs, Quote_Intelligence.gs, extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count | New Today | Carried From 2026-06-16 |
|----------|-------|-----------|--------------------------|
| CRITICAL | 3     | 0         | C1, C2, C3 carried open  |
| MODERATE | 8     | 1 new (M8)| M1–M7 carried            |
| MINOR    | 11    | 1 new (N11) | N1–N5, N7–N10 carried (N6 promoted to M8) |
| **Total**| **22**| **2 new** | **20 still open, zero fixes landed** |

> ⚠️ **Zero fixes landed since the 2026-06-16 report.** All 20 prior issues remain open.
> **M8 is the most urgent new finding today**: the smoke gate is now ACTIVELY BROKEN for 26 scenarios (including golden `rome_florence_venice_8n`) due to past travel dates from the hardcoded 2026 year in `smoke.py`. Previously classified as MINOR (N6), this has escalated to MODERATE because it is now live.

---

## CRITICAL

### C1 (CARRIED — 5+ DAYS OPEN) — Login handler missing from `doPost` in Code.gs
**File:** `Code.gs` (not in repo)

`doPost` does not handle `action=checkLogin`. Any re-deploy of Code.gs as-is will lock all users out permanently. **Fix before any next re-deploy.**

**Fix:**
```javascript
if (action === 'checkLogin') return checkLogin(data.user || '', data.pass || '');
```

---

### C2 (CARRIED) — Plaintext passwords in Google Sheet
**File:** `Code.gs` (not in repo)

Passwords stored and compared in plaintext. Any team member with sheet access can read all credentials.

**Fix:** Use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` and store/compare the digest.

---

### C3 (CARRIED — 4 DAYS OPEN, STILL NOT FIXED) — DEV credentials exposed in production HTML
**File:** `app/index.html:1–8`

Still present. The production app at `fit.tripstoreholidays.com/app/` opens with:
```html
<!--
  DEV FILE — index_fit.tripstore.DEV.html
  DO NOT OVERWRITE WITH LIVE FILE. This has features live doesn't.
  DEV Sheet: 1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4
  DEV API: AKfycbz3dpvTIrQ0gQWqmO3cGZ9fHoJ2oHOahZmvLBk-oy7x1ShyNacqhQhjsIVQJ2bYbXuqrQ
-->
```
Anyone viewing page source sees the DEV Sheet ID and DEV deployment ID. Four days open.

**Fix:** Delete lines 1–8 from `app/index.html` and push to v2. Takes 2 minutes.

---

## MODERATE

### M1 (CARRIED) — GST 0% silently replaced with 5%
**File:** `Quote_Intelligence.gs:119` (not in repo)

`const gstPct = d.gst || 5;` treats `gst: 0` as falsy, silently billing 5% GST on zero-rated services.

**Fix:** `const gstPct = d.gst != null ? Number(d.gst) : 5;`

---

### M2 (CARRIED) — `logQuote` infinite recursion risk
**File:** `Quote_Intelligence.gs:33–37` (not in repo)

Recursive retry without a depth guard. If `setupQuoteLog()` fails, the function recurses until stack overflow.

**Fix:** After `setupQuoteLog()`, look up the sheet again; if still null, log and return instead of recursing.

---

### M3 (CARRIED) — Formula injection via `USER_ENTERED` in both sheet writers
**Files:** `write_to_sheets.py:196`, `archive_to_input.py:390`

Both use `value_input_option="USER_ENTERED"`. Any cell beginning with `=`, `+`, `-`, or `@` executes as a formula.

**Fix:** Use `value_input_option="RAW"` for all data rows in both scripts.

---

### M4 (CARRIED — 20 DAYS STALE) — `edge_date_month_boundary` travel date in the past
**File:** `qa/gen_scenarios.py:168`

`travelStartDate="2026-05-29"` is now 20 days in the past. The engine may reject this or apply fallback logic, producing false PASS or false FAIL in smoke.

**Fix:** Change to `"2027-05-29"` or derive at runtime.

---

### M5 (CARRIED) — `innerHTML` injecting unescaped API/user data
**File:** `app/index.html:4900, 4903, 4908`

`intel.nextCity`, `r.city` inserted raw into innerHTML. `_e()` escape helper exists but is not applied.

**Fix:** Apply `_e()` to every API/user value interpolated into innerHTML template literals.

---

### M6 (CARRIED) — Swiss Pass injects five unescaped API strings into `innerHTML`
**File:** `app/index.html:5101, 5131, 5154, 5173`

`l.from`, `l.to`, `t.tour_name`, `missingFlags[].tour_name`, `data.pass_duration` inserted raw. A poisoned sheet row would trigger XSS for every user opening the Swiss Pass panel.

**Fix:** Run all five values through `_e()` before interpolation, or switch to DOM construction (`createElement` / `textContent`).

---

### M7 (CARRIED — WORSENING) — All six P07 seasonal-pair scenarios have past travel dates
**File:** `qa/gen_scenarios.py:186–190`

Both `"2026-04-15"` (2 months past) and `"2026-06-15"` (3 days past) are in the past. The seasonal P07 ratio check is now operating on stale dates in all three pairs, producing unreliable signals.

**Fix:** Update all six `travelStartDate` values to future dates (e.g. April 2027 / June 2027), or generate dynamically from `datetime.date.today()`.

---

### M8 (NEW — ESCALATED FROM N6) — Hardcoded 2026 in `smoke.py` is NOW ACTIVELY BREAKING 26 scenarios including a golden
**File:** `qa/smoke.py:73`

```python
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
```

Previously flagged as N6 (a "Jan 2027 time bomb"). As of today (June 18), this has become an **active smoke gate failure**: every scenario with `month <= 6` and no explicit `travelStartDate` is now firing a past date. Confirmed 26 affected scenarios:

| Scenario | Month | Default Date | Status |
|----------|-------|--------------|--------|
| `top_rome_florence_venice_8n` **[GOLDEN]** | 6 | 2026-06-15 | **Past since Jun 15** |
| `top_london_4n_couple` | 6 | 2026-06-15 | Past since Jun 15 |
| `top_barcelona_5n_couple` | 6 | 2026-06-15 | Past |
| `top_madrid_5n_couple` | 6 | 2026-06-15 | Past |
| `top_milan_4n_couple` | 6 | 2026-06-15 | Past |
| `top_venice_3n_couple` | 6 | 2026-06-15 | Past |
| `top_barcelona_madrid_8n` | 6 | 2026-06-15 | Past |
| `top_italy_grand_10n` | 6 | 2026-06-15 | Past |
| `top_rome_family_5n` | 6 | 2026-06-15 | Past |
| `top_barcelona_family_6n` | 6 | 2026-06-15 | Past |
| `top_madrid_family_5n` | 6 | 2026-06-15 | Past |
| `top_italy_couple_6n` | 6 | 2026-06-15 | Past |
| `top_london_5n_lux` | 6 | 2026-06-15 | Past |
| `pair_child_02_a/b` | 6 | 2026-06-15 | Past |
| `top_rome_5n_couple` | 5 | 2026-05-15 | Past since May 15 |
| `top_prague_4n_couple` | 5 | 2026-05-15 | Past |
| `top_vienna_4n_couple` | 5 | 2026-05-15 | Past |
| `top_florence_4n_couple` | 5 | 2026-05-15 | Past |
| `top_prague_vienna_budapest` | 5 | 2026-05-15 | Past |
| `top_prague_family_4n` | 5 | 2026-05-15 | Past |
| `pair_child_03_a/b` | 5 | 2026-05-15 | Past |
| `top_budapest_4n_couple` | 4 | 2026-04-15 | Past since Apr 15 |
| `top_paris_disney_family` | 4 | 2026-04-15 | Past |

The golden scenario `rome_florence_venice_8n` produces unreliable golden diffs. Any P-check or E-check comparison on these 26 scenarios is now suspect.

**Fix (1 line):**
```python
import datetime
yr = datetime.date.today().year
"travelStartDate": scn.get("travelStartDate", f"{yr}-{scn.get('month', 7):02d}-15")
```

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

`ws.row_count` returns the sheet's grid dimension (default 1000), never 0. The first clause is dead.

**Fix:** `sheet_is_empty = not ws.get_all_values()`

---

### N4 (CARRIED) — Hardcoded live Spreadsheet IDs
**Files:** `write_to_sheets.py:28`, `archive_to_input.py:32`

No safeguard against accidentally running against live data during testing.

**Fix:** `os.environ.get("SPREADSHEET_ID")` with a fallback.

---

### N5 (CARRIED) — 7 Python scripts absent from repository
Still missing: `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`. If in active local use, commit them.

---

### N7 (CARRIED) — `ADOBE_PDF_API` URL not validated by `check_html.py`
**File:** `app/index.html:8476`, `check_html.py:53–95`

PDF deployment URL goes unchecked. If redeployed, PDF generation silently breaks.

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

### N9 (CARRIED) — API_URL comment says "DEV @18" — possible environment mismatch
**File:** `app/index.html:3285`

```javascript
const API_URL = "https://script.google.com/macros/s/AKfycbwP9KQH39hcBcLQsPsOL_c4hKIuV3TTlm1XW2CT2e72W-TYVP01-adjsVAKtAAArhGQWA/exec";
// DEV @18 — 2026-05-04 RBAC 5-role + getAllUsers
```

CLAUDE.md states the live URL fragment should be `AKfycbzAbIgzRoN_MNs377jm3u`. The deployed URL does not contain that fragment and is labelled "DEV". If interpretation 2 applies (wrong URL in production), all saves go to DEV sheet — a data integrity issue.

**Fix:** Open Apps Script → Deploy → Manage Deployments, confirm which environment `AKfycbwP9KQH39...` belongs to. Update CLAUDE.md and the comment to match.

---

### N10 (CARRIED) — `nightly.py` only compares `pair_01` for P01 and P07
**File:** `qa/nightly.py:69–72`

`gen_scenarios.py` generates three pairs each for child (P01) and seasonal (P07), but `nightly.py` only runs the first pair of each. `pair_child_02/03` and `pair_season_02/03` divergences produce no nightly signal.

**Fix:**
```python
for a, b, fn in [
    ("pair_child_01_a",    "pair_child_01_b",   inv.compare_P01_pair),
    ("pair_child_02_a",    "pair_child_02_b",   inv.compare_P01_pair),
    ("pair_child_03_a",    "pair_child_03_b",   inv.compare_P01_pair),
    ("pair_season_01_apr", "pair_season_01_jun", inv.compare_P07_pair),
    ("pair_season_02_apr", "pair_season_02_jun", inv.compare_P07_pair),
    ("pair_season_03_apr", "pair_season_03_jun", inv.compare_P07_pair),
]:
```

---

### N11 (NEW) — `edge_date_booking_eq_travel` travel date expires in 27 days
**File:** `qa/gen_scenarios.py:179`

```python
add(id="edge_date_booking_eq_travel", ...,
    travelStartDate="2026-07-15", flags={"booking_eq_travel":True})
```

On July 16, this date becomes past, corrupting the scenario designed to test same-day booking-equals-travel behaviour. Add to the fix batch alongside M4 and M7.

**Fix:** Change to `"2027-07-15"` or generate dynamically.

---

## Action Items (Priority Order)

1. **[C3 — URGENT, 4 DAYS OPEN]** Delete lines 1–8 from `app/index.html`. Push to v2. 2 minutes.
2. **[M8 — URGENT, ACTIVE NOW]** Fix the hardcoded 2026 in `smoke.py:73` to use `datetime.date.today().year`. 1-line fix. 26 scenarios including golden `rome_florence_venice_8n` are currently producing past-date engine requests.
3. **[C1 — URGENT]** Add `checkLogin` to `doPost` in Code.gs before any re-deploy.
4. **[C2 — HIGH]** Hash passwords in Code.gs.
5. **[N9 — TODAY]** Verify `AKfycbwP9KQH39...` in Apps Script console — confirm live vs. DEV environment.
6. **[M4, M7, N11 — THIS WEEK]** Update all stale and near-expiry `travelStartDate` values in `gen_scenarios.py` to 2027. Re-run `gen_scenarios.py` to regenerate `scenarios.json`.
7. **[M6 — THIS WEEK]** Escape Swiss Pass innerHTML values (`l.from`, `l.to`, `t.tour_name`, `m.tour_name`, `data.pass_duration`) with `_e()`.
8. **[M5 — THIS WEEK]** Apply `_e()` globally to all unescaped `innerHTML` interpolations.
9. **[M3 — THIS WEEK]** Change `USER_ENTERED` to `RAW` in `write_to_sheets.py:196` and `archive_to_input.py:390`.
10. **[N10]** Add pair_02/03 comparisons to `nightly.py`.
11. **[N7]** Add `ADOBE_PDF_API` URL check to `check_html.py`.
12. **[N3, N4, N8]** Dead code, hardcoded IDs, CLASP path — low-effort fixes.
13. **[N5]** Commit the 7 missing Python scripts.

---

*Generated automatically — 2026-06-18*
