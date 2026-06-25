# TripStore Daily Code Review — 2026-06-25

**Run by:** Automated (Claude Code · scheduled)
**Branch:** v2 (commit `1b38216`)
**Recent commits:**
```
1b38216 Landing: signup copy 15 free quotes -> 15 quotes at ₹495 (paid signup, S10/B-02)
1be2ef8 Auto: daily code review 2026-06-24
c4fe4db feat: F10 re-quote in place — editable nights + date cascade
1085604 Auto: daily code review 2026-06-23
a15f4a0 fix: remove dangling skill symlinks breaking Pages build
```

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `app/index.html` | ~10,200 | ✅ Reviewed |
| `index.html` (landing) | ~600 | ✅ Reviewed (new commit) |
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
| 🟠 MODERATE | 10 | 1 | 9 |
| 🟡 MINOR | 8 | 0 | 8 |

**C1 is now DAY 4 and still unresolved — real credential-exposure risk on live production.**

**New today:** M10 — 3 "Sign Up Free" labels remain on landing page after the ₹495 pricing change in commit `1b38216`.

---

## 🔴 CRITICAL Issues

### C1 — Password sent as GET query parameter *(carryover — DAY 4)*
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

### M1 — Session token sent in GET URL *(carryover — DAY 4)*
**File:** `app/index.html:4319`

```javascript
const res = await fetch(
  `${API_URL}?action=validateSession&user=${encodeURIComponent(s.username)}&token=${encodeURIComponent(s.token)}`
);
```

Session tokens in URLs appear in server/CDN logs and browser history. A leaked token grants full impersonation.

**Fix:** Move `validateSession` to POST, matching the `computeItinerary` pattern.

---

### M2 — API-sourced strings injected into `innerHTML` without sanitization *(carryover — DAY 4)*
**File:** `app/index.html:5179, 5202, 5232, 4939, 4942–4943, 9190`

**Confirmed existing locations (Swiss Pass feature):**
```javascript
const renderTourRow = t => `<span>${t.tour_name}: <s …>${fmtInr(t.full_price)}</s> → …`; // line 5179
detailsEl.innerHTML = '…Error loading pass data: ' + (e.message || e) + '</span>';       // line 5232
```

**City intelligence banner in `renderRouteInputs()`:**
```javascript
// line 4939 — intel.nextCity comes from the API response (Google Sheets data)
`Often Paired With: <b …>${intel.nextCity}</b>`

// line 4942 — r.city comes from user input via autocomplete
`No archive data for ${r.city}`
```

If a sheet cell (tour name, city pairing name) or a user's autocomplete input contains `<script>` or `<img onerror=…>`, it executes in the browser.

**Fix:** Apply the `_esc()` helper to all API-sourced and user-input strings before innerHTML interpolation:
```javascript
function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Then: `Often Paired With: <b>${_esc(intel.nextCity)}</b>`
// And:  `No archive data for ${_esc(r.city)}`
```

---

### M3 — Production `console.log` dumps full plan JSON *(carryover — DAY 4)*
**File:** `app/index.html` — 22 occurrences including lines 6940, 6966–6968, 6984, 8630, 8818, 8840–8841, 8847, 9787

Full plan JSON, agent names, pricing structures, and billing internals visible to anyone with DevTools open.

**Fix:** Gate behind `if (window._TRIPSTORE_DEBUG) console.log(...)`.

---

### M4 — No fetch timeout on any API call *(carryover — DAY 4)*
**File:** `app/index.html` — all `fetch()` calls

Apps Script cold starts can take 15–30 s; a quota error or script failure causes the UI to hang indefinitely with no recovery path.

**Fix:** Wrap every fetch in a 30-second `AbortController`.

---

### M5 — `// DEV @18` comment on live API URL *(carryover — DAY 4)*
**File:** `app/index.html:3302`

```javascript
const API_URL = "...AKfycbwP9KQH39.../exec"; // DEV @18 — 2026-05-04
```

The comment says "DEV" on the live production URL. Misleading during incident response.

**Fix:** Change comment to `// LIVE @18 — 2026-05-04`.

---

### M6 — `write_to_sheets.py`: dead `row_count` check + no chunking *(carryover — DAY 4)*
**File:** `write_to_sheets.py:168, 195`

`ws.row_count == 0` is never true for a gspread worksheet (new sheets start at 1000 rows by default). `append_rows` has no chunking, so a large batch silently hits the Sheets API 10 MB / quota limits.

**Fix:** Cache `get_all_values()` result; chunk `append_rows` in 500-row batches.

---

### M7 — Swiss Pass `fetchSwissPassOptions` sends full tour list as GET URL parameter *(carryover — DAY 4)*
**File:** `app/index.html:5119–5125`

```javascript
const url = `${API_URL}?action=getSwissPassOptions`
          + `&cities=...`
          + `&tours=${encodeURIComponent(JSON.stringify(selectedTours))}`;
const res = await fetch(url);
```

A 10-city itinerary produces a JSON blob of 3,000–10,000+ characters URL-encoded. Many browsers and reverse proxies enforce a 2,048–8,192 byte URL limit. When this fails, the catch block shows a generic error with no indication the URL was too long.

**Fix:** Convert `getSwissPassOptions` to POST (consistent with `computeItinerary` pattern).

---

### M8 — `getSavedList` and `searchItinerary` send username/role in GET URL *(carryover — DAY 4)*
**File:** `app/index.html:4437, 4512`

```javascript
fetch(`${API_URL}?action=search&username=…&role=…`);
fetch(`${API_URL}?action=getSavedList&username=…&role=…`);
```

Agent usernames and role strings appear in server logs and browser history on every tab switch.

**Fix:** Move to POST bodies as part of the session-validation fix scope.

---

### M9 — Negative nights value accepted in F10 editable nights input *(carryover — DAY 2)*
**File:** `app/index.html:4946, 4907`

Still unresolved. The inline `onchange` handler:
```javascript
onchange="selectedRoute[${i}].nights=parseInt(this.value)||1; _cascadeRouteDates(${i})"
```
And inside `_cascadeRouteDates` (line 4907):
```javascript
const nights = parseInt(selectedRoute[i].nights) || 1;
```

Both use `||1` which only guards falsy values. `parseInt('-3') || 1 = -3` — negative integers pass through, producing check-out dates **before** check-in. All subsequent city dates cascade wrongly.

**Fix:**
```javascript
// line 4946:
onchange="selectedRoute[${i}].nights = Math.max(1, parseInt(this.value) || 1); _cascadeRouteDates(${i})"
// line 4907:
const nights = Math.max(1, parseInt(selectedRoute[i].nights) || 1);
```

---

### M10 — "Sign Up Free" button labels contradict ₹495 pricing after commit `1b38216` *(NEW — today)*
**File:** `index.html:1484, 1506, 1992`

Commit `1b38216` changed the price callout (L1910) and final-note paragraph (L1994) from "15 free quotes" to "15 quotes at ₹495". However, three prominent CTAs on the same page still read **"Sign Up Free"**:

```html
<!-- L1484 — nav bar -->
<a href="app/index.html?action=signup" class="topbar-cta">Sign Up Free</a>

<!-- L1506 — hero section -->
<a href="app/index.html?action=signup" class="btn-cta large">Sign Up Free →</a>

<!-- L1992 — final CTA section (directly above the updated ₹495 note) -->
<a href="app/index.html?action=signup" class="btn-cta large">Sign Up Free →</a>
```

A visitor sees "Sign Up Free →" as the call to action, then reads "15 quotes at ₹495" two lines below. Contradictory messaging will erode trust and conversion. Line 1923 ("Edit hotels, dates, tours — same quote covers it. Free.") refers to reworks being included and may be intentional — does not need changing.

**Fix:** Update the three button/link labels:
- L1484: `Sign Up →` or `Get Started`
- L1506: `Get Started →` (hero primary CTA)
- L1992: `Sign Up for ₹495 →` (makes the paid nature explicit at point of action)

---

## 🟡 MINOR Issues

### m1 — `ADOBE_PDF_API` URL not validated by `check_html.py` *(carryover — DAY 4)*
**File:** `app/index.html`, `check_html.py`

PDF API deployment URL has no pre-commit guard. If the deployment is redeployed and the URL changes, PDFs silently break.

**Fix:** Add the Adobe PDF API URL fragment to `check_html.py`'s `REQUIRED` list.

---

### m2 — `archive_to_input.py`: hardcoded LIVE sheet ID, no dry-run guard *(carryover — DAY 4)*
**File:** `archive_to_input.py:32`

Running in any context writes directly to the production `INPUT_*` sheets, which triggers the overnight enrichment pipeline on unvalidated data.

**Fix:** Add `--env dev|live` flag and require confirmation before live writes.

---

### m3 — `check_pipeline.py`: `CLASP_LIVE_ROOT` not configurable via env var *(carryover — DAY 4)*
**File:** `check_pipeline.py:14–19`

Path hardcoded to `~/Desktop/tripstore-pipeline/clasp-live`. `smoke.py` correctly reads `TRIPSTORE_PIPELINE` from the environment; `check_pipeline.py` should match.

**Fix:** `_pipe = os.environ.get('TRIPSTORE_PIPELINE', os.path.expanduser('~/Desktop/tripstore-pipeline'))`

---

### m4 — `qa/invariants.py`: `import re` inside per-call helper *(carryover — DAY 4)*
**File:** `qa/invariants.py`, `_word_in()` function

`import re` inside a function called thousands of times per nightly run. Not a performance concern (module is cached by Python), but non-idiomatic.

**Fix:** Move to module top-level.

---

### m5 — `qa/smoke.py`: column fallback is silent *(carryover — DAY 4)*
**File:** `qa/smoke.py`, `_col()` helper

If the Sightseeing tab renames the Duration column, T04/T05 silently SKIP with no alert. A data quality regression can hide for weeks.

**Fix:** `print("WARNING: Duration column not found", file=sys.stderr)` when `_col()` returns `None` for a critical column.

---

### m6 — `qa/gen_scenarios.py`: stale `travelStartDate` for seasonal pair scenarios *(carryover — DAY 4, worsening)*
**File:** `qa/gen_scenarios.py:179, 186, 189`

```python
travelStartDate="2026-04-15"  # pair_season_01_apr  — NOW 71 days in the past
travelStartDate="2026-05-29"  # (separate scenario) — NOW 27 days in the past
travelStartDate="2026-06-15"  # pair_season_01_jun  — NOW 10 days in the past
```

The P07 seasonal pair test (April vs June, expects ~1.20× totalSpent ratio) uses dates now firmly in the past. The June 15 date is 10 days stale and will tip to past-month pricing next nightly run.

**Fix:** Bump seasonal pair dates forward to 2027:
```python
travelStartDate="2027-04-15"
travelStartDate="2027-05-29"
travelStartDate="2027-06-15"
```

---

### m7 — Swiss Pass class radio not reset when optimizer runs without Swiss cities *(carryover — DAY 4)*
**File:** `app/index.html:5406–5430`

When an agent loads a non-Swiss itinerary after having set 1st class on a Swiss one, `swissPassEnabled` is not reset and `getSwissPassClass()` returns '1st' unexpectedly on the next Swiss quote.

**Affected path:** `runOptimizer()` → does not call `toggleSwissPass(false)` when new route has no Swiss cities.

**Fix:** In `runOptimizer()`, reset Swiss Pass state when the new route contains no Swiss cities.

---

### m8 — City intelligence banner injects API fields into `innerHTML` without escaping *(carryover — DAY 2)*
**File:** `app/index.html:4929, 4935–4939, 4942`

`intel.nextCity` (from Google Sheets via API) and `r.city` (from user-typed autocomplete) are interpolated raw into innerHTML in `renderRouteInputs()`. Extends the M2 XSS surface. See M2 for the fix.

---

## Action Items (Priority Order)

| # | Priority | File | Action | Days Open |
|---|----------|------|--------|-----------|
| 1 | 🔴 CRITICAL | `app/index.html:3730` | Move `checkLogin` credentials to POST body | **DAY 4** |
| 2 | 🟠 MODERATE | `app/index.html:4946,4907` | Clamp nights to `Math.max(1, …)` to reject negatives | **DAY 2** |
| 3 | 🟠 MODERATE | `index.html:1484,1506,1992` | **NEW** Fix "Sign Up Free" button labels — contradicts ₹495 pricing | Day 1 |
| 4 | 🟠 MODERATE | `app/index.html:4319` | Move `validateSession` token to POST body | Day 4 |
| 5 | 🟠 MODERATE | `app/index.html:5119–5125` | Convert `getSwissPassOptions` to POST (URL length risk) | Day 4 |
| 6 | 🟠 MODERATE | `app/index.html:5179,5232,4939,4942,9190` | Escape API-sourced strings before innerHTML | Day 4 |
| 7 | 🟠 MODERATE | `app/index.html` (all fetches) | Add 30s `AbortController` timeout to every `fetch()` | Day 4 |
| 8 | 🟠 MODERATE | `app/index.html` (22 sites) | Gate production `console.log` dumps behind `window._TRIPSTORE_DEBUG` | Day 4 |
| 9 | 🟠 MODERATE | `app/index.html:3302` | Fix `// DEV @18` comment → `// LIVE @18` | Day 4 |
| 10 | 🟠 MODERATE | `write_to_sheets.py:168,195` | Remove dead `row_count == 0` branch; add 500-row chunking | Day 4 |
| 11 | 🟠 MODERATE | `app/index.html:4437,4512` | Move `getSavedList`/`searchItinerary` username+role to POST body | Day 4 |
| 12 | 🟡 MINOR | `app/index.html:4939,4942` | Escape `intel.nextCity` + `r.city` in intelligence banner | Day 2 |
| 13 | 🟡 MINOR | `app/index.html:5406` | Reset Swiss Pass class radio when optimizer runs without Swiss cities | Day 4 |
| 14 | 🟡 MINOR | `qa/gen_scenarios.py:179,186,189` | Bump stale `travelStartDate` values to 2027 | **DAY 4 — URGENT** |
| 15 | 🟡 MINOR | `check_html.py` | Add `ADOBE_PDF_API` URL fragment to REQUIRED list | Day 4 |
| 16 | 🟡 MINOR | `archive_to_input.py:32` | Add `--env` flag and confirmation prompt before live writes | Day 4 |
| 17 | 🟡 MINOR | `check_pipeline.py:14` | Make `CLASP_LIVE_ROOT` configurable via `TRIPSTORE_PIPELINE` env var | Day 4 |
| 18 | 🟡 MINOR | `qa/invariants.py` | Move `import re` in `_word_in()` to module top-level | Day 4 |
| 19 | 🟡 MINOR | `qa/smoke.py` | Print stderr warning when critical column not found in Sightseeing tab | Day 4 |

---

## Findings from `1b38216` (Landing: paid signup copy change)

**What was changed:** Price callout (L1910–1911) and final-note paragraph (L1994) updated from "15 free quotes" to "15 quotes at ₹495".

**Good:** Commit was surgical — only the two text nodes mentioned in the commit message were changed. `app/index.html` correctly untouched.

**Issue found (M10):** Three button/link labels with "Sign Up Free" were NOT updated and now contradict the ₹495 copy. The nav CTA, hero primary button, and final CTA section button all still say "Free". These are the highest-visibility elements on the page — they dominate user perception more than the explanatory text below.

---

## Not Changed This Run
This report is read-only. No production code was modified. All items require Sumit's review before any fix is applied.

*Generated: 2026-06-25 by automated daily code review routine.*
