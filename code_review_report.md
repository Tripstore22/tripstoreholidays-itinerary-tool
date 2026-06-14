# TripStore Daily Code Review — 2026-06-14

**Files reviewed:** app/index.html, write_to_sheets.py, archive_to_input.py, check_pipeline.py, check_html.py, qa/nightly.py, qa/smoke.py, qa/invariants.py, qa/gen_scenarios.py, .github/workflows/night-guardian.yml
**Files listed but absent from repo:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

**Previous review:** 2026-06-13 — 12 issues found (2 CRITICAL, 5 MODERATE, 5 MINOR)
**Night Guardian last nightly (2026-06-13):** PASS 1050 / KNOWN 29 / SKIP 195 / FAIL 0 — GREEN
**New commits since last review:** 3 (night-guardian.yml, QA harness c54ec94, skills updates)

---

## Summary

| Severity | New | Carried Forward | Total |
|----------|-----|-----------------|-------|
| CRITICAL | 0 | 2 | 2 |
| MODERATE | 2 | 5 | 7 |
| MINOR    | 3 | 5 | 8 |
| **Total**| **5** | **12** | **17** |

None of the 12 issues from the 2026-06-13 review have been fixed. All are carried forward below.

---

## NEW FINDINGS (2026-06-14)

### NEW-M1 — Stale past travel dates in gen_scenarios.py corrupt the P07 seasonal pair test
**File:** qa/gen_scenarios.py:169, 186-190

Several travelStartDate values are already in the past as of today (2026-06-14):

- edge_date_month_boundary: "2026-05-29" — 16 days past
- All pair_season_01_apr scenarios: "2026-04-15" — 2 months past
- All pair_season_01_jun scenarios: "2026-06-15" — stale from tomorrow

The P07 pair test checks that June totalSpent / April totalSpent ~= 1.20. When the engine receives a past date it may apply the current date's seasonal multiplier to both members, collapsing the ratio to ~1.0 and triggering the fill-to-budget SKIP guard. The test stops being a real assertion. The 195 SKIPs in the 2026-06-13 nightly are consistent with this already happening for the April scenarios.

**Fix:** Use 2027 dates or make the year dynamic so scenarios stay in the future:
```python
import datetime
_NEXT_APR = f"{datetime.date.today().year + 1}-04-15"
_NEXT_JUN = f"{datetime.date.today().year + 1}-06-15"
```

---

### NEW-M2 — Column count mismatch: make_hotel_row writes 25 columns into a 26-column INPUT_Hotels sheet
**Files:** archive_to_input.py:232-242 vs check_pipeline.py:113

check_pipeline.py's KNOWN_HEADERS['Hotels'] defines 26 columns including 'Meals' at index 6:
```
0:City  1:Hotel Name  2:Star  3:Category  4:Chain  5:Room  6:Meals
7:Jan ... 18:Dec  19:Annual Avg  20:Added_By  21:Source  22:Notes
23:Pipeline_Status  24:Error_Reason  25:Processed_Date
```

But make_hotel_row in archive_to_input.py omits Meals from its layout comment and creates only 25 columns:
```python
row = [""] * 25
row[19] = ADDED_BY   # lands in Annual_Avg slot on the real 26-col sheet
row[22] = STATUS     # lands in Notes_Input slot on the real 26-col sheet
```

Result: Pipeline.gs reads Pipeline_Status (col 23) as blank on every archive-imported hotel row — it never sees 'PENDING' and may skip or re-queue rows indefinitely.

**Fix:** Update make_hotel_row to 26 columns:
```python
row = [""] * 26
row[20] = ADDED_BY
row[23] = STATUS
```

---

### NEW-N1 — E_CHECKS / P_CHECKS duplicated verbatim between smoke.py and nightly.py
**Files:** qa/smoke.py:146-165, qa/nightly.py:28-30

The two check-name sets are copy-pasted. Adding a new invariant requires updating both files; missing one causes the nightly and smoke gates to silently test different subsets.

**Fix:** Define both sets as module-level constants in invariants.py and import them in both runners.

---

### NEW-N2 — Year 2026 hardcoded in smoke.py fallback travelStartDate
**File:** qa/smoke.py:73

```python
"travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")
```

From 2027 onwards all ~80 scenarios that rely on the fallback will silently send past dates to the engine. Seasonal lookups and date-boundary tests degrade without any warning.

**Fix:** `import datetime` at top of file, then use `datetime.date.today().year` in the f-string.

---

### NEW-N3 — make_sightseeing_row writes archive total cost into Avg Price
**File:** archive_to_input.py:253

```python
row[5] = s.get("cost_inr", "")   # archive cost as a starting reference for Claude
```

The archive's cost_inr is the per-person billed total for the trip, not a live GYG/Viator per-seat price. If Pipeline.gs's enrichment prompt treats a non-empty Avg Price as authoritative and skips overwriting it, the inflated archive cost persists in the Sightseeing master sheet and flows into future itinerary pricing.

**Fix:** Leave row[5] blank. Write cost hint to row[12] (Notes_Input) where it cannot be mistaken for a market price.

---

## CARRIED FORWARD — CRITICAL

### C1 — Login is broken: checkLogin routed as POST but doPost doesn't handle it
**Files:** app/index.html + Code.gs:doPost — **Status: UNRESOLVED**

Frontend sends login as HTTP POST. doPost() only handles "signup" and "saveItinerary". checkLogin falls through to 'Invalid action' — every login returns "Invalid Credentials". Re-deploying Code.gs as-is locks all users out permanently.

**Fix:** Add to doPost: `if (action === 'checkLogin') return checkLogin(data.user || '', data.pass || '');`

---

### C2 — Passwords stored and compared in plaintext
**File:** Code.gs:handleSignup, checkLogin — **Status: UNRESOLVED**

Passwords are appended to the sheet as plaintext and compared with ===. Anyone with sheet read access sees all credentials.

**Fix:** Hash with Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password) before storage and comparison.

---

## CARRIED FORWARD — MODERATE

### M1 — GST 0% silently defaults to 5% (falsy check)
**File:** Quote_Intelligence.gs:119 — `const gstPct = d.gst || 5;`
**Status: UNRESOLVED** — Fix: `d.gst != null ? Number(d.gst) : 5`

### M2 — logQuote can recurse infinitely if setupQuoteLog() fails
**File:** Quote_Intelligence.gs:33-37 — **Status: UNRESOLVED**
Guard: check the re-lookup is non-null before calling logQuote recursively.

### M3 — Pipeline.gs risks Apps Script 6-minute execution kill on large backlogs
**File:** Pipeline.gs:processSheet — **Status: UNRESOLVED**
Fix: `if (Date.now() - startTime > 5 * 60 * 1000) break;` inside the batch loop.

### M4 — callClaudeAPI crashes on unexpected response structure
**File:** Pipeline.gs:callClaudeAPI — responseData.content[0].text throws when content is absent.
**Status: UNRESOLVED** — Fix: `const text = responseData?.content?.[0]?.text; if (!text) throw new Error(...);`

### M5 — innerHTML built from Google Sheet data without sanitization (stored XSS)
**File:** app/index.html — multiple innerHTML assignments using sheet-sourced strings.
**Status: UNRESOLVED** — Add esc() helper; escape all dynamic values before HTML injection.

---

## CARRIED FORWARD — MINOR

### N4 — doGet checkLogin exposes credentials in URL and server logs
**File:** Code.gs:doGet — **Status: UNRESOLVED** — Remove GET login; auth via POST body only.

### N5 — No brute-force protection on login
**File:** Code.gs:checkLogin — **Status: UNRESOLVED** — Add Utilities.sleep(500) + failed-attempt logging.

### N6 — ws.row_count == 0 is dead code
**File:** write_to_sheets.py:168 — **Status: UNRESOLVED** — Remove; keep `not ws.get_all_values()`.

### N7 — Hardcoded Spreadsheet IDs and credential paths
**Files:** write_to_sheets.py:28, archive_to_input.py:32 — **Status: UNRESOLVED**
Replace with os.environ.get(...).

### N8 — 7 review-listed pipeline scripts absent from repo
**Missing:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py — **Status: UNRESOLVED**
Commit if in active use; document retirement if not.

---

## Night Guardian Status

**Last run: 2026-06-13 — GREEN** (PASS 1050 / KNOWN 29 / SKIP 195 / FAIL 0)

All 29 KNOWN items tracked in qa/known_issues.json with registry refs and ratchets. No new regressions. The high SKIP count (195) is consistent with NEW-M1: April seasonal-pair scenarios are sending past travelStartDate values, causing the P07 ratio to collapse to ~1.0 and fall into the fill-to-budget SKIP guard. Those P07 assertions are not currently running in practice.

---

## Action Items (Priority Order)

1. [C1 — URGENT] Add checkLogin to doPost in Code.gs and redeploy.
2. [C2 — URGENT] Hash passwords with SHA-256 in Code.gs before storage and comparison.
3. [NEW-M1] Update seasonal pair travelStartDate values to 2027 in gen_scenarios.py; regenerate scenarios.json.
4. [NEW-M2] Fix make_hotel_row to 26 columns in archive_to_input.py; update row[20]=ADDED_BY, row[23]=STATUS.
5. [M1] Fix d.gst || 5 falsy bug in Quote_Intelligence.gs.
6. [M2] Guard logQuote retry against infinite recursion.
7. [M3] Add deadline guard to processSheet loop in Pipeline.gs.
8. [M4] Null-check responseData.content[0] in callClaudeAPI.
9. [M5] Escape all sheet data before innerHTML injection in app/index.html.
10. [NEW-N1] Move E_CHECKS/P_CHECKS to invariants.py; import in both runners.
11. [NEW-N2] Make fallback travelStartDate year dynamic in smoke.py.
12. [NEW-N3] Clear row[5] in make_sightseeing_row; use Notes_Input (row[12]) for cost hint.
13. [N6] Remove dead ws.row_count == 0 check in write_to_sheets.py.
14. [N7] Replace hardcoded Spreadsheet IDs with environment variables.
15. [N8] Commit or retire the 7 missing pipeline Python scripts.

---

*Generated automatically — 2026-06-14*
