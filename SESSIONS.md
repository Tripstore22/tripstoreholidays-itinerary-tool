# Session Handoff

## Latest Session — 2026-04-09 (evening continuation)

### Completed — 2026-04-09 (this session)
- enrichSightseeing TypeError fixed: guard added to all 4 enrich functions (blocks direct calls from Apps Script editor)
- INPUT_Hotels wipe incident fixed: `_archiveAndClear` removed from auto-call in `processSheet()` — now manual only
- `restoreFromDone()` added: copies rows from DONE_*/DUPL_* back to input sheets if data gets wiped
- `archiveAndClearInput()` added: manual-only archive function after team reviews pipeline results
- Naming conflicts fixed: 4 duplicate functions in Automation.gs renamed with `_LEGACY` suffix
- Column pollution fixed: old Automation.gs wrote STATUS to wrong columns across all 4 sheet types
- `fixOldStatusData()` extended to cover all 12 sheets (INPUT + DONE + DUPL for all 4 types)
- `_fixOldCols()` updated with hasBanner param — handles both INPUT sheets (header+banner) and archive sheets (header only)
- `check_pipeline.py` created: static validator run by Claude before any .gs changes
- Validator scoped by file: pipeline scope = full check, automation = naming+legacy only, code = naming only
- Pre-commit hook updated: passes correct scope arg based on which .gs file is staged
- Pre-push hook (Guard 5) wired to `check_pipeline.py`
- `runCodeCheck()` added to Pipeline.gs: live health check inside Apps Script (reads sheet headers, checks column maps, checks for status pollution)
- `setupTrigger_LEGACY` in Automation.gs disabled — was deleting ALL project triggers (dangerous)
- `_buildInputSheet()` fixed: no longer inserts duplicate banner row if `setupSheets()` is run twice
- `runNow()` alert in Automation.gs corrected: now points to AUDIT_LOG (was incorrectly saying ENRICHMENT_LOG)
- Pre-push hook URL comment added: explains how to update hardcoded Apps Script deployment URL if redeployed

### Still Pending — copy updated Pipeline.gs + Automation.gs into Apps Script, then:
- Run `fixOldStatusData()` once — cleans column pollution across all 12 sheets
- Run `restoreFromDone()` if INPUT_Hotels is still empty
- Run `setupSheets()` and `setupTrigger()` once if not already done (midnight automation)
- Google Sheet Users tab: columns D–H headers still need labels (Created, Agency Name, Person Name, Mobile, Email)
- Trains and Transfers data quality not yet reviewed

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
