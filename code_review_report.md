# TripStore Daily Code Review — 2026-06-30

**Reviewed by:** Automated daily review  
**Branch:** v2  
**Last commit:** `541812c` — Auto: daily code review 2026-06-29  
**Commits since last non-review commit:** None — last substantive commit was `04e4d03` (G-07 invariants) + `ce7c2d0` (T08 ratchet 134→137) on 2026-06-26

---

## Files Reviewed

| File | Status |
|------|--------|
| `app/index.html` (itinerary tool, 901 KB) | ✅ Structure confirmed, key sections spot-checked |
| `write_to_sheets.py` | ✅ Reviewed |
| `archive_to_input.py` | ✅ Reviewed |
| `check_pipeline.py` | ✅ Reviewed |
| `check_html.py` | ✅ Reviewed |
| `qa/smoke.py` | ✅ Reviewed |
| `qa/invariants.py` | ✅ Reviewed |
| `qa/nightly.py` | ✅ Reviewed |
| `qa/gen_scenarios.py` | ✅ Reviewed |
| `qa/known_issues.json` | ✅ Reviewed — T08 ratchet confirmed at 137 |

## Files NOT in this repo (cannot review remotely)

- `Code.gs`, `Pipeline.gs`, `Quote_Intelligence.gs` — live in local `~/Desktop/tripstore-pipeline/clasp-live`
- `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py` — not in this repo

---

## Code Activity Since Yesterday

No substantive code changes since 2026-06-26. The three commits since then (`541812c`, `a1f1124`, `8ca3845`) are all automated code review report commits. All findings from previous reports carry over unchanged. The status below reflects the full open backlog.

---

## ⚠️ URGENT — Expiring in 15 Days

### M-07 (ESCALATING) — `qa/gen_scenarios.py`: Scenario date `2026-07-15` expires in 15 days

**File:** `qa/gen_scenarios.py` line 179  
**Issue:** `edge_date_booking_eq_travel` uses `travelStartDate="2026-07-15"` — this date becomes past on July 15, 2026, which is **15 days from today**. At that point the scenario is testing with a past travel date, making the engine's behavior undefined and the P07/F04 coverage unreliable.

The full set of stale/expiring dates:
```python
travelStartDate="2026-04-15"   # lines 186 — pair_season_01_apr (already 2.5 months past)
travelStartDate="2026-06-15"   # lines 189 — pair_season_01_jun (already 15 days past)
travelStartDate="2026-05-29"   # line 168 — edge_date_month_boundary (over a month past)
travelStartDate="2026-07-15"   # line 179 — edge_date_booking_eq_travel (EXPIRES IN 15 DAYS)
travelStartDate="2026-12-31"   # line 172 — edge_date_dec31_jan1 (still future, good)
travelStartDate="2028-02-29"   # line 176 — edge_date_leap_feb29 (good)
```

**Action (do this week):** Roll all 2026 past-dates forward to 2027. Update `gen_scenarios.py` then run `python3 qa/gen_scenarios.py` to regenerate `qa/scenarios.json`:
```python
# Change:
travelStartDate="2026-04-15"  →  "2027-04-15"
travelStartDate="2026-05-29"  →  "2027-05-29"
travelStartDate="2026-06-15"  →  "2027-06-15"
travelStartDate="2026-07-15"  →  "2027-07-15"
```
Also update the default year in `qa/smoke.py:73`:
```python
# Change:
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
# To:
"travelStartDate": scn.get("travelStartDate", f"{datetime.date.today().year + 1}-{scn.get('month', 7):02d}-15")
```

---

## Carry-Over Findings (All Still Open)

### CRITICAL (runtime-safe but misleading)

| ID | File | Issue | Status |
|----|------|-------|--------|
| C-01 | `CLAUDE.md` | Live API URL fragment is stale — CLAUDE.md says `AKfycbzAbIgzRoN_MNs377jm3u` but live app uses `AKfycbwP9KQH39hcBcLQ...` | Open |
| C-02 | `app/index.html` | "DEV FILE" comment block in lines 1–8 of the live production file; "DEV @18" comment at line 3302 on the live API_URL constant | Open |

Both are cosmetic only — runtime is safe.

### MODERATE

| ID | File | Issue | Status |
|----|------|-------|--------|
| M-01 | `write_to_sheets.py:28`, `archive_to_input.py:32` | Live Sheet ID `1U3f6Ph...` hardcoded — no `os.environ` override | Open |
| M-02 | `write_to_sheets.py:196`, `archive_to_input.py:390` | `value_input_option="USER_ENTERED"` allows formula injection from CSV data | Open |
| M-03 | `write_to_sheets.py:168` | Double `get_all_values()` call: once in `ws.row_count == 0 or not ws.get_all_values()`, then again inside `build_existing_keys()` — wastes one full Sheets API read per run | Open |
| M-04 | `check_pipeline.py:16` | `CLASP_LIVE_ROOT` hardcoded to `~/Desktop/tripstore-pipeline/clasp-live` — script `sys.exit(1)` immediately in any environment without that path (CI, remote sessions) | Open |
| M-05 | `qa/smoke.py:73` | Default `travelStartDate` format hardcodes `2026-` prefix — all non-dated scenarios use a past-year travel date starting 2027 | Open — see URGENT above |
| M-06 | `write_to_sheets.py`, `archive_to_input.py` | No retry/backoff on Sheets API calls — a transient 429 or network hiccup silently fails the run | Open |
| M-07 | `qa/gen_scenarios.py:168,179,186,189` | Seasonal pair and date-edge scenarios have stale/past `travelStartDate` — P07 seasonal regression no longer exercised — **15 days to July 15 expiry** | URGENT |
| M-08 | `qa/gen_scenarios.py:193–204` | No engine-testable golden scenario for exactly 1 Swiss city with Swiss Pass (newly enabled by commit `0209656`) — the only 1-city Swiss Pass scenario is deferred as `fe_state` | Open |

### MINOR

| ID | File | Issue | Status |
|----|------|-------|--------|
| m-01 | `qa/invariants.py:399` | `import re` inside `_word_in()` function body — should be at module level | Open |
| m-02 | `index.html` (landing page) | Footer `<a href="#">` privacy and terms links are dead — no real pages | Open |
| m-03 | `check_pipeline.py:34` | `open(path)` has no `encoding` argument — will fail on non-UTF-8 .gs files in some environments | Open |
| m-04 | `qa/smoke.py:73` | `"markupPct": 15, "gstOnMarkupPct": 18, "vehicle": "sedan"` hardcoded in `post()` — not overridable from scenario flags | Open |
| m-05 | `archive_to_input.py:57` | `_parts()` strips but does not normalize case — duplicate keys like "Paris" vs "paris" treated as different in `seen` sets (partial fix: `seen` uses `.lower()` keys, but source comparison uses raw case) | Open |
| m-06 | `qa/smoke.py:53,205,301` | Files opened without context managers in `load_ids()`, `_grep()` loop, and T14 lock write — handle leak risk under non-CPython | Open |
| m-07 | `qa/smoke.py:80` | `load_scenarios()` has no error handling; a corrupt/empty `scenarios.json` crashes the entire smoke/nightly run with no useful error message (contrast: `load_known()` on line 84 has a try/except) | Open |
| m-08 | `qa/smoke.py:313` | **NEW FINDING** — check name mismatch in exception handler: successful path emits `"T08_combo_a1_self_ref"` (line 292) but the `except Exception` path emits `"T08_a1_self_ref"` (line 313). If a sheet scan throws, the SKIP event's check name won't match any `known_issues.json` entries keyed on `"T08_combo_a1_self_ref"` | Open |
| m-09 | `app/index.html:3302` | Inline comment says `// DEV @18` on the live API_URL constant — confusingly implies DEV endpoint (combined fix with C-02) | Open |

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
| T08 | `T08_combo_a1_self_ref` | **137** | Ratcheted ✅ (updated ce7c2d0) |
| E02 | `E02_full_caps` (Milan x2) | — (instance-keyed) | Accepted |
| E13 | `E02_full_caps` (venice_3n, berlin_4n, italy_couple) | — | Accepted |
| E05 | `E05_daytrip_guard` (swiss_montreux_7n) | — | Accepted — **note: marked "NOT accept-forever"**, fix still open |

The E05 `top_swiss_montreux_7n` known issue note explicitly states it is not a permanent acceptance — the day-trip guard gap (unflagged trip to a route city) needs an engine fix.

---

## Summary

| Severity | Count | Notes |
|----------|-------|-------|
| URGENT | 1 | M-07 booking_eq_travel date expires July 15 (15 days) |
| CRITICAL | 2 | C-01, C-02 — cosmetic only, runtime safe |
| MODERATE | 8 | M-01–M-08, all carry-overs |
| MINOR | 9 | m-01–m-09 (m-08 is new today) |
| Cannot review | 10 | .gs files + 7 pipeline Python scripts not in this repo |

---

## Action Items (Priority Order)

1. **[BY JULY 8 — 7 days buffer]** Roll all past `travelStartDate` values in `gen_scenarios.py` to 2027 and fix the default year in `smoke.py:73` — July 15 is 15 days away. Do not wait for next week's review (M-07 URGENT).
2. **[When convenient]** Update `CLAUDE.md` live API URL fragment to match actual deployment `AKfycbwP9KQH...` (C-01).
3. **[When convenient]** Remove "DEV FILE" header comment from `app/index.html` lines 1–8 and update line 3302 comment to say "LIVE" (C-02 + m-09 combined — no runtime risk).
4. Add a `golden=True` engine-testable 1-Swiss-city scenario to `gen_scenarios.py` (M-08).
5. Change `value_input_option="USER_ENTERED"` → `"RAW"` in `write_to_sheets.py:196` and `archive_to_input.py:390` (M-02).
6. Add `SPREADSHEET_ID = os.environ.get("SHEET_ID", "1U3f6...")` env-var override to both sheet scripts (M-01).
7. Add `CLASP_LIVE_ROOT = os.environ.get("CLASP_LIVE_ROOT", "~/Desktop/...")` override to `check_pipeline.py:16` (M-04).
8. Fix `load_scenarios()` in `qa/smoke.py:80` to use `.get("scenarios") or []` like `load_known()` does (m-07).
9. Fix `_grep()` loop and `load_ids()` and T14 lock-write in `qa/smoke.py` to use context managers (m-06).
10. Fix T08 check name inconsistency: `qa/smoke.py:313` `"T08_a1_self_ref"` → `"T08_combo_a1_self_ref"` to match the normal path (m-08 new).
11. Move `import re` to module level in `qa/invariants.py:399` (m-01).
12. Add retry/backoff to Sheets API calls in `write_to_sheets.py` and `archive_to_input.py` (M-06).
13. Cache `get_all_values()` in `write_to_sheets.py:168` to avoid double API call (M-03).
14. Engine fix for E05 day-trip guard gap in `top_swiss_montreux_7n` (E05 known — marked not-permanent).
