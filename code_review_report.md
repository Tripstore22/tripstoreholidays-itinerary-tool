# TripStore Code Review Report
**Date:** 2026-05-01  
**Reviewer:** Claude (Automated Daily Review)  
**Branch:** v2  
**Recent Commits Reviewed:**
- d64a756 Auto: daily code review
- 426134b Auto: daily code review
- cdd4dc2 Auto: daily code review
- c11f1ee Auto: daily code review
- fdd2f17 Sync main with v2: fix budget hints (inline style)
- 07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class

---

## Files Reviewed

| File | Status |
|------|--------|
| Code.gs | ✅ Reviewed |
| Pipeline.gs | ✅ Reviewed |
| Quote_Intelligence.gs | ✅ Reviewed |
| index_fit.tripstore.html | ✅ Reviewed |
| write_to_sheets.py | ✅ Reviewed |
| archive_to_input.py | ✅ Reviewed |
| extract_itineraries.py | ❌ File not found in repo |
| write_inputs_to_sheets.py | ❌ File not found in repo |
| cleanup_sheet.py | ❌ File not found in repo |
| clean_pipeline_data.py | ❌ File not found in repo |
| cross_reference.py | ❌ File not found in repo |
| enrich_hotels.py | ❌ File not found in repo |
| enrich_hotels_booking.py | ❌ File not found in repo |

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 2 |
| 🟠 MODERATE | 8 |
| 🟡 MINOR | 9 |
| **Total** | **19** |

---

## 🔴 CRITICAL Issues

---

### C1 — Code.gs: Login authentication routing mismatch (potentially broken login)

**File:** `Code.gs` (lines 25–28 in `doGet`) + `index_fit.tripstore.html` (line 583 in `checkLogin()`)

**Problem:**  
The `checkLogin` action is handled in `doGet()`, which reads credentials from URL query parameters (`e.parameter.user`, `e.parameter.pass`). However, the front-end JavaScript sends login as a **POST** request with a JSON body:

```javascript
// index_fit.tripstore.html — checkLogin()
const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) });
```

A POST request triggers `doPost()` in Apps Script — which only handles `signup` and `saveItinerary`. The `checkLogin` action falls through to the final return `'Invalid action'`.

**Impact:** If the deployed Apps Script matches this local Code.gs, fresh logins fail with "Invalid action." Users who are already logged in via `localStorage` are unaffected until they log out.

**Fix:** Add `checkLogin` handling to `doPost()`:

```javascript
// Code.gs — doPost, add before the final return
if (action === 'checkLogin') {
  return checkLogin(data.user || '', data.pass || '');
}
```

---

### C2 — index_fit.tripstore.html: Stored XSS in `renderTables()`

**File:** `index_fit.tripstore.html` (lines ~1286–1460 in `renderTables()`)

**Problem:**  
Data loaded from cloud storage is injected directly into `innerHTML` with no escaping:

```javascript
hHtml += `<td ...>${item.city}</td>`;
hHtml += `<textarea ...>${item.hotel?.name || ''}</textarea>`;
```

`item.city`, `item.hotel.name`, and many other fields come from `currentPlan`, populated from JSON stored in Google Sheets. If these fields contain `<img src=x onerror=alert(1)>` or a `<script>` tag (saved by anyone with Sheets access), the payload executes in every agent's browser that loads the itinerary.

**Impact:** Stored XSS. An admin browsing all saved itineraries via the Admin Panel is especially exposed.

**Fix:** Escape all dynamic values before injecting into innerHTML:

```javascript
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Then everywhere: ${esc(item.city)}, ${esc(item.hotel?.name)}, etc.
```

---

## 🟠 MODERATE Issues

---

### M1 — Code.gs: Passwords stored and compared in plaintext

**File:** `Code.gs` (lines 257–264 in `checkLogin()`, line 289 in `handleSignup()`)

Passwords are written to and read from the Users sheet as plain text. Anyone with read access to the sheet (co-owner, accidental share) can see all agent passwords.

**Fix:** Hash passwords with SHA-256 via `Utilities.computeDigest()` before storage, or use an external bcrypt endpoint.

---

### M2 — Code.gs: No authentication on `searchItinerary` and `getAllSaved`

**File:** `Code.gs` (lines 299–334)

`getAllSaved` (returns all pax names) and `searchItinerary` (returns full itinerary JSON) require no token. Any HTTP client can enumerate all client names and download full itinerary data with a single public URL call.

**Fix:** Add a server-side secret token stored in Script Properties and required as a parameter on sensitive `doGet` actions.

---

### M3 — Pipeline.gs: Claude response idx ordering not validated

**File:** `Pipeline.gs` (lines 228–249 in `processSheet()`)

Results from Claude are matched to input rows by array position (index 0 → batch[0]), not by the `idx` field Claude is instructed to return. If Claude returns results out of order or omits a row, the wrong master-sheet data is written silently.

**Fix:**
```javascript
results.forEach(res => {
  const row = batch[res.idx];
  if (!row) { auditLog(ss, `WARN: unexpected idx ${res.idx}`); return; }
  // rest of logic...
});
```

---

### M4 — Pipeline.gs: Claude response parsing is brittle

**File:** `Pipeline.gs` (lines 585–591 in `callClaudeAPI()`)

```javascript
const cleaned = text.replace(/```json|```/g, '').trim();
return JSON.parse(cleaned);
```

If Claude adds any explanatory text before or after the JSON array, `JSON.parse` throws. The catch block silently marks all rows in the batch as errors and defers them to the next nightly run with no clear diagnostic.

**Fix:** Extract the JSON array explicitly:
```javascript
const jsonMatch = text.match(/\[[\s\S]*\]/);
if (!jsonMatch) throw new Error('No JSON array in Claude response');
return JSON.parse(jsonMatch[0]);
```

---

### M5 — Quote_Intelligence.gs: Infinite recursion risk in `logQuote()`

**File:** `Quote_Intelligence.gs` (lines 29–47)

```javascript
if (!logSheet) {
  setupQuoteLog();
  return logQuote(paxName, data); // infinite loop if setupQuoteLog fails silently
}
```

If `setupQuoteLog()` fails (quota, permissions), `logQuote` recurses indefinitely until a stack overflow. This would crash the parent `saveItinerary()` call, losing the entire save operation.

**Fix:** Add a `retried` guard:
```javascript
function logQuote(paxName, data, retried = false) {
  const logSheet = ss.getSheetByName('Quote_Log');
  if (!logSheet) {
    if (retried) { Logger.log('Quote_Log missing — skip log'); return; }
    setupQuoteLog();
    return logQuote(paxName, data, true);
  }
```

---

### M6 — Quote_Intelligence.gs: Stale GST field in `buildQuoteLogRow()`

**File:** `Quote_Intelligence.gs` (line 119)

```javascript
const gstPct = d.gst || 5;
```

The current app saves `gstMode` (string: `'5pkg'`, `'18svc'`, `'none'`), not a numeric `d.gst`. When `d.gst` is `0` or absent (no GST), `|| 5` applies 5% GST incorrectly. Backfill and new logs for "No GST" itineraries are overstated.

**Fix:**
```javascript
const gstPct = d.gstMode === '5pkg' ? 5 : (d.gstMode === '18svc' ? 18 : (Number(d.gst) || 0));
```

---

### M7 — index_fit.tripstore.html: `saveItinerary()` ignores Apps Script error responses

**File:** `index_fit.tripstore.html` (lines 719–724 in `saveItinerary()`)

```javascript
await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
showToast("Saved Successfully");
```

If Apps Script returns `"Setup Error: Saved_Itineraries sheet not found"` or any other error string, the UI still shows "Saved Successfully." The itinerary is silently lost.

**Fix:**
```javascript
const text = await (await fetch(API_URL, { method: "POST", body: JSON.stringify(data) })).text();
if (!text.toLowerCase().includes('successfully')) throw new Error(text);
showToast("Saved Successfully");
```

---

### M8 — archive_to_input.py: `parse_hotels_cell` range can miss trailing hotels

**File:** `archive_to_input.py` (lines 70–76 in `parse_hotels_cell()`)

`range(0, len(parts) - 3, 4)` — for a cell with 7 parts (1 full hotel + 1 partial), the range is `[0]` only. The second hotel's data (positions 4–6) is silently dropped.

**Fix:** Use `range(0, len(parts), 4)` and rely on the existing inner bounds check `if i + 3 < len(parts)`.

---

## 🟡 MINOR Issues

---

### N1 — Code.gs: No rate limiting on login — brute-force possible

No failed-attempt tracking or lockout. An attacker can try unlimited username/password combinations. Consider logging failures to a `Login_Audit` sheet and blocking after 5 attempts.

---

### N2 — Code.gs: `getQuoteLog` is unauthenticated — exposes business data

`GET {API_URL}?action=getQuoteLog` returns all quote financials, pax names, cities, and budgets to anyone with the API URL. Apply the same token check recommended in M2.

---

### N3 — Pipeline.gs: `Utilities.sleep(1500)` may be insufficient at scale

1.5 seconds between batches is adequate for low volume. With large INPUT queues across all 4 sheet types, Claude Haiku's 50 req/min limit could be hit. Cap queue processing at 40 rows per run or implement backoff on 429 responses.

---

### N4 — Quote_Intelligence.gs: Quote ID can collide within the same millisecond

```javascript
const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);
```

Two near-simultaneous saves produce identical IDs. Fix: `'Q-' + Date.now() + '-' + Math.floor(Math.random() * 9999)`.

---

### N5 — write_to_sheets.py: Hardcoded Spreadsheet ID and credentials path

```python
SPREADSHEET_ID   = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
CREDENTIALS_PATH = Path("./sheets-credentials.json")
```

The credentials file path being hardcoded risks accidental `git add .` committing the service account key. Verify `sheets-credentials.json` is in `.gitignore`. Move both values to a `.env` file.

---

### N6 — archive_to_input.py: Same hardcoded Spreadsheet ID

Same as N5. Consolidate into a shared `config.py` or `.env`.

---

### N7 — index_fit.tripstore.html: `BUDGET_RANGES` are hardcoded and will go stale

```javascript
const BUDGET_RANGES = { hotel: { low: 2500, high: 7500 }, land: { low: 1200, high: 2800 } };
```

These drive the budget suggestion hints shown to agents. With European hotel prices rising, these will underquote over time. Flag for quarterly manual review, or derive from live sheet averages.

---

### N8 — index_fit.tripstore.html: CDN scripts loaded without SRI hashes

`html2canvas`, `jsPDF`, `ExcelJS`, `FileSaver`, and Tailwind load from CDNs with no Subresource Integrity hashes. A compromised CDN would silently inject malicious code. Add `integrity` + `crossorigin` attributes to each `<script>` tag.

---

### N9 — 7 expected Python files absent from the repository

The following files listed for daily review are **not in the repo**:
`extract_itineraries.py`, `write_inputs_to_sheets.py`, `cleanup_sheet.py`, `clean_pipeline_data.py`, `cross_reference.py`, `enrich_hotels.py`, `enrich_hotels_booking.py`

If these exist only on a local machine, they are not version-controlled and cannot be recovered after disk failure. Commit them to v2 immediately, or confirm they have been superseded by `archive_to_input.py` and `write_to_sheets.py`.

---

## Action Items (Priority Order)

| # | Priority | Action |
|---|----------|--------|
| 1 | IMMEDIATE | **C1** — Verify live login works. If broken, add `checkLogin` to `doPost` in Apps Script. |
| 2 | IMMEDIATE | **C2** — Add `esc()` helper and sanitize all `renderTables()` innerHTML injections. |
| 3 | THIS WEEK | **M1** — Hash passwords in Users sheet. Prompt agents to reset. |
| 4 | THIS WEEK | **M5** — Add `retried` guard to `logQuote()`. |
| 5 | THIS WEEK | **M3** — Match Claude results by `res.idx`, not array position. |
| 6 | THIS WEEK | **M6** — Fix GST field read in `buildQuoteLogRow()`. |
| 7 | THIS MONTH | **M2 + N2** — Add secret-token auth to sensitive `doGet` actions. |
| 8 | THIS MONTH | **M4** — Use regex to extract JSON from Claude responses. |
| 9 | THIS MONTH | **M7** — Check Apps Script response body before showing save success. |
| 10 | ONGOING | **N5/N6** — Move IDs to `.env`. **N8** — Add SRI hashes. **N9** — Commit or deprecate missing Python files. |

---

*Generated automatically by Claude Code — TripStore Daily Review — 2026-05-01*
