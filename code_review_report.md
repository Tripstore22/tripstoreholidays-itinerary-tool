# TripStore Daily Code Review — 2026-06-27

**Run by:** Automated (Claude Code · scheduled)
**Branch:** v2 (commit `04e4d03`)
**Recent commits:**
```
04e4d03 G-07: enforce hotel-ceiling/headroom/S3-trigger invariants from v4Log
ce7c2d0 qa: ratchet T08 self-ref cap 134->137 (Aix-en-Provence combos)
0209656 Swiss Pass: show toggle for any route with >=1 Swiss city
8c11ec3 Auto: daily code review 2026-06-26
98e0f71 Revert "Landing: signup copy 15 free quotes -> 15 quotes at ₹495..."
```

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `app/index.html` | ~10,200 | ✅ Reviewed |
| `index.html` (landing) | ~600 | ✅ Reviewed |
| `write_to_sheets.py` | 208 | ✅ Reviewed |
| `archive_to_input.py` | 409 | ✅ Reviewed |
| `check_html.py` | 147 | ✅ Reviewed |
| `check_pipeline.py` | 266 | ✅ Reviewed |
| `qa/invariants.py` | 443 | ✅ Reviewed |
| `qa/smoke.py` | 381 | ✅ Reviewed |
| `qa/nightly.py` | 113 | ✅ Reviewed |
| `qa/gen_scenarios.py` | 262 | ✅ Reviewed |

### ⚠️ Files NOT reviewable (not in this repo)

The following files live at `~/Desktop/tripstore-pipeline/` on Sumit's local machine only — not committed to GitHub:

- `Code.gs`, `Pipeline.gs`, `Quote_Intelligence.gs`, `Wallet.gs`
- `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`
- `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`

**Action needed:** To include these in daily automated reviews, commit them to a private repo or expose via CI secrets.

---

## Today's Changes

### `04e4d03` — G-07: new invariants for hotel-ceiling, sight headroom, S3 trigger

**No production code changed today.** Only `qa/invariants.py` and `qa/nightly.py` were modified.

#### What was added
- `check_P03` now reads `v4Log.hotel_summary.hotelPctOfNet` to verify Step-1 hotel spend ≤ 45% of net budget (previously SKIP-only).
- `check_G02_headroom` — verifies `cityBudgetCapped / cityBudgetRaw ≈ 0.95` (sight headroom constant) for every city in v4Log.
- `check_G03_s3_trigger` — verifies `utilAtS3Eval < 0.80` wherever `s3Triggered = true` in v4Log.
- Both G02 and G03 added to `SINGLE_CHECKS` and to `nightly.py`'s `P_CHECKS` set.
- Nightly reported GREEN (PASS=1233, FAIL=0, KNOWN=30) after the push.

**Three new minor issues found in these additions — see m10, m11, m12 below.**

---

## Summary

| Severity | Count | Change from yesterday |
|----------|-------|-----------------------|
| 🔴 CRITICAL | 1 | — (same) |
| 🟠 MODERATE | 9 | — (same) |
| 🟡 MINOR | 12 | +3 (new m10, m11, m12 from G-07 invariants) |

**C1 is now DAY 6 and still unresolved — real credential-exposure risk on live production.**

**Stale seasonal dates (m6) are now DAY 6 — P07 seasonal pair test is unreliable.**

---

## 🔴 CRITICAL Issues

### C1 — Password sent as GET query parameter *(carryover — DAY 6)*
**File:** `app/index.html:3730`

```javascript
const res = await fetch(
  `${API_URL}?action=checkLogin&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`
);
```

Passwords appear in browser history, Apps Script server logs, DevTools Network panel, and any CDN/proxy log. The signup flow at line 3746 correctly uses `POST` with a JSON body — the login flow should match.

**Fix:** Change `checkLogin` to POST:
```javascript
const res = await fetch(API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'checkLogin', username: user, password: pass })
});
```

---

## 🟠 MODERATE Issues

### M1 — Session token sent in GET URL *(carryover — DAY 6)*
**File:** `app/index.html:4319`

```javascript
const res = await fetch(
  `${API_URL}?action=validateSession&user=${encodeURIComponent(s.username)}&token=${encodeURIComponent(s.token)}`
);
```

Session tokens in URLs appear in server/CDN logs and browser history. A leaked token grants full impersonation.

**Fix:** Move `validateSession` to POST, matching the `computeItinerary` pattern.

---

### M2 — API-sourced strings injected into `innerHTML` without sanitization *(carryover — DAY 6)*
**File:** `app/index.html:5179, 5202, 5232, 4947, 4950, 9190`

City intelligence banner, hotel swap results, and autocomplete suggestions inject Sheets-sourced data directly into innerHTML. The F11 self-healing fetch broadened this surface.

**Fix:** Apply the `_esc()` helper (which already exists elsewhere in the file) to all API-sourced and user-input strings before innerHTML interpolation.

---

### M3 — Production `console.log` dumps full plan JSON *(carryover — DAY 6)*
**File:** `app/index.html` — 22 occurrences including lines 6940, 6966–6968, 6984, 8630, 8818, 8840–8841, 8847, 9787

Full plan JSON, agent names, pricing structures, and billing internals visible to anyone with DevTools open.

**Fix:** Gate behind `if (window._TRIPSTORE_DEBUG) console.log(...)`.

---

### M4 — No fetch timeout on any API call *(carryover — DAY 6)*
**File:** `app/index.html` — all `fetch()` calls, including the F11 `getIntelligenceForRoute` call at line 4991

Apps Script cold starts can take 15–30 s; a quota error causes the UI to hang indefinitely.

**Fix:** Wrap every fetch in a 30-second `AbortController`.

---

### M5 — `// DEV @18` comment on live API URL *(carryover — DAY 6)*
**File:** `app/index.html:3302`

```javascript
const API_URL = "...AKfycbwP9KQH39.../exec"; // DEV @18 — 2026-05-04
```

Comment says "DEV" on the live production URL. Misleading during incident response.

**Fix:** Change comment to `// LIVE @18 — 2026-05-04`.

---

### M6 — `write_to_sheets.py`: dead `row_count` check + no chunking *(carryover — DAY 6)*
**File:** `write_to_sheets.py:168, 195`

`ws.row_count == 0` is never true for a gspread worksheet (new sheets start at 1000 rows by default). `append_rows` has no chunking, so a large batch silently hits the Sheets API quota limits.

**Fix:** Cache `get_all_values()` result; chunk `append_rows` in 500-row batches.

---

### M7 — Swiss Pass `fetchSwissPassOptions` sends full tour list as GET URL parameter *(carryover — DAY 6)*
**File:** `app/index.html:5119–5125`

A 10-city itinerary produces a JSON blob of 3,000–10,000+ characters URL-encoded. Many browsers and reverse proxies enforce a 2,048–8,192 byte URL limit.

**Fix:** Convert `getSwissPassOptions` to POST (consistent with `computeItinerary` pattern).

---

### M8 — `getSavedList` and `searchItinerary` send username/role in GET URL *(carryover — DAY 6)*
**File:** `app/index.html:4437, 4512`

Agent usernames and role strings appear in server logs and browser history on every tab switch.

**Fix:** Move to POST bodies as part of the session-validation fix scope.

---

### M9 — Negative nights value accepted in F10 editable nights input *(carryover — DAY 4)*
**File:** `app/index.html:4954`

```javascript
onchange="selectedRoute[${i}].nights=parseInt(this.value)||1; _cascadeRouteDates(${i})"
```

`parseInt('-3') || 1 = -3` — negative integers pass through, producing check-out dates before check-in.

**Fix:**
```javascript
onchange="selectedRoute[${i}].nights = Math.max(1, parseInt(this.value) || 1); _cascadeRouteDates(${i})"
```

---

## 🟡 MINOR Issues

### m1 — `ADOBE_PDF_API` URL not validated by `check_html.py` *(carryover — DAY 6)*
**File:** `check_html.py`

PDF API deployment URL has no pre-commit guard. If the deployment is redeployed and the URL changes, PDFs silently break.

**Fix:** Add the Adobe PDF API URL fragment to `check_html.py`'s `REQUIRED` list.

---

### m2 — `archive_to_input.py`: hardcoded LIVE sheet ID, no dry-run guard *(carryover — DAY 6)*
**File:** `archive_to_input.py:32`

Running in any context writes directly to the production `INPUT_*` sheets, triggering the overnight enrichment pipeline on unvalidated data.

**Fix:** Add `--env dev|live` flag and require confirmation before live writes.

---

### m3 — `check_pipeline.py`: `CLASP_LIVE_ROOT` not configurable via env var *(carryover — DAY 6)*
**File:** `check_pipeline.py:14–19`

Path hardcoded to `~/Desktop/tripstore-pipeline/clasp-live`. `smoke.py` correctly reads `TRIPSTORE_PIPELINE` from the environment; `check_pipeline.py` should match.

**Fix:** `_pipe = os.environ.get('TRIPSTORE_PIPELINE', os.path.expanduser('~/Desktop/tripstore-pipeline'))`

---

### m4 — `qa/invariants.py`: `import re` inside per-call helper *(carryover — DAY 6)*
**File:** `qa/invariants.py:344` (`_word_in()` function)

Non-idiomatic; `import re` inside a function that runs per-tour per-scenario.

**Fix:** Move to module top-level (already imported elsewhere in smoke.py).

---

### m5 — `qa/smoke.py`: column fallback is silent *(carryover — DAY 6)*
**File:** `qa/smoke.py`, `_col()` helper

If the Sightseeing tab renames the Duration column, T04/T05 silently SKIP with no alert.

**Fix:** `print("WARNING: Duration column not found", file=sys.stderr)` when `_col()` returns `None` for a critical column.

---

### m6 — `qa/gen_scenarios.py`: stale `travelStartDate` for seasonal pair scenarios *(carryover — DAY 6 — URGENT)*
**File:** `qa/gen_scenarios.py:168, 186, 189`

```python
travelStartDate="2026-04-15"  # pair_season_01_apr  — 73 days in the past
travelStartDate="2026-06-15"  # pair_season_01_jun  — 12 days in the past
travelStartDate="2026-05-29"  # edge_date_month_boundary — 29 days in the past
```

Both dates in the P07 seasonal pair test are now fully in the past. The seasonal multiplier test has been unreliable for 6 consecutive days.

**Fix (do today):** Bump all three dates to 2027:
```python
travelStartDate="2027-04-15"
travelStartDate="2027-06-15"
travelStartDate="2027-05-29"
```

---

### m7 — Swiss Pass class radio not reset when optimizer runs without Swiss cities *(carryover — DAY 6)*
**File:** `app/index.html:5406–5430`

When an agent loads a non-Swiss itinerary after setting 1st class on a Swiss one, `getSwissPassClass()` returns '1st' unexpectedly.

**Fix:** In `runOptimizer()`, reset Swiss Pass state when the new route contains no Swiss cities.

---

### m8 — City intelligence banner injects API fields into `innerHTML` without escaping *(carryover — DAY 4)*
**File:** `app/index.html:4947, 4950`

`intel.nextCity` (Sheets-sourced) and `r.city` (user autocomplete) inserted raw. See M2 for fix.

---

### m9 — F11: N-city uncached route fires N concurrent GAS calls *(carryover — DAY 2)*
**File:** `app/index.html:4925–4926`

Opening a saved 8-city itinerary fires 8 concurrent GAS requests. GAS limits concurrency; routes with >6 cities may receive 429/503 responses, caching `{ found: false }` for cities that have data.

**Fix:** In `renderRouteInputs()`, fire only the first uncached city fetch per render cycle — each fetch re-renders on return, picking up the next uncached city naturally (serial queue via existing re-render loop).

---

### m10 — `check_G02_headroom`: no None guard for `cityBudgetCapped` *(NEW — today)*
**File:** `qa/invariants.py:323`

```python
raw = e.get("cityBudgetRaw"); cap = e.get("cityBudgetCapped")
if not raw:
    continue
ratio = cap / raw   # cap could be None → TypeError
```

If a v4Log city entry has `cityBudgetRaw` but is missing `cityBudgetCapped` (engine bug or schema evolution), `cap / raw` raises `TypeError`. The `run_single` exception handler will catch it and report a FAIL with "exception: …" — useful but misleading.

**Fix:**
```python
if not raw or cap is None:
    return _r("G02_sight_headroom", "G02", "SKIP", sid,
              reason=f"cityBudgetCapped missing for city {e.get('city')}")
```

---

### m11 — `check_P03`: silent fallback to hardcoded `0.45` when `hotelCeilPct` absent *(NEW — today)*
**File:** `qa/invariants.py:305`

```python
ceil = (hs.get("hotelCeilPct") or 0.45) * 100.0
```

If the engine emits `hotel_summary` without `hotelCeilPct` (e.g., a pre-G-07 build), the check silently uses 45%. If the ceiling constant ever changes in the engine, the test won't detect it until someone notices the value mismatch.

**Fix:** SKIP when `hotelCeilPct` is absent rather than guessing:
```python
ceil_raw = hs.get("hotelCeilPct")
if ceil_raw is None:
    return _r("P03_hotel_ceiling", "P03", "SKIP", sid,
              reason="hotelCeilPct absent from v4Log hotel_summary — cannot verify ceiling")
ceil = ceil_raw * 100.0
```

---

### m12 — Three magic numbers in new G-07 invariants should be named constants *(NEW — today)*
**File:** `qa/invariants.py:305, 329, 347`

Three threshold values added in G-07 are inline literals with no module-level constant:

```python
ceil = (hs.get("hotelCeilPct") or 0.45) * 100.0          # line 305 — hotel ceiling %
if not (0.94 <= ratio <= 0.96):                            # line 329 — headroom tolerance band
if ue is None or ue >= 0.80:                               # line 347 — S3 trigger threshold
```

The file already has good precedent (`ANCHOR_HOURS`, `FULL_HCAP`, `TOL`) — these should match.

**Fix:** Add at top of module alongside existing constants:
```python
HOTEL_CEIL_PCT   = 0.45   # Step-1 hotel spend cap (V4_HOTEL_CEILING)
SIGHT_HEADROOM   = 0.95   # cityBudgetCapped/Raw ratio (V4_SIGHT_HEADROOM)
HEADROOM_TOL     = 0.01   # ±1 percentage point for INR rounding
S3_TRIGGER       = 0.80   # capped-budget util threshold for Step 3 (V4_S3_TRIGGER)
```

---

## Action Items (Priority Order)

| # | Priority | File | Action | Days Open |
|---|----------|------|--------|-----------|
| 1 | 🔴 CRITICAL | `app/index.html:3730` | Move `checkLogin` credentials to POST body | **DAY 6** |
| 2 | 🟠 MODERATE | `app/index.html:4954` | Clamp nights to `Math.max(1, …)` to reject negatives | **DAY 4** |
| 3 | 🟡 MINOR | `qa/gen_scenarios.py:168,186,189` | **URGENT** Bump stale `travelStartDate` to 2027 — P07 test unreliable | **DAY 6** |
| 4 | 🟠 MODERATE | `app/index.html:4319` | Move `validateSession` token to POST body | Day 6 |
| 5 | 🟠 MODERATE | `app/index.html:5119–5125` | Convert `getSwissPassOptions` to POST (URL length risk) | Day 6 |
| 6 | 🟠 MODERATE | `app/index.html:4947,4950,5179,5232,9190` | Escape API-sourced strings before innerHTML | Day 6 |
| 7 | 🟠 MODERATE | `app/index.html` (all fetches) | Add 30s `AbortController` timeout to every `fetch()` | Day 6 |
| 8 | 🟠 MODERATE | `app/index.html` (22 sites) | Gate production `console.log` dumps behind `window._TRIPSTORE_DEBUG` | Day 6 |
| 9 | 🟠 MODERATE | `app/index.html:3302` | Fix `// DEV @18` comment → `// LIVE @18` | Day 6 |
| 10 | 🟠 MODERATE | `write_to_sheets.py:168,195` | Remove dead `row_count == 0` branch; add 500-row chunking | Day 6 |
| 11 | 🟠 MODERATE | `app/index.html:4437,4512` | Move `getSavedList`/`searchItinerary` username+role to POST body | Day 6 |
| 12 | 🟡 MINOR | `app/index.html:4925–4926` | Serialize self-healing City Intelligence fetches to avoid GAS burst | Day 2 |
| 13 | 🟡 MINOR | `qa/invariants.py:323` | **NEW** Add `cap is None` guard in `check_G02_headroom` | Day 1 |
| 14 | 🟡 MINOR | `qa/invariants.py:305` | **NEW** SKIP (not fallback) when `hotelCeilPct` absent in `check_P03` | Day 1 |
| 15 | 🟡 MINOR | `qa/invariants.py:305,329,347` | **NEW** Extract magic numbers to named module-level constants | Day 1 |
| 16 | 🟡 MINOR | `qa/gen_scenarios.py:186,189` | Bump stale `travelStartDate` to 2027 | Day 6 |
| 17 | 🟡 MINOR | `app/index.html:4947,4950` | Escape `intel.nextCity` + `r.city` in intelligence banner | Day 4 |
| 18 | 🟡 MINOR | `app/index.html:5406` | Reset Swiss Pass class radio when optimizer runs without Swiss cities | Day 6 |
| 19 | 🟡 MINOR | `check_html.py` | Add `ADOBE_PDF_API` URL fragment to REQUIRED list | Day 6 |
| 20 | 🟡 MINOR | `archive_to_input.py:32` | Add `--env` flag and confirmation prompt before live writes | Day 6 |
| 21 | 🟡 MINOR | `check_pipeline.py:14` | Make `CLASP_LIVE_ROOT` configurable via `TRIPSTORE_PIPELINE` env var | Day 6 |
| 22 | 🟡 MINOR | `qa/invariants.py:344` | Move `import re` in `_word_in()` to module top-level | Day 6 |
| 23 | 🟡 MINOR | `qa/smoke.py` | Print stderr warning when critical column not found in Sightseeing tab | Day 6 |

---

## Resolved Since Yesterday

Nothing resolved today (G-07 was QA-only, no production fixes landed).

---

## Not Changed This Run
This report is read-only. No production code was modified. All items require Sumit's review before any fix is applied.

*Generated: 2026-06-27 by automated daily code review routine.*
