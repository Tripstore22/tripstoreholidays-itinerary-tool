# TripStore Daily Code Review — 2026-06-29

**Reviewed by:** Automated daily review  
**Branch:** v2  
**Last commit:** `a1f1124` — Auto: daily code review 2026-06-28  
**Commits since last review:** `04e4d03` G-07 invariants, `0209656` Swiss Pass toggle, `qa/gen_scenarios.py` (in-tree)

---

## Files Reviewed

| File | Status |
|------|--------|
| `app/index.html` (itinerary tool) | ✅ Reviewed |
| `write_to_sheets.py` | ✅ Reviewed |
| `archive_to_input.py` | ✅ Reviewed |
| `check_pipeline.py` | ✅ Reviewed |
| `check_html.py` | ✅ Reviewed |
| `qa/smoke.py` | ✅ Reviewed |
| `qa/invariants.py` | ✅ Reviewed |
| `qa/nightly.py` | ✅ Reviewed |
| `qa/gen_scenarios.py` | ✅ Reviewed (NEW — first time in scope) |

## Files NOT in this repo (cannot review remotely)

- `Code.gs`, `Pipeline.gs`, `Quote_Intelligence.gs` — not in repo (local ~/Desktop/tripstore-pipeline)
- `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py` — not in repo

---

## Status of Carry-Overs from Previous Reports

### C-01 (API URL mismatch in check_html.py) — STILL OPEN
`check_html.py` validates the URL fragment `AKfycbwP9KQH...` and this IS present at `app/index.html:3302` as `const API_URL`. However the inline comment on line 3302 says `// DEV @18`, and `CLAUDE.md` states the live URL contains `AKfycbzAbIgzRoN_MNs377jm3u` — which matches neither the validator nor the actual HTML. CLAUDE.md live URL fragment is stale. The validator is correctly tracking the current deployment, but CLAUDE.md needs updating to avoid confusion.

### C-02 (DEV header comment in live app/index.html) — RUNTIME SAFE, STALE COMMENT
Runtime code confirmed safe today: `1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4` (DEV Sheet ID) appears **only** in the header comment block (lines 1–8), not in any live JavaScript. The `DEV API: AKfycbz3dpvTIrQ0...` fragment also appears only in the comment. The live app is calling the correct endpoint. The risk is lower than initially classified. However the misleading "DEV FILE" header in a live production file will cause confusion during future code reviews and should be removed.

### M-01 (hardcoded live sheet ID in Python scripts) — STILL OPEN, no code change
### M-02 (USER_ENTERED formula injection risk) — STILL OPEN, no code change
### M-03 (double get_all_values() call) — STILL OPEN, no code change
### M-04 (check_pipeline.py CI-dead) — STILL OPEN, no code change
### M-05 (hardcoded 2026 year in smoke.py default date) — STILL OPEN, worsening
### M-06 (no rate-limit retry in sheet scripts) — STILL OPEN, no code change
### m-01 through m-06 — STILL OPEN, no code change

---

## New Findings (2026-06-29)

### MODERATE

---

#### M-07 (NEW) — `qa/gen_scenarios.py`: Seasonal pair dates are now in the past

**File:** `qa/gen_scenarios.py` lines 186, 189  
**Issue:** The P07 seasonal comparison pair (`pair_season_01_apr` and `pair_season_01_jun`) hardcode `travelStartDate` to `"2026-04-15"` and `"2026-06-15"` respectively. Today is **2026-06-29**. Both dates are now in the past.

```python
travelStartDate="2026-04-15"   # line 186 — 2.5 months in the past
travelStartDate="2026-06-15"   # line 189 — 14 days in the past
```

The P07 check compares June totalSpent / April totalSpent and expects a ≈1.20 seasonal multiplier. If the engine applies seasonal pricing based on the travel month (regardless of whether the date is past), the test is still meaningful. But if the engine rejects or behaves differently for past dates, the P07 result will be wrong — possibly a silent false-PASS because both return identical degenerate responses. The `compare_P07_pair` function has a "fill-to-budget guard" that converts this to SKIP if ratio ≈ 1.0, so it would not produce a false red, but the seasonal regression is no longer being genuinely exercised.

The same dates are also hardcoded in `pair_season_02` and `pair_season_03` (lines 184–190 produce all 3 pairs using the same `"2026-04-15"` / `"2026-06-15"` templates).

**Action:** After June 2026, the seasonal pair dates need to be rolled forward. Change to `"2027-04-15"` / `"2027-06-15"` in `gen_scenarios.py` and re-run `python3 qa/gen_scenarios.py` to regenerate `scenarios.json`. Also update `edge_date_month_boundary` (line 168, `"2026-05-29"`) and the booking-eq-travel scenario (line 179, `"2026-07-15"` — will go past in 16 days).

---

#### M-08 (NEW) — Swiss Pass: no test scenario for exactly 1 Swiss city after commit `0209656`

**File:** `qa/gen_scenarios.py` lines 193–204; `app/index.html:5068`  
**Issue:** Commit `0209656` changed `checkSwissPass()` from `swissCities.length < 2` to `swissCities.length < 1`, meaning the Swiss Pass card now shows for routes with **1 Swiss city** (was 2+). This is a FE-only visibility change, but the scenario bank has no golden or live_safe scenario that exercises exactly 1 Swiss city with Swiss Pass enabled:

```python
# existing Swiss Pass scenarios in gen_scenarios.py:
"edge_swisspass_no_swiss_cities"  → 0 Swiss cities (Paris/Rome)  — P12 no-leak
"edge_swisspass_with_swiss"       → 2 Swiss cities (Zurich/Interlaken)  — P12 discount
"edge_swisspass_toggle_midedit"   → 1 Swiss city (Lucerne) — but scoped to fe_state/deferred
```

The new behaviour (card visible for 1 Swiss city) is only exercised by `edge_swisspass_toggle_midedit`, which is `deferred: "fe_harness"` and never runs in bare-POST smoke. If the engine pricing for a 1-Swiss-city route behaves differently with Swiss Pass enabled, there is no automated coverage for it.

**Action:** Add a `golden=True` engine-testable scenario: 1 Swiss city (e.g. `Lucerne`, 3N, 2 adults), without `deferred`, with `registry_refs: ["P12"]`, to cover the newly-enabled 1-city case.

---

### MINOR

---

#### m-07 (NEW) — `qa/smoke.py`: `load_scenarios()` has no error handling unlike `load_known()`

**File:** `qa/smoke.py` lines 80, 84  
**Issue:** `load_known()` wraps its JSON load in a try/except and returns `[]` on failure. `load_scenarios()` does not:

```python
def load_scenarios():
    return json.load(open(os.path.join(HERE, "scenarios.json")))["scenarios"]  # no guard

def load_known():
    try:
        return json.load(open(os.path.join(HERE, "known_issues.json")))["known"]
    except Exception:
        return []   # graceful fallback
```

If `scenarios.json` is empty (e.g. from a failed `gen_scenarios.py` run on disk-full) or has a schema change that removes the top-level `"scenarios"` key, `load_scenarios()` raises an unhandled KeyError/JSONDecodeError and crashes the entire smoke/nightly run with no useful error message.

**Action:** Wrap in try/except like `load_known()`, or at minimum add a `.get("scenarios", [])` guard:
```python
def load_scenarios():
    data = json.load(open(os.path.join(HERE, "scenarios.json")))
    return data.get("scenarios") or []
```

---

#### m-08 (NEW) — `qa/smoke.py`: `_grep()` opens files without context manager (extends m-06)

**File:** `qa/smoke.py` line 205  
**Issue:** The `_grep()` helper (used by `seam_data`) opens files without a context manager inside an `os.walk` loop. CPython will GC-close them but under alternate implementations file handles accumulate:

```python
for i, line in enumerate(open(fp, errors="ignore"), 1):  # no context manager
```

This was noted as m-06 for `load_ids()` (line 53) but the same pattern appears in `_grep()` which may walk dozens of `.gs` / `.py` / `.js` files.

**Action:** Change to `with open(fp, errors="ignore") as fh: for i, line in enumerate(fh, 1):`. Also fix the `open(lock, "w").write(qhash)` pattern on the T14 lock-write path (line 301, also lacks context manager).

---

#### m-09 (NEW) — `app/index.html:3302` stale inline comment says "DEV @18"

**File:** `app/index.html` line 3302  
**Issue:** The runtime `API_URL` constant has the comment `// DEV @18 — 2026-05-04 RBAC 5-role + getAllUsers (prev pinned @5 AKfycbwRr9k5...)`. This URL is the actual production endpoint (validated by `check_html.py`). The "DEV @18" label is a historical tag from when this deployment was on the DEV Apps Script version. Combined with the "DEV FILE" header comment (C-02), this makes it look like the live app is hitting a DEV endpoint when it isn't.

**Action:** Update the comment to: `// LIVE — current deployment (promoted from DEV @18, 2026-05-04)` and remove the "DEV FILE" header block (C-02 combined fix).

---

## G-07 New Invariants Review (commit `04e4d03`) — Passed

The three new checks added in `qa/invariants.py` were reviewed and appear correct:

- **`check_P03`**: Now reads `v4Log.hotel_summary.hotelPctOfNet` instead of always SKIP. Correctly handles missing log entry (SKIP), budget_too_low flag, and 0.1pt INR rounding slack. No issues.
- **`check_G02_headroom`**: Ratio `cityBudgetCapped/cityBudgetRaw ∈ [0.94, 0.96]` per city. Zero-budget city guard (`if not raw: continue`) prevents division-by-zero. Correct.
- **`check_G03_s3_trigger`**: Only asserts when `s3Triggered=true`. `utilAtS3Eval is None` is treated as FAIL (correct — engine must expose the value if it fires Step 3). Correct.
- **`nightly.py` P_CHECKS update**: `"G02_sight_headroom"` and `"G03_s3_trigger"` correctly added to the P_CHECKS set. No issues.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| CRITICAL | 2 | C-01 (CLAUDE.md stale live URL), C-02 (DEV header in production file) — both lower-risk than first assessed; runtime is safe |
| MODERATE | 8 | M-01–M-06 (carry-overs), M-07 (seasonal dates past), M-08 (Swiss Pass 1-city gap) |
| MINOR | 9 | m-01–m-06 (carry-overs), m-07 (load_scenarios no guard), m-08 (_grep no context manager), m-09 (stale API_URL comment) |
| Cannot review | 10 | .gs files + 7 pipeline Python files not in this repo |

## Action Items (Priority Order)

1. **[16 days]** Roll seasonal pair dates in `gen_scenarios.py` to 2027, and update `edge_date_booking_eq_travel` to `2027-07-15` before July 15 — after that date smoke P07 tests become stale (M-07).
2. **[When convenient]** Update `CLAUDE.md` live API URL fragment to `AKfycbwP9KQH39hcBcLQ...` (first 20 chars) to match actual deployment (C-01).
3. **[When convenient]** Remove the "DEV FILE" header comment block from `app/index.html` lines 1–8 and update the line 3302 inline comment to say LIVE (C-02 + m-09 combined fix — no runtime risk, cosmetic only).
4. Add a 1-Swiss-city golden engine scenario to `gen_scenarios.py` to cover post-`0209656` behavior (M-08).
5. Change `value_input_option="USER_ENTERED"` → `"RAW"` in `write_to_sheets.py:196` and `archive_to_input.py:390` (M-02).
6. Add `SPREADSHEET_ID = os.environ.get("SHEET_ID", "1U3f6...")` env-var override to both sheet-writing scripts (M-01).
7. Fix `travelStartDate` default year in `qa/smoke.py:73` to use `datetime.date.today().year` (M-05).
8. Add exponential-backoff retry to Sheets API calls in `write_to_sheets.py` and `archive_to_input.py` (M-06).
9. Add `CLASP_LIVE_ROOT` env-var override in `check_pipeline.py:16` (M-04).
10. Wrap `load_scenarios()` in `qa/smoke.py` with error handling like `load_known()` (m-07).
11. Fix `_grep()` and lock-file writes in `qa/smoke.py` to use context managers (m-08).
12. Move `import re` to module level in `qa/invariants.py:399` (m-01).
13. Cache `get_all_values()` result in `write_to_sheets.py:168` to avoid redundant API call (M-03).
14. Add `encoding='utf-8'` to `check_pipeline.py:34` (m-03).
15. Create real `privacy.html` and `terms.html` pages to replace `<a href="#">` footer links (m-02).
