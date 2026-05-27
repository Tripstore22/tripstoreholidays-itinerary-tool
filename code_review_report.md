# TripStore Code Review — 2026-05-27

**Reviewed by:** Automated daily review  
**Total issues:** 25 (3 CRITICAL · 12 MODERATE · 10 MINOR)  
**Files reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py, archive_to_input.py  
**Files absent (cannot review):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Code.gs

### CRITICAL — Passwords stored and compared in plaintext
**Line 261, 289**  
`checkLogin` does a raw string comparison of passwords from the sheet. `handleSignup` stores the user-typed password directly via `sheet.appendRow([username.trim(), password.trim(), ...])`. If the Google Sheet is ever shared or leaked, all user credentials are exposed.  
**Fix:** Hash passwords with a SHA-256 HMAC before storing and compare hashes. Even a simple `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt)` would be far safer.

### CRITICAL — Login credentials exposed via GET request
**Line 25–27 (doGet), line 583 (frontend)**  
`doGet` handles `checkLogin` with `e.parameter.user` and `e.parameter.pass` as URL query parameters. Credentials in GET parameters appear in Google server logs, browser history, and any proxy/CDN logs in plaintext.  
**Fix:** Enforce login only via `doPost`. Remove the `checkLogin` branch from `doGet`.

### MODERATE — No brute-force protection on login
**Line 249–268**  
`checkLogin` iterates the full Users sheet on every call with no rate limiting, lockout, or attempt counter. The public Google Apps Script URL can be hammered indefinitely.  
**Fix:** Add a lockout field to the Users sheet (failed_attempts + locked_until). After 5 failures lock the account for 15 minutes.

### MODERATE — `doPost` will throw if `e.postData` is null
**Line 45**  
`JSON.parse(e.postData.contents)` — if a POST arrives with no body (empty content-type mismatch, certain proxies), `e.postData` is null and this throws unhandled before the outer try/catch can catch it cleanly.  
**Fix:** Guard: `if (!e.postData || !e.postData.contents) return ContentService.createTextOutput('Bad Request');`

### MINOR — Signup allows empty password
**Line 289**  
`password.trim()` is stored without checking if it is empty. A user can sign up with a blank password.  
**Fix:** Add `if (!username || !password) return ContentService.createTextOutput('Missing fields');`

---

## Pipeline.gs

### MODERATE — Claude API response accessed without null guard
**Line 586–587**  
`responseData.content[0].text` — if the Anthropic API returns a response where `content` is an empty array or has a different structure (e.g., a stop_reason of `max_tokens` with partial content), this throws `TypeError: Cannot read properties of undefined`.  
**Fix:** Add `if (!responseData?.content?.[0]?.text) throw new Error('Empty response from Claude');` before the `.text` access.

### MODERATE — `setupSheets()` re-run inserts duplicate banner rows
**Line 778 (`_buildInputSheet`)**  
`ws.insertRowBefore(2)` inserts a new row every time `setupSheets()` is called. Re-running the setup on an existing sheet stacks banner rows, pushing data down.  
**Fix:** Check if row 2 is already a merged info banner before inserting: `if (!ws.getRange(2, 1).getMergedRanges().length) ws.insertRowBefore(2);`

### MODERATE — Master sheet writes are one row at a time (Sheets API rate risk)
**Line 243 (`processSheet`)**  
`mst.appendRow(rowArr)` is called inside a `.forEach`, meaning one Sheets API call per enriched row. At 5 rows/batch × 4 sheets × many batches, this can exceed the Google Apps Script 6-minute execution limit or hit Sheets write-per-minute quotas.  
**Fix:** Collect all valid rows per sheet in an array, then call `mst.appendRows(allNewRows)` once after the batch loop.

### MODERATE — 6-minute execution limit not guarded
**Line 146 (`runMidnightEnrichment`)**  
There is no timer guard. If there are many PENDING rows, the script will be killed mid-run, leaving some rows partially processed without being marked ERROR.  
**Fix:** Add a start-time check inside the batch loop: `if (new Date() - start > 300000) { auditLog(ss, 'TIME LIMIT: stopping early'); break; }`

### MODERATE — `Array.fill()` shares object reference in error fallback
**Line 593**  
`Array(expectedCount).fill({ valid: false, error_reason: ... })` — `.fill()` with an object puts the same reference into every slot. If any downstream code mutates one error object, all slots change.  
**Fix:** Use `Array.from({ length: expectedCount }, () => ({ valid: false, error_reason: ... }))`.

### MINOR — Audit timestamps in UTC, not IST
**Line 627 (`markRow`), Line 149 (`runMidnightEnrichment`)**  
`new Date().toISOString()` logs timestamps in UTC. For a team operating in IST (UTC+5:30), all log timestamps will appear 5.5 hours behind.  
**Fix:** Use `Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss')`.

### MINOR — `Utilities.sleep(1500)` may not be enough for burst batches
**Line 252**  
With `BATCH_SIZE: 5` and multiple sheet types, several Claude API calls happen in quick succession. Anthropic's rate limit for Haiku is generous but a 1.5s gap between batches may still cause 429s during large runs.  
**Fix:** Increase to `Utilities.sleep(2500)` or add retry-on-429 logic in `callClaudeAPI`.

---

## Quote_Intelligence.gs

### MODERATE — GST mode mismatch: `d.gst` is never set by the frontend
**Line 119**  
`const gstPct = d.gst || 5;` — the frontend saves `gstMode` as a string ('5pkg', '18svc', 'none'), never a numeric `gst` field. So `d.gst` is always `undefined`, and every quote log entry records 5% GST regardless of the actual GST mode selected. Quote totals in the log will be wrong for agents using 18% or No GST.  
**Fix:**
```js
let gstPct = 0;
const gstMode = d.gstMode || '';
if (gstMode === '5pkg')  gstPct = 5;
if (gstMode === '18svc') gstPct = 18;
const gstBase = gstMode === '18svc' ? markupAmt : (subTotal + markupAmt);
const gstAmt  = Math.round(gstBase * gstPct / 100);
```

### MODERATE — `logQuote` recursive call with no depth guard
**Lines 36–37**  
If `setupQuoteLog()` succeeds but the sheet is somehow still not found on the retry (e.g., concurrent deletion), `logQuote` calls itself again indefinitely until Apps Script kills it. This would also block the `saveItinerary` response.  
**Fix:** Add a `retried` parameter: `function logQuote(paxName, data, retried = false)` and guard: `if (!retried) { setupQuoteLog(); return logQuote(paxName, data, true); } else { Logger.log('Quote_Log setup failed'); return; }`

### MODERATE — `backfillQuoteLog` creates duplicates on re-run
**Line 278**  
`backfillQuoteLog` appends all rows from `Saved_Itineraries` without checking if they already exist in `Quote_Log`. Running it twice doubles every historical quote.  
**Fix:** Read existing Quote_Log pax names into a Set before importing; skip rows already present.

### MINOR — Quote ID collision risk
**Line 140**  
`'Q-' + new Date().getTime().toString().slice(-8)` — two quotes saved within the same millisecond (possible in batch imports) would get the same ID.  
**Fix:** Append a random suffix: `'Q-' + new Date().getTime().toString().slice(-8) + '-' + Math.random().toString(36).slice(-4).toUpperCase()`

---

## index_fit.tripstore.html

### CRITICAL — Admin access bypassable via localStorage manipulation
**Lines 641–652 (`checkAutoLogin`)**  
On page load the app reads `localStorage.getItem("tripstore_session")` and calls `launchApp()` directly if found, setting `isAdmin = s.isAdmin`. Any user can open DevTools and run:  
`localStorage.setItem("tripstore_session", JSON.stringify({isLoggedIn:true,isAdmin:true,modeText:"ADMIN MODE"}))`  
to gain the admin UI without authenticating. The backend APIs (`getAllSaved`, `search`) have no auth checks, so the admin panel would actually work.  
**Fix:** The server must return a session token on successful login. The token should be stored and sent with every subsequent request. The backend must verify the token on every admin action.

### MODERATE — All API endpoints are unauthenticated
**Lines 659–661, 727–734 (`getAllSaved`, `searchItinerary`)**  
Anyone who knows the Google Apps Script URL (visible in the JS source) can:
- `?action=getAllSaved` → enumerate all saved pax names
- `?action=search&name=XYZ` → download any saved itinerary in full
- POST `{action:"saveItinerary",...}` → overwrite any existing itinerary

No credential, session token, or API key is required.  
**Fix:** Implement server-side session tokens. The `doGet`/`doPost` handlers must validate a token against a Sessions sheet on every call that accesses customer data.

### MODERATE — XSS via unsanitized sheet data in renderTables
**Lines 1285–1296 (`renderTables`)**  
Hotel names, city names, and other sheet data are interpolated directly into HTML template literals. If a cell in the Google Sheet ever contains `<script>alert(1)</script>`, it executes in the user's browser.  
**Fix:** Escape all values before inserting into HTML:  
`const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');`

### MODERATE — `saveItinerary` response not checked for errors
**Line 720**  
`await fetch(...)` result is not inspected. If the server returns "Setup Error: Saved_Itineraries sheet not found", the user still sees "Saved Successfully".  
**Fix:** `const result = await res.text(); if (!result.includes('Successfully')) throw new Error(result);`

### MINOR — Generic error message on load failure
**Line 762–763**  
`catch (e) { showToast("Error loading itinerary", "error"); }` swallows the actual error. Agents cannot diagnose why a load failed.  
**Fix:** `showToast("Error: " + (e.message || "Unknown"), "error"); console.error(e);`

---

## write_to_sheets.py

### MODERATE — `ws.row_count` check is unreliable for empty sheet detection
**Line 168**  
`ws.row_count == 0` checks sheet capacity (default 1000 rows), not filled rows. This is always False on a new sheet, so the header row is never written and the first data row of the CSV becomes the header.  
**Fix:** `sheet_is_empty = len(ws.get_all_values()) == 0`

### MINOR — `value_input_option="USER_ENTERED"` may corrupt data
**Line 196**  
`USER_ENTERED` tells Sheets to interpret values as if typed by a user — numbers stored as strings like `"12,345"` may be auto-converted, date strings may be parsed as dates.  
**Fix:** Use `value_input_option="RAW"` for controlled data imports.

### MINOR — No retry logic for transient network errors
If a call to `ws.get_all_values()` or `ws.append_rows()` fails with a transient 503, the entire script exits with silent data loss.  
**Fix:** Wrap sheet calls in a simple retry loop with exponential backoff (3 attempts, 2s / 4s / 8s).

---

## archive_to_input.py

### MODERATE — Off-by-one in `parse_hotels_cell` may drop last hotel entry
**Line 70**  
`for i in range(0, len(parts) - 3, 4)` — if the last group of 4 parts is complete but the bound calculation excludes it, the last hotel is silently dropped. Use `range(0, len(parts), 4)` with an explicit bounds check: `if i + 1 >= len(parts): continue`.

### MODERATE — Off-by-one in `parse_sightseeing_cell` may drop last tour entry
**Line 86**  
Same pattern: `for i in range(0, len(parts) - 2, 3)` — same fix applies.

### MODERATE — Bus/Coach incorrectly classified as Train
**Line 107 (`parse_trains_cell`)**  
`mode = "Ferry" if ... else "Train"` — descriptions like "Paris to Brussels by Bus" are classified as "Train". Pipeline.gs validates `mode` must be `Train / Ferry / Bus / Coach`, so these rows will be ERRORed.  
**Fix:**
```python
lower_desc = desc.lower()
if re.search(r'\b(ferry|boat|ship|sail)\b', lower_desc): mode = "Ferry"
elif re.search(r'\b(bus|coach)\b', lower_desc): mode = "Bus"
else: mode = "Train"
```

### MODERATE — Archive transfer cost written as economy sedan price, inflating estimates
**Line 286 (`make_transfer_row`)**  
`row[9] = x.get("cost_inr", "")` sets the Economy Sedan column using the full archive cost, which may have been a van price for groups. Pipeline.gs then calculates van prices as multiples of this, inflating all transfer estimates.  
**Fix:** Leave `row[9]` blank. Add the archive cost to Notes column instead: `row[14] = f"Archive ref: INR {x.get('cost_inr','')} — verify economy rate"`.

### MINOR — Airport code regex misses most European airports
**Lines 155–159 (`parse_transfers_cell`)**  
The city extraction regex only lists 7 airport codes (cdg, lhr, ams, fra, vie, bcn, fco). Transfers through MXP, DUB, ZRH, CPH, ARN, MAD, etc. get wrong city extractions.  
**Fix:** Expand the list or use a broader pattern: `re.split(r'\s+(?:[A-Z]{3})\b', from_loc, maxsplit=1, flags=0)` matching any 3-letter uppercase code.

### MINOR — No retry on Google Sheets API failures
No transient error handling. Add the same retry logic recommended for write_to_sheets.py.

---

## Summary Action Items (Priority Order)

| # | Severity | File | Action |
|---|----------|------|--------|
| 1 | CRITICAL | Code.gs + HTML | Implement server-side session tokens for all API actions |
| 2 | CRITICAL | Code.gs | Hash passwords; remove GET-based login |
| 3 | CRITICAL | HTML | Remove localStorage admin bypass; verify auth server-side |
| 4 | MODERATE | Quote_Intelligence.gs | Fix GST mode mapping (`d.gstMode` string, not `d.gst` number) |
| 5 | MODERATE | Pipeline.gs | Add null guard on `responseData.content[0]` |
| 6 | MODERATE | Pipeline.gs | Batch `appendRow` → single `appendRows` call |
| 7 | MODERATE | archive_to_input.py | Fix off-by-one in hotels + sightseeing cell parsers |
| 8 | MODERATE | archive_to_input.py | Fix Bus/Coach mode classification |
| 9 | MODERATE | HTML | Sanitize sheet data before inserting into DOM |
| 10 | MODERATE | write_to_sheets.py | Fix `ws.row_count` empty-sheet detection |
| 11 | MINOR | Pipeline.gs | Switch all timestamps to IST |
| 12 | MINOR | Quote_Intelligence.gs | Add re-run guard to `backfillQuoteLog` |

---

*Generated: 2026-05-27 | TripStore automated code review*
