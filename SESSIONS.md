# Session Handoff

## Latest Session — 2026-04-09 (full day)

### Completed — 2026-04-09
- C1/C2/C3 security fixes: SHA-256 password hashing, session token validation, admin role server-verified on auto-login
- chat_backups/ removed from git history (had exposed GitHub PAT) + added to .gitignore permanently
- City route list now shows dates: "Rome (09 Apr – 11 Apr, 2N)"
- CRITICAL budget optimizer bug fixed: first "Generate Quote" was picking cheapest hotel (systemHotelCitiesCount=0 bug)
- ₹ symbol now tight against price in sightseeing column
- + Add Train / Ferry / Bus button added to intercity table (with modal form)
- Hotel name allows 2 lines (rows=2) — full name now visible
- Category/duration tags bumped 8px → 9px
- Star rating dark golden (#B8860B) in swap modal
- Print/PDF/Excel buttons: immediate "⏳ Wait..." feedback so no double-click
- Second Print/PDF/Excel button set added below Terms & Conditions
- Save name auto-generates: "PaxName x2_09Apr" or "CityName x2_09Apr" if no name entered
- Version control: loading a saved itinerary + saving now ALWAYS creates _V1,_V2,_V3 (never overwrites)
- autoSaveThenDo uses same name format for export auto-saves
- Pipeline.gs timeout guard added (stops at 5min, resumes next run — prevents duplicate master rows)
- Automation.gs: setupSheets() and setupTrigger() functions added
- All 5 GS files now tracked in git (Automation.gs removed from .gitignore)

### Still Pending
- Run setupSheets() and setupTrigger() once in Apps Script editor (midnight automation)
- Google Sheet Users tab: columns D–H headers still need labels (Created, Agency Name, Person Name, Mobile, Email)
- Trains and Transfers data quality not yet reviewed
- Pipeline.gs timeout error when running full enrichment — timeout guard now in place, next run should self-heal

---

## Feature Verification Index
*These are the exact function/string names the pre-push hook checks.
If any go missing after a code edit — the push will be blocked automatically.*

| Feature | Proof it exists (grep pattern) |
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

## Rules (permanent)
- **ONE source of truth for HTML**: `/Users/Sumit/Desktop/Itinerary-Create/index_fit.tripstore.html`
- Worktree copy is always synced FROM the desktop copy, never edited independently
- Every push must pass the pre-push hook feature check — no bypassing with `--no-verify`
- When a new feature is added, add its grep pattern to SESSIONS.md AND to the pre-push hook CHECKS array
