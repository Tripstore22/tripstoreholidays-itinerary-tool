# TripStore Holidays — Automated Code Review
**Date:** 2026-04-23
**Reviewed by:** Claude (automated)
**Branch:** v2

---

## Recent Commits Reviewed
```
c11f1ee Auto: daily code review
fdd2f17 Sync main with v2: fix budget hints (inline style)
07f6f63 Fix budget hints not showing: use inline style instead of Tailwind hidden class
d74b3bd Remove CNAME from main (custom domain managed via Pages Settings)
e6a35d9 Merge v2 into main — sync all app files to production
f3b87ad Sync index.html with index_fit.tripstore.html
a105e1d Fix security issues and add budget suggestion hints
2b3c62c Auto: Claude edit 2026-04-06 18:20
16f846c Auto: Claude edit 2026-04-06 17:45
ee5c74b Auto: Claude edit 2026-04-06 17:34
```

---

## ⚠️  Status vs Last Review (2026-04-23)

**No code fixes have been applied since the 2026-04-09 report.** All CRITICAL and MODERATE issues reported two weeks ago remain open. New findings are added below.

---

## Summary

| Severity  | Carried Over | New | Total |
|-----------|-------------|-----|-------|
| CRITICAL  | 4           | 1   | 5     |
| MODERATE  | 10          | 2   | 12    |
| MINOR     | 7           | 1   | 8     |
| **TOTAL** | **21**      | **4** | **25** |

---

## Files Reviewed

### 1. Code.gs

**[CRITICAL] ⚠️ STILL OPEN — Login is broken: frontend sends POST, backend handles GET only**
- `index_fit.tripstore.html` line 583: `fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "checkLogin", user, pass }) })`
- `Code.gs doPost()` handles only `signup` and `saveItinerary`. `checkLogin` is in `doGet()` only.
- Every login attempt returns `"Invalid action"` → frontend shows `"❌ Invalid Credentials"`.
- **Action:** Add `checkLogin` to `doPost()` reading from `data.user` and `data.pass`.

**[CRITICAL] ⚠️ STILL OPEN — Passwords stored as plain text in Google Sheets**
- `Code.gs` line 261: `dbPass === pass.trim()` — direct string comparison. Sheet access = full credential leak.
- **Action:** Hash passwords before storing. At minimum, use SHA-256.

**[CRITICAL] ⚠️ STILL OPEN — `getAllSaved()` and `searchItinerary()` have no authentication**
- Any caller who knows the API URL (hardcoded in public HTML) can enumerate all pax names and load any itinerary.
- **Action:** Add a shared session token or admin re-verification before serving any data-read endpoints.

**[MODERATE] ⚠️ STILL OPEN — No rate limiting on login**
- Unlimited login attempts with no lockout or delay.
- **Action:** Track failed attempts in the Users sheet. After 5 failures, reject for 15 minutes.

**[MODERATE] ⚠️ STILL OPEN — `saveItinerary()` has no ownership check**
- Any authenticated user can overwrite any pax record by supplying a matching name.
- **Action:** Associate saves with the logged-in username and validate server-side.

**[MINOR] ⚠️ STILL OPEN — `getHotels()` hardcodes column index `r[18]` for Annual Avg**
- If the Hotels sheet gains or loses a column, silently reads wrong data.
- **Action:** Read columns by header name, not position.

---

### 2. Pipeline.gs

**[MODERATE] ⚠️ STILL OPEN — Hardcoded EUR→INR rate is stale**
- `enrichTrains` prompt (line 463): `"INR price at ₹110/€"` — current mid-market rate is ~₹92/€.
- Claude will overstate train costs by ~20% when back-calculating from EUR.
- **Action:** Update to ₹92/€ or add `CFG.EUR_TO_INR = 92` and reference it in the prompt string.

**[MODERATE] ⚠️ STILL OPEN — `mst.appendRow(rowArr)` has no column-count validation**
- If Claude returns fewer fields than expected, the row is inserted with silent blank trailing cells, misaligning all subsequent column reads in the master sheet.
- **Action:** Pad `rowArr` to the expected column count or skip and log a warning if length is wrong.

**[MODERATE] ⚠️ STILL OPEN — `buildMasterKeySet()` loads full sheet on every pipeline run**
- For large master sheets this is slow and may hit Apps Script memory limits.
- **Action:** Cache key set in `CacheService` with a 1-hour TTL.

**[MINOR] ⚠️ STILL OPEN — `sendSummaryEmail` uses `GmailApp.sendEmail()` — 500/day quota**
- **Action:** Use `MailApp.sendEmail()` or batch digest.

**[MINOR] ⚠️ STILL OPEN — `Utilities.sleep(1500)` is hardcoded**
- **Action:** Expose as `CFG.API_SLEEP_MS = 1500`.

---

### 3. Quote_Intelligence.gs

**[MODERATE] ⚠️ STILL OPEN — GST calculation always uses 5%, ignores actual GST mode**
- `buildQuoteLogRow()` line 119: `const gstPct = d.gst || 5`
- The frontend stores `gstMode` as `'5pkg'`, `'18svc'`, or `'none'` — not a numeric `d.gst` field.
- Every Quote_Log row records a wrong `gstAmt`.
- **Action (one line):**
  ```javascript
  const gstPct = d.gstMode === '18svc' ? 18 : d.gstMode === '5pkg' ? 5 : (Number(d.gst) || 0);
  ```

**[MODERATE] ⚠️ STILL OPEN — `logQuote()` infinite recursion risk**
- Calls `setupQuoteLog()` then recursively calls itself. If `setupQuoteLog()` fails (quota exceeded), the recursion runs until stack overflow and breaks the entire save operation.
- **Action:** Remove the recursive retry. Use a simple flag or just `return` after `setupQuoteLog()`.

**[MINOR] ⚠️ STILL OPEN — Quote ID collision possible**
- `'Q-' + new Date().getTime().toString().slice(-8)` — collides if two saves occur within the same millisecond.
- **Action:** Append a random suffix: `'Q-' + Date.now().toString().slice(-8) + '-' + Math.floor(Math.random()*9000+1000)`.

---

### 4. index_fit.tripstore.html

**[CRITICAL] ⚠️ STILL OPEN — Admin escalation via DevTools localStorage**
- `checkAutoLogin()` reads `isAdmin` directly from `localStorage`. Any user can run:
  ```javascript
  localStorage.setItem("tripstore_session", JSON.stringify({isAdmin:true, modeText:"ADMIN MODE"}));
  location.reload();
  ```
  This opens the admin panel with no credentials. Since `getAllSaved()` has no auth check, this is fully exploitable.
- **Action:** Admin actions must be re-validated server-side. Backend must require an admin token.

**[CRITICAL] 🆕 NEW — XSS via Google Sheet city names injected into innerHTML**
- `index_fit.tripstore.html` line 686: `cities.map(c => \`<option value="${c}">\`).join('')` — city values from the master Google Sheet are injected into innerHTML without HTML-escaping.
- `index_fit.tripstore.html` line 841: `<span><b>${r.city}</b> (${r.nights}N)</span>` — same issue in route list.
- If a malicious city name (e.g., `"><script>alert(1)</script>`) is entered into the Google Sheet, it executes in every agent's browser.
- **Action:** Escape values before injecting into HTML. Use `document.createElement` and `textContent` for dynamic list items, or an `escapeHtml()` helper.

**[MODERATE] ⚠️ STILL OPEN — `saveItinerary()` shows success toast on server-side error**
- Line 720–721: `fetch()` only throws on network failure. HTTP errors (sheet missing, quota exceeded) still show "Saved Successfully".
- **Action:**
  ```javascript
  const result = await (await fetch(API_URL, { method: "POST", ... })).text();
  if (!result.includes("Successfully")) throw new Error(result);
  showToast("Saved Successfully");
  ```

**[MODERATE] ⚠️ STILL OPEN — No CSRF protection on POST endpoints**
- `signup` and `saveItinerary` accept POST with no origin check. Any page can forge requests.
- **Action:** Add a CSRF token in the POST payload, verified server-side.

**[MODERATE] 🆕 NEW — `checkLogin` sends credentials via POST body but `doGet` expects URL params**
- This is the same login mismatch flagged in Code.gs (also visible in the HTML at line 583). Credentials sent as JSON POST body (`user`, `pass`) will never be read by `doGet`'s `e.parameter.user` / `e.parameter.pass`. The fix must happen on both sides.
- **Action (HTML side):** Match the POST body field names to what `doPost` will read once `doPost` is updated to handle `checkLogin`.

**[MINOR] ⚠️ STILL OPEN — Budget hint ranges `BUDGET_RANGES` have no version date**
- Lines 782–785: `{ hotel: { low: 2500, high: 7500 }, land: { low: 1200, high: 2800 } }` — no indication of when these were last reviewed. They will silently become stale.
- **Action:** Add a comment: `// Last reviewed: April 2026`.

**[MINOR] ⚠️ STILL OPEN — No input length limit on paxName**
- A very long name could exceed Google Sheets cell limits or break itinerary JSON.
- **Action:** Add `maxlength="100"` to `#paxNameInput`.

**[MINOR] 🆕 NEW — `checkAutoLogin()` does not validate session token age**
- Sessions stored in `localStorage` never expire. An agent whose machine is shared or stolen will remain logged in indefinitely.
- **Action:** Add a `loginTimestamp` to the session object and reject sessions older than 8 hours.

---

### 5. write_to_sheets.py

**[MODERATE] ⚠️ STILL OPEN — Spreadsheet ID hardcoded in source**
- Line 28: `SPREADSHEET_ID = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"`
- **Action:** `SPREADSHEET_ID = os.environ["TRIPSTORE_SHEET_ID"]`

**[MODERATE] ⚠️ STILL OPEN — Empty-sheet detection is unreliable**
- Line 168: `ws.row_count == 0` — gspread's `row_count` is always 1000+ for new sheets. Header row may never be written.
- **Action:** Replace with `sheet_is_empty = not ws.get_all_values()`

**[MINOR] ⚠️ STILL OPEN — No retry on transient API failures**
- `ws.append_rows()` will abort the run on a single 429 or 503.
- **Action:** Wrap in a retry loop with exponential backoff.

---

### 6. archive_to_input.py

**[MODERATE] ⚠️ STILL OPEN — Spreadsheet ID hardcoded in source**
- Line 32: same ID as `write_to_sheets.py`. Commit to a public repo exposes the asset.
- **Action:** `SPREADSHEET_ID = os.environ["TRIPSTORE_SHEET_ID"]`

**[MODERATE] ⚠️ STILL OPEN — `parse_hotels_cell()` silently drops malformed entries**
- Iterates in steps of 4. A misplaced pipe character misaligns all subsequent entries silently.
- **Action:** Add `if len(parts) % 4 != 0: print(f"WARNING: malformed hotels cell: {cell[:80]}")` before the loop.

**[MINOR] ⚠️ STILL OPEN — Transfer city extraction is brittle**
- Lines 155–161: city extracted by splitting on a hardcoded keyword list. New European cities not in the list will extract incorrectly.
- **Action:** Fall back to the full `from_loc` string as city if no keyword matches.

---

## Files Requested But Not Found in Repo

| File | Status |
|------|--------|
| extract_itineraries.py | Not found |
| write_inputs_to_sheets.py | Not found |
| cleanup_sheet.py | Not found |
| clean_pipeline_data.py | Not found |
| cross_reference.py | Not found |
| enrich_hotels.py | Not found |
| enrich_hotels_booking.py | Not found |

These files have not appeared in the repo across two consecutive review cycles. If they exist locally, commit them. If they've been deleted, confirm intentional.

---

## Prioritised Action Items

### Fix Immediately (CRITICAL)
1. **🆕 XSS via city names in innerHTML** — Escape all Google Sheet values before injecting into HTML. High impact: one bad sheet row breaks every agent's browser session.
2. **Login mismatch** — `doPost` in Code.gs must handle `checkLogin`. Without this, login is broken or relying on an outdated deployed version.
3. **Admin escalation via localStorage** — Backend must re-verify admin status on every admin request.
4. **Unauthenticated API endpoints** — `getAllSaved` and `searchItinerary` must require auth.
5. **Plain-text passwords** — Plan migration to hashed storage.

### Fix This Week (MODERATE)
6. **GST calculation bug** in Quote_Intelligence.gs — one-line fix, affects all Quote_Log data going forward.
7. **EUR/INR rate** in Pipeline.gs — update from ₹110 to ₹92 (20% pricing error).
8. **`saveItinerary` false success toast** — check response text before showing "Saved".
9. **`sheet_is_empty` bug** in write_to_sheets.py — header row never written for new sheets.
10. **Spreadsheet IDs** — Move to env vars in both Python scripts.
11. **`logQuote` recursion guard** — Add a `retried` flag to prevent infinite loop on sheet creation failure.
12. **`saveItinerary` ownership** — Users should only overwrite their own records.

### Fix When Convenient (MINOR)
13. Add `maxlength="100"` to paxName input.
14. Add date comment to `BUDGET_RANGES`.
15. Add retry loop to gspread calls.
16. Fix Quote ID collision risk.
17. 🆕 Add session expiry (8-hour timeout) to `checkAutoLogin`.
18. Expose `Utilities.sleep(1500)` as `CFG.API_SLEEP_MS`.

---

*Generated automatically by Claude on 2026-04-23. Previous report: 2026-04-09. No fixes applied between reports.*
