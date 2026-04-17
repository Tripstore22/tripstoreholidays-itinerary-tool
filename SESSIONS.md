# Session Handoff

## Latest Session — 2026-04-17

### Completed — this session

**Generate Quote critical fix (LIVE + DEV):**
- `runOptimizer()` was crashing silently — `landBudgetTotal` was undefined (should be `landBudgetNet`). This broke Generate Quote on BOTH live and DEV. Fixed in both `index_fit.tripstore.html` (line 1610) and `index_fit.tripstore.DEV.html` (line 1976).

**City Intelligence rebuild (6 fixes in `build_city_intelligence.py`):**
- Sightseeing per day was ₹160K instead of ~₹12K — old code attributed entire trip sightseeing to every city. Now parses per-city from `Sightseeing_Used` column, uses median.
- Land cost: same full-trip attribution bug — now proportional by city nights / total nights
- Prev/next city: only found first occurrence in route, missed revisited cities — now iterates all with `enumerate`
- Combo names: showed lowercase "florence + paris" — now uses proper case
- Hotel cost + transfers: switched from mean to median (outlier resistant)
- Saved_Itineraries: fixed `selectedRoute: null` crash + `int("2.5")` crash

**Tour dedup fix (DEV):**
- Colosseum tours appearing on multiple days — bigram dedup missed "Colosseum with Arena" vs "Fast-Track Colosseum" because the word "colosseum" paired with different neighbours. Added `LANDMARK_KEYWORDS` unigram matching for 50+ major EU attractions.

**Wallet.gs hardened (4 fixes):**
- Added `LockService.getScriptLock()` to `topUpWallet` and `processQuoteDeduction` — prevents double-charge race condition
- Transaction ID: replaced fragile `getLastRow()` with `Utilities.getUuid()`
- Counter update moved BEFORE debit — prevents money loss if counter write fails
- Added null/empty guard on agentId/paxName

**Frontend wallet fix (DEV):**
- Reversed save flow: save itinerary first, deduct wallet only after save succeeds — prevents money loss on failed saves

**Route merges + syncs:**
- Merged `dev-appscript/Code.gs` — now has ALL routes: intelligence (3) + wallet (5) + existing (11)
- Synced `Wallet.gs` to `dev-appscript/`
- Fixed `renderRouteInputs()` null crash on city intelligence cache
- City_Intelligence tab rebuilt (321 cities, corrected data)

### Still Pending
- Push updated `index_fit.tripstore.html` to GitHub v2 (Generate Quote fix is critical for live)
- Copy merged `dev-appscript/Code.gs` + `Wallet.gs` into DEV Apps Script and redeploy
- Run `revertEmptyPriceHotels()` + `markDuplicateInputHotels()` from Apps Script console
- Copy updated `Pipeline.gs` into live Apps Script (server-side price guard)

---

## Session — 2026-04-16

### Completed — this session
- **Wallet + Quote Pricing system** built end-to-end:
  - `Wallet.gs` — 9 functions: createWalletTabs, getWalletBalance, topUpWallet (with bank ref), calculateQuoteCharge, processQuoteDeduction, updateQuoteCounter_, getAgentDisplayName_, getRecentTransactions, getAgentList
  - Pricing: ₹99 for quotes 1-3 per PAX, ₹49 per quote from 4+, cap ₹246/client
  - `Code.gs` — added 5 wallet routes to doGet (3) and doPost (2)
  - Frontend: wallet badge in nav, admin top-up tab, save-flow deduction gate, bank ref field
- **Applied wallet to correct DEV file** (`index_fit.tripstore.DEV.html`) after initially applying to wrong file
- **Fixed [object Object] bug** — `selectedRoute` is objects not strings, now uses `.map(r => r.city).join()`
- **Fixed PAX name for wallet** — uses clean client name (before versioning) so V1/V2/V3 share one Quote_Counter
- **CLAUDE.md hardened** with strict file rules: never copy live→DEV, 3-file table, API URL rules, sheet ID rules

### CRITICAL LESSON LEARNED
- `index_fit_DEV.html` was created by copying from live file (`index_fit.tripstore.html`), which LOST 29 DEV-only features (Swiss Pass, City Intelligence, server-side Auto-Build, custom city dropdown, PDF mode, budget breakdown bar, etc.)
- The correct DEV file is ALWAYS `index_fit.tripstore.DEV.html` — it has features the live file doesn't
- **Rule: NEVER copy live → DEV. Always branch from DEV.**

### Still Pending
- Run `revertEmptyPriceHotels()` from Apps Script console to clean up bad PROCESSED rows
- Run `markDuplicateInputHotels()` to mark duplicates
- Copy updated **Pipeline.gs** into Apps Script (server-side price guard)
- Copy `Wallet.gs` + wallet routes in `Code.gs` into DEV Apps Script project
- Copy `Quote_Intelligence.gs` into DEV Apps Script project (for Quote Dashboard)
- Redeploy DEV web app (new version) after pasting updated files
- Delete deprecated `index_fit_DEV.html` file

---

## Session — 2026-04-15

### Completed — this session
- `markDuplicateInputHotels()` in Temp.gs — standalone Set-lookup function to mark INPUT_Hotels rows as DUPLICATE (amber `#FFF3CD`) if hotel name + city already exists in Hotels master
- Root-caused empty-price hotels slipping through as PROCESSED: Claude API ignored the "all prices = 0 → valid=false" prompt rule, and pipeline had no server-side guard
- `Pipeline.gs` — added server-side guard (after Claude returns results): overrides `valid=true` to `valid=false` if all 12 monthly prices in the input row are 0, regardless of what Claude says
- `revertEmptyPriceHotels()` in Temp.gs — cleanup function to fix existing damage: reverts wrongly-PROCESSED rows (all prices=0) to ERROR in INPUT_Hotels + deletes matching bad rows from Hotels master

---

## Session — 2026-04-10 (final)

### Completed — this session
- `FIX_QUOTELOG` function (Temp.gs) — fixed all Quote_Log display issues in one shot:
  - Travel Month: set cell format to TEXT before writing string to prevent Sheets auto-converting "Mar-26" → serial
  - No. of Cities + Markup %: values stored as text with ₹ prefix — rewritten as plain numbers via `num()` helper
  - Sub Total + Budget Entered: same ₹-text issue — rewritten as plain numbers
  - Utilisation %: recalculated from clean numeric values, now shows correctly
  - Budget flag + row colour: recalculated (OVER / ✅ TARGET / NEAR / UNDER / No Budget)
- Budget Entered root cause fixed in `index_fit.tripstore.html`: removed "Fix 1" block in `loadAndOpen` that was overwriting `hotelBudget` input with actual hotel cost on load
- Quote_Intelligence.gs: Travel Month format changed to `mmm-yy` (e.g. "Apr-26")
- Quote_Intelligence.gs full audit: fixed hotel net (missing pricingFactor), sightseeing net + train net (missing paxCount), formatLogRow for column format inheritance, Notes column width
- index_fit.tripstore.html: added `roomsRequired` and `agentName` to save payload; restored `roomCountInput` on load
- Utilisation % changed from Sub Total vs Budget → Grand Total vs Budget in both `buildQuoteLogRow` and `fixQuoteLogComplete` (Quote_Intelligence.gs)
- Backup taken: all 4 key files copied to `/backups/` with timestamp 2026-04-10_1856

### Still Pending (manual — no code changes needed)
- Copy updated **Code.gs**, **Quote_Intelligence.gs**, **Pipeline.gs** into Apps Script and redeploy
- Run `fixQuoteLogComplete()` to recompute all historical Util% rows with Grand Total formula
- Re-save Nitika itinerary to log a fresh correct row
- Trains master: manually delete rows 638, 639, 640, 642 (bad transfer/invalid route data)
- Trains master rows 620-621: fix London-Liverpool INR (₹27,630 → ~₹4,400), clear monthly € cols, run `repairTrainMonthlyPrices()`
- INPUT_Trains: delete rows with blank From City or blank To City
- INPUT_Transfers: delete rows containing itinerary text (wrong data in wrong sheet)
- After cleanup: run `resetErrorRows()` → `runMidnightEnrichment()` → `setupTrigger()` (once)

---

## Latest Session — 2026-04-09 (evening, continued)

### Completed — this session
- Data Dashboard rebuilt: 6 new sections (pipeline status, hotel star breakdown, tag diversity, transfer coverage, train routes, gap report, demand gaps)
- Duplicate "All Cities" full tables removed (were repeating top/bottom 10 data)
- KPI row expanded to 8 cards (added Trains, Transfers, Coverage Gaps, Demand)
- Hotel star breakdown: click any city row → expands to show 3★/4★/5★ counts
- Sightseeing tag diversity: unique tags per city shown in top 10 + separate tag diversity cards
- Transfer coverage: cities with airport pricing, flags hotel cities missing transfers
- Train route coverage: route count, covered cities list, flags well-stocked hotel cities with no trains
- Gap report: cities missing hotels or sightseeing
- High demand + thin data: most-quoted cities (Quote_Log) with weakest data coverage
- Pipeline status: PENDING/ERROR/DUP/PROCESSED count for all 4 INPUT sheets
- Code.gs getMasterInventory: rewrote to return stars, tags, transfers, trains, pipeline, gapCities, demandGaps
- Dashboard caching: Quote + Data dashboards cache on first load, instant on tab switch
- Refresh button added to both dashboards with "Last updated X min ago" timestamp
- Cache clears on logout/page refresh (always fresh data on new session)

### Still Pending
- Copy updated **Pipeline.gs** into Apps Script (prompt fixes + res.idx fix + 8192 token cap)
- Copy updated **Code.gs** into Apps Script and redeploy (needed for new dashboard sections to show data)
- Trains master: manually delete rows 638, 639, 640, 642 (bad transfer/invalid route data)
- Trains master rows 620-621: fix London-Liverpool INR (₹27,630 → ~₹4,400), clear monthly € cols, run `repairTrainMonthlyPrices()`
- INPUT_Trains: delete rows with blank From City or blank To City
- INPUT_Transfers: delete rows containing itinerary text (wrong data in wrong sheet)
- After cleanup: run `resetErrorRows()` → `runMidnightEnrichment()` → `setupTrigger()` (once)
- Run `archiveAndClearInput()` after reviewing enrichment results

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
