# TripStore Daily Code Review — 2026-06-21

**Files reviewed:** app/index.html, write_to_sheets.py, archive_to_input.py, check_html.py, check_pipeline.py, Quote_Intelligence_Dashboard.html, qa/smoke.py, qa/invariants.py, qa/nightly.py, qa/gen_scenarios.py
**Files absent from repo (cannot inspect):** Code.gs, Pipeline.gs, Quote_Intelligence.gs, extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count | New Today | Carried |
|----------|-------|-----------|----------|
| CRITICAL | 3     | 0         | C1, C2, C3 |
| MODERATE | 9     | 1 new (M9)| M1–M8 |
| MINOR    | 15    | 2 new (N15, N16) | N1–N14 |
| **Total**| **27**| **3 new** | **24 still open — zero fixes in 5 days** |

> ⚠️ **Zero fixes landed since the 2026-06-16 report (5 days).** All prior issues remain open.
>
> **Escalation watch:**
> - **C3** is now **7 DAYS OPEN** — DEV Sheet ID and DEV API deployment key visible in production HTML source to any visitor. Still present in `app/index.html:1–8`. 2-minute fix.
> - **M8** is now **6 DAYS OF ACTIVE BREAKAGE** — `smoke.py:73` hardcoded 2026 means all month ≤ 6 scenarios run with past travel dates. Engine may apply fallback logic silently — golden diffs are unreliable.
> - **M4** is now **23 DAYS STALE.** `edge_date_month_boundary` fired May 29, 2026.
> - **M7 WORSENING:** April P07 dates are now **67 days** in the past; June P07 dates **6 days** in the past.
> - **N11** — `edge_date_booking_eq_travel` expires in **24 days** (July 15).
> - **M9 (NEW TODAY)** — `Quote_Intelligence_Dashboard.html` silently replaces a failed API call with demo data, hiding production outages from analysts.

---

## CRITICAL

### C1 (CARRIED — 7+ DAYS OPEN) — Login handler missing from `doPost` in Code.gs
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

### C3 (CARRIED — **7 DAYS OPEN**, STILL NOT FIXED) — DEV credentials exposed in production HTML
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
Seven days open. The DEV Sheet ID and DEV deployment key are fully public.

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

### M4 (CARRIED — **23 DAYS STALE**) — `edge_date_month_boundary` travel date in the past
**File:** `qa/gen_scenarios.py:168` — CONFIRMED STILL OPEN

`travelStartDate="2026-05-29"` is now 23 days in the past. The engine may apply fallback logic, producing unreliable smoke signals.

**Fix:** Change to `"2027-05-29"` or derive at runtime.

---

### M5 (CARRIED) — `innerHTML` injecting unescaped API/user data
**File:** `app/index.html:4900, 4903, 4908` — CONFIRMED STILL OPEN

`intel.nextCity` (line 4900) and `r.city` (lines 4903, 4908) injected raw into innerHTML template literals. `_e()` escape helper exists but is not applied.

**Fix:** Apply `_e()` to every API/user value interpolated into innerHTML template literals.

---

### M6 (CARRIED) — Swiss Pass injects five unescaped API strings into `innerHTML`
**File:** `app/index.html:5101, 5131, 5154, 5173` — CONFIRMED STILL OPEN

`l.from`, `l.to` (line 5101), `t.tour_name` (line 5131), `missingFlags[].tour_name` (line 5154), and `data.pass_duration` (line 5173) are all injected raw. A poisoned sheet row would trigger stored XSS for every user opening the Swiss Pass panel.

**Fix:** Run all five values through `_e()` before interpolation, or switch to DOM construction.

---

### M7 (CARRIED — WORSENING) — All six P07 seasonal-pair scenarios have past travel dates
**File:** `qa/gen_scenarios.py:185–190` — CONFIRMED STILL OPEN

`"2026-04-15"` is now **67 days** in the past; `"2026-06-15"` is now **6 days** in the past. The P07 ratio check is operating on stale dates across all three seasonal pairs.

**Fix:** Update all six `travelStartDate` values to `"2027-04-15"` / `"2027-06-15"`, or generate dynamically.

---

### M8 (CARRIED — **ACTIVE FOR 6 DAYS**) — Hardcoded 2026 in `smoke.py` actively breaking scenarios
**File:** `qa/smoke.py:73` — CONFIRMED STILL OPEN

```python
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
```

As of today (June 21, 2026), every scenario with `month <= 6` and no explicit `travelStartDate` fires a past travel date. Actively broken for 6 days. Golden `rome_florence_venice_8n` (month=6) is affected — golden diffs captured since June 15 may reflect stale or fallback-mode engine responses.

**Fix (1 line):**
```python
import datetime
yr = datetime.date.today().year
"travelStartDate": scn.get("travelStartDate", f"{yr}-{scn.get('month', 7):02d}-15")
```

---

### M9 (NEW) — `Quote_Intelligence_Dashboard.html` silently falls back to demo data on API failure
**File:** `Quote_Intelligence_Dashboard.html:155–168`

```javascript
async function loadData() {
  try {
    const res = await fetch(API_URL + '?action=getQuoteLog');
    const live = await res.json();
    allData = (Array.isArray(live) && live.length > 0) ? live : DEMO_DATA;
    ...
  } catch(e) {
    document.getElementById('mainContent').innerHTML = '⚠️ Could not load data...' + e.message + ...
  }
}
```

If the API is reachable but returns an empty array (e.g. Quote_Log not yet populated, or a deploy clears it), `allData` silently becomes `DEMO_DATA` — 11 fabricated entries including a Dimple quote showing 578.5% utilisation and Q-10009 over budget. Analysts see fabricated data and may act on false signals. There is no visual indicator distinguishing "live data" from "demo fallback" once the dashboard renders.

**Fix:** Show a distinct "Demo data — API returned no records" banner when falling back; never silently mix demo into the render path.

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

### N9 (CARRIED) — API URL comment says "DEV @18" in production file
**File:** `app/index.html:3285` — CONFIRMED STILL OPEN

```javascript
const API_URL = "https://script.google.com/macros/s/AKfycbwP9KQH39hcBcLQsPsOL_c4hKIuV3TTlm1XW2CT2e72W-TYVP01-adjsVAKtAAArhGQWA/exec";
// DEV @18 — 2026-05-04 RBAC 5-role + getAllUsers
```

CLAUDE.md states the live URL fragment should be `AKfycbzAbIgzRoN_MNs377jm3u`. The deployed URL does not contain that fragment and is labelled "DEV". Confirm this is intentional and update the comment and CLAUDE.md.

---

### N10 (CARRIED) — `nightly.py` only compares `pair_01` for P01 and P07
**File:** `qa/nightly.py:69–72` — CONFIRMED STILL OPEN

`gen_scenarios.py` generates three pairs each for child (P01) and seasonal (P07), but `nightly.py` only runs the first pair of each. Pairs 02 and 03 are never compared nightly.

**Fix:** Add pair_02/03 comparisons to the nightly loop.

---

### N11 (CARRIED — **24 DAYS TO EXPIRY**) — `edge_date_booking_eq_travel` travel date expires July 15
**File:** `qa/gen_scenarios.py:179`

```python
travelStartDate="2026-07-15"
```

On July 16, this date becomes past. Include in the same fix batch as M4 and M7.

**Fix:** Change to `"2027-07-15"` or generate dynamically.

---

### N12 (CARRIED) — Transfer dedup city key mismatch in `archive_to_input.py`
**File:** `archive_to_input.py:155–161, 178–184, 220–225`

`transfers_keys()` builds dedup keys using column 0 (e.g. `"London"`). But `parse_transfers_cell` derives city via a regex split that lacks full airport names ("heathrow", "gatwick", "schiphol", "orly", "bergamo", etc.). For any transfer written with a full airport name, the heuristic returns `"London Heathrow"` instead of `"London"`, breaking the dedup match and re-queuing already-enriched transfers.

**Fix (option A):** Add full airport names to the regex keyword list.
**Fix (option B):** Use `(from_loc.lower(), to_loc.lower())` as the dedup key, matching the bidirectional pattern used for trains.

---

### N13 (CARRIED) — T08 check name mismatch between exception path and success path in `smoke.py`
**File:** `qa/smoke.py:291` (success path) vs `qa/smoke.py:313` (exception path)

In the success path, T08 is reported as `"T08_combo_a1_self_ref"`:
```python
results.append(_chk("T08", "T08_combo_a1_self_ref", t08, ...))
```
In the exception-catch block, it is reported as `"T08_a1_self_ref"`:
```python
("T08", "T08_a1_self_ref"),
```
If `known_issues.json` ever references `T08_combo_a1_self_ref`, the exception-path SKIP result won't be matched by the ratchet.

**Fix:** Change `"T08_a1_self_ref"` on line 313 to `"T08_combo_a1_self_ref"`.

---

### N14 (CARRIED) — `check_shape()` only validates the first tour's schema
**File:** `qa/invariants.py:82–86`

```python
for _, _, t in _city_tours(resp):
    for k in ("hours", "canonical_id", "name"):
        if k not in t:
            return _r("shape", "shape", "FAIL", ...)
    break    # ← exits after the first tour only
return _r("shape", "shape", "PASS", sid)
```

Tours 2..N are never validated. An engine regression where only later tours are malformed would pass the shape check unchallenged.

**Fix:** Remove the `break` and return PASS only after the loop completes naturally:
```python
for _, _, t in _city_tours(resp):
    for k in ("hours", "canonical_id", "name"):
        if k not in t:
            return _r("shape", "shape", "FAIL", sid, expected=f"tour has {k}", got=sorted(t.keys()))
return _r("shape", "shape", "PASS", sid)
```

---

### N15 (NEW) — `e.message` inserted into `innerHTML` in Quote Intelligence Dashboard
**File:** `Quote_Intelligence_Dashboard.html:164–166`

```javascript
document.getElementById('mainContent').innerHTML =
  '...⚠️ Could not load data...<small>' + e.message + '</small></div>';
```

`e.message` from a failed `fetch()` or `res.json()` call is injected directly into `innerHTML` without escaping. If a malicious proxy or server returns a response whose parse error contains HTML/script tags, this is an XSS vector. Low-probability in practice but trivial to fix.

**Fix:** `document.createTextNode(e.message)` or sanitise with `.replace(/</g, '&lt;')` before inserting.

---

### N16 (NEW) — Apparent real customer names and financial figures in public `DEMO_DATA`
**File:** `Quote_Intelligence_Dashboard.html:139–150`

The `DEMO_DATA` constant contains 11 entries with names (`Sumit`, `Fatema`, `Benson`, `Dimple`, `Arun`, `Aanchal`) and precise INR quote amounts (₹1.63L–₹5.28L). This file is committed to a public GitHub repository (GitHub Pages host). If any of these are real clients, their travel itinerary costs are publicly disclosed.

**Fix:** Replace with clearly synthetic names (`Test_Client_A`, `Sample_User_B`, etc.) and round/scramble the financial figures.

---

## Action Items (Priority Order)

1. **[C3 — URGENT, 7 DAYS OPEN]** Delete lines 1–8 from `app/index.html`. Push to v2. 2 minutes.
2. **[M8 — URGENT, 6 DAYS ACTIVE]** Fix hardcoded 2026 in `smoke.py:73` to use `datetime.date.today().year`. 1-line fix.
3. **[C1 — URGENT]** Add `checkLogin` to `doPost` in Code.gs before any re-deploy.
4. **[C2 — HIGH]** Hash passwords in Code.gs.
5. **[N16 — THIS WEEK]** Replace apparent real client names in `DEMO_DATA` with synthetic placeholders.
6. **[M9 — THIS WEEK]** Add a visible "Demo fallback active" banner to `Quote_Intelligence_Dashboard.html` so analysts are never silently shown fabricated data.
7. **[N9 — TODAY]** Verify `AKfycbwP9KQH39...` in Apps Script console — confirm live vs. DEV environment.
8. **[M4, M7, N11 — THIS WEEK]** Update all stale and near-expiry `travelStartDate` values in `gen_scenarios.py` to 2027. Re-run to regenerate `scenarios.json`.
9. **[M6 — THIS WEEK]** Escape Swiss Pass innerHTML values with `_e()`.
10. **[M5 — THIS WEEK]** Apply `_e()` globally to all unescaped `innerHTML` interpolations.
11. **[M3 — THIS WEEK]** Change `USER_ENTERED` to `RAW` in `write_to_sheets.py:196` and `archive_to_input.py:390`.
12. **[N15 — QUICK]** Sanitise `e.message` before inserting into innerHTML in `Quote_Intelligence_Dashboard.html`.
13. **[N13 — QUICK]** Fix T08 check name in `smoke.py:313` to `"T08_combo_a1_self_ref"`.
14. **[N14 — QUICK]** Remove the `break` from `check_shape()` in `invariants.py:86`.
15. **[N12]** Fix transfer dedup city key mismatch in `archive_to_input.py`.
16. **[N10]** Add pair_02/03 comparisons to `nightly.py`.
17. **[N7]** Add `ADOBE_PDF_API` URL check to `check_html.py`.
18. **[N3, N4, N8]** Dead code, hardcoded IDs, CLASP path — low-effort fixes.
19. **[N5]** Commit the 7 missing Python scripts.

---

*Generated automatically — 2026-06-21*
