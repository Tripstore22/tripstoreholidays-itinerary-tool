# TripStore Code Review Report
**Date:** 2026-06-05  
**Scope:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Missing files (not found in repo):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Recent Commits
```
a5e4a7f Auto: daily code review
56edcaa Auto: daily code review
d64a756 Auto: daily code review
426134b Auto: daily code review
cdd4dc2 Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style
d74b3bd Remove CNAME from main
e6a35d9 Merge v2 into main
```

---

## FILE: Code.gs

### CRITICAL

**C1 — Passwords stored in plaintext (Line 289)**
`handleSignup()` writes raw passwords to Google Sheets: `sheet.appendRow([username, password.trim(), 'PENDING', ...])`. `checkLogin()` reads them back as plain text (line 261). If the spreadsheet is ever shared or leaked, all credentials are immediately exposed.
**Fix:** Hash before storing: `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` converted to hex, with a per-user salt in a separate column.

**C2 — isAdmin flag restored from localStorage without server re-verification (index_fit.tripstore.html Line 643–651)**
`checkAutoLogin()` sets `isAdmin = s.isAdmin` directly from `localStorage`. Any user can open DevTools and run `localStorage.setItem('tripstore_session', JSON.stringify({isLoggedIn:true,isAdmin:true,modeText:'ADMIN MODE'}))` to access the admin panel without logging in.
**Fix:** On auto-login, call the backend to re-verify role before granting admin UI.

**C3 — No authentication on saveItinerary() / searchItinerary() / getAllSaved() (Code.gs Lines 299–364)**
All three endpoints accept any HTTP caller with no authentication. Anyone who finds the API_URL (hardcoded in the frontend HTML) can enumerate all pax names, load any itinerary, or overwrite any itinerary.
**Fix:** Require a server-issued session token on all write and read operations.

### MODERATE

**M1 — checkLogin() exposed via GET with credentials in URL (Line 26)**
`doGet` handles `action=checkLogin&user=X&pass=Y`. GET query params appear in access logs and browser history. The frontend uses POST correctly, but the GET route remains live.
**Fix:** Remove the `checkLogin` case from `doGet`.

**M2 — No payload size limit in saveItinerary() (Line 348)**
`JSON.stringify(payload)` is written with no size check. Google Sheets cells cap at 50,000 characters; exceeding this silently truncates data.
**Fix:** `if (payloadStr.length > 45000) return ContentService.createTextOutput('Payload too large');`

**M3 — getAllSaved() exposes all customer pax names to any caller (Line 303)**
No authentication. `?action=getAllSaved` returns the full list of saved customers.

### MINOR

**m1 — parsePrice() silent zero return**
No logging when a value expected to be numeric is unparseable. Data quality issues in the sheet are invisible.

---

## FILE: Pipeline.gs

### MODERATE

**M4 — Entire batch marked ERROR if Claude returns malformed JSON (Lines 587–597)**
If Claude hits the token limit mid-response, `JSON.parse(cleaned)` throws and every row in the batch is marked ERROR with a generic "Claude API error" message. There is no distinction between a network failure and a truncated response.
**Fix:** Catch JSON parse errors separately with a specific reason ("Claude response was incomplete — reduce BATCH_SIZE or increase MAX_TOKENS"). Consider per-item try-catch for partial recovery.

**M5 — logQuote() recursive retry has no guard (Quote_Intelligence.gs Lines 36–37)**
```js
setupQuoteLog();
return logQuote(paxName, data); // retry
```
If `setupQuoteLog()` silently fails, this recurse indefinitely.
**Fix:** Add a `retried = false` parameter and return immediately on the second attempt.

**M6 — _buildInputSheet() duplicates info banner row on repeated runs (Lines 779–788)**
`ws.insertRowBefore(2)` is unconditional. Running `setupSheets()` again inserts another banner row into every existing sheet, pushing data down.
**Fix:** Check if row 2 already contains banner text before inserting.

**M7 — setupTrigger() calls SpreadsheetApp.getUi() which fails in non-UI context (Line 847)**
`getUi().alert()` throws `Cannot call getUi() from this context` when invoked from a time-based trigger or script editor automation.
**Fix:** Replace with `Logger.log()` and/or an email notification.

**M8 — buildMasterKey() returns empty string for unknown type (Line 290)**
`default: return ''` causes `keySet.add('')`. Rows with unknown types are all incorrectly flagged as duplicates of each other.

### MINOR

**m2 — EUR/INR rate hardcoded in Claude prompt as 110/euro (Line 463)**
The rate fluctuates. A stale figure causes Claude to miscalculate INR prices back-derived from EUR columns.
**Fix:** Store in Script Properties and inject dynamically.

**m3 — 1500ms sleep between Claude batches may be insufficient**
Consider 3000ms or exponential backoff on HTTP 429 responses.

---

## FILE: Quote_Intelligence.gs

### MODERATE

**M9 — GST calculation ignores gstMode, always applies 5% (Line 119)**
```js
const gstPct = d.gst || 5;
```
The frontend saves `gstMode: '5pkg' | '18svc' | 'none'` but the code reads `d.gst` (a numeric field that no longer exists in current payloads). For all current saves, `d.gst` is undefined, so GST is always logged as `markupAmt * 0.05` regardless of the mode selected. Quote_Log financial data is wrong for all 18%-mode and no-GST quotes.
**Fix:**
```js
const gstMode = d.gstMode || 'none';
const gstBase = gstMode === '5pkg' ? (subTotal + markupAmt) : markupAmt;
const gstPct  = gstMode === '5pkg' ? 5 : gstMode === '18svc' ? 18 : 0;
const gstAmt  = Math.round(gstBase * gstPct / 100);
```

**M10 — backfillQuoteLog() has no duplicate detection (Lines 278–308)**
Running it a second time appends all historical quotes again — no check for existing entries. The sheet accumulates duplicates silently.
**Fix:** Build a Set of existing paxNames from Quote_Log before writing and skip entries already present.

**M11 — Quote ID collision risk (Line 140)**
`'Q-' + new Date().getTime().toString().slice(-8)` cycles every ~27 hours. Simultaneous saves by two users can produce identical IDs.
**Fix:** Append a short random suffix: `+ Math.random().toString(36).slice(2,5).toUpperCase()`

### MINOR

**m4 — _titleCase() uses deprecated substr (Line 315)**
`t.substr(1)` is deprecated. Use `t.slice(1)`.

---

## FILE: index_fit.tripstore.html

### MODERATE

**M12 — Tour object JSON embedded in onclick attribute (Lines 2063, 2115)**
```js
const enc = encodeURIComponent(JSON.stringify(s));
return `<div onclick="...JSON.parse(decodeURIComponent('${enc}'...))">`;
```
Tour names or tags from the Sheet containing quote characters could corrupt the attribute string. A crafted entry could inject arbitrary JS.
**Fix:** Store tour data in a `data-sight-idx` attribute and look up by index in a click handler instead of embedding serialised JSON.

**M13 — CDN scripts loaded without Subresource Integrity hashes (Lines 7–11)**
html2canvas, jsPDF, ExcelJS, FileSaver loaded from cdnjs.cloudflare.com with no `integrity` attribute. A CDN compromise executes code in the app context.
**Fix:** Add `integrity="sha384-..."` and `crossorigin="anonymous"` to each script tag.

**M14 — Intercity price stored per-pax but editable as total; changes with paxCount (Line 1747–1748)**
When a user edits the total intercity price, it is divided by current paxCount and stored per-person. If paxCount later changes, the displayed total silently recalculates differently from what the agent typed, corrupting the quote.

**M15 — searchItinerary() not protected against double-clicks (Line 727)**
The button text changes but `disabled` is never set. Double-clicking sends two concurrent API requests.
**Fix:** `btn.disabled = true` at start, restore in `finally`.

**M16 — autoSaveThenDo() swallows all errors silently (Line 2292)**
```js
} catch(e) { /* silent */ }
```
If auto-save fails before PDF/Excel export, the user receives no warning and may lose unsaved data.
**Fix:** At minimum, `console.warn('Auto-save failed:', e)`.

**M17 — formatDate() UTC midnight parsing (Line 2029)**
`new Date("2024-01-15")` is parsed as UTC midnight. In timezones west of UTC, `toLocaleDateString()` displays the previous day.
**Fix:** `new Date(d + 'T12:00:00')` to anchor to midday and avoid boundary issues.

### MINOR

**m5 — BUDGET_RANGES hotel suggestion cap is too low for luxury HNI market (Line 782–785)**
```js
hotel: { low: 2500, high: 7500 }  // Rs/room/night
```
Rs 7,500/room/night is approximately EUR 68 — budget accommodation. For HNI luxury European travel, 4-5 star hotels cost Rs 25,000–80,000+/night. Agents using the "Use mid" button would underquote by 5-10x.
**Fix:** Revise to at least `{ low: 12000, high: 45000 }` or make configurable per hotel category.

**m6 — Add tour search capped at 20 results with no user feedback (Line 2058)**
`.slice(0, 20)` hides options in cities with 50+ tours. Users see no indication results are truncated.

---

## FILE: write_to_sheets.py

### MODERATE

**M18 — SPREADSHEET_ID hardcoded in source (Line 27)**
`SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"` committed to git. Move to a `.env` file excluded from version control.

**M19 — ws.row_count == 0 check is unreliable (Line 168)**
New gspread worksheets have `row_count = 1000`, never 0. The first half of the condition never triggers; only `not ws.get_all_values()` actually works.
**Fix:** Remove the `ws.row_count == 0` half.

### MINOR

**m7 — No retry logic for Google Sheets API quota errors**
No exponential backoff on 429/503 responses.

**m8 — CSV opened with utf-8, not utf-8-sig**
Excel-exported CSVs often contain a UTF-8 BOM. Using `encoding="utf-8"` includes the BOM in the first column header, causing duplicate-key lookups to silently fail.
**Fix:** `encoding="utf-8-sig"`.

---

## FILE: archive_to_input.py

### MODERATE

**M20 — SPREADSHEET_ID hardcoded (Line 31)**
Same issue as write_to_sheets.py.

**M21 — append_rows() not protected against missing INPUT sheet (Line 390)**
The read step handles `WorksheetNotFound` gracefully (lines 312–319) but the write step does not. If `setupSheets()` was never run in Apps Script, this crashes mid-script after data has already been processed.
**Fix:** Wrap in try/except WorksheetNotFound.

**M22 — parse_transfers_cell() city extraction is brittle (Lines 155–162)**
The regex splits on airport keywords to extract a city name. "Paris Charles de Gaulle Airport" yields "Paris Charles de Gaulle" (not "Paris"), causing mismatches against the Cities master in INPUT_Transfers.

**M23 — parse_hotels_cell() silently drops malformed entries (Line 70)**
Steps through indices in groups of 4; any cell with an extra or missing pipe silently drops trailing hotels with no warning logged.

### MINOR

**m9 — No retry on Google Sheets API calls** — same as write_to_sheets.py.

**m10 — parse_trains_cell() drops non-standard route formats silently**
Routes using em-dash (Paris–Brussels) or other separators instead of " to " are skipped with no log entry.

---

## MISSING FILES (7 of 14 listed not in repository)

| File | Status |
|------|--------|
| extract_itineraries.py | Not found |
| write_inputs_to_sheets.py | Not found |
| cleanup_sheet.py | Not found |
| clean_pipeline_data.py | Not found |
| cross_reference.py | Not found |
| enrich_hotels.py | Not found |
| enrich_hotels_booking.py | Not found |

These may have been deleted, renamed, or never committed to v2.

---

## ACTION ITEMS — PRIORITY ORDER

### Fix This Week (Critical + High Business Impact)
1. **M9** — Quote_Log GST always 5% regardless of gstMode — financial analytics are wrong for all 18%/no-GST quotes
2. **m5** — BUDGET_RANGES hotel cap is Rs 7,500 max — agents using "Use mid" will severely underquote HNI clients
3. **C2** — Admin panel accessible via localStorage edit — add server-side role re-verification on auto-login
4. **M21** — archive_to_input.py crashes if INPUT sheets missing — add try/except on append_rows

### Fix Next Sprint
5. **C1** — Plaintext password storage in Google Sheets
6. **C3** — No auth on save/load/list API endpoints
7. **M4** — Claude batch-error is all-or-nothing; improve JSON parse failure handling
8. **M6** — _buildInputSheet duplicates banner row on repeated runs
9. **M12** — Tour JSON in onclick attribute; switch to data attributes
10. **M13** — CDN scripts without SRI hashes
11. **M14** — Intercity edit price confusion when paxCount changes
12. **M18/M20** — Move hardcoded SPREADSHEET_ID out of source code

### Clean Up When Time Allows
13. Remove `checkLogin` from `doGet` (M1)
14. Fix `_titleCase` deprecated `substr` (m4)
15. Add `btn.disabled = true` to searchItinerary (M15)
16. Add `console.warn` to autoSaveThenDo catch (M16)
17. Use `encoding="utf-8-sig"` in CSV readers (m8)
18. Update hardcoded EUR/INR rate in Claude prompt (m2)
19. Add retry/backoff to Python Google Sheets API calls (m7, m9)
20. Fix `formatDate()` UTC midnight edge case (M17)

---

**Total issues: 3 CRITICAL · 19 MODERATE · 10 MINOR**
*Generated by automated daily code review — 2026-06-05*
