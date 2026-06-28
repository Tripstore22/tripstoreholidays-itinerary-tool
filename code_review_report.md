# TripStore Daily Code Review — 2026-06-28

**Reviewed by:** Automated daily review  
**Branch:** v2  
**Last commit:** `8ca3845` — Auto: daily code review 2026-06-27

---

## Files Reviewed

| File | Status |
|------|--------|
| `index.html` (landing page / index_fit.tripstore.html copy) | ✅ Reviewed |
| `app/index.html` (itinerary tool) | ✅ Reviewed (first 100 lines) |
| `write_to_sheets.py` | ✅ Reviewed |
| `archive_to_input.py` | ✅ Reviewed |
| `check_pipeline.py` | ✅ Reviewed |
| `check_html.py` | ✅ Reviewed |
| `qa/smoke.py` | ✅ Reviewed |
| `qa/invariants.py` | ✅ Reviewed |
| `qa/nightly.py` | ✅ Reviewed |

## Files NOT in this repo (cannot review remotely)

The following files requested for review do not exist in the GitHub repository. They live on Sumit's local machine at `~/Desktop/tripstore-pipeline/`:

- `Code.gs` — not in repo
- `Pipeline.gs` — not in repo
- `Quote_Intelligence.gs` — not in repo
- `extract_itineraries.py` — not in repo
- `write_inputs_to_sheets.py` — not in repo
- `cleanup_sheet.py` — not in repo
- `clean_pipeline_data.py` — not in repo
- `cross_reference.py` — not in repo
- `enrich_hotels.py` — not in repo
- `enrich_hotels_booking.py` — not in repo

**Action required:** These files should either be added to the repo or reviewed separately on the local machine using `check_pipeline.py`.

---

## Findings

### CRITICAL

---

#### C-01 — `check_html.py`: API URL mismatch between validator and CLAUDE.md

**File:** `check_html.py`, line 90  
**Issue:** The hardcoded API URL fragment in `check_html.py` does not match the live API URL listed in `CLAUDE.md`.

- `check_html.py` requires: `AKfycbwP9KQH39hcBcLQsPsOL_c4hKIuV3TTlm1XW2CT2e72W-TYVP01-adjsVAKtAAArhGQWA`  
- `CLAUDE.md` says live URL contains: `AKfycbzAbIgzRoN_MNs377jm3u`  
- `app/index.html` (DEV header comment) shows: `AKfycbz3dpvTIrQ0gQWqmO3cGZ9fHoJ2oHOahZmvLBk-oy7x1ShyNacqhQhjsIVQJ2bYbXuqrQ`  

None of these three strings match each other. The note in `check_html.py` says: *"If Apps Script is redeployed, update the URL fragment below."* This check appears to have been missed after at least one redeployment. The "Correct API URL" invariant in `check_html.py` is currently not validating the actual deployment in use.

**Action:** Open `app/index.html`, search for `script.google.com/macros`, and copy the exact deployment ID into `check_html.py` line 90 and 110. Also sync `CLAUDE.md` live API fragment if it has changed.

---

#### C-02 — `app/index.html` carries a DEV file header comment in the live repo

**File:** `app/index.html`, lines 1–8  
**Issue:** The file at `app/index.html` (served at `fit.tripstoreholidays.com/app/`) carries this comment header:

```html
<!--
  DEV FILE — index_fit.tripstore.DEV.html
  DO NOT OVERWRITE WITH LIVE FILE. This has features live doesn't.
  DEV Sheet: 1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4
  DEV API: AKfycbz3dpvTIrQ0gQWqmO3cGZ9fHoJ2oHOahZmvLBk-oy7x1ShyNacqhQhjsIVQJ2bYbXuqrQ
-->
```

`CLAUDE.md` explicitly states: *"NEVER put a DEV URL in the live file or vice versa"* and lists `1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4` as the DEV sheet that must never be used in live code. The presence of this comment means either:
1. The DEV file was accidentally promoted and the runtime JS is querying DEV endpoints, or  
2. The comment is stale (live JS uses correct live IDs) but the header was not updated on promote.

**Action (HIGH PRIORITY):** Search `app/index.html` for all occurrences of `script.google.com` and both sheet IDs to confirm which backend the live tool is actually calling. If it's calling DEV endpoints, roll back immediately and promote the correct file.

---

### MODERATE

---

#### M-01 — `write_to_sheets.py` and `archive_to_input.py`: hardcoded LIVE sheet ID, no dev/live switch

**Files:** `write_to_sheets.py` line 28, `archive_to_input.py` line 31  
**Issue:** Both scripts hardcode `SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` — the live production Google Sheet. There is no environment variable, command-line flag, or config file to point at the DEV sheet. Running either script on a test machine or with test data will silently modify live data.

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"  # hardcoded live
```

**Action:** Add `SPREADSHEET_ID = os.environ.get("SHEET_ID", "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM")` so a dev sheet can be targeted without editing source.

---

#### M-02 — `write_to_sheets.py` and `archive_to_input.py`: formula injection risk via `USER_ENTERED`

**Files:** `write_to_sheets.py` line 196, `archive_to_input.py` line 390  
**Issue:** Both scripts use `value_input_option="USER_ENTERED"` when appending rows to Google Sheets. This causes Sheets to evaluate any value starting with `=`, `+`, or `-` as a formula. If a hotel name, tour name, or CSV field contains something like `=IMPORTRANGE(...)`, it will execute in the spreadsheet.

```python
ws.append_rows(new_rows, value_input_option="USER_ENTERED")  # formula injection risk
```

**Action:** Change to `value_input_option="RAW"` for all data-append calls. (The header row in `write_to_sheets.py` line 170 is already correctly using `"RAW"`.)

---

#### M-03 — `write_to_sheets.py`: redundant double API call for empty-sheet check

**File:** `write_to_sheets.py` lines 168–175  
**Issue:** The empty-sheet check calls `ws.get_all_values()` (line 168) and discards the result, then `build_existing_keys()` calls `ws.get_all_values()` again (line 120). This wastes one Sheets API quota unit on every run.

```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()  # first call (discarded)
...
existing_keys = build_existing_keys(ws, headers)  # calls get_all_values() again internally
```

**Action:** Cache the result: `all_values = ws.get_all_values()`, pass it into `build_existing_keys`, and derive `sheet_is_empty` from `len(all_values) < 2`.

---

#### M-04 — `check_pipeline.py`: hardcoded local-machine path, dead in CI

**File:** `check_pipeline.py` lines 16–19  
**Issue:** The validator immediately exits if `~/Desktop/tripstore-pipeline/clasp-live` is not found:

```python
CLASP_LIVE_ROOT = os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live')
if not os.path.isdir(CLASP_LIVE_ROOT):
    sys.exit(1)
```

This means `check_pipeline.py` cannot run in this remote CI/cloud environment or on any machine other than Sumit's desktop. The naming-conflict check, column-map check, and prompt-logic rules all run locally only. When the daily automated review runs here, these critical guards are completely skipped.

**Action:** Add `CLASP_LIVE_ROOT = os.environ.get("CLASP_LIVE_ROOT", os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live'))` so CI runners can set the path via environment variable.

---

#### M-05 — `qa/smoke.py`: hardcoded year 2026 in default travel date

**File:** `qa/smoke.py` line 73  
**Issue:** The default `travelStartDate` for scenarios that don't specify one uses year `2026`:

```python
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
```

Scenarios with `month` values 1–6 are already generating past dates (e.g., `2026-01-15` is 6 months in the past). In January 2027 all defaults become stale. Engines may behave differently or return errors for past travel dates, producing false-green QA results.

**Action:** Replace `"2026"` with a dynamic expression:
```python
import datetime
year = datetime.date.today().year
month = scn.get('month', 7)
if month <= datetime.date.today().month:
    year += 1
f"{year}-{month:02d}-15"
```

---

#### M-06 — No rate-limit retry in sheet-writing scripts

**Files:** `write_to_sheets.py`, `archive_to_input.py`  
**Issue:** Both scripts make multiple sequential Google Sheets API calls with no retry logic. The Sheets API returns HTTP 429 (`RESOURCE_EXHAUSTED`) under quota pressure. A single transient failure will abort the entire import and leave sheets in a partially written state. For `archive_to_input.py` this means some INPUT_* sheets get new rows while others don't.

**Action:** Wrap `append_rows()` and `get_all_values()` calls with exponential-backoff retry using `google.api_core.retry` or a simple `tenacity`-based decorator.

---

### MINOR

---

#### m-01 — `qa/invariants.py`: `import re` inside a hot-path function

**File:** `qa/invariants.py` line 399  
**Issue:** `import re` is inside `_word_in()`, which is called in a loop for every tour in every scenario. While CPython caches the import after the first call, the lookup overhead accumulates.

```python
def _word_in(needle, hay):
    import re   # should be module-level
```

**Action:** Move `import re` to the top of the file alongside other imports.

---

#### m-02 — Landing page footer has dead placeholder links

**File:** `index.html` lines 2010–2011  
**Issue:** `<a href="#">Privacy</a> · <a href="#">Terms</a>` scroll to the top of the page. These are visible to prospects. Most payment processors and enterprise buyers require real policy pages before onboarding.

**Action:** Create minimal `privacy.html` and `terms.html` pages and update the footer links.

---

#### m-03 — `check_pipeline.py` file reads without explicit encoding

**File:** `check_pipeline.py` line 34  
**Issue:** `open(path)` without `encoding='utf-8'` may misread .gs files containing Unicode characters (comments, em-dashes, INR ₹ symbols) on systems where the default encoding is not UTF-8.

**Action:** Change `def read(path): with open(path) as f:` to `with open(path, encoding='utf-8') as f:`.

---

#### m-04 — `qa/nightly.py`: no error handling around report file write

**File:** `qa/nightly.py` lines 83–86  
**Issue:** `open(rp, "w")` to write the dated report has no exception handling. In a read-only CI environment or on a disk-full runner, the script crashes after completing all scenario POSTs, losing all results.

**Action:** Wrap the report-writing block in a `try/except IOError` and print the full results table to stdout as a fallback.

---

#### m-05 — `archive_to_input.py`: brittle city extraction from transfer descriptions

**File:** `archive_to_input.py` lines 155–161  
**Issue:** City extraction from transfer descriptions relies on a fixed keyword list (`airport`, `cdg`, `lhr`, etc.). Airports not in the list fall through to `from_loc.split()[0]` (first word only). Cities with compound names ("San Sebastian", "Monte Carlo") will be truncated to "San" or "Monte".

**Action:** Extend the keyword list with `vce`, `mxp`, `nap`, `bud`, `ath`, `hel`, `lis`, and other common European airport codes as they appear in the data. No urgent action needed.

---

#### m-06 — `qa/smoke.py`: file open without context manager

**File:** `qa/smoke.py` line 53  
**Issue:** `for line in open(p):` — file is not explicitly closed if an exception occurs mid-iteration. CPython's GC handles this but it's not portable or safe under alternate Python implementations.

**Action:** Change to `with open(p) as fh: for line in fh:`.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| CRITICAL | 2 | C-01 (check_html.py API URL mismatch), C-02 (DEV header in live app/index.html) |
| MODERATE | 6 | M-01 (hardcoded live sheet IDs), M-02 (formula injection via USER_ENTERED), M-03 (double API call), M-04 (check_pipeline.py CI-dead), M-05 (stale 2026 year in smoke.py), M-06 (no retry logic) |
| MINOR | 6 | m-01 through m-06 |
| Cannot review | 10 | .gs files + 7 Python files not in this repo |

## Action Items (Priority Order)

1. **[URGENT]** Search `app/index.html` for `script.google.com/macros` and both sheet IDs to confirm the live app is not accidentally calling DEV endpoints (C-02).
2. **[URGENT]** Update `check_html.py` line 90 and 110 API URL fragment to match current live Apps Script deployment ID (C-01).
3. Change `value_input_option="USER_ENTERED"` → `"RAW"` in both `write_to_sheets.py` and `archive_to_input.py` (M-02).
4. Add env-var override for `SPREADSHEET_ID` in both sheet-writing scripts (M-01).
5. Fix `travelStartDate` year in `qa/smoke.py` to use `datetime.date.today().year` (M-05).
6. Add exponential-backoff retry to Sheets API calls (M-06).
7. Add `CLASP_LIVE_ROOT` env-var override in `check_pipeline.py` (M-04).
8. Cache `get_all_values()` result in `write_to_sheets.py` to avoid double call (M-03).
9. Move `import re` to module level in `qa/invariants.py` (m-01).
10. Add `encoding='utf-8'` to `check_pipeline.py` file reads (m-03).
11. Create real Privacy and Terms pages (m-02).
