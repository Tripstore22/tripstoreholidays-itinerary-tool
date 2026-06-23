# TripStore Daily Code Review — 2026-06-23

**Run by:** Automated (Claude Code · scheduled)
**Branch:** v2 (commit `a15f4a0`)
**Recent commits:**
```
a15f4a0 fix: remove dangling skill symlinks breaking Pages build
ac55738 W1: A3 Actual Spend + Swiss 1st/2nd toggle + F06 cache-bust + billing-hash grandTotal lockstep (FE)
b763f8a skills(session): write-once to docs/ replaces dual-mirror ritual
68f3e4b Auto: daily code review 2026-06-22
82578ce Auto: daily code review 2026-06-21
```

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `app/index.html` | 10,118 | ✅ Reviewed |
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

## Summary

| Severity | Count | New today | Carryover |
|----------|-------|-----------|-----------|
| 🔴 CRITICAL | 1 | 0 | 1 |
| 🟠 MODERATE | 8 | 2 | 6 |
| 🟡 MINOR | 7 | 2 | 5 |

**C1 is now 2 days old and still unresolved. It is a real credential-exposure risk.**

---

## 🔴 CRITICAL Issues

### C1 — Password sent as GET query parameter *(carryover — day 2)*
**File:** `app/index.html:3730`

```javascript
const res = await fetch(
  `${API_URL}?action=checkLogin&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`
);
```

Passwords appear in browser history, Apps Script server logs, DevTools Network panel, and any CDN/proxy log. The signup flow at line 3746 correctly uses `POST` with a JSON body.

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

### M1 — Session token sent in GET URL *(carryover — day 2)*
**File:** `app/index.html:4319`

```javascript
const res = await fetch(
  `${API_URL}?action=validateSession&user=${encodeURIComponent(s.username)}&token=${encodeURIComponent(s.token)}`
);
```

Session tokens in URLs appear in server/CDN logs and browser history. A leaked token grants full impersonation.

**Fix:** Move `validateSession` to a POST request matching the pattern used by `computeItinerary`.

---

### M2 — `e.message` and API strings injected into `innerHTML` without sanitization *(carryover + new scope)*
**File:** `app/index.html:5208, 5124–5126, 5155, 5196`

**Existing (line 5208):**
```javascript
detailsEl.innerHTML = '<span ...>Error loading pass data: ' + (e.message || e) + '</span>';
```

**NEW from ac55738 — API response data in innerHTML (lines 5124–5126, 5155):**
```javascript
// swiss_legs[] city names from API injected raw
const legs = (data.swiss_legs || []).map(l =>
    `<span>${l.from} → ${l.to}: ...</span>`
).join('<br>');

// tour names from API injected raw
const renderTourRow = t => `<span>${t.tour_name}: ...`;
```

All of `l.from`, `l.to`, and `t.tour_name` come from Google Apps Script, which reads from Google Sheets. If a sheet cell (city name or tour name) ever contained `<script>` or `<img onerror=…>` — whether entered by mistake or as a supply-chain attack — it would execute in the browser. The main `detailsEl.innerHTML` block at line 5196 injects `data.pass_duration`, `data.pass_price_per_adult_2nd`, etc. the same way.

**Fix:** Use a small escape helper before all API-sourced strings go into innerHTML:
```javascript
function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Then: `<span>${_esc(l.from)} → ${_esc(l.to)}: ...`
```

---

### M3 — Production `console.log` dumps full plan JSON *(carryover — day 2)*
**File:** `app/index.html` — 22 occurrences including lines 6916, 6942–6944, 8817, 8823

Full plan JSON, agent names, pricing structures, and billing internals visible to anyone with DevTools open.

**Fix:** Gate behind `if (window._TRIPSTORE_DEBUG) console.log(...)`.

---

### M4 — No fetch timeout on any API call *(carryover — day 2)*
**File:** `app/index.html` — all `fetch()` calls

Apps Script cold starts can take 15–30 s; a quota error or script failure causes the UI to hang indefinitely with no recovery path.

**Fix:** Wrap every fetch in a 30-second `AbortController`.

---

### M5 — `// DEV @18` comment on live API URL *(carryover — day 2)*
**File:** `app/index.html:3302`

```javascript
const API_URL = "...AKfycbwP9KQH39.../exec"; // DEV @18 — 2026-05-04
```

The comment says "DEV" on the live production URL. CLAUDE.md API URL fragments are also stale and don't match this URL. Misleading during incident response.

**Fix:** Change comment to `// LIVE @18 — 2026-05-04`. Update CLAUDE.md URL fragments.

---

### M6 — `write_to_sheets.py`: dead `row_count` check + no chunking *(carryover — day 2)*
**File:** `write_to_sheets.py:168, 195`

`ws.row_count == 0` is never true for a gspread worksheet (new sheets start at 1000 rows). `append_rows` has no chunking, so a large batch silently hits the Sheets API 10 MB / quota limits.

**Fix:** Cache `get_all_values()` result; chunk `append_rows` in 500-row batches.

---

### M7 — Swiss Pass `fetchSwissPassOptions` sends full tour list as GET URL parameter *(NEW — ac55738)*
**File:** `app/index.html:5094–5101`

```javascript
const url = `${API_URL}?action=getSwissPassOptions`
          + `&cities=...`
          + `&tours=${encodeURIComponent(JSON.stringify(selectedTours))}`;
const res = await fetch(url);
```

`selectedTours` contains every tour in the current itinerary (name + price for each). A 10-city trip with 10+ tours per city produces a JSON blob of 3,000–10,000 characters URL-encoded. Many browsers and reverse proxies enforce a 2,048–8,192 byte URL limit; Apps Script itself can reject very long GET URLs. When this happens, the fetch returns an error page rather than JSON — the `catch` block at line 5208 shows a generic error with no indication that the URL was too long.

**Fix:** Convert `getSwissPassOptions` to a POST request (consistent with `computeItinerary` pattern):
```javascript
const res = await fetch(API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'getSwissPassOptions', cities: allCities, nights: swissNights,
                         adults, children, passClass: getSwissPassClass(), tours: selectedTours })
});
```

---

### M8 — `getSavedList` and `searchItinerary` send role/username in GET URL *(carryover scope)*
**File:** `app/index.html:4437, 4512`

```javascript
fetch(`${API_URL}?action=search&name=...&username=${encodeURIComponent(window.currentUsername||'')}&role=...`);
fetch(`${API_URL}?action=getSavedList&username=...&role=...`);
```

Agent usernames and role strings appear in server logs and browser history on every tab switch. Role-in-URL is a minor privilege-enumeration risk (competitor or staff member can see colleague's role from shared screen/browser history).

**Fix:** Move these to POST bodies to match the session-validation fix scope.

---

## 🟡 MINOR Issues

### m1 — `ADOBE_PDF_API` URL not validated by `check_html.py` *(carryover — day 2)*
**File:** `app/index.html`, `check_html.py`

PDF API deployment URL has no pre-commit guard. If the deployment is redeployed and the URL changes, PDFs silently break.

**Fix:** Add the Adobe PDF API URL fragment to `check_html.py`'s `REQUIRED` list.

---

### m2 — `archive_to_input.py`: hardcoded LIVE sheet ID, no dry-run guard *(carryover — day 2)*
**File:** `archive_to_input.py:32`

Running in any context writes directly to the production `INPUT_*` sheets, which triggers overnight enrichment pipeline on unvalidated data.

**Fix:** Add `--env dev|live` flag and require confirmation before live writes.

---

### m3 — `check_pipeline.py`: `CLASP_LIVE_ROOT` not configurable via env var *(carryover — day 2)*
**File:** `check_pipeline.py:14–19`

Path hardcoded to `~/Desktop/tripstore-pipeline/clasp-live`. `smoke.py` correctly reads `TRIPSTORE_PIPELINE` from the environment; `check_pipeline.py` should match.

**Fix:** `_pipe = os.environ.get('TRIPSTORE_PIPELINE', os.path.expanduser('~/Desktop/tripstore-pipeline'))`

---

### m4 — `qa/invariants.py`: `import re` inside per-call helper *(carryover — day 2)*
**File:** `qa/invariants.py`, `_word_in()` function

`import re` inside a function called thousands of times per nightly run. Not a performance concern (module is cached), but non-idiomatic.

**Fix:** Move to module top-level.

---

### m5 — `qa/smoke.py`: column fallback is silent *(carryover — day 2)*
**File:** `qa/smoke.py`, `_col()` helper

If the Sightseeing tab renames the Duration column, T04/T05 silently SKIP with no alert. A data quality regression can hide for weeks.

**Fix:** `print("WARNING: Duration column not found", file=sys.stderr)` when `_col()` returns `None` for a critical column.

---

### m6 — `qa/gen_scenarios.py`: stale `travelStartDate` for seasonal pair scenarios *(NEW — review finding)*
**File:** `qa/gen_scenarios.py:185–190`

```python
travelStartDate="2026-04-15"  # pair_season_01_apr  — 69 days in the past
travelStartDate="2026-06-15"  # pair_season_01_jun  —  8 days in the past
```

The P07 seasonal pair test (compare April vs June totalSpent to assert ~1.20× ratio) uses dates that have already passed. If the engine's seasonal multiplier logic uses travel date relative to booking date (or clamps to current month), the test may not exercise the intended edge. April is 69 days past, which is definitely stale.

**Fix:** Bump both dates forward to be consistently in the future:
```python
travelStartDate="2027-04-15"
travelStartDate="2027-06-15"
```

---

### m7 — Swiss Pass class selector not reset when itinerary is cleared or re-generated *(NEW — ac55738)*
**File:** `app/index.html:5383–5395, 5397–5416`

When an agent generates a new quote (city/route changed), `swissPassEnabled` is not reset and the 1st/2nd class radio button retains its prior state. If an agent previously set 1st class on a Swiss itinerary, then loads a non-Swiss itinerary, the class radio still shows 1st. When they later enable Swiss Pass on a different itinerary, `getSwissPassClass()` will return '1st' unexpectedly.

**Affected path:** `runOptimizer()` → does not call `toggleSwissPass(false)` or reset `swissPassEnabled`.

**Fix:** In `runOptimizer()`, reset Swiss Pass state if the new route has no Swiss cities:
```javascript
if (!selectedRoute.some(r => isSwissCityFE(r.city))) {
    swissPassEnabled = false;
    const row = document.getElementById('swissPassClassRow');
    if (row) row.style.display = 'none';
    const tog = document.getElementById('swissPassToggle');
    if (tog) tog.checked = false;
}
```

---

## Action Items (Priority Order)

| # | Priority | File | Action |
|---|----------|------|--------|
| 1 | 🔴 CRITICAL | `app/index.html:3730` | Move `checkLogin` credentials to POST body — **day 2, still open** |
| 2 | 🟠 MODERATE | `app/index.html:4319` | Move `validateSession` token to POST body |
| 3 | 🟠 MODERATE | `app/index.html:5094–5101` | **NEW** Convert `getSwissPassOptions` to POST (URL length risk) |
| 4 | 🟠 MODERATE | `app/index.html:5124,5155,5196,5208` | Escape API-sourced strings before innerHTML (swiss_legs, tour names) |
| 5 | 🟠 MODERATE | `app/index.html` (all fetches) | Add 30s `AbortController` timeout to every `fetch()` |
| 6 | 🟠 MODERATE | `app/index.html:6916+` | Gate production `console.log` dumps behind `window._TRIPSTORE_DEBUG` |
| 7 | 🟠 MODERATE | `app/index.html:3302` + `CLAUDE.md` | Fix `// DEV @18` comment → `// LIVE @18`; update CLAUDE.md URL fragments |
| 8 | 🟠 MODERATE | `write_to_sheets.py:168,195` | Remove dead `row_count == 0` branch; add 500-row chunking |
| 9 | 🟠 MODERATE | `app/index.html:4437,4512` | Move `getSavedList`/`searchItinerary` username+role to POST body |
| 10 | 🟡 MINOR | `app/index.html:5397` | **NEW** Reset Swiss Pass class radio when optimizer runs without Swiss cities |
| 11 | 🟡 MINOR | `qa/gen_scenarios.py:185–190` | **NEW** Bump stale seasonal pair `travelStartDate` values to 2027 |
| 12 | 🟡 MINOR | `check_html.py` | Add `ADOBE_PDF_API` URL fragment to REQUIRED list |
| 13 | 🟡 MINOR | `archive_to_input.py:32` | Add `--env` flag and confirmation prompt before live writes |
| 14 | 🟡 MINOR | `check_pipeline.py:14` | Make `CLASP_LIVE_ROOT` configurable via `TRIPSTORE_PIPELINE` env var |
| 15 | 🟡 MINOR | `qa/invariants.py` | Move `import re` in `_word_in()` to module top-level |
| 16 | 🟡 MINOR | `qa/smoke.py` | Print stderr warning when critical column not found in Sightseeing tab |

---

## Positive findings from ac55738

- **Billing-hash grandTotal lockstep** (`app/index.html:8267`): Correctly excludes `grandTotal` from `computeFrontendHash` to prevent spurious re-bills when re-saving. Comment explains the lockstep contract clearly. ✅
- **F06 cache-bust** (`app/index.html:14–19`): `Cache-Control: no-cache, must-revalidate` meta tag correctly forces browser revalidation on every load without busting CDN for unchanged files. ✅
- **Swiss 1st/2nd class toggle**: UI implementation is correct — `getSwissPassClass()` reads from DOM state, re-fetch+re-apply flow is sound. Minor edge cases noted in m7 above.
- **A3 Actual Spend**: `grandTotal` now stored in every save payload and surfaced in My Itineraries table. The `null`-guard `(typeof window._lastGrandTotal === 'number' ? ... : null)` is appropriate. ✅

---

## Not Changed This Run
This report is read-only. No production code was modified. All items require Sumit's review before any fix is applied.

*Generated: 2026-06-23 by automated daily code review routine.*
