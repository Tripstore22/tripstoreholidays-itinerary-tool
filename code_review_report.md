# TripStore Daily Code Review — 2026-06-22

**Run by:** Automated (Claude Code · scheduled)
**Branch:** v2 (commit `82578ce`)
**Recent commits:**
```
82578ce Auto: daily code review 2026-06-21
69003e4 Auto: daily code review 2026-06-20
2109581 Auto: daily code review 2026-06-19
15589d9 Auto: daily code review 2026-06-18
d0473f8 Auto: daily code review 2026-06-16
```

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `app/index.html` | 10,056 | ✅ Reviewed |
| `index.html` (landing page) | 2,073 | ✅ Reviewed |
| `write_to_sheets.py` | ~220 | ✅ Reviewed |
| `archive_to_input.py` | ~290 | ✅ Reviewed |
| `check_html.py` | ~100 | ✅ Reviewed |
| `check_pipeline.py` | ~180 | ✅ Reviewed |
| `qa/invariants.py` | ~280 | ✅ Reviewed |
| `qa/smoke.py` | ~260 | ✅ Reviewed |
| `qa/nightly.py` | ~110 | ✅ Reviewed |
| `qa/gen_scenarios.py` | ~170 | ✅ Reviewed |

### ⚠️ Files NOT reviewable (not in this repo)

The following files requested for review live at `~/Desktop/tripstore-pipeline/` on Sumit's local machine only — they are not committed to GitHub and are inaccessible from CI/remote sessions:

- `Code.gs`, `Pipeline.gs`, `Quote_Intelligence.gs`, `Wallet.gs`
- `extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`
- `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`

**Action needed:** To include these in daily automated reviews, they need to be in a (private) repo or made available via CI secrets/path.

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 1 |
| 🟠 MODERATE | 6 |
| 🟡 MINOR | 5 |

---

## 🔴 CRITICAL Issues

### C1 — Password sent as GET query parameter
**File:** `app/index.html:3713`

```javascript
const res = await fetch(
  `${API_URL}?action=checkLogin&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`
);
```

Passwords are passed in the URL query string. This means every login attempt writes the plaintext password to:
- **Browser history** (anyone at the computer can read it from the address bar)
- **Google Apps Script server logs** (Apps Script logs incoming request URLs by default)
- **Chrome DevTools Network panel** (visible to anyone who opens devtools)
- **Any CDN or proxy access log** sitting in front of GAS

The signup flow (line 3746) correctly uses `POST` with a JSON body — login should match.

**Fix:** Change `checkLogin` to a POST request with credentials in the JSON body:
```javascript
const res = await fetch(API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'checkLogin', username: user, password: pass })
});
```
Update the corresponding Apps Script `doPost()` handler to read `params.username` / `params.password`.

---

## 🟠 MODERATE Issues

### M1 — Session token sent in GET URL
**File:** `app/index.html:4302`

```javascript
const res = await fetch(
  `${API_URL}?action=validateSession&user=${encodeURIComponent(s.username)}&token=${encodeURIComponent(s.token)}`
);
```

Session tokens in URL query strings appear in server/CDN logs and browser history. A leaked token grants full impersonation for the token's lifetime.

**Fix:** Move `validateSession` to a POST request (same pattern as the `computeItinerary` calls at line 6856).

---

### M2 — `e.message` injected into `innerHTML` without sanitization
**File:** `app/index.html:9104, 5184`

```javascript
// line 9104
el.innerHTML = `<div style="...">Error: ${e.message}</div>`;

// line 5184
detailsEl.innerHTML = '<span ...>Error loading pass data: ' + (e.message || e) + '</span>';
```

JavaScript `Error.message` can contain text derived from API response bodies (e.g., JSON parse errors, network error strings). If a malicious server response triggers an exception with a crafted message containing `<script>...</script>`, this is an XSS vector.

Real-world risk is low given the controlled API, but it is worth fixing. Use `textContent` for the error message portion.

**Fix (line 9104 example):**
```javascript
const div = document.createElement('div');
div.style.cssText = 'text-align:center;padding:60px;color:#dc2626;';
div.textContent = 'Error: ' + (e.message || e);
el.innerHTML = '';
el.appendChild(div);
```

---

### M3 — Production `console.log` dumps full plan JSON and agent identity
**File:** `app/index.html:6862, 6888–6890, 6906, 8544, 8732, 8754–8761`

Several verbose debug `console.log` calls remain in production code:

```javascript
console.log('[engine response]', JSON.stringify(data, null, 2));   // full API payload
console.log('[currentPlan]', JSON.stringify(currentPlan, null, 2)); // full pricing plan
console.log('[autoSaveTick] POSTing saveItinerary as',
  JSON.stringify({ paxName: saveName, savedBy: agent, payload_keys: Object.keys(payload||{}) }));
```

Any user (agent, customer, competitor) who opens DevTools → Console can see full itinerary pricing, agent names, plan structure, and payload keys.

**Fix:** Remove or gate behind a debug flag:
```javascript
if (window._TRIPSTORE_DEBUG) console.log('[engine response]', ...);
```

---

### M4 — No fetch timeout on any API call — UI hangs indefinitely on slow GAS
**File:** `app/index.html` (all `fetch()` calls)

No API call uses an `AbortController` or timeout signal. Apps Script cold starts can take 15–30 seconds; if the script errors or quota-limits, the fetch hangs indefinitely. The user sees a spinner with no recovery.

**Fix (pattern to apply to all `fetch` calls):**
```javascript
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 30000);
try {
  const res = await fetch(url, { ..., signal: ctrl.signal });
  clearTimeout(timer);
  // ...
} catch(e) {
  clearTimeout(timer);
  if (e.name === 'AbortError') showToast('Request timed out — try again.', 'error');
  else throw e;
}
```

---

### M5 — CLAUDE.md API URL patterns stale; "DEV @18" comment misleading on live URL
**File:** `app/index.html:3285`, `CLAUDE.md`

`CLAUDE.md` states:
- Live URL contains: `AKfycbzAbIgzRoN_MNs377jm3u`
- DEV URL contains: `AKfycbzFTBGVeZ6oQglrgULFCJ1ESHqxipL-QGCHLVL9hBk8`

But `app/index.html:3285` has:
```javascript
const API_URL = "...AKfycbwP9KQH39hcBcLQsPsOL_c4hKIuV3TTlm1XW2CT2e72W-TYVP01-adjsVAKtAAArhGQWA/exec";
// DEV @18 — 2026-05-04 RBAC 5-role + getAllUsers
```

This URL matches **neither** pattern in CLAUDE.md, and the comment says "DEV @18" — implying this might be a DEV deployment ID serving the live app. `check_html.py` validates this exact URL, so the URL itself is correct, but:

1. CLAUDE.md documentation is stale and will cause confusion during incident response.
2. The "DEV @18" comment suggests to any reader that the live app is running on a DEV deployment.

**Fix:** Update CLAUDE.md with the current live URL fragment (`AKfycbwP9KQH39`…). Change the line 3285 comment from `// DEV @18` to `// LIVE @18 — 2026-05-04 RBAC 5-role`.

---

### M6 — `write_to_sheets.py`: dead `row_count` branch + no chunking on `append_rows`
**File:** `write_to_sheets.py:168, 185`

**Issue A — Dead-code branch:**
```python
sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
```
When gspread creates a new worksheet via `add_worksheet(rows=1000)`, `ws.row_count` is 1000 — never 0. The first condition is dead code. The actual empty check is `not ws.get_all_values()`, which is also a redundant second API call (the same data is fetched again in `build_existing_keys()`).

**Fix:** Cache the result of `get_all_values()` and pass it to both functions:
```python
all_values = ws.get_all_values()
sheet_is_empty = not all_values
if sheet_is_empty:
    ws.append_row(headers, value_input_option="RAW")
    apply_header_style(ws, len(headers))
existing_keys = build_existing_keys_from_data(all_values, headers)
```

**Issue B — No chunking on `append_rows()`:**
```python
ws.append_rows(new_rows, value_input_option="USER_ENTERED")
```
Sheets API has a 10MB-per-request limit and rate quotas (~60 writes/minute). If `new_rows` is large, this call fails with a quota error and nothing is written — no partial progress, no retry.

**Fix:** Chunk into batches of 500 rows:
```python
CHUNK = 500
for i in range(0, len(new_rows), CHUNK):
    ws.append_rows(new_rows[i:i+CHUNK], value_input_option="USER_ENTERED")
    if i + CHUNK < len(new_rows):
        time.sleep(1)
```

---

## 🟡 MINOR Issues

### m1 — `ADOBE_PDF_API` URL has no validator guard in `check_html.py`
**File:** `app/index.html:8476`, `check_html.py`

```javascript
const ADOBE_PDF_API = 'https://script.google.com/macros/s/AKfycbzHI5cG.../exec';
```

`check_html.py` validates the main `API_URL` constant, but `ADOBE_PDF_API` has no equivalent check. If this deployment is redeployed and the URL changes, PDFs silently break with no pre-commit guard to catch it.

**Fix:** Add an entry to `check_html.py`'s `REQUIRED` list:
```python
("AKfycbzHI5cGHeknV7qlGNx3X62qtNH_STe3t6wRTBiJ0aEPU", "Adobe PDF API URL"),
```

---

### m2 — `archive_to_input.py`: hardcoded LIVE sheet ID, no dry-run guard
**File:** `archive_to_input.py:18`

```python
SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"  # LIVE sheet
```

Running this script accidentally in a DEV context writes to production INPUT sheets, which triggers the overnight enrichment pipeline on unvalidated data.

**Fix:** Add a `--env` flag (or read `TRIPSTORE_ENV` env var), prompt for confirmation before any live write, and add `--dry-run` support.

---

### m3 — `check_pipeline.py`: `CLASP_LIVE_ROOT` not configurable via env var
**File:** `check_pipeline.py:14`

```python
CLASP_LIVE_ROOT = os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live')
```

The path is hardcoded. `smoke.py` correctly reads `TRIPSTORE_PIPELINE` from the environment. `check_pipeline.py` requires editing the file to run anywhere else.

**Fix:**
```python
_pipe = os.environ.get('TRIPSTORE_PIPELINE', os.path.expanduser('~/Desktop/tripstore-pipeline'))
CLASP_LIVE_ROOT = os.path.join(_pipe, 'clasp-live')
```

---

### m4 — `qa/invariants.py`: `import re` inside a per-tour helper function
**File:** `qa/invariants.py`, `_word_in()` function

```python
def _word_in(needle, hay):
    import re    # imported on every call
    return re.search(r"\b" + re.escape(needle) + r"\b", hay) is not None
```

Python caches modules so this doesn't re-parse the module, but it's non-idiomatic and incurs a dict lookup on each of potentially thousands of calls during a full scenario bank run.

**Fix:** Move `import re` to module top-level.

---

### m5 — `qa/smoke.py`: column fallback is silent; T04/T05 SKIP without alerting if column renamed
**File:** `qa/smoke.py`, `_col()` helper

```python
ci_h = _col(hdr, "Duration", "Average Hours", "Avg_Duration", "Hours")
if ci_h is not None:
    # run T04/T05
else:
    results.append(inv._r("T04_hours_gt_14", "T04", "SKIP", "data", reason="Duration column not found"))
```

If the Sightseeing tab renames the Duration column to something not in the fallback list, T04 and T05 silently SKIP in every nightly run. The reports show SKIP without any alert that the column name changed. This is how a data quality regression can hide for weeks.

**Fix:** When `_col()` returns `None` for a critical column, emit a stderr warning:
```python
ci_h = _col(hdr, "Duration", "Average Hours", "Avg_Duration", "Hours")
if ci_h is None:
    print("WARNING: Duration column not found in Sightseeing tab — T04/T05 skipped", file=sys.stderr)
```

---

## Action Items (Priority Order)

| # | Priority | File | Action |
|---|----------|------|--------|
| 1 | 🔴 CRITICAL | `app/index.html:3713` | Move `checkLogin` credentials to POST body — passwords in GET URL |
| 2 | 🟠 MODERATE | `app/index.html:4302` | Move `validateSession` token to POST body |
| 3 | 🟠 MODERATE | `app/index.html:9104,5184` | Replace `innerHTML = ...e.message` with `textContent` |
| 4 | 🟠 MODERATE | `app/index.html` (all fetches) | Add 30s `AbortController` timeout to every `fetch()` call |
| 5 | 🟠 MODERATE | `app/index.html:6862+` | Remove / gate production `console.log` dumps behind `window._TRIPSTORE_DEBUG` |
| 6 | 🟠 MODERATE | `CLAUDE.md` + `app/index.html:3285` | Update CLAUDE.md API URL patterns; fix "DEV @18" comment to "LIVE @18" |
| 7 | 🟠 MODERATE | `write_to_sheets.py:168,185` | Remove dead `row_count == 0` branch; add 500-row chunking to `append_rows` |
| 8 | 🟡 MINOR | `check_html.py` | Add `ADOBE_PDF_API` URL fragment to REQUIRED list |
| 9 | 🟡 MINOR | `archive_to_input.py` | Add `--env` flag and confirmation prompt before live writes |
| 10 | 🟡 MINOR | `check_pipeline.py:14` | Make `CLASP_LIVE_ROOT` read from `TRIPSTORE_PIPELINE` env var |
| 11 | 🟡 MINOR | `qa/invariants.py` | Move `import re` to module top-level |
| 12 | 🟡 MINOR | `qa/smoke.py` | Add stderr warning when critical column not found in Sightseeing tab |

---

## Not Changed This Run
This report is read-only. No production code was modified. All items require Sumit's review before any fix is applied.

*Generated: 2026-06-22 by automated daily code review routine.*
