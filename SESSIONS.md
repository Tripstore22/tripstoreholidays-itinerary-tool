# Session Handoff

## Latest Session — 2026-04-09 (evening, continued)

### Completed — this session
- `check_html.py` created: static validator for index_fit.tripstore.html (duplicate functions, missing features, index.html sync, API URL count, script tag balance)
- Pre-commit hook updated: runs `check_html.py` when HTML file is staged
- Pre-push hook updated: Guard 6 added — runs `check_html.py` before every push
- Sightseeing prompt fixed: GYG-only or Viator-only rows now explicitly valid (old wording was ambiguous)
- Hotels prompt fixed: removed "European location" restriction — now allows any real location (Dubai, Maldives etc.)
- Trains prompt fixed: inr_price=0 now valid if monthly € prices exist (old rule contradicted the enrich path)
- `processSheet()` fixed: now uses `res.idx` (Claude's index) not forEach index — prevents wrong row being marked if Claude reorders results
- `callClaudeAPI` max_tokens raised to 8192: Trains returns 2 rows per input; old 4096 cap risked truncated JSON
- `check_pipeline.py` Section 6 added: prompt logic regression checks for all 4 enrichment functions + processSheet idx fix
- Save name bug fixed: re-saving no longer doubles the suffix (e.g. "Sumit Spain x2_09Apr x4_09Apr_V1" → "Sumit Spain x4_09Apr_V1")
- Star ratings fixed: ⭐ emoji replaced with ★ Unicode in all display locations — now renders as solid gold, not gradient
- Budget on load fixed: hotelBudget recalculated from actual plan costs after loading a saved itinerary (was stale from old version)
- Vehicle type on load fixed: if saved as sedan but pax ≥ 4, automatically resets to auto (Standard Van) on load
- PDF speed fixed: auto-save before export changed to fire-and-forget — export now starts instantly instead of waiting 3-6s for API
- html2canvas scale reduced 2→1.5 and JPEG quality 0.95→0.90 for faster PDF rendering
- Users tab headers confirmed already complete — no changes needed
- Trains master sheet: rows 638-642 identified as bad data (transfers/invalid routes) — user to delete manually
- London-Liverpool price identified as wrong (Claude estimated ₹27,630, should be ~₹4,400) — user to fix manually

### Still Pending
- Trains master: manually delete rows 638, 639, 640, 642 (bad transfer/invalid data)
- Trains master rows 620-621: fix INR price for London-Liverpool (₹27,630 → correct price ~₹4,400), clear monthly € cols, run `repairTrainMonthlyPrices()`
- INPUT_Trains: delete rows with blank From City or blank To City ("MISSING: From" error rows)
- INPUT_Transfers: delete itinerary text rows (wrong data entered in wrong sheet)
- After cleanup: run `resetErrorRows()` then `runMidnightEnrichment()`
- Run `setupTrigger()` once to activate midnight automation
- Copy updated Pipeline.gs into Apps Script (has prompt fixes + processSheet res.idx fix + token cap fix)

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
