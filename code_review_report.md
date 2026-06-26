# TripStore Daily Code Review — 2026-06-26

**Run by:** Automated (Claude Code · scheduled)
**Branch:** v2 (commit `98e0f71`)
**Recent commits:**
```
98e0f71 Revert "Landing: signup copy 15 free quotes -> 15 quotes at ₹495 (paid signup, S10/B-02)"
5b8e207 F11: self-healing City Intelligence fetch in renderRouteInputs
2c3d45c Auto: daily code review 2026-06-25
1b38216 Landing: signup copy 15 free quotes -> 15 quotes at ₹495 (paid signup, S10/B-02)
1be2ef8 Auto: daily code review 2026-06-24
```

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `app/index.html` | ~10,200 | ✅ Reviewed |
| `index.html` (landing) | ~600 | ✅ Reviewed (revert commit) |
| `write_to_sheets.py` | 208 | ✅ Reviewed |
| `archive_to_input.py` | 409 | ✅ Reviewed |
| `check_html.py` | 147 | ✅ Reviewed |
| `check_pipeline.py` | 266 | ✅ Reviewed |
| `qa/invariants.py` | 387 | ✅ Reviewed |
| `qa/smoke.py` | 381 | ✅ Reviewed |
| `qa/nightly.py` | 112 | ✅ Reviewed |
| `qa/gen_scenarios.py` | 262 | ✅ Reviewed |

### ⚠️ Files NOT reviewable (not in this repo)

The following files live at `~/Desktop/tripstore-pipeline/` on Sumit's local machine only — not committed to GitHub:

- `Code.gs`, `Pipeline.gs`, `Quote_Intelligence.gs`, `Wallet.gs`
- `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`
- `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`

**Action needed:** To include these in daily automated reviews, commit them to a private repo or expose via CI secrets.

---

## Today's Changes

### `98e0f71` — Revert of ₹495 pricing copy change
The `1b38216` commit (which changed landing copy from "15 free quotes" to "15 quotes at ₹495") has been fully reverted. Landing page is back to "Sign Up Free" / "15 free quotes" — messaging is consistent again.

**M10 from yesterday is RESOLVED by this revert.** No new issues introduced.

### `5b8e207` — F11: self-healing City Intelligence fetch

**Implementation is correct.** The key guard is solid:
- `fetchCityIntelligence` sets `cityIntelligenceCache[key] = null` (the "loading" sentinel) synchronously before its first `await` — so if `renderRouteInputs` is called again during the pending fetch, the `=== undefined` check at line 4925 correctly skips the re-fire.
- The `!== undefined` guard at line 4988 inside `fetchCityIntelligence` also protects against double-fetching.
- No re-fetch loop possible.

**One new issue found (see m9 below):** N-city uncached routes fire N concurrent GAS calls simultaneously instead of sequentially.

---

## Summary

| Severity | Count | Change from yesterday |
|----------|-------|-----------------------|
| 🔴 CRITICAL | 1 | — (same) |
| 🟠 MODERATE | 9 | -1 (M10 resolved by revert) |
| 🟡 MINOR | 9 | +1 (new m9 from F11) |

**C1 is now DAY 5 and still unresolved — real credential-exposure risk on live production.**

**Stale seasonal dates (m6) are now DAY 5 — both April and June 2026 dates are fully in the past; P07 seasonal test is unreliable.**

---

## 🔴 CRITICAL Issues

### C1 — Password sent as GET query parameter *(carryover — DAY 5)*
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

### M1 — Session token sent in GET URL *(carryover — DAY 5)*
**File:** `app/index.html:4319`

```javascript
const res = await fetch(
  `${API_URL}?action=validateSession&user=${encodeURIComponent(s.username)}&token=${encodeURIComponent(s.token)}`
);
```

Session tokens in URLs appear in server/CDN logs and browser history. A leaked token grants full impersonation.

**Fix:** Move `validateSession` to POST, matching the `computeItinerary` pattern.

---

### M2 — API-sourced strings injected into `innerHTML` without sanitization *(carryover — DAY 5)*
**File:** `app/index.html:5179, 5202, 5232, 4947, 4950, 9190`

**City intelligence banner (also touched by F11 code path):**
```javascript
// line 4947 — intel.nextCity comes from Google Sheets via API
`Often Paired With: <b style="…">${intel.nextCity}</b>`

// line 4950 — r.city comes from user autocomplete input
`No archive data for ${r.city}`
```

The F11 self-healing fetch now triggers `fetchCityIntelligence` from more code paths (Quick-Quote build, saved-itinerary open, revert), broadening the surface at which malicious Sheet data reaches `innerHTML`.

**Fix:** Apply the `_esc()` helper (which already exists elsewhere in the file) to all API-sourced and user-input strings before innerHTML interpolation.

---

### M3 — Production `console.log` dumps full plan JSON *(carryover — DAY 5)*
**File:** `app/index.html` — 22 occurrences including lines 6940, 6966–6968, 6984, 8630, 8818, 8840–8841, 8847, 9787

Full plan JSON, agent names, pricing structures, and billing internals visible to anyone with DevTools open.

**Fix:** Gate behind `if (window._TRIPSTORE_DEBUG) console.log(...)`.

---

### M4 — No fetch timeout on any API call *(carryover — DAY 5)*
**File:** `app/index.html` — all `fetch()` calls, including the new F11 `getIntelligenceForRoute` call at line 4991

Apps Script cold starts can take 15–30 s; a quota error or script failure causes the UI to hang indefinitely. F11 fires N concurrent uncached fetches (see m9 below), each of which can hang.

**Fix:** Wrap every fetch in a 30-second `AbortController`.

---

### M5 — `// DEV @18` comment on live API URL *(carryover — DAY 5)*
**File:** `app/index.html:3302`

```javascript
const API_URL = "...AKfycbwP9KQH39.../exec"; // DEV @18 — 2026-05-04
```

The comment says "DEV" on the live production URL. Misleading during incident response.

**Fix:** Change comment to `// LIVE @18 — 2026-05-04`.

---

### M6 — `write_to_sheets.py`: dead `row_count` check + no chunking *(carryover — DAY 5)*
**File:** `write_to_sheets.py:168, 195`

`ws.row_count == 0` is never true for a gspread worksheet (new sheets start at 1000 rows by default). `append_rows` has no chunking, so a large batch silently hits the Sheets API 10 MB / quota limits.

**Fix:** Cache `get_all_values()` result; chunk `append_rows` in 500-row batches.

---

### M7 — Swiss Pass `fetchSwissPassOptions` sends full tour list as GET URL parameter *(carryover — DAY 5)*
**File:** `app/index.html:5119–5125`

```javascript
const url = `${API_URL}?action=getSwissPassOptions`
          + `&cities=...`
          + `&tours=${encodeURIComponent(JSON.stringify(selectedTours))}`;
const res = await fetch(url);
```

A 10-city itinerary produces a JSON blob of 3,000–10,000+ characters URL-encoded. Many browsers and reverse proxies enforce a 2,048–8,192 byte URL limit.

**Fix:** Convert `getSwissPassOptions` to POST (consistent with `computeItinerary` pattern).

---

### M8 — `getSavedList` and `searchItinerary` send username/role in GET URL *(carryover — DAY 5)*
**File:** `app/index.html:4437, 4512`

```javascript
fetch(`${API_URL}?action=search&username=…&role=…`);
fetch(`${API_URL}?action=getSavedList&username=…&role=…`);
```

Agent usernames and role strings appear in server logs and browser history on every tab switch.

**Fix:** Move to POST bodies as part of the session-validation fix scope.

---

### M9 — Negative nights value accepted in F10 editable nights input *(carryover — DAY 3)*
**File:** `app/index.html:4954`

```javascript
onchange="selectedRoute[${i}].nights=parseInt(this.value)||1; _cascadeRouteDates(${i})"
```

`parseInt('-3') || 1 = -3` — negative integers pass through, producing check-out dates before check-in. All subsequent city dates cascade wrongly.

**Fix:**
```javascript
onchange="selectedRoute[${i}].nights = Math.max(1, parseInt(this.value) || 1); _cascadeRouteDates(${i})"
```

---

## 🟡 MINOR Issues

### m1 — `ADOBE_PDF_API` URL not validated by `check_html.py` *(carryover — DAY 5)*
**File:** `check_html.py`

PDF API deployment URL has no pre-commit guard. If the deployment is redeployed and the URL changes, PDFs silently break.

**Fix:** Add the Adobe PDF API URL fragment to `check_html.py`'s `REQUIRED` list.

---

### m2 — `archive_to_input.py`: hardcoded LIVE sheet ID, no dry-run guard *(carryover — DAY 5)*
**File:** `archive_to_input.py:32`

Running in any context writes directly to the production `INPUT_*` sheets, triggering the overnight enrichment pipeline on unvalidated data.

**Fix:** Add `--env dev|live` flag and require confirmation before live writes.

---

### m3 — `check_pipeline.py`: `CLASP_LIVE_ROOT` not configurable via env var *(carryover — DAY 5)*
**File:** `check_pipeline.py:14–19`

Path hardcoded to `~/Desktop/tripstore-pipeline/clasp-live`. `smoke.py` correctly reads `TRIPSTORE_PIPELINE` from the environment; `check_pipeline.py` should match.

**Fix:** `_pipe = os.environ.get('TRIPSTORE_PIPELINE', os.path.expanduser('~/Desktop/tripstore-pipeline'))`

---

### m4 — `qa/invariants.py`: `import re` inside per-call helper *(carryover — DAY 5)*
**File:** `qa/invariants.py:344` (`_word_in()` function)

Non-idiomatic (module is cached by Python so no real perf cost, but it's misleading).

**Fix:** Move to module top-level.

---

### m5 — `qa/smoke.py`: column fallback is silent *(carryover — DAY 5)*
**File:** `qa/smoke.py`, `_col()` helper

If the Sightseeing tab renames the Duration column, T04/T05 silently SKIP with no alert.

**Fix:** `print("WARNING: Duration column not found", file=sys.stderr)` when `_col()` returns `None` for a critical column.

---

### m6 — `qa/gen_scenarios.py`: stale `travelStartDate` for seasonal pair scenarios *(carryover — DAY 5 — URGENT)*
**File:** `qa/gen_scenarios.py:186, 189`

```python
travelStartDate="2026-04-15"  # pair_season_01_apr  — 72 days in the past
travelStartDate="2026-06-15"  # pair_season_01_jun  — 11 days in the past
travelStartDate="2026-05-29"  # edge_date_month_boundary — 28 days in the past
```

Both dates in the P07 seasonal pair test (April vs June, expects ~1.20× totalSpent ratio) are now fully in the past. The engine may use historical pricing not reflecting the intended seasonal multiplier. The P07 check has been operating on unreliable data for at least 5 days.

**Fix (do today):** Bump all three dates to 2027:
```python
travelStartDate="2027-04-15"
travelStartDate="2027-06-15"
travelStartDate="2027-05-29"
```

---

### m7 — Swiss Pass class radio not reset when optimizer runs without Swiss cities *(carryover — DAY 5)*
**File:** `app/index.html:5406–5430`

When an agent loads a non-Swiss itinerary after having set 1st class on a Swiss one, `getSwissPassClass()` returns '1st' unexpectedly on the next Swiss quote.

**Fix:** In `runOptimizer()`, reset Swiss Pass state when the new route contains no Swiss cities.

---

### m8 — City intelligence banner injects API fields into `innerHTML` without escaping *(carryover — DAY 3)*
**File:** `app/index.html:4947, 4950`

`intel.nextCity` (from Google Sheets via API) and `r.city` (from user autocomplete) are inserted raw into innerHTML. The F11 self-healing feature now triggers this from more code paths. See M2 for fix.

---

### m9 — F11: N-city uncached route fires N concurrent GAS calls *(NEW — today)*
**File:** `app/index.html:4925–4926`

```javascript
if (cityIntelligenceCache[key] === undefined) {
    fetchCityIntelligence(r.city);  // async, re-renders on return
}
```

When `renderRouteInputs()` renders an N-city route where all cities are uncached (e.g. opening a saved 8-city itinerary), this fires N concurrent GAS requests simultaneously. GAS limits concurrent executions per deployment. For routes with >6 cities, some calls may receive 429 / 503, causing `{ found: false }` to be cached for cities that do have data — the intelligence banner will show as empty until the next page reload.

The old `addCityToRoute` path (one city at a time) was naturally sequential and never hit this.

**Fix:** Serialize the fetches from the self-healing path using a small queue:
```javascript
// In renderRouteInputs(), collect uncached cities and queue them
const uncached = selectedRoute.filter(r => cityIntelligenceCache[r.city.toLowerCase()] === undefined);
if (uncached.length) {
    // fetch serially, 1 per render: fire only the first, the rest fire on subsequent re-renders
    const first = uncached[0];
    fetchCityIntelligence(first.city);  // sets null sentinel; re-render after → picks up next
}
```

Or set a "pending" sentinel before the fetch is called (already done by line 4989) and add a retry mechanism for `{ found: false }` entries older than 5 minutes.

---

## Action Items (Priority Order)

| # | Priority | File | Action | Days Open |
|---|----------|------|--------|-----------|
| 1 | 🔴 CRITICAL | `app/index.html:3730` | Move `checkLogin` credentials to POST body | **DAY 5** |
| 2 | 🟠 MODERATE | `app/index.html:4954` | Clamp nights to `Math.max(1, …)` to reject negatives | **DAY 3** |
| 3 | 🟡 MINOR | `qa/gen_scenarios.py:186,189` | **URGENT** Bump stale `travelStartDate` to 2027 — P07 test unreliable | **DAY 5** |
| 4 | 🟠 MODERATE | `app/index.html:4319` | Move `validateSession` token to POST body | Day 5 |
| 5 | 🟠 MODERATE | `app/index.html:5119–5125` | Convert `getSwissPassOptions` to POST (URL length risk) | Day 5 |
| 6 | 🟠 MODERATE | `app/index.html:4947,4950,5179,5232,9190` | Escape API-sourced strings before innerHTML | Day 5 |
| 7 | 🟠 MODERATE | `app/index.html` (all fetches) | Add 30s `AbortController` timeout to every `fetch()` | Day 5 |
| 8 | 🟠 MODERATE | `app/index.html` (22 sites) | Gate production `console.log` dumps behind `window._TRIPSTORE_DEBUG` | Day 5 |
| 9 | 🟠 MODERATE | `app/index.html:3302` | Fix `// DEV @18` comment → `// LIVE @18` | Day 5 |
| 10 | 🟠 MODERATE | `write_to_sheets.py:168,195` | Remove dead `row_count == 0` branch; add 500-row chunking | Day 5 |
| 11 | 🟠 MODERATE | `app/index.html:4437,4512` | Move `getSavedList`/`searchItinerary` username+role to POST body | Day 5 |
| 12 | 🟡 MINOR | `app/index.html:4925–4926` | **NEW** Serialize self-healing City Intelligence fetches to avoid GAS rate-limit burst | Day 1 |
| 13 | 🟡 MINOR | `app/index.html:4947,4950` | Escape `intel.nextCity` + `r.city` in intelligence banner | Day 3 |
| 14 | 🟡 MINOR | `app/index.html:5406` | Reset Swiss Pass class radio when optimizer runs without Swiss cities | Day 5 |
| 15 | 🟡 MINOR | `check_html.py` | Add `ADOBE_PDF_API` URL fragment to REQUIRED list | Day 5 |
| 16 | 🟡 MINOR | `archive_to_input.py:32` | Add `--env` flag and confirmation prompt before live writes | Day 5 |
| 17 | 🟡 MINOR | `check_pipeline.py:14` | Make `CLASP_LIVE_ROOT` configurable via `TRIPSTORE_PIPELINE` env var | Day 5 |
| 18 | 🟡 MINOR | `qa/invariants.py:344` | Move `import re` in `_word_in()` to module top-level | Day 5 |
| 19 | 🟡 MINOR | `qa/smoke.py` | Print stderr warning when critical column not found in Sightseeing tab | Day 5 |

---

## Resolved Since Yesterday

| Issue | Resolution |
|-------|-----------|
| M10 — "Sign Up Free" contradicts ₹495 pricing | Resolved via revert `98e0f71` — landing page back to consistent free messaging |

---

## Not Changed This Run
This report is read-only. No production code was modified. All items require Sumit's review before any fix is applied.

*Generated: 2026-06-26 by automated daily code review routine.*
