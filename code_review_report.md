# TripStore Code Review Report
**Date:** 2026-06-02
**Reviewer:** Automated Daily Review
**Files Reviewed:** Code.gs, Pipeline.gs, Quote_Intelligence.gs, index_fit.tripstore.html, write_to_sheets.py
**Missing Files (not in repo):** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| MODERATE | 5 |
| MINOR    | 6 |

**Total issues found: 13**

---

## CRITICAL ISSUES

---

### C1 — Login Action Routed to doGet but Frontend Sends POST
**File:** Code.gs (line 25) + index_fit.tripstore.html (line 583)

The `checkLogin` action is handled inside `doGet()` in Code.gs, reading credentials from `e.parameter.user` and `e.parameter.pass` (URL query parameters). However, the frontend sends login credentials via HTTP POST with a JSON body:

    const res = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "checkLogin", user, pass })
    });

In Google Apps Script, POST requests go to `doPost()` — not `doGet()`. The current `doPost()` only handles `signup` and `saveItinerary`. When the frontend POSTs `{ action: "checkLogin" }`, `doPost` returns "Invalid action", causing the frontend to display "Invalid Credentials" for all login attempts.

If the app works on the live site today, it is because an older version is still deployed. Any re-deployment of the current Code.gs will break all logins.

**Fix:** Move the `checkLogin` block into `doPost()` and read from `data.user` / `data.pass`.

**Impact:** Total login failure after any new deployment.

---

### C2 — Passwords Stored and Compared in Plain Text
**File:** Code.gs (lines 257-268)

User passwords are stored as plain text in the "Users" Google Sheet and compared directly:

    const dbPass = String(data[i][1]).trim();
    if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) { ... }

Anyone with read access to the spreadsheet can see every user's password.

**Fix:** Hash passwords using `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)` before storing and before comparing. Ideally migrate to Google OAuth.

**Impact:** Full credential exposure if the spreadsheet is accessed by an unauthorised party.

---

## MODERATE ISSUES

---

### M1 — No Authentication on saveItinerary
**File:** Code.gs (lines 342-365)

The `saveItinerary` endpoint accepts any POST request and writes to the sheet without verifying the caller is an authenticated user. Anyone who knows the Apps Script URL can overwrite real itineraries or spam the sheet with garbage data.

**Fix:** Add a shared secret token to the POST body and validate it server-side before writing.

---

### M2 — localStorage Session Has No Expiry
**File:** index_fit.tripstore.html (lines 587, 642-649)

After login, the session is stored in localStorage indefinitely with no timestamp, TTL, or server-side invalidation. On a shared computer, a forgotten logout gives the next person full access.

**Fix:** Add a `loginAt` timestamp to the session object and reject sessions older than 8 hours inside `checkAutoLogin()`.

---

### M3 — Pipeline Has No GAS Execution Time Guard
**File:** Pipeline.gs (lines 224-255)

`runMidnightEnrichment()` processes all pending rows in a single run with 1.5s sleep between Claude batches. Google Apps Script has a hard 6-minute execution limit. With 50+ pending rows the script can silently time out mid-run, leaving rows stuck as PENDING with no error flag and no email alert.

**Fix:** Track a start timestamp; if more than 5 minutes have elapsed before a batch, stop gracefully and log a warning to the audit log.

---

### M4 — XSS Risk via innerHTML with API/User Data
**File:** index_fit.tripstore.html (lines 686, 841, 1390, 1391, 1396, 1445, 1585, 1714, 1821+)

Dozens of UI sections inject values from the API or user input directly via innerHTML without sanitisation. A malicious value in the Google Sheet (e.g. a city name containing a script tag) would execute as HTML.

**Fix:** Escape all dynamic values before innerHTML injection:
`val.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')`

---

### M5 — Brittle Transfer City Extraction in archive_to_input.py
**File:** archive_to_input.py (lines 154-168)

City names are extracted from transfer descriptions using a hardcoded regex keyword list (cdg, lhr, ams, fra, vie, bcn, fco, etc.). Cities not in the list — Zurich, Prague, Lisbon, Dubrovnik, Porto, etc. — produce empty or wrong city names. These rows land in INPUT_Transfers with a blank City field and will be marked ERROR by Pipeline.gs.

**Fix:** Extend the keyword list or fall back to `from_loc.split()[0]` when no keyword match is found.

---

## MINOR ISSUES

---

### m1 — Model Name Hardcoded in Pipeline.gs
**File:** Pipeline.gs (line 39)

`MODEL: 'claude-haiku-4-5-20251001'` — if this version is deprecated, every Claude batch will error silently until code is manually updated.

**Fix:** Add a "last verified" comment date and review monthly.

---

### m2 — SPREADSHEET_ID Hardcoded in Python Scripts
**File:** write_to_sheets.py (line 27), archive_to_input.py (line 31)

Hardcoded `SPREADSHEET_ID` means all Python scripts must be manually edited if the spreadsheet is ever moved or duplicated for staging.

**Fix:** Use `os.getenv("SPREADSHEET_ID", "1U3f6PhTpvbEO7...")` to allow environment override.

---

### m3 — Quote ID Collision Risk
**File:** Quote_Intelligence.gs (line 140)

`'Q-' + new Date().getTime().toString().slice(-8)` keeps only the last 8 ms digits, which repeat every ~11.5 days. Two simultaneous saves will collide silently.

**Fix:** Use the full 13-digit timestamp or append a 4-character random suffix.

---

### m4 — Confusing `type` Field Alias in getHotels
**File:** Code.gs (lines 109-110)

Both `roomType` and `type` return the room type string (e.g. "Double Room"). Frontend code reading `hotel.type` expecting a category label (Budget/Luxury) gets the room type instead — a silent logic error.

**Fix:** Find all `hotel.type` usages in the frontend, migrate to `hotel.roomType`, then remove the alias.

---

### m5 — Anthropic API Version Header Is Over Two Years Old
**File:** Pipeline.gs (line 571)

`'anthropic-version': '2023-06-01'` — very old API versions can be sunset. No monitoring exists for this.

**Fix:** Update to the current stable header version when next touching Pipeline.gs.

---

### m6 — 7 Python Scripts Not Committed to Repository

**Missing:** extract_itineraries.py, write_inputs_to_sheets.py, cleanup_sheet.py, clean_pipeline_data.py, cross_reference.py, enrich_hotels.py, enrich_hotels_booking.py

These files appear in the review scope but do not exist in the repo. If they live only on a local machine they are unversioned and at risk of loss.

**Fix:** Commit all active scripts to the v2 branch.

---

## Prioritised Action Items

| # | Priority | Action |
|---|----------|--------|
| 1 | URGENT | Code.gs — Move checkLogin to doPost() and redeploy Apps Script |
| 2 | URGENT | Code.gs — Hash passwords; restrict Sheet access to admin-only as interim |
| 3 | HIGH | Code.gs — Add secret token check to saveItinerary endpoint |
| 4 | HIGH | index_fit.tripstore.html — Add 8-hour TTL to localStorage session |
| 5 | HIGH | Pipeline.gs — Add 5-minute execution time guard with graceful early exit |
| 6 | MEDIUM | index_fit.tripstore.html — Sanitise values before innerHTML injection |
| 7 | MEDIUM | archive_to_input.py — Extend transfer city extraction keyword list |
| 8 | LOW | All — Commit 7 missing Python scripts to the v2 branch |
| 9 | LOW | Quote_Intelligence.gs — Fix Quote ID collision |
| 10 | LOW | Pipeline.gs / Code.gs — Address minor issues m1-m5 |

---

*Generated by automated daily code review — 2026-06-01*
