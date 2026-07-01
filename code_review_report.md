# TripStore Daily Code Review — 2026-07-01

**Reviewed by:** Automated daily review  
**Branch:** v2  
**Last commit:** `a03a3f0` — Auto: daily code review 2026-06-30  
**Last substantive commit:** `04e4d03` (G-07 invariants) + `ce7c2d0` (T08 ratchet 134→137) on 2026-06-26  

---

## Files Reviewed

| File | Status |
|------|--------|
| `app/index.html` (live production app, ~900 KB) | ✅ Lines 1–30 checked; key sections spot-checked |
| `write_to_sheets.py` | ✅ Reviewed |
| `archive_to_input.py` | ✅ Reviewed |
| `check_pipeline.py` | ✅ Reviewed |
| `check_html.py` | ✅ Reviewed |
| `qa/smoke.py` | ✅ Reviewed |
| `qa/invariants.py` | ✅ Reviewed |
| `qa/nightly.py` | ✅ Reviewed |
| `qa/gen_scenarios.py` | ✅ Reviewed |
| `qa/known_issues.json` | ✅ Reviewed — T08 ratchet confirmed at 137 |
| `.github/workflows/night-guardian.yml` | ✅ Reviewed |

## Files NOT in this repo (cannot review remotely)

- `Code.gs`, `Pipeline.gs`, `Quote_Intelligence.gs` — live in local `~/Desktop/tripstore-pipeline/clasp-live`
- `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py` — not in this repo

---

## Code Activity Since Yesterday

No substantive code changes since 2026-06-26. The four automated review commits since then contain no logic changes. All findings from prior reports carry over. One **new MODERATE finding** (M-09) was identified today.

---

## ⚠️ URGENT — Expires in 14 Days (was 15 yesterday)

### M-07 (ESCALATING) — `qa/gen_scenarios.py`: Date `2026-07-15` expires July 15

**File:** `qa/gen_scenarios.py` line 179  
**Issue:** `edge_date_booking_eq_travel` uses `travelStartDate="2026-07-15"` — this becomes a past date in **14 days**. Once past, the engine behaviour is undefined and P07/F04 coverage is unreliable.

Full stale date inventory:
```python
travelStartDate="2026-04-15"   # line 185 — pair_season_01_apr (77 days past)
travelStartDate="2026-05-29"   # line 168 — edge_date_month_boundary (33 days past)
travelStartDate="2026-06-15"   # line 189 — pair_season_01_jun (16 days past)
travelStartDate="2026-07-15"   # line 179 — edge_date_booking_eq_travel (14 DAYS LEFT)
travelStartDate="2026-12-31"   # line 172 — edge_date_dec31_jan1 (still future ✅)
travelStartDate="2028-02-29"   # line 176 — edge_date_leap_feb29 (still future ✅)
```

**Action (do this week — before July 8):** Roll all 2026 past-dates to 2027:
```python
travelStartDate="2026-04-15"  →  "2027-04-15"
travelStartDate="2026-05-29"  →  "2027-05-29"
travelStartDate="2026-06-15"  →  "2027-06-15"
travelStartDate="2026-07-15"  →  "2027-07-15"
```
Also fix the default-year fallback in `qa/smoke.py:73`:
```python
# Change:
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
# To:
"travelStartDate": scn.get("travelStartDate", f"{datetime.date.today().year + 1}-{scn.get('month', 7):02d}-15")
```
Then run `python3 qa/gen_scenarios.py` to regenerate `qa/scenarios.json`.

---

## 🆕 NEW Finding Today

### M-09 (NEW) — `qa/smoke.py`: G02 and G03 checks silently dropped — not in smoke's `p_checks`

**File:** `qa/smoke.py` lines 163–166  
**Severity:** MODERATE

`invariants.py` defines `check_G02_headroom` (V4_SIGHT_HEADROOM=0.95 constant guard) and `check_G03_s3_trigger` (V4_S3_TRIGGER=0.80 constant guard) in `SINGLE_CHECKS`, which means `run_single()` always produces those results. They were also added to `nightly.py`'s `P_CHECKS` set (line 31–32).

**BUT** `smoke.py`'s `seam_engine` and `seam_pricing` each filter `run_single()` output against their own local sets, and both sets omit G02/G03:

```python
# smoke.py — seam_engine (line 146–148):
e_checks = {"shape", "E01_departure_empty", "E02_full_caps", "E03_arrival_caps",
            "E04_no_cross_city_dup", "E05_daytrip_guard", "E06_anchor_placed",
            "E09_empty_day_flagged", "E10_algorithm_stated", "E11_no_phantom_leg"}

# smoke.py — seam_pricing (line 164–166):
p_checks = {"P01_child_factor", "P03_hotel_ceiling", "P06_markup_gst",
            "P08_utilisation", "P09_inr_format", "P10_budget_bound"}
# ← G02_sight_headroom and G03_s3_trigger are MISSING
```

```python
# nightly.py P_CHECKS (line 31–32) — correctly includes them:
P_CHECKS = {"P01_child_factor", "P03_hotel_ceiling", "P06_markup_gst",
            "P08_utilisation", "P09_inr_format", "P10_budget_bound",
            "G02_sight_headroom", "G03_s3_trigger"}   # ← correct
```

**Impact:** `python3 smoke.py --seam all` (the pre-promote gate) silently discards G02/G03 results. A regression in the `V4_SIGHT_HEADROOM` or `V4_S3_TRIGGER` constants can pass smoke and only surface hours later in the nightly. The commit `04e4d03` (G-07) added both checks to invariants and nightly but missed smoke's filter lists.

**Fix:** Add `"G02_sight_headroom"` and `"G03_s3_trigger"` to `p_checks` in `seam_pricing()`:
```python
# smoke.py line 164-166 — change:
p_checks = {"P01_child_factor", "P03_hotel_ceiling", "P06_markup_gst",
            "P08_utilisation", "P09_inr_format", "P10_budget_bound",
            "G02_sight_headroom", "G03_s3_trigger"}    # ← add these two
```

---

## Carry-Over Findings (All Still Open)

### CRITICAL (runtime-safe but misleading)

| ID | File | Issue | Status |
|----|------|-------|--------|
| C-01 | `CLAUDE.md` | Live API URL fragment is stale — CLAUDE.md says `AKfycbzAbIgzRoN_MNs377jm3u` but `check_html.py` validates against `AKfycbwP9KQH39hcBcLQ...` (the real live URL) | Open |
| C-02 | `app/index.html` | Lines 1–8 contain a `<!-- DEV FILE -->` comment block (including a stale DEV API URL `AKfycbz3dpvTIrQ0...` that differs from the current DEV PIN in CLAUDE.md) on the live production file | Open |

Both are cosmetic only — runtime is safe. Note: the DEV API URL in the C-02 comment block (`AKfycbz3dpvTIrQ0gQWqmO3cGZ9fHoJ2oHOahZmvLBk-oy7x1ShyNacqhQhjsIVQJ2bYbXuqrQ`) is a third stale ID — not matching either CLAUDE.md's DEV or live URLs.

### MODERATE

| ID | File | Issue | Status |
|----|------|-------|--------|
| M-01 | `write_to_sheets.py:28`, `archive_to_input.py:32` | Live Sheet ID `1U3f6Ph...` hardcoded — no `os.environ` override | Open |
| M-02 | `write_to_sheets.py:196`, `archive_to_input.py:390` | `value_input_option="USER_ENTERED"` allows formula injection from CSV data | Open |
| M-03 | `write_to_sheets.py:168` | Double `get_all_values()` call: `ws.row_count == 0 or not ws.get_all_values()` then again in `build_existing_keys()` — wastes one full Sheets API read per run | Open |
| M-04 | `check_pipeline.py:16` | `CLASP_LIVE_ROOT` hardcoded to `~/Desktop/tripstore-pipeline/clasp-live` — `sys.exit(1)` immediately in any environment without that path (CI, remote sessions) | Open |
| M-05 | `qa/smoke.py:73` | Default `travelStartDate` hardcodes `2026-` prefix — all non-dated scenarios use a past-year travel date | Open — see URGENT above |
| M-06 | `write_to_sheets.py`, `archive_to_input.py` | No retry/backoff on Sheets API calls — a transient 429 or network hiccup silently fails the run | Open |
| M-07 | `qa/gen_scenarios.py:168,179,185,189` | Seasonal pair and date-edge scenarios have stale/past `travelStartDate` — **14 days to July 15 expiry** | URGENT |
| M-08 | `qa/gen_scenarios.py:193–204` | No engine-testable golden scenario for exactly 1 Swiss city with Swiss Pass (enabled by commit `0209656`) | Open |
| M-09 | `qa/smoke.py:164–166` | **NEW** — G02 (`G02_sight_headroom`) and G03 (`G03_s3_trigger`) checks run in `run_single()` but are silently dropped by `seam_pricing` and `seam_engine` — only caught in nightly, not at the smoke pre-promote gate | Open |

### MINOR

| ID | File | Issue | Status |
|----|------|-------|--------|
| m-01 | `qa/invariants.py:399` | `import re` inside `_word_in()` function body — should be at module level | Open |
| m-02 | `index.html` (landing page) | Footer `<a href="#">` privacy and terms links are dead | Open |
| m-03 | `check_pipeline.py:34` | `open(path)` has no `encoding` argument — will fail on non-UTF-8 .gs files in some environments | Open |
| m-04 | `qa/smoke.py:73` | `"markupPct": 15, "gstOnMarkupPct": 18, "vehicle": "sedan"` hardcoded in `post()` — not overridable from scenario flags | Open |
| m-05 | `archive_to_input.py:57` | `_parts()` does not normalize case — duplicate keys "Paris" vs "paris" treated differently in `seen` sets | Open |
| m-06 | `qa/smoke.py:53,205,301` | Files opened without context managers in `load_ids()`, `_grep()` loop, and T14 lock write | Open |
| m-07 | `qa/smoke.py:80` | `load_scenarios()` has no error handling; corrupt `scenarios.json` crashes the entire run (contrast: `load_known()` on line 84 has try/except) | Open |
| m-08 | `qa/smoke.py:313` | Check name mismatch in exception handler: success path emits `"T08_combo_a1_self_ref"` but the `except Exception` path emits `"T08_a1_self_ref"` — SKIP event won't match `known_issues.json` | Open |
| m-09 | `app/index.html:3302` (approx) | Inline comment `// DEV @18` on live API_URL constant implies DEV endpoint | Open |

---

## Known Issues Confirmed (qa/known_issues.json)

| Registry Ref | Check | Max Count | Status |
|---|---|---|---|
| T07 | `E02_full_caps` (PARIS_MONT) | — (instance-keyed) | Accepted |
| E13 | `E02_full_caps` (rome_florence_venice_8n) | — (instance-keyed) | Accepted |
| T05 | `T05_hours_lt_0.25` | 2 | Ratcheted |
| T04 | `T04_hours_gt_14` | 2 | Ratcheted |
| T15 | `T15_no_sightseeing_v2` | 13 | Ratcheted |
| D08 | `D08_no_debug_markers` | 1 | Ratcheted |
| T08 | `T08_combo_a1_self_ref` | **137** | Ratcheted ✅ |
| E02 | `E02_full_caps` (Milan ×2) | — (instance-keyed) | Accepted |
| E13 | `E02_full_caps` (venice_3n, berlin_4n, italy_couple) | — | Accepted |
| E05 | `E05_daytrip_guard` (swiss_montreux_7n) | — | Accepted — NOT permanent, fix still open |

---

## Summary

| Severity | Count | Notes |
|----------|-------|-------|
| URGENT | 1 | M-07 booking_eq_travel date expires July 15 (**14 days** — was 15 yesterday) |
| CRITICAL | 2 | C-01, C-02 — cosmetic only, runtime safe |
| MODERATE | 9 | M-01–M-09 (M-09 is NEW today: G02/G03 silently dropped in smoke.py) |
| MINOR | 9 | m-01–m-09, all carry-overs |
| Cannot review | 10 | .gs files + 7 pipeline Python scripts not in this repo |

---

## Action Items (Priority Order)

1. **[BY JULY 8 — 7 days buffer]** Roll all past `travelStartDate` values in `gen_scenarios.py` to 2027 and fix the default year in `smoke.py:73` — July 15 is **14 days away** (M-07 URGENT).
2. **[This week]** Add `"G02_sight_headroom"` and `"G03_s3_trigger"` to `p_checks` in `smoke.py`'s `seam_pricing()` so the pre-promote gate catches headroom/S3-trigger regressions (M-09 NEW).
3. **[When convenient]** Update `CLAUDE.md` live API URL fragment to match actual `AKfycbwP9KQH...` (C-01).
4. **[When convenient]** Remove DEV header comment block from `app/index.html` lines 1–8 and fix line ~3302 comment (C-02 + m-09 combined).
5. Add a `golden=True` engine-testable 1-Swiss-city scenario to `gen_scenarios.py` (M-08).
6. Change `value_input_option="USER_ENTERED"` → `"RAW"` in `write_to_sheets.py:196` and `archive_to_input.py:390` (M-02).
7. Add `SPREADSHEET_ID = os.environ.get("SHEET_ID", "1U3f6...")` env-var override to both sheet scripts (M-01).
8. Add `CLASP_LIVE_ROOT = os.environ.get("CLASP_LIVE_ROOT", "~/Desktop/...")` override to `check_pipeline.py:16` (M-04).
9. Fix `load_scenarios()` in `qa/smoke.py:80` to use `.get("scenarios") or []` with try/except like `load_known()` (m-07).
10. Fix T08 check name inconsistency: `qa/smoke.py:313` `"T08_a1_self_ref"` → `"T08_combo_a1_self_ref"` (m-08).
11. Fix `_grep()` loop and `load_ids()` and T14 lock-write in `qa/smoke.py` to use context managers (m-06).
12. Move `import re` to module level in `qa/invariants.py:399` (m-01).
13. Add retry/backoff to Sheets API calls in `write_to_sheets.py` and `archive_to_input.py` (M-06).
14. Cache `get_all_values()` in `write_to_sheets.py:168` to avoid double API call (M-03).
15. Engine fix for E05 day-trip guard gap in `top_swiss_montreux_7n` (E05 known — marked not-permanent).
