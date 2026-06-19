# TripStore Daily Code Review — 2026-06-19

**Files reviewed:** app/index.html, write_to_sheets.py, archive_to_input.py, check_html.py, check_pipeline.py, qa/smoke.py, qa/invariants.py, qa/nightly.py, qa/gen_scenarios.py
**Files absent from repo (cannot inspect):** Code.gs, Pipeline.gs, Quote_Intelligence.gs, extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count | New Today | Carried From 2026-06-18 |
|----------|-------|-----------|--------------------------|
| CRITICAL | 3     | 0         | C1, C2, C3 carried open  |
| MODERATE | 8     | 0         | M1–M8 carried            |
| MINOR    | 12    | 1 new (N12) | N1–N5, N7–N11 carried |
| **Total**| **23**| **1 new** | **22 still open, zero fixes landed in 3 days** |

> ⚠️ **Zero fixes landed since the 2026-06-16 report (3 days).** All prior issues remain open.
>
> **Escalation watch:**
> - **C3** is now **5 days open** — DEV credentials visible in production HTML source to any visitor. 2-minute fix.
> - **M8** is now **4 days into active breakage** — 26 smoke scenarios (including golden `rome_florence_venice_8n`) are generating past travel dates. Smoke gate reliability is degraded.
> - **N11** (edge_date_booking_eq_travel) expires in **26 days**. Add to the fix batch with M4/M7.

---

## CRITICAL

### C1 (CARRIED — 6+ DAYS OPEN) — Login handler missing from `doPost` in Code.gs
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

### C3 (CARRIED — **5 DAYS OPEN**, STILL NOT FIXED) — DEV credentials exposed in production HTML
**File:** `app/index.html:1–8` — CONFIRMED STILL PRESENT

The production app at `fit.tripstoreholidays.com/app/` opens with the following comment visible to any user who views page source:
```html
<!--
  DEV FILE — index_fit.tripstore.DEV.html
  DO NOT OVERWRITE WITH LIVE FILE. This has features live doesn't.
  DEV Sheet: 1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4
  DEV API: AKfycbz3dpvTIrQ0gQWqmO3cGZ9fHoJ2oHOahZmvLBk-oy7x1ShyNacqhQhjsIVQJ2bYbXuqrQ
-->
```
Five days open. The DEV Sheet ID and DEV deployment ID are fully public.

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
**Files:** `write_to_sheets.py:196`, `archive_to_input.py:390` — CONFIRMED STILL OPEN

Both use `value_input_option="USER_ENTERED"`. Any cell beginning with `=`, `+`, `-`, or `@` executes as a formula in Google Sheets.

**Fix:** Use `value_input_option="RAW"` for all data rows in both scripts.

---

### M4 (CARRIED — **21 DAYS STALE**) — `edge_date_month_boundary` travel date in the past
**File:** `qa/gen_scenarios.py:168` — CONFIRMED STILL OPEN

`travelStartDate="2026-05-29"` is 21 days in the past. The engine may apply fallback logic, producing unreliable smoke signals.

**Fix:** Change to `"2027-05-29"` or derive at runtime.

---

### M5 (CARRIED) — `innerHTML` injecting unescaped API/user data
**File:** `app/index.html:4900, 4903, 4908` — CONFIRMED STILL OPEN

`intel.nextCity` (line 4900) and `r.city` (lines 4903, 4908) injected raw into innerHTML template literals. `_e()` escape helper exists but is not applied.

**Fix:** Apply `_e()` to every API/user value interpolated into innerHTML template literals.

---

### M6 (CARRIED) — Swiss Pass injects five unescaped API strings into `innerHTML`
**File:** `app/index.html:5101, 5131, 5154, 5173` — CONFIRMED STILL OPEN

`l.from`, `l.to` (line 5101), `t.tour_name` (line 5131), `missingFlags[].tour_name` (line 5154 via `.map(m => m.tour_name)`), and `data.pass_duration` (line 5173) are all injected raw. A poisoned sheet row would trigger stored XSS for every user opening the Swiss Pass panel.

**Fix:** Run all five values through `_e()` before interpolation, or switch to DOM construction (`createElement` / `textContent`).

---

### M7 (CARRIED — WORSENING) — All six P07 seasonal-pair scenarios have past travel dates
**File:** `qa/gen_scenarios.py:186–190` — CONFIRMED STILL OPEN

Both `"2026-04-15"` (65 days past) and `"2026-06-15"` (4 days past) are now in the past across all three seasonal pairs. The P07 ratio check is operating on stale dates, producing unreliable signals.

**Fix:** Update all six `travelStartDate` values to future dates (e.g. April 2027 / June 2027), or generate dynamically from `datetime.date.today()`.

---

### M8 (CARRIED — **ACTIVE FOR 4 DAYS**) — Hardcoded 2026 in `smoke.py` is actively breaking 26 scenarios including a golden
**File:** `qa/smoke.py:73` — CONFIRMED STILL OPEN

```python
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
```

As of today (June 19, 2026), every scenario with `month <= 6` and no explicit `travelStartDate` fires a past travel date. This has been actively broken since June 15 (4 days). Confirmed 26 affected scenarios including the golden `rome_florence_venice_8n`. Any E/P check on these 26 scenarios is now suspect. The golden file may reflect a stale or error-mode engine response.

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
**File:** `write_to_sheets.py:168` — CONFIRMED STILL OPEN

`ws.row_count` returns the sheet's grid dimension (default 1000), never 0. The first clause is dead.

**Fix:** `sheet_is_empty = not ws.get_all_values()`

---

### N4 (CARRIED) — Hardcoded live Spreadsheet IDs
**Files:** `write_to_sheets.py:28`, `archive_to_input.py:32` — CONFIRMED STILL OPEN

No safeguard against accidentally running against live data during testing.

**Fix:** `os.environ.get("SPREADSHEET_ID")` with a fallback.

---

### N5 (CARRIED) — 7 Python scripts absent from repository
Still missing: `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`. If in active local use, commit them.

---

### N7 (CARRIED) — `ADOBE_PDF_API` URL not validated by `check_html.py`
**File:** `app/index.html`, `check_html.py:53–95`

PDF deployment URL goes unchecked. If redeployed, PDF generation silently breaks.

**Fix:** Add `ADOBE_PDF_API` fragment to the `REQUIRED` list in `check_html.py`.

---

### N8 (CARRIED) — `check_pipeline.py` hardcoded to Sumit's Mac path
**File:** `check_pipeline.py:16` — CONFIRMED STILL OPEN

```python
CLASP_LIVE_ROOT = os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live')
```
Exits on any other machine (cloud sessions, CI, second developer).

**Fix:** `CLASP_LIVE_ROOT = os.environ.get('CLASP_LIVE_ROOT') or os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live')`

---

### N9 (CARRIED) — API_URL comment says "DEV @18" — possible environment mismatch
**File:** `app/index.html:3285` — CONFIRMED STILL OPEN

```javascript
const API_URL = "https://script.google.com/macros/s/AKfycbwP9KQH39hcBcLQsPsOL_c4hKIuV3TTlm1XW2CT2e72W-TYVP01-adjsVAKtAAArhGQWA/exec";
// DEV @18 — 2026-05-04 RBAC 5-role + getAllUsers
```

CLAUDE.md states the live URL fragment should be `AKfycbzAbIgzRoN_MNs377jm3u`. The deployed URL does not contain that fragment and is labelled "DEV". If the wrong URL is in production, all saves go to the DEV sheet — a data integrity issue.

**Fix:** Open Apps Script → Deploy → Manage Deployments, confirm which environment `AKfycbwP9KQH39...` belongs to. Update CLAUDE.md and the comment to match.

---

### N10 (CARRIED) — `nightly.py` only compares `pair_01` for P01 and P07
**File:** `qa/nightly.py:69–72` — CONFIRMED STILL OPEN

`gen_scenarios.py` generates three pairs each for child (P01) and seasonal (P07), but `nightly.py` only runs the first pair of each.

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

### N11 (CARRIED — 26 DAYS TO EXPIRY) — `edge_date_booking_eq_travel` travel date expires July 15
**File:** `qa/gen_scenarios.py:179`

```python
travelStartDate="2026-07-15"
```

On July 16, this date becomes past. Include in the same fix batch as M4 and M7.

**Fix:** Change to `"2027-07-15"` or generate dynamically.

---

### N12 (NEW) — Transfer dedup city key mismatch in `archive_to_input.py`
**File:** `archive_to_input.py:155–161, 178–184, 220–225`

`transfers_keys()` builds dedup keys using column 0 of the master sheet (e.g. `"London"`). But `parse_transfers_cell` derives the city from a regex split of the "from" description string. The keyword list in the regex (`cdg|lhr|ams|fra|vie|bcn|fco|airport|...`) does NOT include "heathrow", "gatwick", "stansted", "schiphol", "orly", "bergamo", or other airport names written in full. For any transfer with a full airport name (not a 3-letter code), the heuristic returns `city="London Heathrow"` instead of `"London"`, breaking the dedup match. Transfers already enriched in the master will be re-queued to INPUT_Transfers, creating duplicates that Pipeline.gs must process again, wasting enrichment quota.

**Fix (option A):** Add common full airport names to the regex keyword list.
**Fix (option B):** Use `(from_loc.lower(), to_loc.lower())` as the dedup key for transfers (matching the bidirectional dedup pattern already used for trains) and update `transfers_keys()` to match col 7+8 rather than col 0+7+8.

---

## Action Items (Priority Order)

1. **[C3 — URGENT, 5 DAYS OPEN]** Delete lines 1–8 from `app/index.html`. Push to v2. 2 minutes.
2. **[M8 — URGENT, 4 DAYS ACTIVE]** Fix hardcoded 2026 in `smoke.py:73` to use `datetime.date.today().year`. 1-line fix.
3. **[C1 — URGENT]** Add `checkLogin` to `doPost` in Code.gs before any re-deploy.
4. **[C2 — HIGH]** Hash passwords in Code.gs.
5. **[N9 — TODAY]** Verify `AKfycbwP9KQH39...` in Apps Script console — confirm live vs. DEV environment.
6. **[M4, M7, N11 — THIS WEEK]** Update all stale and near-expiry `travelStartDate` values in `gen_scenarios.py` to 2027. Re-run `gen_scenarios.py` to regenerate `scenarios.json`.
7. **[M6 — THIS WEEK]** Escape Swiss Pass innerHTML values (`l.from`, `l.to`, `t.tour_name`, `m.tour_name`, `data.pass_duration`) with `_e()`.
8. **[M5 — THIS WEEK]** Apply `_e()` globally to all unescaped `innerHTML` interpolations.
9. **[M3 — THIS WEEK]** Change `USER_ENTERED` to `RAW` in `write_to_sheets.py:196` and `archive_to_input.py:390`.
10. **[N12]** Fix transfer dedup city key mismatch in `archive_to_input.py`.
11. **[N10]** Add pair_02/03 comparisons to `nightly.py`.
12. **[N7]** Add `ADOBE_PDF_API` URL check to `check_html.py`.
13. **[N3, N4, N8]** Dead code, hardcoded IDs, CLASP path — low-effort fixes.
14. **[N5]** Commit the 7 missing Python scripts.

---

*Generated automatically — 2026-06-19*
