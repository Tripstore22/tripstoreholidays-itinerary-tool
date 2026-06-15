# TripStore Daily Code Review — 2026-06-15

**Files reviewed:** app/index.html, write_to_sheets.py, archive_to_input.py, check_html.py, check_pipeline.py, qa/smoke.py, qa/invariants.py, qa/nightly.py, qa/gen_scenarios.py
**Files absent from repo (cannot inspect):** Code.gs, Pipeline.gs, Quote_Intelligence.gs, extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count | New Today | Carried From 2026-06-13 |
|----------|-------|-----------|--------------------------|
| CRITICAL | 3     | 1 new + 2 carried | C1, C2 from prior report |
| MODERATE | 6     | 3 new + 3 carried | M1, M2, M5 from prior |
| MINOR    | 7     | 4 new + 3 carried | N3, N4, N5 from prior |
| **Total**| **16** | **8 new** | **8 still open** |

> ⚠️ **C1 and C2 from the 2026-06-13 report (login broken, plaintext passwords) are still listed as OPEN** because Code.gs is not in this repo and cannot be re-inspected. They remain highest priority.

---

## CRITICAL

### C1 (CARRIED) — Login handler missing from `doPost` in Code.gs
**File:** `Code.gs` (not in repo — verified via June 13 review)

`doPost` does not handle `action=checkLogin`. Any re-deploy of Code.gs as-is will lock all users out permanently. **Unchanged from prior report. Fix immediately before next re-deploy.**

**Fix:** Add the missing case to `doPost`:
```javascript
if (action === 'checkLogin') return checkLogin(data.user || '', data.pass || '');
```

---

### C2 (CARRIED) — Plaintext passwords in Google Sheet
**File:** `Code.gs` (not in repo — verified via June 13 review)

Passwords are stored and compared in plaintext. Any team member with sheet access can read all user credentials. **Unchanged from prior report.**

**Fix:** Use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` and store/compare the digest.

---

### C3 (NEW) — DEV credentials exposed in production HTML comments
**File:** `app/index.html:1–8`

The production file served at `fit.tripstoreholidays.com/app/` starts with this comment block:
```html
<!--
  DEV FILE — index_fit.tripstore.DEV.html
  DO NOT OVERWRITE WITH LIVE FILE. This has features live doesn't.
  DEV Sheet: 1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4
  DEV API: AKfycbz3dpvTIrQ0gQWqmO3cGZ9fHoJ2oHOahZmvLBk-oy7x1ShyNacqhQhjsIVQJ2bYbXuqrQ
-->
```
Anyone who views page source of the live site sees the DEV Google Sheet ID and DEV deployment ID. With the Sheet ID and a Google account that has been granted access, or if sheet sharing settings have any gap, this exposes the DEV data environment.

Additionally, the label says "DEV FILE" but `app/index.html` is now the **production** app (per the Option B split). The comment is a stale relic that was never removed when the file was promoted.

**Fix (two steps):**
1. Remove the entire comment block (lines 1–8) from `app/index.html`.
2. Add the correct production header if needed, omitting all credentials.

---

## MODERATE

### M1 (CARRIED) — GST 0% silently replaced with 5%
**File:** `Quote_Intelligence.gs:119` (not in repo — confirmed via June 13 review)

`const gstPct = d.gst || 5;` treats `gst: 0` as falsy, silently billing 5% GST on zero-rated services.

**Fix:** `const gstPct = d.gst != null ? Number(d.gst) : 5;`

---

### M2 (CARRIED) — `logQuote` infinite recursion risk
**File:** `Quote_Intelligence.gs:33–37` (not in repo)

Recursive retry without a guard. If `setupQuoteLog()` fails, the function recurses until stack overflow.

**Fix:** After `setupQuoteLog()`, look up the sheet again; if still null, log and return instead of recursing.

---

### M3 (NEW) — Formula injection via `USER_ENTERED` in both Python sheet writers
**Files:** `write_to_sheets.py:196`, `archive_to_input.py:390`

Both scripts write CSV data to Google Sheets with `value_input_option="USER_ENTERED"`:
```python
ws.append_rows(new_rows, value_input_option="USER_ENTERED")   # write_to_sheets.py:196
ss.worksheet(sheet_name).append_rows(rows, value_input_option="USER_ENTERED")  # archive_to_input.py:390
```
If any CSV cell begins with `=`, `+`, `-`, or `@`, Google Sheets will evaluate it as a formula. An itinerary archive row with a hotel cost like `=SUM(A1:A100)` or a name containing `=IMPORTDATA(...)` would execute in the sheet. This is a CSV injection / formula injection vulnerability.

Note: `write_to_sheets.py` correctly uses `"RAW"` for the header row (line 170) but `"USER_ENTERED"` for data rows.

**Fix:** Use `value_input_option="RAW"` for all data rows in both scripts. RAW writes literal strings; the sheet user can always reformat manually if needed.

---

### M4 (NEW) — `edge_date_month_boundary` scenario date already in the past
**File:** `qa/gen_scenarios.py:169`

```python
add(id="edge_date_month_boundary", category="dates", ..., month=5,
    travelStartDate="2026-05-29",
    flags={"spans":"May->June","assert":"which_rule_applies_seasonal_switch"})
```
Today is 2026-06-15. This scenario's start date (`2026-05-29`) is 17 days in the past. The engine may reject past travel dates outright or apply unexpected seasonal logic, causing this scenario to produce a false FAIL or false PASS in nightly runs.

**Fix:** Update `travelStartDate` to a future date that still spans a May/June boundary (e.g., next year: `"2027-05-29"`), or make it relative: derive from today's date at runtime.

---

### M5 (CARRIED) — `innerHTML` injecting unescaped API/user data
**File:** `app/index.html:4900, 4903, 4908` (and broader pattern from June 13)

City intelligence data (`intel.nextCity`) and user-entered city names (`r.city`) are inserted directly into `innerHTML` without escaping:
```javascript
// line 4900
`Often Paired With: <b style="...">${intel.nextCity}</b>`
// line 4903
`No archive data for ${r.city}`
// line 4908
`<span ...>${r.city}</span>`
```
The `_e()` escape helper exists (defined inside `loadSavedList` at line 4333) but is only used in one place. If the Google Sheet or API returns a city name containing `<script>` or `"onmouseover="`, it will execute in the browser.

**Fix:** Define `_e()` globally and apply it to every API/user value interpolated into innerHTML template literals.

---

## MINOR

### N1 (CARRIED) — `doGet` login exposes password in URL
**File:** `Code.gs` (not in repo)

GET-based login writes credentials to Apps Script execution logs permanently.

**Fix:** Remove GET login path; handle login exclusively in `doPost`.

---

### N2 (CARRIED) — No brute-force protection on login
**File:** `Code.gs` (not in repo)

No rate limiting, lockout, or delay on failed login attempts.

**Fix:** Add `Utilities.sleep(500)` on every login call; log repeated failures.

---

### N3 (CARRIED) — Dead code: `ws.row_count == 0` always false
**File:** `write_to_sheets.py:168`

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```
`ws.row_count` returns the sheet's grid dimension (default 1000), never 0. The first clause is dead.

**Fix:** `sheet_is_empty = not ws.get_all_values()`

---

### N4 (CARRIED) — Hardcoded live Spreadsheet IDs
**Files:** `write_to_sheets.py:28`, `archive_to_input.py:32`

Both hardcode the LIVE sheet ID. There's no safeguard against accidentally running against live data during testing.

**Fix:** Read from `os.environ.get("SPREADSHEET_ID")` with a fallback, or add a `--dry-run` flag.

---

### N5 (CARRIED) — 7 Python scripts absent from repository
See June 13 report. Still missing from repo: `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`. If in active local use, commit them.

---

### N6 (NEW) — Hardcoded year 2026 in `smoke.py` default start date
**File:** `qa/smoke.py:73`

```python
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
```
On January 1, 2027 this will generate past dates for every scenario that doesn't override `travelStartDate`. All engine POSTs will hit past-date logic, potentially breaking the entire smoke gate silently.

**Fix:** Use `datetime.date.today().year` dynamically:
```python
import datetime
yr = datetime.date.today().year
"travelStartDate": scn.get("travelStartDate", f"{yr}-{scn.get('month', 7):02d}-15")
```

---

### N7 (NEW) — ADOBE_PDF_API URL not covered by `check_html.py` validator
**File:** `app/index.html:8476`, `check_html.py:53–95`

```javascript
const ADOBE_PDF_API = 'https://script.google.com/macros/s/AKfycbzHI5cGHeknV7qlGNx3X62qtNH_STe3t6wRTBiJ0aEPU2I0lj9_Z9MI2qmUKzX3osl35Q/exec';
```
The main `API_URL` is validated by `check_html.py`, but `ADOBE_PDF_API` is not. If this Apps Script deployment is re-versioned, PDF generation silently breaks with no validator catching it.

**Fix:** Add `ADOBE_PDF_API` to the `REQUIRED` list in `check_html.py` (or at minimum a warning check for the URL fragment).

---

### N8 (NEW) — `check_pipeline.py` hardcoded to Sumit's Mac path
**File:** `check_pipeline.py:16`

```python
CLASP_LIVE_ROOT = os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live')
```
This path is specific to one machine. The script exits with an informative error on any other machine (including cloud sessions), making it non-runnable in CI or by a second developer.

**Fix:** Allow override via environment variable:
```python
CLASP_LIVE_ROOT = os.environ.get('CLASP_LIVE_ROOT') or os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live')
```

---

## Action Items (Priority Order)

1. **[C1 — URGENT]** Add `checkLogin` to `doPost` in Code.gs before next re-deploy — this will break login for all users otherwise.
2. **[C2 — URGENT]** Hash passwords in Code.gs (`handleSignup` + `checkLogin`).
3. **[C3 — TODAY]** Remove DEV credentials comment block from `app/index.html` lines 1–8 and push.
4. **[M3 — THIS WEEK]** Change `value_input_option` to `"RAW"` for data rows in `write_to_sheets.py` and `archive_to_input.py`.
5. **[M4 — TODAY]** Update `edge_date_month_boundary` `travelStartDate` to a future date in `gen_scenarios.py` and regenerate `scenarios.json`.
6. **[M5 — THIS WEEK]** Define `_e()` globally in `app/index.html` and apply to all innerHTML template-literal substitutions.
7. **[N6 — BEFORE JAN 2027]** Fix hardcoded year 2026 in `smoke.py:73` to use `datetime.date.today().year`.
8. **[N7]** Add `ADOBE_PDF_API` URL check to `check_html.py` REQUIRED list.
9. **[N3]** Remove dead `ws.row_count == 0` check in `write_to_sheets.py:168`.
10. **[N8]** Make `CLASP_LIVE_ROOT` overridable via env variable in `check_pipeline.py`.
11. **[N4, N5]** Environment-variable Spreadsheet IDs; commit missing Python scripts.

---

*Generated automatically — 2026-06-15*
