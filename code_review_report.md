# TripStore Daily Code Review — 2026-06-17

**Files reviewed:** app/index.html, write_to_sheets.py, archive_to_input.py, check_html.py, check_pipeline.py, qa/smoke.py, qa/invariants.py, qa/nightly.py, qa/gen_scenarios.py
**Files absent from repo (cannot inspect):** Code.gs, Pipeline.gs, Quote_Intelligence.gs, extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count | New Today | Carried From 2026-06-16 |
|----------|-------|-----------|--------------------------|
| CRITICAL | 3     | 0 new     | C1, C2, C3 all carried open |
| MODERATE | 8     | 1 new     | M1–M7 carried |
| MINOR    | 12    | 2 new     | N1–N10 carried |
| **Total**| **23**| **3 new** | **20 still open** |

> Zero fixes have landed since the first report. All 20 prior issues remain open. C3 (DEV credentials exposed on live site) is now four days open. M8 is a new escalation: the live smoke gate is silently running two of its three live_safe scenarios with past travel dates right now.

---

## CRITICAL

### C1 (CARRIED) — Login handler missing from doPost in Code.gs
**File:** Code.gs (not in repo)

doPost does not handle action=checkLogin. Any re-deploy of Code.gs as-is will lock all users out permanently. Fix before next re-deploy.

**Fix:**
```javascript
if (action === 'checkLogin') return checkLogin(data.user || '', data.pass || '');
```

---

### C2 (CARRIED) — Plaintext passwords in Google Sheet
**File:** Code.gs (not in repo)

Passwords are stored and compared in plaintext. Any team member with sheet access can read all credentials.

**Fix:** Hash with `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` and compare digest only.

---

### C3 (CARRIED — DAY 4, STILL NOT FIXED) — DEV credentials exposed in production HTML
**File:** app/index.html:1-8

Confirmed present again today (fourth consecutive day). Page source at fit.tripstoreholidays.com/app/ opens with a comment block showing the DEV Sheet ID (1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4) and the DEV API key.

**Fix:** Delete lines 1-8 from app/index.html and push to v2. Takes 2 minutes.

---

## MODERATE

### M1 (CARRIED) — GST 0% silently replaced with 5%
**File:** Quote_Intelligence.gs:119 (not in repo)

`const gstPct = d.gst || 5;` treats gst=0 as falsy, billing 5% GST on zero-rated services.

**Fix:** `const gstPct = d.gst != null ? Number(d.gst) : 5;`

---

### M2 (CARRIED) — logQuote infinite recursion risk
**File:** Quote_Intelligence.gs:33-37 (not in repo)

Recursive retry with no guard. If setupQuoteLog() fails, recursion continues until stack overflow.

**Fix:** After setupQuoteLog(), look up the sheet again; if still null, log and return instead of recursing.

---

### M3 (CARRIED) — Formula injection via USER_ENTERED in both Python sheet writers
**Files:** write_to_sheets.py:196, archive_to_input.py:390

Both scripts write CSV data with value_input_option="USER_ENTERED". Any cell beginning with =, +, -, or @ executes as a Google Sheets formula.

**Fix:** Use value_input_option="RAW" for all data rows in both scripts.

---

### M4 (CARRIED) — edge_date_month_boundary scenario has past travel date
**File:** qa/gen_scenarios.py:168

travelStartDate="2026-05-29" is 19 days in the past. Produces false PASS or false FAIL in nightly smoke.

**Fix:** Change to "2027-05-29" or derive at runtime.

---

### M5 (CARRIED) — innerHTML injecting unescaped API/user data
**File:** app/index.html:4900, 4903, 4908

intel.nextCity, r.city inserted raw into innerHTML. The _e() escape helper exists but is not applied here.

**Fix:** Apply _e() to every API/user value interpolated into innerHTML template literals.

---

### M6 (CARRIED) — Swiss Pass section injects five unescaped API strings into innerHTML
**File:** app/index.html:5101, 5131, 5154, 5173

Confirmed still present today. l.from, l.to, t.tour_name, m.tour_name, and data.pass_duration are all interpolated raw into innerHTML. A poisoned sheet row (e.g. a tour name containing a script tag) would execute in the browser for every user opening the Swiss Pass panel.

**Fix:** Run all five values through _e() before interpolation, or switch the block to document.createElement + textContent.

---

### M7 (CARRIED) — All six P07 seasonal-pair scenarios have past travel dates
**File:** qa/gen_scenarios.py:186-190

Both 2026-04-15 (past since April 16) and 2026-06-15 (past since June 16) are now in the past. Seasonal comparison tests are producing unreliable signals.

**Fix:** Update all six dates to future dates (e.g. April 2027 and June 2027), or generate dynamically.

---

### M8 (NEW) — Live smoke gate running 2 of 3 live_safe scenarios with past travel dates
**File:** qa/smoke.py:73, qa/gen_scenarios.py:79

smoke.py:73 generates the travel date for scenarios without an explicit travelStartDate:
```python
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
```

The three live_safe scenarios (the only ones run against the production engine):
- top_prague_4n_couple: month=5 → generates "2026-05-15" — 32 days in the past
- top_budapest_4n_couple: month=4 → generates "2026-04-15" — 63 days in the past
- top_lisbon_4n_couple: month=9 → generates "2026-09-15" — still future (safe)

Two of the three live safety checks are sending past dates to the production engine. If the engine applies past-date fallback logic or rejects them, these checks either false-PASS or false-SKIP. The production smoke gate is giving a false green.

The same issue affects top_rome_florence_venice_8n (GOLDEN, month=6 → "2026-06-15" — 2 days past), meaning one of the six golden baselines is compromised.

**Fix (immediate):** In gen_scenarios.py, add explicit travelStartDate to prague_4n_couple and budapest_4n_couple pointing to future dates (e.g. "2026-09-15"), OR fix smoke.py:73 to use datetime.date.today().year and advance by 1 year if the generated date is already past.

---

## MINOR

### N1 (CARRIED) — checkLogin sends credentials in GET URL
**File:** app/index.html:3713

Credentials appear in Apps Script execution logs.

**Fix:** Use POST with JSON body.

---

### N2 (CARRIED) — No brute-force protection on login
**File:** Code.gs (not in repo). No rate limiting or lockout.

**Fix:** Utilities.sleep(500) on every call; log repeated failures.

---

### N3 (CARRIED) — Dead code: ws.row_count == 0 always false
**File:** write_to_sheets.py:168

ws.row_count returns the sheet's grid dimension (default 1000), never 0.

**Fix:** `sheet_is_empty = not ws.get_all_values()`

---

### N4 (CARRIED) — Hardcoded live Spreadsheet IDs
**Files:** write_to_sheets.py:28, archive_to_input.py:32

No safeguard against running these scripts against live data during testing.

**Fix:** os.environ.get("SPREADSHEET_ID") with a fallback.

---

### N5 (CARRIED) — 7 Python scripts absent from repository
Still missing: extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py. If actively used, commit them.

---

### N6 (CARRIED) — Hardcoded year 2026 in smoke.py default start date
**File:** qa/smoke.py:73

Months 1-6 are now generating past dates right now (escalated to M8 for the live_safe and GOLDEN impact; the root cause fix lives here).

**Fix:** Use datetime.date.today().year and advance by 1 year when the generated date is already past.

---

### N7 (CARRIED) — ADOBE_PDF_API URL not validated by check_html.py
**File:** app/index.html:8476, check_html.py:53-95

If the PDF deployment is redeployed, PDF generation silently breaks with no validator catching it.

**Fix:** Add the ADOBE_PDF_API URL fragment to the REQUIRED list in check_html.py.

---

### N8 (CARRIED) — check_pipeline.py hardcoded to Sumit's Mac path
**File:** check_pipeline.py:16

```python
CLASP_LIVE_ROOT = os.path.expanduser('~/Desktop/tripstore-pipeline/clasp-live')
```
Exits on any other machine.

**Fix:** Env-var override with the Mac path as fallback.

---

### N9 (CARRIED) — API_URL comment says "DEV @18"
**File:** app/index.html:3285

The API_URL in production HTML has a comment "DEV @18 — 2026-05-04 RBAC 5-role". Either the comment is stale or the production app is hitting the DEV backend. If the latter, all production saves go to the DEV sheet.

**Fix:** Open Apps Script → Deploy → Manage Deployments; confirm which environment this deployment ID belongs to. Update CLAUDE.md and the comment.

---

### N10 (CARRIED) — nightly.py only compares pair_01 for P01 and P07
**File:** qa/nightly.py:69-72

Three child pairs and three season pairs exist; only the first of each is pair-compared. pair_child_02/03 and pair_season_02/03 are fetched but never checked.

**Fix:** Extend the loop to include all six pairs (same gap exists in smoke.py seam_pricing).

---

### N11 (NEW) — edge_date_booking_eq_travel travel date expires in 28 days
**File:** qa/gen_scenarios.py:179

travelStartDate="2026-07-15" becomes past on July 16, 2026 — 28 days from now.

**Fix:** Change to "2027-07-15" now, or generate dynamically.

---

### N12 (NEW) — smoke.py exception handler uses wrong check name for T08
**File:** qa/smoke.py:313

The exception path uses "T08_a1_self_ref" but the normal path uses the canonical "T08_combo_a1_self_ref". If the sheet scan raises an exception, the SKIP result has an inconsistent check key — any known_issues.json entry or log parser matching on check name will miss it.

**Fix:** Change the exception path tuple to ("T08", "T08_combo_a1_self_ref").

---

## Action Items (Priority Order)

1. [C3 — URGENT, 4 DAYS OPEN] Delete lines 1-8 (DEV credentials block) from app/index.html and push to v2. 2-minute fix.
2. [M8 — TODAY] Add explicit future travelStartDate to prague_4n_couple and budapest_4n_couple in gen_scenarios.py (or fix smoke.py:73 year logic). Two live_safe smoke checks are currently unreliable.
3. [C1 — URGENT] Add checkLogin to doPost in Code.gs before any re-deploy.
4. [C2 — HIGH] Hash passwords in Code.gs.
5. [N9 — TODAY] Verify the API_URL deployment in Apps Script console. If DEV, critical data-integrity issue.
6. [M7 + M4 — TODAY] Update all seven past travelStartDate values in gen_scenarios.py to 2027, regenerate scenarios.json, and commit.
7. [N11 — BEFORE JULY 16] Update edge_date_booking_eq_travel to "2027-07-15".
8. [M6 — THIS WEEK] Escape l.from, l.to, t.tour_name, m.tour_name, data.pass_duration in Swiss Pass innerHTML block.
9. [N6 — THIS WEEK] Fix hardcoded 2026 year in smoke.py:73.
10. [M3 — THIS WEEK] Change USER_ENTERED to RAW in write_to_sheets.py:196 and archive_to_input.py:390.
11. [M5 — THIS WEEK] Apply _e() globally to all innerHTML interpolations in app/index.html.
12. [N12] Fix wrong check name in smoke.py:313 exception handler (2-line fix).
13. [N10] Add pair_02/03 comparisons to nightly.py and smoke.py.
14. [N7] Add ADOBE_PDF_API URL check to check_html.py.
15. [N3, N4, N8] Dead code, hardcoded IDs, CLASP path — low-effort cleanup.
16. [N5] Commit the 7 missing Python scripts.

---

*Generated automatically — 2026-06-17*
