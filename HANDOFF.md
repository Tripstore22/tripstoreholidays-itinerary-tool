# Trip Store Itinerary Tool — Full Project Handoff

> Created: 2026-04-13. Use this file to onboard a new Claude session with complete context.

---

## Who is the User

Sumit Mishra — non-technical business owner of Trip Store Holidays. He does **not** write code. All explanations must be in plain English. No jargon (no "array", "API", "function" etc. without explaining). Think travel-business analogies.

---

## What This Tool Does

A custom itinerary-building tool used internally by Trip Store agents. It lets agents:
- Build day-by-day travel itineraries with hotels, sightseeing, trains, transfers
- Run an AI "Optimizer" to fill gaps and suggest options
- Save/load itineraries
- Export to PDF and Excel
- View a Quote Log of all saved quotes
- View a Data Dashboard of inventory coverage

---

## Live Environment

| Item | Value |
|---|---|
| Live URL | https://fit.tripstoreholidays.com |
| GitHub repo | Tripstore22/tripstoreholidays-itinerary-tool |
| Active branch | **v2** (ONLY branch to ever push to) |
| Main HTML file | `index_fit.tripstore.html` (auto-copied to `index.html` on every edit) |
| Backend | Google Apps Script — connected to Google Sheets |
| Spreadsheet name | "Itinerary Builder_Master" |
| Apps Script API URL | `AKfycbzAbIgzRoN_MNs377jm3u` (in the HTML file) |

---

## File Structure (local: /Users/Sumit/Desktop/Itinerary-Create/)

| File | Purpose |
|---|---|
| `index_fit.tripstore.html` | **THE ONE TRUE SOURCE** — main app. Never edit any other HTML |
| `index.html` | Auto-copy of the above, what GitHub serves |
| `Code.gs` | Main Google Apps Script backend (save, load, fetch data) |
| `Quote_Intelligence.gs` | Quote logging, Quote_Log sheet writing, AI analysis |
| `Pipeline.gs` | Overnight enrichment pipeline (processes INPUT sheets) |
| `Automation.gs` | Trigger setup, archiving |
| `Quote_Intelligence_Dashboard.html` | Standalone dashboard (not the main app) |
| `SESSIONS.md` | Running session log — always read at conversation start |
| `CLAUDE.md` | Claude instructions file |
| `backups/` | Timestamped backups (last taken: 2026-04-10_1856) |

---

## Google Sheets Structure ("Itinerary Builder_Master")

### Master Inventory Sheets (read-only reference data)
- `Master_Hotels` — hotel name, city, stars, price per night, pax type
- `Master_Sightseeing` — attraction name, city, tags, price per pax
- `Master_Trains` — train routes, from/to city, price INR, monthly € prices
- `Master_Transfers` — airport/point-to-point transfers by city

### Input/Pipeline Sheets (raw data to be processed overnight)
- `INPUT_Hotels`, `INPUT_Sightseeing`, `INPUT_Trains`, `INPUT_Transfers`
- Status column: PENDING → PROCESSED / ERROR / DUP

### Output/Log Sheets
- `Quote_Log` — one row per saved itinerary quote
- `Saved_Itineraries` — full itinerary JSON stored here

---

## Quote_Log Columns (as of last session)

| Column | What it stores |
|---|---|
| Agent Name | Who saved the quote |
| Client Name | Client |
| Travel Month | Text format "Apr-26" (mmm-yy) |
| No. of Cities | Plain number |
| No. of Pax | Plain number |
| Rooms Required | Plain number |
| Sub Total | Plain number (hotel + sightseeing + trains + transfers) |
| Grand Total | Sub Total + markup |
| Markup % | Plain number (e.g. 15) |
| Budget Entered | Plain number — what client said their budget is |
| Utilisation % | Grand Total ÷ Budget Entered |
| Budget Flag | OVER / ✅ TARGET / NEAR / UNDER / No Budget |
| Row Color | Red/Green/Yellow/Blue based on flag |

---

## Key Frontend Features (index_fit.tripstore.html)

These must always exist — the pre-push hook checks for them:

| Feature | Proof string in code |
|---|---|
| Optimizer | `function runOptimizer` |
| Render tables | `function renderTables` |
| Save | `function saveItinerary` |
| Load saved | `function loadAndOpen` |
| PDF export | `function downloadPDF` |
| Excel export | `function downloadExcel` |
| Hotel swap modal | `function openHotelSwap` |
| Hotel swap filters | `function applyHotelFilters` |
| Hotel diff tracking | `_currentHotelCost` |
| Hotel diff label | `diffLabel` |
| ±20% grouping | `Within ±20` |
| Current hotel bar | `currentHotelBar` |
| Budget hint HTML | `hotelBudgetHint` |
| Land hint HTML | `sightBudgetHint` |
| Budget suggest fn | `function suggestBudgets` |
| Budget apply fn | `function applyBudgetSuggestion` |
| Admin nav tabs | `tab-itinerary`, `tab-saved`, `tab-quote`, `tab-data` |
| Admin tab switch | `function switchAdminTab` |
| My Itineraries | `function loadSavedList` |
| Version control | `_loadedFromName` |
| Correct API URL | `AKfycbzAbIgzRoN_MNs377jm3u` |
| Login | `function launchApp` |
| Auto-login | `function checkAutoLogin` |

---

## Admin Dashboard Tabs

The app has 4 admin tabs:
1. **Itinerary** — main builder
2. **My Itineraries** — saved quotes list, load/delete
3. **Quote Intelligence** — Quote_Log viewer with filters
4. **Data Dashboard** — inventory health: pipeline status, hotel star breakdown, sightseeing tag diversity, transfer coverage, train routes, gap report, demand vs data coverage

---

## Git Rules — STRICT

- **ONLY ever push to `v2` branch.** Never push to `main` or `master`.
- `CNAME` file must only exist on v2. Never copy it anywhere else.
- If fix not showing live: **wait 3–5 minutes for CDN.** Do not touch branches.
- If GitHub Pages stops deploying: Settings → Pages → toggle branch to `main` → Save → toggle back to `v2` → Save.

---

## Testing Rule

- Simple change: push to v2, check live site after 3–5 mins.
- Unsure: open `/Users/Sumit/Desktop/Itinerary-Create/index.html` in browser locally first.

---

## What Was Last Completed (Session 2026-04-10)

- `FIX_QUOTELOG` function (Temp.gs) — fixed all Quote_Log display bugs:
  - Travel Month: stored as text "Mar-26" (was converting to serial number)
  - No. of Cities, Markup %, Sub Total, Budget Entered: stored as plain numbers (were stored as "₹123" strings)
  - Utilisation %: now Grand Total ÷ Budget Entered (was Sub Total ÷ Budget)
  - Budget flag + row colour: recalculated correctly
- `loadAndOpen` bug fixed: removed block that was overwriting `hotelBudget` field with actual hotel cost on load
- `Quote_Intelligence.gs`: Travel Month format changed to `mmm-yy`
- `Quote_Intelligence.gs`: full audit — fixed hotel net (missing pricingFactor), sightseeing/train net (missing paxCount), formatLogRow, Notes column width
- `index_fit.tripstore.html`: added `roomsRequired` and `agentName` to save payload; restored `roomCountInput` on load
- Utilisation % changed to Grand Total vs Budget in both `buildQuoteLogRow` and `fixQuoteLogComplete`
- Backup taken: all 4 key files in `/backups/` with timestamp 2026-04-10_1856

---

## Still Pending (manual steps — no code changes needed)

1. Copy updated **Code.gs**, **Quote_Intelligence.gs**, **Pipeline.gs** into Apps Script and redeploy
2. Run `fixQuoteLogComplete()` — recomputes all historical Util% rows with Grand Total formula
3. Re-save Nitika itinerary to log a fresh correct row
4. Trains master: manually delete rows 638, 639, 640, 642 (bad data)
5. Trains master rows 620–621: fix London-Liverpool INR (₹27,630 → ~₹4,400), clear monthly € cols, run `repairTrainMonthlyPrices()`
6. INPUT_Trains: delete rows with blank From City or blank To City
7. INPUT_Transfers: delete rows containing itinerary text (wrong sheet)
8. After cleanup: run `resetErrorRows()` → `runMidnightEnrichment()` → `setupTrigger()` (once)

---

## Permanent Rules

- **ONE source of truth for HTML**: `index_fit.tripstore.html` — never edit `index.html` or any worktree copy directly
- Every push must pass the pre-push hook feature check — never bypass with `--no-verify`
- When a new feature is added: add its grep pattern to `SESSIONS.md` AND to the pre-push hook CHECKS array
- Always read `SESSIONS.md` silently at the start of every session
- When user says "bye" / "done" / "closing" etc. — update `SESSIONS.md` automatically before responding
