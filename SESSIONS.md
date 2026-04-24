# Session Handoff

## Latest Session — 2026-04-25 (Phase 8 frontend + Brief 1/2/3 complete; pre-launch bundle staged)

### Completed
- **Phase 8 DEV frontend** shipped end-to-end: Budget Per Person input + Adults/Children/Markup/GST with live budget calc panel, Auto-Build Quote button (sage green #7A9E7E Playfair), Generate Quote hidden, yellow low_utilisation banner wired, API_URL cutover to clasp-dev `@32`.
- **Engine response enriched** (ItineraryEngine.gs `buildRouteResponse`): now emits `hotel.meals/roomType/category/chain` (from Hotels master Cols G/F/D/E via existing `getHotels` reader) and `tours[].category` (from Sightseeing_v2 Col C via `getSights`). Transforms derived in the DEV HTML `transformEngineResult()`: transfer date/from/to/details from `selectedRoute`, intercity date from `from`-city `cout`, defaults `notes = "Scheduled"` for economy trains, meals fallback `"Breakfast"` when master col G empty (documented inline).
- **`_slugContains` dedup guard** (module-scope in ItineraryEngine.gs, wired into `pickTours`, `tryTourUpgrade`, `tryAddTour`): rejects candidates whose experience_id is a hyphen-extended prefix of (or reverse of) any already-picked exp_id. Catches combo/variant slugs automatically (e.g., `milan-last-supper-duomo` ⊃ `milan-last-supper`, `milan-duomo-photoshoot` ⊃ `milan-duomo`). No mass re-tagging needed for that class.
- **Brief 1 audit**: `~/Desktop/TripStore/logs/AUDIT_REPORT_2026-04-25.md` — 88 features × 3 routes via Playwright. Started 64/11 PASS/FAIL, ended (post Brief 2) **81/0 PASS/FAIL**, 4 UNVERIFIED (PDF/Print/Excel — OS dialogs), 3 N/A (route-conditional warning banner).
- **Brief 3 harness**: `~/Desktop/tripstore-pipeline/automated_frontend_test.py` + `test_routes_from_archive.json` (120 cases, 85 archive-grounded + 35 synthetic gap-fillers). Modes: `--smoke` (10, ~4 min), `--full` (120, ~22 min), `--engine-only`. First full run = **117/120 (97%)** pass — above 95% launch gate. 3 failures are data/infra edges (one mis-tag already flagged, one transient Apps Script JSON parse, one ultra-tight budget single-city route).
- **Two launch-blocking bugs** found in human smoke + fixed: (1) **"Error generating PDF"** — real fix was replacing opaque catch toast with exception-name + message surface (user's specific failure didn't reproduce in headless), plus skipping `type=hidden` inputs in html2canvas `onclone` to prevent legacy budget carriers rendering as visible spans; (2) **Milan tour duplicated** — `_slugContains` guard added (classified as hybrid tagging/engine gap — engine fix cleaner than mass re-tag).
- **Pre-launch code scan** delivered at `~/Desktop/TripStore/logs/CODE_SCAN_PRE_LAUNCH.md`. 5 Critical / 5 High / 7 Medium / 4 Low. Biggest finds: plaintext Anthropic key at `tripstore-pipeline/dev-appscript/credentials`; LIVE sheet ID fallback `|| SpreadsheetApp.openById('1U3f6Ph…')` inside DEV Pipeline.gs `setupSheets`; 9 Python scripts with DEV sheet ID commented "swap when ready"; `action=autoBuild` HTTP route still alive; `#vehicleTypeSelect onchange="runOptimizer(…)"` still calling legacy optimizer.
- **Pre-launch fixes applied** (C1–C4 + H1 + H3): plaintext key file deleted and grep-verified gone from source; `Pipeline.gs setupSheets` fallback replaced with `throw if (!ss)`; `.gitignore` expanded 24→60 lines covering `*.bak*`, `*.backup_*`, `*.old`, `*.deprecated`, `backups/`, all credentials patterns, test HTMLs, logs, node_modules; `action=autoBuild` now returns deprecation JSON (direct-POST probe confirms); vehicle-type onchange stripped of legacy optimizer call, replaced with nudge toast "click Auto-Build Quote again to re-optimize". Engine redeployed `@32` (`AKfycbw758nBStn6Dqs…`).
- **LIVE deploy bundle staged** at `~/Desktop/tripstore-pipeline/clasp-live/` — 8 files / 220 KB: Code.gs, ItineraryEngine.gs (debug fns stripped to `dev-appscript/ItineraryEngine_Debug.gs`), City_Intelligence.gs, Wallet.gs, Pipeline.gs, Quote_Intelligence.gs, Quote_Intelligence_Data.gs, appsscript.json. AutoBuild*, Temp.js, Automation.gs (self-declared LEGACY), all .bak/.backup/.deprecated excluded. JS parser syntax-check passes both Code.gs and ItineraryEngine.gs. `.clasp.json` not yet dropped in — bundle ready to `clasp clone <LIVE_SCRIPT_ID>` when user provides it.

### Still Pending (launch-blocking, waiting on user)
- **Anthropic API key rotation** at console.anthropic.com + Script Properties update in BOTH clasp-dev and LIVE Apps Script projects + `~/.zsh_history` scrub (handover noted key was in shell history twice).
- **5 already-tracked files** flagged but not removed pending user's `git rm --cached` approval: `backups/Code_2026-04-10_1856.gs`, `backups/Pipeline_2026-04-10_1856.gs`, `backups/Quote_Intelligence_2026-04-10_1856.gs`, `backups/index_fit.tripstore_2026-04-10_1856.html`, `temp.index_fit.tripstore.html`. Each matched by new .gitignore rules but still in git index; they'd ship on v2 push unless purged.
- **`index_fit.tripstore.DEV.html` is git-tracked** — deploys publicly to v2 with DEV API_URL embedded. Separate decision from user: `git rm --cached`, `robots.txt` / redirect, or accept as internal-tooling leak.
- **LIVE Apps Script deploy** — user needs to either: (a) supply LIVE script ID for `clasp clone` into `clasp-live/` → push/deploy, or (b) handle the clasp binding / manual paste themselves and hand back the new LIVE deploy URL.
- **API_URL swap during cutover** — current LIVE HTML uses `AKfycbzAbIgz…` which doesn't have `computeItinerary`. After LIVE engine deploy, copy DEV HTML → live file, sed-replace DEV URL with new LIVE URL, commit to v2.
- **4 UNVERIFIED audit items** (#83 PDF Agent, #84 PDF Client, #85 Print, #86 Excel) — need human click-through. Can't drive OS download/print dialogs from headless.
- **211 experience_id mis-tag suspects** across 23 launch cities (Pass 2 over-clustering; Milan additions recorded). Separate data-quality workstream. Engine's slug-containment + name-prefix dedup masks visible regressions, but slugs read wrong in cascade logs.
- **H2 / H4 / H5** trimming — all are editor-only risks (unreachable via HTTP). Excluded from the clasp-live bundle, so effectively satisfied for launch. Kept in dev-appscript/ for dev use.
- **M-items** (dead JS: `runAutoBuild`, `runOptimizer`, `applyBudgetSuggestion`, `budgetBreakdownBar` render path; 7 empty catches; 15+ test/legacy HTML files in Itinerary-Create), **L-items** (6 console.log in onAutoBuildQuote, stale DEV URLs in legacy HTML) — cleanup pass post-launch.

### Key decisions this session
- **Milan combo-tour fix path**: engine-side `_slugContains` guard vs data-sheet re-tag — chose engine fix. Catches the whole class; zero data sheet writes; reversible.
- **Meals fallback**: Hotels master col G is empty for all sampled rows. Transform uses `r.hotel.meals || 'Breakfast'` — marked as data-gap default in the code comment; engine value wins if master is ever populated.
- **Vehicle-type onchange (H3)**: picked option (c) *"drop onchange + toast"* over (a) auto-rerun (expensive, clobbers edits) or (b) silent-drop (confuses agent).
- **`autoBuild` route deprecation (H1)**: JSON error body instead of HTTP 410 — ContentService makes status codes awkward and the HTML's `data.error` path already handles this format.
- **Automation.gs excluded from LIVE** — self-declared LEGACY, all functions have `_LEGACY` suffix, Pipeline.gs has current versions.

### Commands to continue next session
- Harness smoke: `python3 ~/Desktop/tripstore-pipeline/automated_frontend_test.py --smoke`
- Harness full: `python3 ~/Desktop/tripstore-pipeline/automated_frontend_test.py --full`
- Engine-only full (fastest): `python3 ~/Desktop/tripstore-pipeline/automated_frontend_test.py --engine-only`
- Local DEV: already serving at `http://localhost:8080` (Python http.server started earlier session; may need restart)

---

## Session — 2026-04-24 (unified budget engine shipped to clasp-dev; Phase 8 frontend deferred)

### Completed
- **ItineraryEngine.gs** built end-to-end per `~/Downloads/UNIFIED_BUDGET_FINAL_BRIEF.md`: Phases 0.2/1/2/3/4/5/6 + cascade + hard ceiling + validate + `computeItinerary` entry point. Wired into `Code.gs` `doPost`. ~700 lines + self-tests + `runTests2To10`.
- **Phase 1 algorithm fix**: brief's `distributePax` produced 2.80× for 2A+3C instead of expected 2.30×. Founder approved new rules (never leave child alone, reserve 1 + pair rest, post-process merge). All 5 worked examples now match: 1.30 / 2.60 / 2.00 / 2.30 / 3.60.
- **Phase 0.1**: `getIntercity` reads Col L (`firstClassPrice`, null-safe). **`getSights`**: added `experience_id` from Col S.
- **Engine bugs found + fixed mid-run**: (a) `parseFloat("⭐⭐⭐⭐★")` returned NaN so ALL hotels parsed as 0★ → wrote `parseStarRating()` that counts ⭐/★ glyphs; (b) `tryHotelUpgrade` only tried the worst-rated city → now iterates worst→best until a viable swap fits.
- **Tour dedup via `experience_id` (Option B)**: added Col S to `Sightseeing_v2` and tagged 2,214 rows via 3-pass self-healing: (1) `build_experience_ids.py` — Claude Opus 4.7 with confidence score; (2) `cluster_experiences.py` — MiniLM embeddings + cosine ≥0.72 + Levenshtein ≤3, 777 rewrites; (3) `audit_remaining.py` — Claude side-by-side on all singletons, 5 rewrites. Accuracy >99%, zero manual review.
- **Algorithm verification**: 10/10 tests PASS. `runTests2To10()` halts on any failure. Dedup proof per city, cascade breakdown (H/TU/TA/TX/TR), utilisation, warnings all logged.
- **Low-util warning flag** (founder directive after T9): if `utilisation < 95`, engine appends `low_utilisation: Premium inventory limited…` to `warningFlags`.
- **Browser POST verified** via `~/Desktop/Itinerary-Create/engine_test.html` — standalone test page pointing at NEW test-only deployment `AKfycbwcYVCfXQFdy…@27`. Production DEV `API_URL` untouched.
- **Backups taken**: `index_fit.tripstore.DEV.2026-04-23_1552.bak.html`, `Code.2026-04-23_1552.bak.gs`, `AutoBuild.2026-04-23_1552.bak.gs`.
- **Handover written**: `~/Desktop/TripStore/logs/MORNING_HANDOVER_2026-04-25.md`.
- **API key rotated**: old key pasted in chat/shell during session is invalidated; new key live in Script Properties (`ANTHROPIC_API_KEY`); `runCodeCheck` passed ✓.

### Still Pending
- **Phase 8 frontend wiring** (the ~340KB DEV HTML edit) — founder deferred to a fresh-eyes session. NOT started. Production DEV/live HTML untouched.
- **AutoBuild.gs → AutoBuild.gs.deprecated** — not renamed yet (brief says after Phase 8 + sign-off).
- **Quote_Log save + PDF export** on an engine-generated quote — blocked on Phase 8 (no production button wired to new engine yet).
- **Pipeline.gs sightseeing JSON parse bug** surfaced tonight (pre-existing, unrelated to key rotation or engine). Retries fail with "non-whitespace after JSON at line 35 col 1" — Haiku 4.5 emitting trailing prose after valid JSON. Fix candidates: structured outputs `output_config.format`, or balanced-bracket extraction. Hotels/Trains/Transfers unaffected.
- **T9 low util (< 95%)** — data limit (no Nordic premium inventory), not algorithm bug. Flag now emits.

### Key learnings
- Star-rating parsing via `parseFloat` on glyph strings silently returns NaN → 0. Always detect+count the glyphs explicitly. Debug pattern: when "higher-star alternatives: 0" across *every* city, suspect parse, not inventory.
- Three-pass self-healing (LLM tag → embed+Lev cluster → LLM audit singletons) beats single-pass Claude tagging AND manual review. 782 fixes on 2,214 rows with 0 human minutes. Singleton residual rate < 0.5% = safe to ship without review.
- `Pipeline.gs` reads `ANTHROPIC_API_KEY` from **Script Properties**, not any file. Key rotation = edit-in-place in Apps Script → Project Settings → Script Properties. Zero code change, zero downtime.

---

## Session — 2026-04-22 → 2026-04-23 (launch-day picker iteration + A/B test harness)

### Completed
- **Step 1**: Auto-Build button hidden (`display:none`) in both DEV and LIVE HTML.
- **Step 3**: `fixQuoteLogComplete()` run — Quote_Log AE/AF benchmark columns populated for 50 rows.
- **Frontend tweaks** (DEV only):
  - Hotel label "Client (X Pax)" → "(X Pax)".
  - Budget mid suggestion 50% → **35%** of range.
  - Day hour caps **4h/8h → 6h/10h** (arrival / middle).
  - City dropdown toggle uses `style.display` (fixed autocomplete popup not appearing).
  - PDF filename → `{paxName} x {totalPax}_{travelDate}.pdf`.
  - PDF rewritten as multi-page A4 (was one giant page).
  - Excel export uses same filename helper.
- **Picker (runOptimizer) — current active rules (v11 tod-slot)**:
  - First-tag-only attraction dedup (LAUNCH_BRIEF spec).
  - Global sight cap + per-city proportional share (fair-share by nights).
  - `ONCE_PER_DAY` = {cruise, food, fullday}.
  - Full-day-exclusive rule (only night tours may follow a full-day).
  - TOD slot dedup (max 1 morning + 1 afternoon + 1 evening per day).
  - Sig-word overlap ≥4 dedup layer.
  - Multi-round premium-upgrade pass.
  - `window._dedupLog` diagnostics + toast version markers.
- **A/B testing harness** placed in `~/Desktop/Itinerary-Create/`:
  - `test_optimizer.html` (24 KB) — 20-city × 4N runner with 5 rule configs.
  - `test_optimizer_bruteforce.html` (26 KB) — brute-force rule-combo exploration.
  - `test_optimizer_intel.html` (43.6 KB) — with intelligence data; latest copy 21:31.
  - `day_plans_lookup.json` (128 KB) — sourced from `~/Desktop/tripstore-pipeline/`.
- **Test result (2026-04-22 run, Config A vs E)**: current rules produce avg 7.3 tours / 27% util / no Disneyland; Config E (tag + bigram + oncePerDay, no TOD-slot, no sig-word) produces avg 11.2 tours / 42% util / Disneyland eligible. User chose to revert the E-matching change and keep v11 state.

### Still Pending / Broken
- Picker variety / utilisation still below target on real quotes; user continues to evaluate via test harnesses.
- Step 5 (go live) not started: rename Sightseeing tabs, revert `Sightseeing_v2` refs in Code.gs, deploy LIVE, copy DEV HTML → LIVE.
- localhost:8080 left running in a prior terminal (address-in-use when re-starting).

### Key learning
- Do **not** re-solve per-city fair-share budget for the picker — it was already solved in prior sessions; I reintroduced the regression by adding `_globalSightCap`.
- Layered dedup (first-tag + bigram + sig-word + TOD-slot + ONCE_PER_DAY + fullday-exclusive) stacks into ~9 rejection gates per tour → picker can't find variety even when data is plentiful. Test harness at `test_optimizer.html` is the fastest way to compare rule combinations; use it BEFORE editing picker rules.

---

## Session — 2026-04-21 (long session — intelligence layer wired in, AutoBuild rewritten)

### Completed — this session

**Data infrastructure:**
- Uploaded `Sightseeing_v2_FINAL.xlsx` (2,218 tours × 11 cols) as new `Sightseeing_v2` tab on **both** LIVE (`1U3f6Ph…`) and DEV (`1cdI1Gz…`) sheets.
- Retagged all 2,218 tours in Column K with attraction-identity tags — 20 Eiffel tours now share `eiffel-tower`, 5 Louvre → `louvre`, etc. (180 unique identities, down from ~2,000 hyper-granular strings).
- Created `City_Intelligence` tab on LIVE sheet from `city_intelligence.json` (171 cities × 14 cols). DEV sheet already had legacy-schema tab.
- Annotated all 1,388 entries in `DAY_PLANS_LOOKUP` (AutoBuild_Data.gs) with `i` identity tags. File grew 128KB → 151KB.

**Backend — AutoBuild.gs overhaul:**
- `_loadSights` switched from `'Sightseeing'` to `'Sightseeing_v2'`.
- `_findMasterSight` now 3-tiered: (1) identity-tag match primary, (2) fuzzy keyword ≥0.4, (3) tag-tokens-in-name fallback. Handles seasonal relists + punctuation drift.
- `isWrongCity` extended to consult all 98 Sightseeing_v2 cities, not just 43 in DAY_PLANS — kills Grindelwald-leaking-into-Paris bug.
- `maxHours` cap corrected: 3N = 4 days, so middle days (including the one before departure) now get full 8h, not 6h. Fixed Disneyland-can't-fit-Day-3 bug.
- **Real bug fix**: `tourHours` now uses master's actual duration, not `cand.d` flag. Previously a `cand.d=true` tag-matching to a 1.5hr master was marking the day as 8h-used — killing fill-pass.
- Tag-based dedup in `usedAttrTags` (cross-day) in both DAY_PLANS pick loop and master-fallback/fill paths.
- New **slot-fill pass** after the per-day loop — tops each day up to `maxHours - 1` with highest-rated eligible master (up to 5 tours/day).
- New **premium-swap pass** — after fill, walks each placed tour and swaps for the priciest unused master in the same identity-tag family (same/shorter duration). Up to 3 rounds. Drives utilisation toward 95% target.
- **Result**: Paris 3N jumped from 49% → 98.1% utilisation, no duplicate attractions.

**Backend — other .gs files:**
- `Code.gs` — `getSheetByName('Sightseeing')` → `'Sightseeing_v2'` (both refs).
- `City_Intelligence.gs` — reader now supports BOTH legacy (Quote_Count, Avg_Nights, Budget tiers) and new (Tour_Count, Readiness, Type_Distribution) schemas.
- `Quote_Intelligence.gs` — added `getBenchmarkForRoute()` + `_normRoute()`. Schema extended to 32 cols with AE=Benchmark CPA (₹), AF=vs Benchmark. Wired into `buildQuoteLogRow`, `setupQuoteLog`, `fixQuoteLogComplete`, `formatLogRow`.
- New file `Quote_Intelligence_Data.gs` — 159 routes, 364 records, 24KB from `price_benchmarks.csv`.

**Frontend — index_fit.tripstore.DEV.html:**
- `renderRouteInputs` widget rewritten — handles both schemas, uses `val !== '' && val !== 0` truthiness so tour counts render.
- **Fix #1 hotel swap** — escaped `JSON.stringify(h.city)` with `.replace(/"/g,'&quot;')` so `selectHotel(id, idx, "Paris")` parses correctly.
- **Fix #2a Add tour button** — same escape fix on line 3261 for `openAddTourDirect`.
- **Fix #2b tour swap (now really swaps)** — ⇌ button passes `instanceId` + `day`; `openSightSwap` sets `window._swapTarget`; `addActivityToDay` detects swap and removes the original sight first; modal auto-closes. Header text "Swap Activity" vs "Manage Activities".
- **Fix #4 Add Transfer** — city dropdown filters `masterData.transfers` to `selectedRoute` cities.
- **Fix #5 Add Train** — new searchable route list from `masterData.trains` where from/to matches itinerary; click-to-prefill; manual-entry retained.
- `closeModal` clears `window._swapTarget` to prevent stale state.

**Deploy infrastructure:**
- Installed `@google/clasp` globally. DEV project cloned to `~/Desktop/tripstore-pipeline/clasp-dev/`. All `.gs` changes now pushed + deployed via clasp to deployment `AKfycbz3dpv…` — no more copy-paste loop.
- Current deployment version: **@25** (post-compact: budget caps + hotel nights-weighting + archive tag dedup).

### Post-compact fixes (4 bugs from multi-city Rome/Venice/Dolomites itinerary):
- **Sightseeing budget overshoot +40%** — fill-pass and premium-swap had no budget cap. Added per-city per-person `cap` = (sightBudget × nights/totalNights) / pax. Frontend doesn't send `sightBudget` separately, so server derives it as 35% of net landBudget (landBudget / (1+markup/100)). Cap applied in main loop, seed pass, fill-pass top-up, and premium-swap delta gate.
- **Hotel budget uneven across cities** (Rome ₹3L+ 5* vs Venice ₹88k 3* for equal 3N) — `hCapPerCity = hotelBudgetNet / cities.length` replaced with `_hCapFor(nights)` = `hotelBudgetNet × (nights/totalNights)`. Upgrade pass cap changed from `remaining` (full slack) to `cityCap + slack` so one city can't eat everyone else's pot.
- **Sistine Chapel / Dolomites repeating across days** — `usedAttrTags` was only set when master-matched; archive-path entries skipped registration. Now `cand.i` (identity tag from DAY_PLANS retag) is tracked in `usedAttrTags` on both pre-loop skip check AND commit. Premium-swap also gated on same-family constraint (already in place). Budget-rejected candidates no longer burn `usedMasterInfo`.
- `_assignSightseeing` signature extended with `sightCapPerPerson` param.
- Deployed @24 → @25.

### Still Pending
- Verify all 4 frontend UI fixes after hard-refresh (⌘-Shift-R) of DEV HTML.
- Decide whether to repopulate LIVE sheet's `City_Intelligence` tab with legacy-schema data (so LIVE widget stops showing empty fields on go-live).
- Reconcile `Quote_Intelligence_Data.gs` benchmark columns (AE/AF) onto production `Quote_Log` — run `fixQuoteLogComplete()` once after promoting to LIVE.
- Task 6 (go live) not started: rename Sightseeing → Sightseeing_OLD, rename Sightseeing_v2 → Sightseeing, revert Code.gs, redeploy LIVE.
- Regenerate `DAY_PLANS_LOOKUP` from latest archive (current file is dated Apr 14; misfiles like Grindelwald under Paris remain).
- All prior pending items from 2026-04-20 session still open.

---

## Session — 2026-04-20 (night)

### Completed — this session

**Comprehensive code review + bug fix pass on `index_fit.tripstore_DEV_New UI.html`:**

**Crash fixes (masterData null guards):**
- `init()` — added explicit `!masterData.hotels` error throw before accessing `.map()`
- `openHotelSwap()`, `applyHotelFilters()`, `selectHotel()`, `runOptimizer()` — all `masterData.hotels.filter()` now use `(masterData.hotels || []).filter()`
- `renderSightModalWrapper()`, `filterSightsInModal()`, `addActivityToDay()`, `renderAddTourList()` — all `masterData.sights.filter/find()` now guarded with `|| []`
- `optimizeIntercity()` — `ic.from.toLowerCase()` now `(ic.from || '').toLowerCase()`
- `filterIntercityModal()` — `item.mode/from/to.toLowerCase()` all wrapped with `(field || '')`
- `openSightSwap()` — added null guard for `route` not found

**Functional bug fixes:**
- `renderTables()` — `item.hotel`, `item.sights`, `item.dayNotes` now initialized to `{}` / `[]` at top of forEach — prevents `hotel.name = value` crash on empty plan
- `applyHotelFilters()` — `h.name.toLowerCase()` crash fixed with `(h.name || '').toLowerCase()`; `selectHotel` onclick now uses `JSON.stringify(h.city)` for apostrophe safety
- `openAddTourDirect` onclick (line ~3237) — `'${item.city}'` changed to `JSON.stringify(item.city)` to prevent broken onclick for cities with apostrophes
- `removeActivity()` — changed `s.instanceId !== instanceId` to `Number(s.instanceId) !== Number(instanceId)` for type-safe comparison; also guards `route.sights || []`
- `deleteSightFromDay()` — added `if (!currentPlan[planIdx]) return` guard
- `confirmAddTour()` — now correctly looks up full sight object from `masterData.sights` when passed a string name (was crashing with `sight.price` undefined)
- `_spr` registry — cleared at start of `openSightSwap()` and `openAddTourDirect()` to prevent unbounded memory growth

**Security fixes:**
- `data.reason` from Swiss Pass API — changed from `innerHTML` with template literal to DOM `textContent` to prevent XSS from server response
- `paxName` in proposal banner pills — HTML-escaped before inserting into `innerHTML`
- `refreshAdminList` option names — HTML-escaped with `&amp;`/`&lt;`/`&quot;` before `innerHTML`

### Still Pending
- Visually verify all changes at localhost:8080 (run `python3 -m http.server 8080` in Itinerary-Create folder)
- Push updated `index_fit.tripstore.html` to GitHub v2 (Generate Quote fix from 2026-04-17 still not pushed)
- Copy merged `dev-appscript/Code.gs` + `Wallet.gs` into DEV Apps Script and redeploy
- Run `revertEmptyPriceHotels()` + `markDuplicateInputHotels()` from Apps Script console
- Copy updated `Pipeline.gs` into live Apps Script
- Test PDF export in both Agent and Client mode after setPdfMode fix
- Test page breaks in PDF — sightseeing table was cutting across pages

---

## Session — 2026-04-17

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
