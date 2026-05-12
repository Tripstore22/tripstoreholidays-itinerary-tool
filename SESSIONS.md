# TripStore Pipeline — Sessions Log

## Latest Session — 2026-05-11 → 12 (v4 caps tightened + departure-day skip)

**Outcome:** V4_DAY_HOURS_CAP 10→9, departure days now serve 0 tours, LIVE @106 / LIVE_BF @107. Smoke verified.

### Completed
- 24-check master audit ran clean (BF URL clarified — backend-only parallel deploy, not an HTML bug).
- Promote #1 → LIVE @104 / LIVE_BF @105: ItineraryEngine.gs drift (Step 1 fallback + arrival 4h cap + 2O Pass B).
- Phase 8 hide-CSS (`#hotelBudgetHint, #sightBudgetHint, #budgetBreakdownBar { display:none !important }`) synced into DEV HTML — DEV was missing the guard rule.
- V4 changes in `clasp-dev/ItineraryEngine.gs`: cap 10→9 (line 1914); `cityIdx`/`totalCities` threaded via `used` object; departure-day skip in `fillDaysFromIntelligence_v4`, `fillDifferentExperiences_v4`, and `redistributeUnspentSight_v4` Pass B.
- DEV pushed @61 via `dev_push.sh`. Promote #2 → LIVE @106 / LIVE_BF @107.
- Paris+Amsterdam 9N v4-premium smoke on LIVE: 99.98% util, arrival days 3.5h ≤4h, full day max 9h (right at new cap), Paris Day 4 (departure) and Amsterdam Day 3 (departure) both 0 tours ✅.
- Zaanse Schans fuzzy-match investigation: read `_v4FuzzyMatch_` + `_v4Tokens_` — formula is `overlap / min(|ta|,|tb|) >= 0.30`. Test pairs score 0.71–0.86. Threshold is not the bug.

### Decisions
- V4_DAY_HOURS_CAP fixed at 9 (was 10).
- Hard rule: departure day = 0 tours. Enforced in s1, s2, and 2O Pass B via `dayTypeAt`.
- `LIVE_BF_DEPLOY_ID` is parallel backend redundancy — by design NOT referenced from HTML; `promote_to_live.sh` redeploys both.

### Still pending
- Zaanse Schans diagnosis — need actual failing Day_Plans entry → master-pool tour pair from a real v4Log run; symptom unclear without it.
- Anthropic API key rotation — longstanding.
- GitHub PAT exposed in `Itinerary-Create/.git/config` — rotation pending.

### Backups
- `~/Desktop/tripstore-pipeline/clasp-live.backup_20260511_203825` (pre-promote #1)
- `~/Desktop/tripstore-pipeline/clasp-live.backup_20260511_205115` (pre-promote #2)

---

## Session — 2026-04-28 → 29 (Whitelist v2 LIVE shipped + clasp-deploy bug fixed)

**Date:** 2026-04-28 13:00 → 2026-04-29 14:03
**Outcome:** Customer URL serves 67 cities (66 + Madeira) on the new pivot schema. `promote_to_live.sh` permanently patched.

### What was built / changed in `tripstore-pipeline/`
- **`build_whitelist_seed_v2.py`** — reads LIVE masters, applies tier rules (T1 ≥30 quotes → 5H+5S, T2 10–29 → 3H+3S, T3 → 2H+2S), train bar=2, transfer bar=1 (n/a if no-airport), excludes non-EU via `NON EU_Hotels`. Rescues currently-Live=Y cities (Cappadocia, Warsaw, Tallinn). Output: 228 cities.
- **`push_whitelist_seed_v2.py`** — DEV writer with 9 conditional-formatting rules (Live Y/N green/grey, Done >0 light-green / =0 dark-grey, Pending >0 red bold / "n/a" grey italic, Total_Gap green/amber/red bands).
- **`promote_to_live.sh`** — created earlier today, then patched late-night to add the missing `clasp deploy --deploymentId` step. Reads ID from `~/Desktop/tripstore-pipeline/.deployment_ids` (new file, gitignored, holds LIVE_DEPLOY_ID + DEV_DEPLOY_ID).
- **`clasp-dev/`** — renamed all 11 `.js` → `.gs`, narrowed `scriptExtensions` to `[".gs"]`. Re-bound `.clasp.json` from orphan `1BP-Zh79…` to actual container-bound `1Mr-dMvu1roz7zxh3tukTgW3SxOJQYzYJ_X43k8uRXMJ2etfLj5lZ-f_k`.
- **`clasp-dev/Code.gs`** — appended `refreshWhitelistStatus`, `_buildMasterCounters`, `_getNoAirportSet`, `_getQuoteCounts`, `onOpen()` menu. Patched `getLaunchCities` from col-4 to col-3 (new schema).
- **`clasp-dev/Temp.gs`** — added `revertEmptyPriceHotels` + `markDuplicateInputHotels` + `__SHEET_ID` constant pinned to DEV sheet.
- **`clasp-live/Code.gs`** — promoted to whitelist v2 via the (now-fixed) `promote_to_live.sh` flow on 2026-04-29 13:48. Deployment @45 → @46.
- **`clasp-live/Temp.js`** — appended `FIX_QUOTELOG` + `revertEmptyPriceHotels` (LIVE's original `markDuplicateInputHotels` preserved verbatim).
- **`clasp-live/Pipeline.gs`** — commented out `getUi().alert` block in `resetErrorRows()` so it can run from script editor without UI context. Same edit also in clasp-dev.
- **Marker files:** `clasp-live/THIS_IS_PRODUCTION.md`, `clasp-dev/THIS_IS_DEV.md`. Both ignored by clasp.
- **Python helpers added (copied from archive):** `write_inputs_to_sheets.py`, `clean_pipeline_data.py`. Pipeline is no longer split across two folders.

### Discoveries / lessons
- **DEV scriptId was wrong for unknown duration.** Orphan `1BP-Zh79…` was bound to nothing (standalone script). DEV sheet's container-bound script is `1Mr-dMvu…`. clasp pushes were going to a script that nothing read. Discovered when the new TripStore menu wouldn't appear in DEV after a `clasp push`. Fixed by editing `.clasp.json` and `clasp push --force`.
- **`clasp push` does NOT update the LIVE customer URL.** That URL is pinned to a versioned deployment. Without `clasp deploy --deploymentId`, push is a silent no-op for the web-app endpoint. UI-bound `onOpen` menus DO use HEAD — that's the misleading bit. Caused a 5-minute outage on 2026-04-28 ~20:30 (rolled back cleanly via sheet schema restore).

### Still pending
- Sightseeing migration (`Pipeline.gs:45` MASTER constant + 11→20 col schema reconciliation) — next priority per DECISIONS.md.
- Frontend `fetchLaunchCities` cache rewrite (1h TTL → network-first) — deferred.
- ERROR rows (25 INPUT_Hotels + 19 INPUT_Trains) — user-manual `resetErrorRows()` from script editor.
- Anthropic API key rotation — longstanding.

### Backups
- `~/Desktop/TripStore/backups/whitelist_v2_2026-04-28_1942/` — DEV-only run snapshots
- `~/Desktop/TripStore/backups/whitelist_v2_LIVE_2026-04-28_2025/` — failed first attempt
- `~/Desktop/TripStore/backups/whitelist_v2_LIVE_retry_2026-04-29_1344/` — successful retry
- `~/Desktop/TripStore/backups/deploy_fix_2026-04-29_1339/` — pre-patch promote_to_live.sh and .clasp.json files

### Handover docs
- `~/Desktop/TripStore/logs/HANDOVER_whitelist_v2_2026-04-28.md` (DEV-only)
- `~/Desktop/TripStore/logs/HANDOVER_whitelist_v2_LIVE_FAILED_2026-04-28.md` (failed first attempt — keep for forensics)
- `~/Desktop/TripStore/logs/HANDOVER_whitelist_v2_LIVE_SHIPPED_2026-04-29.md` (successful retry)

---


## Session 1 — extract_archive.py foundation
**Date:** earlier session
**Outcome:** Built extract_archive.py from scratch. Hotels, trains, transfers, passes, self-drive all working. Sightseeing baseline: 408 rows.

---

## Session 2 — Sightseeing extraction overhaul
**Date:** 2026-04-11
**Backup:** extract_archive_backup_20260411.py (in old archive folder)

### What was built
- **Merge-map fix** — `build_merge_map(ws)` + `mcv()` helper. All extractors now read merged cells correctly. This was the core problem affecting 70-90% of sheets.
- **Hotel calendar** — `build_hotel_calendar()` builds {date: city} from hotel checkin/checkout. Used as primary city source in sightseeing.
- **4-step city assignment** in `extract_sightseeing_raw`:
  1. Calendar date lookup
  2. c1 text as city (Pratik sir format — merged city label in col A)
  3. c7 explicit city
  4. Travel signal ("Arrive at X", "Proceed to X")
  5. Sticky carry-forward
  6. Unknown fallback — never discard a tour row
- **Sticky city on skip** — arrival rows skipped by SKIP_ACTIVITY still seed last_city before being discarded
- **Expanded section headers** — "tour", "tours", "activities", "service", "tentative tour itinerary" added (exact cell match only)
- **~$ filter** — temp lock files excluded from scan
- **FUTURE comment** — Day Pattern Intelligence added at top of file

### Key decisions
- SEA/Thailand costing template NOT fixed — product focus is Europe only
- City = "Unknown" rather than dropping the row — manual cleanup later
- `extract_archive.py` is the only file modified this session

### Final counts (426 files, 1,527 sheets, 0 failures)
| Output | Rows |
|---|---|
| input_sightseeing.csv | 6,281 (was 408 at start of session 1) |
| input_hotels.csv | 1,762 |
| input_trains.csv | 62 |
| input_transfers.csv | 188 |
| input_passes.csv | 17 |
| input_self_drive.csv | 48 |

### Stopped at
Step 2 complete. Step 3 (cross_reference.py) not yet run.

---

## Session 3 — Folder reorganisation
**Date:** 2026-04-13

### What was done
Created this clean working folder `/Users/Sumit/Desktop/tripstore-pipeline/` to separate the active pipeline from the legacy archive folder.

**This folder contains:**
- `extract_archive.py` — `INPUT_DIR` points to absolute path `/Users/Sumit/Desktop/tripstore-itinerary-archive/input-pdfs`
- `cross_reference.py` — all relative paths (`./output`, `./sheets-credentials.json`)
- `sheets-credentials.json` — copied from archive
- `credentials/` — copied from archive
- `output/` — all 8 CSVs (itinerary-archive, input_hotels, input_sightseeing, input_trains, input_transfers, input_passes, input_self_drive, hotel_costs)

**Original folder `/Users/Sumit/Desktop/tripstore-itinerary-archive/` — untouched:**
- All old scripts remain as-is
- `input-pdfs/` (453 source Excel files) stays there — referenced by absolute path from this folder
- No files deleted or modified

### Key decisions
- `input-pdfs/` NOT copied — 453 files, stays in archive folder, referenced via absolute path
- Old folder kept intact as live reference — not renamed or deleted

### Stopped at
Step 3 (cross_reference.py) not yet run. Run from this folder:
`cd ~/Desktop/tripstore-pipeline && python3 cross_reference.py`

---

## Session 4 — Wallet + route merge
**Date:** 2026-04-16 / 2026-04-17

### What was done
- **Wallet system** built in `Wallet.gs` (9 functions): createWalletTabs, getWalletBalance, topUpWallet, calculateQuoteCharge, processQuoteDeduction, etc.
- **Pricing model:** ₹99 for quotes 1-3 per PAX, ₹49 from quote 4+, cap ₹246/client
- **dev-appscript/Code.gs merged** — wallet routes (5) added alongside existing intelligence + autobuild routes (3)
- **dev-appscript/Wallet.gs** added as single source of truth
- **Frontend wallet** applied to `index_fit.tripstore.DEV.html` (in Itinerary-Create): nav badge, admin tab, save-flow deduction gate
- **Bug fixes:** null guard in renderRouteInputs for city intelligence, [object Object] in wallet description

### Key lesson
- `dev-appscript/Code.gs` is the canonical DEV Code.gs — it has ALL routes (intelligence + autobuild + wallet + standard). Always copy FROM here to Apps Script editor, never the other way.
- Never create DEV HTML by copying from live — DEV has 29 features live doesn't.

### Files in dev-appscript/ (copy ALL to DEV Apps Script project)
| File | Routes/functions |
|------|-----------------|
| Code.gs | doGet: 14 routes, doPost: 4 routes |
| Wallet.gs | 9 wallet functions |
| City_Intelligence.gs | getIntelligenceForRoute |
| AutoBuild.gs | autoBuild |
| AutoBuild_Data.gs | day plans data |
| Pipeline.gs | enrichment pipeline |
| Quote_Intelligence.gs | quote logging |

---

## Build Sequence (7 Steps)
1. extract_archive.py — build, test --dry-run on 5 files  ✅ COMPLETE
2. Full run on all files — review output CSVs and counts  ✅ COMPLETE
3. cross_reference.py — run to queue new PENDING rows  ✅ COMPLETE (run 5, 2026-04-15)
4. Create Swiss_Pass_Config + City_Intelligence tabs in Google Sheet  ✅ COMPLETE (in DEV sheet)
5. build_city_intelligence.py — build, run, verify City_Intelligence tab  ✅ COMPLETE
6. Apps Script — add getIntelligenceForRoute + getSwissPassOptions + autoBuild + wallet  ✅ COMPLETE (in dev-appscript/)
7. Frontend — intelligence banner + Swiss Pass toggle + PDF toggle + wallet  ✅ COMPLETE (in index_fit.tripstore.DEV.html)

---

## Session — 2026-05-04 (Tag taxonomy v1 + PDF-intelligence audit)

### What was done
- **Tag taxonomy v1 dropped into pipeline** (built in chat session). Files moved to `~/Desktop/tripstore-pipeline/`:
  - `build_tag_taxonomy.py` (50K)
  - `retag_sightseeing.py` (9.7K)
  - `tag_taxonomy.json` (1.0M)
  - `sightseeing_v2_tagged.csv` (580K — header has 12+ trailing empty cols, strip before any Sheet write)
  - `TAXONOMY_REPORT.md` (5K, bonus)
- **Eyeball QA on 60 random tagged rows** (20 Paris + 20 Rome + 20 Amsterdam). Verdict: usable but noisy. 5 issues to fix in v2 (brief from user pending). Examples of noise: apostrophe-fragments (`d'orsay`, `'hollandsche`), Italian-language tags (`roma`, `spettri`, `alchimisti`), generic `1hr` as a tag, over-splitting one Colosseum tour into `colosseum-floor` / `colosseum-forum` / `colosseum-palatine` / `colosseum-roman`.
- **PDF-intelligence pipeline audit** (existing Apr-16 run at `~/Desktop/TripStore/intelligence/`):
  - `city_tour_patterns.csv` — 1,298 rows; `Archive_Avg_Price_INR` empty on **100% of 1,284 tour rows**. Cross-reference to Excel-side prices never landed.
  - `manual_check.csv` — 217 rows, **all flagged Needs_Action=YES**. None triaged since Apr 16.
  - `tripstore_intelligence_master.json` — 689K, valid JSON, but inherits the empty-price problem.
- **Schema gap mapped between Excel & PDF day-pattern outputs:**
  - Excel `output_v2/day_patterns_dated.csv` (10,160 rows) — raw observations, pipe-separated `Tour_Names_List` per day, has cost data.
  - PDF `intelligence/csv_output/city_tour_patterns.csv` (1,298 rows) — aggregated, one row per (City, Nights, Day, Tour), has Frequency + Day_Type + Time_Of_Day + Combined_With.
  - **Bridge to build:** explode Excel → fuzzy-match tour names → re-aggregate into PDF schema → backfill `Archive_Avg_Price_INR`.

### Key decisions
- Hold Google Sheet push of tagged sightseeing data until tag taxonomy v2 ships.
- Hold all `ItineraryEngine.gs` edits until tag v2 lands.
- Reuse Apr-16 PDF-intelligence output as baseline; fix the cross-reference bridge instead of re-extracting.

### Stopped at
- Waiting on user's "5 noise issues" cleanup brief for tag taxonomy v2.
- After v2: push to Google Sheet, then move on to the Excel↔PDF day-pattern merge.


## Session — 2026-05-04 → 05 (v3-beta-semantic dedup wired & field-tested — DEV only)

**Date:** 2026-05-04 evening → 2026-05-05 12:56
**Outcome:** v3 implementation complete and reachable in DEV. Field tests show v3 produces byte-identical picks to v2.2. v2.2's existing 3-layer dedup is sufficient; v3's semantic pass has nothing to catch. No promotion. Awaiting disposition decision (A: drop / B: opt-in beta / C: pivot infrastructure to editorial dedup or semantic search).

### What was built / changed in `tripstore-pipeline/`
- **`clasp-dev/` initialised as git repo** (`main` branch). `.gitignore` excludes `.backups/`. 5 commits for the v3 work: baseline → gitignore → revert heuristic v3 (−371 lines) → rewrite v3 against real v2.2 architecture (+481 lines) → dispatcher branch (+4 lines).
- **`clasp-dev/ItineraryEngine.gs`** — heuristic v3 removed (6 blocks, ~370 lines). Semantic v3 added: `V3_SIM_THRESHOLD = 0.85`, `V3_DROPPED_PER_CITY_CAP = 10`, `V3_EMB_TAB`, 5 regex constants, 7 helpers (`v3_normKey`, `v3_extractTimes`, `v3_extractMatches`, `v3_setsEqual`, `v3_isDuplicate`, `v3_parseEmbedding`, `v3_cosine`), `v3_loadEmbeddings()`, `applyV3SemanticDedup_(state, ctx, embMap)`, `computeItinerary_v3(params)` (mirrors v2.2 exactly + dedup pass between cascade_v22 and validate), `testV3SemanticDedup` smoke harness, `diagWhichSpreadsheet` (editor-only diag, not deployed). Dispatcher gained `v3 / v3-beta / v3-beta-semantic` branch placed before v2.2.
- **`compute_embeddings.py`** — SBERT (`all-MiniLM-L6-v2`) embeddings populator. Idempotent. Reads Sightseeing_v2 col A (City) + col B (Tour Name), writes JSON-encoded 384-float L2-normalised arrays into `Embeddings_Sightseeing` col C. Uses gspread + service account. SHEET_ID currently points at DEV (`1iENrNwWTtU9...`).
- **`create_embeddings_tab.py`** — idempotent tab creator (3 cols: City | Tour Name | Embedding). Run once per sheet.
- **`run_field_test.py`** — POST 3 quotes (v1, v2.2, v3-beta-semantic) to DEV web-app URL with `{action: "computeItinerary", params: {...}}` shape. Saves responses + summary JSON to `field_test_output/`.
- **`analyze_field_test.py`** — side-by-side comparison report (cost, tour counts, repetition, dedupLog, warning flags).
- **`verify_v3_endpoint.py`** — single-shot smoke verifier (Paris-only, returns algorithm + dedupLog + warnings).
- **`field_test_output/`** — `response_v1.json`, `response_v2_2.json`, `response_v3_beta_semantic.json`, `field_test_summary.json`, `comparison_report.txt`.

### What was changed in DEV Sheet (`1iENrNwWTtU9...`)
- New tab `Embeddings_Sightseeing`, 2,217 rows × 3 cols. Idempotently regenerable. NOT a hand-edited tab.

### What was deployed
- `clasp push` ran 3× this session (always to DEV scriptId `1Mr-dMvu1roz...`).
- `clasp deploy --deploymentId AKfycbxrC4tULOlFLPvTIDt8HpJtmsiuueF2gurUxaoaiHQzns_fxeLyMoKP2WZrt6OhalWkPQ` ran 2×, bumping the DEV public deployment @18 → @19 → @20. Same deployment ID, same URL — version number increments.
- LIVE deployment ID `AKfycbzAbIgzRoN_MNs377jm3u` NOT touched.
- DEV HTML `API_URL` already pointed at the right deployment ID (matches @19/@20).

### Discoveries / lessons
- **Sheet binding bug.** First populate run wrote 1,911 embeddings to LIVE sheet because `compute_embeddings.py` had LIVE's SHEET_ID. The DEV Apps Script project is container-bound to DEV sheet, so `getActiveSpreadsheet()` inside `applyV3SemanticDedup_` returned DEV — where `Embeddings_Sightseeing` didn't exist. `dedupLog.withEmbedding = 0` on every quote despite a populated tab. Smoke test from Apps Script editor reported `1911 loaded` because *that* execution context also returned LIVE — the bug was invisible from the editor. **Generalised lesson:** any Sheet-writing script meant for code-side consumption must point at the same Sheet ID that `getActiveSpreadsheet()` will return at runtime, and a smoke test that doesn't go through the production code path can lie.
- **v2.2's pickTours_v2.tryAdd is already a 3-layer dedup**: `usedTags[c][tag]` (exact experience_id) + `_slugContains` (slug-substring) + `_nameKey` (name-prefix). It produces zero near-text duplicates in real quotes. v3's semantic pass has nothing to catch.
- **Max same-city semantic similarity in real picks = 0.632.** Far below the 0.85 threshold. The closest "looks-like-same-attraction" pair (St. Peter's Basilica tickets vs Vatican Dome Climb tour) scores 0.586. SBERT correctly distinguishes ticket-only from guided-experience packages.
- **The original v3 brief's 5.1% repetition figure was simulation-only.** It didn't account for v2.2's tryAdd dedup. In production, the rate is effectively 0%.
- **doPost contract** is `{action: "computeItinerary", params: {...}}`. Flat payload returns `Invalid action`. First time the web-app endpoint was exercised externally (frontend uses `google.script.run` for v2.2 calls).

### Still pending
- **v3 disposition decision** (A: drop, B: opt-in beta only, C: pivot embeddings to a feature that moves the needle — editorial dedup at master ingestion, semantic search, agent-archive matching).
- **Stale 1,911-row `Embeddings_Sightseeing` tab on LIVE sheet** from the mis-pointed first run. Delete if v3 is dropped.
- **Diagnostic clutter** if v3 is closed: `diagWhichSpreadsheet`, `[v3 DEBUG]` Logger.log inside `applyV3SemanticDedup_`. Push-only, in deployment @20.
- **`run_field_test.py` header text** still says "Paris/Rome/Barcelona" after Paris-only stress patch (cosmetic).
- **`analyze_field_test.py` parser** walks `route[i].days[j].tours` but real shape is `route[i].tours` — TOURS PER CITY column always 0 (cosmetic, dedupLog itself is fine).

### Key decisions
- All v3 work in `clasp-dev/` only. `clasp-live/` untouched.
- `promote_to_live.sh` NOT run.
- Embeddings live on DEV sheet only.
- v3 dispatcher branch placed before v2.2 (explicit-version-wins ordering).
- `clasp-dev/` placed under git this session — first time the folder has version control.

### Stopped at
- Awaiting Sumit's v3 disposition decision (A / B / C). No further engine work until that's decided.


## Session — 2026-05-07 — Brief 4: Sheet ID + deployment hygiene + LIVE API_URL leak fix

**Outcome:** Customer signup/save/quote-log leak to DEV Sheet (open since 2026-05-06 19:17) is closed. Verified end-to-end by smoketest signup landing in LIVE Users, absent from DEV Users.

### What was changed
- **Phase 1 audit** (read-only): `AUDIT_2026-05-07.md`, `RECONCILE_2026-05-07.md`, `CLEANUP_2026-05-07.md`. Bucket A=0 (no LIVE-app→DEV-Sheet violations); Bucket F=0 (no 5th unknown Sheet ID); 9 `_OLD` (`1cdI1Gz…`) refs in active code; 2 LIVE HTML deployment-ID violations.
- **Bucket B routing (8 in-place SPREADSHEET_ID swaps + 1 file deletion):**
  - `cross_reference.py:24` + `build_city_intelligence.py:36` → LIVE
  - `test_intelligence.py:26` + `dev-appscript/{build_experience_ids,dump_experience_review,audit_remaining,build_tier_classification,cluster_experiences}.py` → DEV
  - `dev-appscript/build_city_intelligence.py` deleted (duplicate)
- **Cosmetic:** HTML header comments + `CLAUDE.md` DEV Sheet ID + `CLAUDE.md` DEV deploy ID corrected.
- **Bucket C — LIVE HTML API_URL fix:** initial promote (`b72e2d1`) hit `promote_to_live.sh` URL-detection bug — script's grep+sort+head heuristic captured a truncated 12-char comment fragment and silently sed-swapped a non-existent string in LIVE HTML. Fix-forward via direct sed (`8dd7e34`) corrected `index.html` and `index_fit.tripstore.html` L1471 to `LIVE_DEPLOY_ID` (`AKfycbwP9KQH…`).
- **clasp-live deployments:** `LIVE_DEPLOY_ID` @78 + `LIVE_BF_DEPLOY_ID` @79 ("promote 2026-05-07_1635"). Only functional `.gs` change: `ItineraryEngine.gs` gained `_v31DayClusters` helper from prior DEV work.
- **GitHub Pages:** `ce60846` (housekeeping) → `b72e2d1` (promote, leak still active) → `8dd7e34` (leak closed) on `v2`.
- **Smoke verified:** `smoketest_2026_05_07_brief4` registered 17:43:30 → row in LIVE Users (17 rows total), absent from DEV Users (16). Leak fully closed.

### Discoveries / lessons
- **`promote_to_live.sh` URL-detection heuristic is broken** (lines 113–128). `grep -oE 'AKfycb[A-Za-z0-9_-]+' | sort -u | head -1` truncates on `.` (HTML comment ellipsis like `prev pinned @5 AKfycbwRr9k5...)`); truncated fragments may sort alphabetically before the actual full URL. Fix sketch: anchor regex to `macros/s/AKfycb[A-Za-z0-9_-]+/exec`. **Severity: silent customer-visible failure.** Until fixed, every promote risks the same leak.
- **Pipeline.gs in `~/Desktop/Itinerary-Create/` is part of the pre-push validation chain** (read by `check_pipeline.py` GUARD 6). 4 orphan `.gs` files + 2 validator scripts in that folder are pre-clasp-split mirrors. Cleanup deferred to a session that audits all 6 together.
- **Bucket A=0 — Rule 2 already complies in clasp-live.** All `openById()` go to `LIVE_SHEET_ID`. `DEV_SHEET_ID` constant at L1745 is dead code. `_pipeline_map.md` rumour about `getSightseeingForCity`/`getIntelligenceForRoute`/`getSwissPassOptions` reading DEV Sheet was out of date.
- **`Sightseeing` migration (TRUTH.md UNRESOLVED BLOCKERS row 5) silently resolved.** LIVE's `Sightseeing_v2` tab no longer exists; legacy `Sightseeing` carries the 15-col schema (1655 rows). Pipeline.gs writes and Code.gs reads agree on `'Sightseeing'`. Mark blocker resolved in TRUTH.md.
- **2 unknown DEV-style deployment IDs found** but not load-bearing: `AKfycbz3dpvT…` (DEV HTML L6 stale comment) + `AKfycbwI0EK…` (was CLAUDE.md L38, now removed).

### Pending
1. **Sumit-manual:** delete `smoketest_2026_05_07_brief4` from LIVE Users; revoke service-account write on `_OLD` Sheet; confirm Drive rename to `_OLD_ARCHIVED_2026_05_07_DO_NOT_USE`.
2. `promote_to_live.sh` URL-regex patch + unit test (high priority — blocks safe future promotes).
3. Orphan cleanup session: 4 `.gs` + 2 validator scripts in `Itinerary-Create/`.
4. DEV deployment hygiene (`DEV_DEPLOY_ID` auth-required vs anonymous).
5. Cosmetic: stale `AKfycbz3dpvT…` line in DEV HTML; "DEV FILE" misleading header in LIVE HTML.

### Stopped at
- Brief 4 complete. Holding for next instruction.


## Session — 2026-05-07 evening — Brief 6 series: hygiene + tooling cleanup

**Outcome:** All 5 sub-briefs (6A→6E) landed cleanly. Customer impact: zero. Repo + tooling are in their cleanest state since the clasp split.

### Brief 6A — `promote_to_live.sh` URL-detection heuristic fixed
- L113-128 (broken `grep + sort + head` heuristic) replaced with hardened `extract_api_deploy_id()` helper: anchored to `^const API_URL =` line, requires deployment ID ≥40 chars after `AKfycb`, fail-loud on 0/2+ matches, post-swap verification.
- 4 dry-run tests passed (today's bug repro, no-op match, zero matches, two matches).
- Backup: `~/Desktop/tripstore-pipeline/promote_to_live.sh.backup_2026-05-07` (220 lines, original buggy version).
- Patched script: 261 lines, `bash -n` clean.

### Brief 6B — Apps Script deployments cull
- `~/Desktop/tripstore-pipeline/DEPLOYMENTS_AUDIT_2026-05-07.md` produced (13 deployment inventory + Sumit-side delete checklist).
- Sumit archived 7 deployments via Apps Script UI: 6 LIVE (`AKfycbyzjC… @14`, `AKfycbwsHh… @4`, `AKfycbyEKH… @43 "Phase 8 launch"`, `AKfycby8KK… @8 "Updated_31 Mar"`, `AKfycbz2zQ… @12`, `AKfycbxfFT… @3`) + 1 DEV (`AKfycbwRr9k5… @17 "Step 7 wallet column"`).
- 8th item (LIVE `AKfycbxtpC… @HEAD`) is un-archivable by Apps Script design — @HEAD entries are auto-generated and don't appear in Manage Deployments UI. Same for DEV's `AKfycbzFTBG… @HEAD` (`DEV_DEPLOY_ID`, intentionally KEPT).
- Final state: LIVE script 3 entries (un-archivable @HEAD + LIVE_DEPLOY_ID @78 + LIVE_BF_DEPLOY_ID @79); DEV script 2 entries (un-archivable @HEAD + DEV_PINNED_DEPLOY_ID @30).

### Brief 6C — `.deployment_ids` documents reality + `dev_push.sh` wrapper
- `.deployment_ids` rewritten with 4 entries (added `DEV_PINNED_DEPLOY_ID=AKfycbxrC4tULOl…` documenting what DEV HTML actually reads). Old `DEV_DEPLOY_ID` value preserved verbatim.
- New `~/Desktop/tripstore-pipeline/dev_push.sh` (53 lines, executable). Wraps `clasp push -f` + `clasp deploy --deploymentId DEV_PINNED_DEPLOY_ID`. Pre-push sanity check warns on DEV HTML drift; post-push HTML reminder.
- `~/Desktop/Itinerary-Create/CLAUDE.md` gained "## DEV deployment workflow" section. Same commit folded in 2 stale-CLAUDE.md fixes from Brief 4 (DEV Sheet ID + DEV API URL).
- Committed at `182b8c5` "docs: fix stale deployment ID + Sheet ID, add DEV deployment workflow". Pushed `8dd7e34..182b8c5`.
- Backup: `~/Desktop/tripstore-pipeline/.deployment_ids.backup_2026-05-07` (546 bytes).

### Brief 6D — 4 orphan `.gs` archived + validator rewired + Hotels.Meals schema drift caught
- Archived to `~/Desktop/Itinerary-Create/_archived_orphans_2026-05-07/`: Pipeline.gs (61 KB), Automation.gs (28 KB), Code.gs (35 KB), Quote_Intelligence.gs (29 KB).
- `check_pipeline.py` rewired to read canonical `clasp-live/` (Option α — single ROOT path swap + fail-loud check + Automation.gs graceful skip).
- **Caught real schema drift on first run.** clasp-live/Pipeline.gs HC.TOTAL=26, but `KNOWN_HEADERS['Hotels']` had 25 entries. Investigation: `'Meals'` column added at position 7 (between 'Room Type' and 'Jan'). One-line fix to validator. Sister tabs (SC/TC/XC) all aligned — only Hotels had drifted.
- Committed at `bbf002b` "cleanup: archive 4 orphan .gs files + update validator to clasp-live, fold SESSIONS.md update". Pushed `182b8c5..bbf002b`.
- Backup: `~/Desktop/Itinerary-Create/check_pipeline.py.backup_2026-05-07` (256 lines).

### Brief 6E — last 2 orphan `.gs` + 3 untracked artifacts cleaned up
- 2 more orphans archived: `Temp.gs` (3.4 KB, single-fn pre-clasp version), `Wallet.gs` (12 KB, pre-cap-removal stale).
- 3 untracked artifacts moved to `~/Desktop/notes/`: `CLAUDE_CODE_BRIEF_NewUI.md` (7 KB), `experience_id_review.md` (95 KB), `day_plans_lookup.json` (128 KB — canonical lives at `~/Desktop/tripstore-pipeline/dev-appscript/day_plans_lookup.json`).
- Committed at `c77ce2e` "cleanup: archive last 2 orphan .gs files + mv untracked notes/artifacts out of repo". Pushed `bbf002b..c77ce2e`.

### Discoveries / lessons
- **Apps Script @HEAD deployments are un-archivable by design.** They don't appear in the Manage Deployments UI; only `clasp deployments` shows them. Treat them as expected noise — they're auto-regenerated and not pinnable for customer URLs.
- **Validator silence is more dangerous than validator failure.** check_pipeline.py was passing for months by validating its own outdated companion file (Itinerary-Create/Pipeline.gs which co-evolved with the validator). Pointing it at canonical clasp-live caught the Hotels.Meals drift immediately. Lesson: a passing validator that validates a stale mirror is a placebo.
- **Brief 4's "deleting Pipeline.gs broke pre-push hook" incident had a deeper cause than identified.** The fix wasn't "restore Pipeline.gs"; it was "rewire the validator to read canonical code." Brief 6D handled the real fix.
- **promote_to_live.sh's URL-preservation logic was structurally fragile.** A grep regex stopping at `.` in HTML comments combined with alphabetical sort created a silent data-correctness failure (today's leak). The fix anchors the regex to the actual `const API_URL =` line and verifies the post-swap result. Generalisable: any text-extraction heuristic operating on free-form HTML/JS comments should be anchored to a known structural element, not just regex-matched anywhere in the file.

### Stopped at
- Brief 6 series complete. Bug #7 (date edit) and Bug #8 (GYG/Viator links) are next session targets — verification report already in hand from Brief 5A. Holding.


## Session — 2026-05-08 13:16–14:00 — Brief 1A: Coverage Dashboard → LIVE (HTML-only)

**Outcome:** Coverage Dashboard tab is no longer a placeholder. Live for ADMIN / MANAGER / DATA_MANAGER on fit.tripstoreholidays.com.

### What was built / changed
- **`dev/index_fit.tripstore.DEV.html`** — `tab-coverage` stub (6 lines, "Coverage Dashboard content coming in next session.") replaced with full content from `~/Desktop/tripstore-pipeline/coverage_dashboard.html`. File grew 392,908 → 829,434 bytes (8,063 lines).
- **`/tmp/inject_coverage.py`** — one-shot scoping script. Reads `coverage_dashboard.html`, renames all 17 `--xxx` CSS vars to `--cov-xxx` (defs + var() refs), prefixes every CSS selector with `.coverage-dash` ancestor (handles `:root`, `body`, `*`, comma-separated lists, nested `@media`/`@supports`; preserves `@keyframes`/`@font-face` unscoped per spec), wraps body in `<div class="coverage-dash">`. Output `/tmp/coverage_block.html` then `python3 -c` injection into DEV HTML.
- **3 manual JS scope patches** (post-injection): `document.querySelectorAll('.tab')` × 2 + `document.querySelectorAll('.view-pane')` × 1 → `.coverage-dash .tab/.view-pane`. Without these, `bindTabs()` would have hijacked the host's 7 unrelated `.tab` elements.

### Promotion
- `bash ~/Desktop/tripstore-pipeline/promote_to_live.sh` (auto-confirmed via `echo yes |`).
- All 7 `.gs` files reported **NO CHANGE** (HTML-only promote).
- LIVE Apps Script redeployed: `LIVE_DEPLOY_ID` @78→@82, `LIVE_BF_DEPLOY_ID` @79→@83 ("promote 2026-05-08_1341").
- HTML promote: DEV → `index_fit.tripstore.html` + mirrored to `index.html`. **New URL-preservation helper from Brief 6A worked correctly** — verified LIVE HTML still pinned at `AKfycbwP9KQH…` post-swap (the previous broken heuristic would have leaked DEV's deployment ID). Phase 8 hide-CSS re-injected automatically.
- Local commit `aa2fee7`. `git push origin v2` rejected — remote had `7645298` (daily auto-review bot) ahead. Stashed dirty SESSIONS.md (pre-existing Brief 6 edits), `git pull --rebase origin v2` → rebased commit `ae5b1c9`, push clean. Stash popped, SESSIONS.md back to dirty state for separate commit.
- All 6 pre-push guards green. fit.tripstoreholidays.com last-modified 08:14:17 GMT. `curl -s` confirms 120 markers (EMBEDDED_REPORT + .coverage-dash + --cov-cream).

### Verification
- 0 unprefixed `--xxx` declarations or `var(--xxx)` refs remain in coverage CSS post-rename.
- 0 unscoped top-level CSS selectors after the scoping pass.
- `id="tab-coverage"` count = 1; 13 dashboard IDs (meta-date, stats-grid, gaps-chart, priority-tbody, detail-panel, matrix-tbody, matrix-search, matrix-sort, all-search, all-cities-tbody, alert-title, alert-sub, meta-tours, lead-alert) all unique vs host.
- 4 `data-view` attrs all live in injected block. No host clash on `.tab` (host has 7 class instances but 0 CSS rules for `.tab`).
- LIVE smoke (Sumit, post-promote): ADMIN / MANAGER / DATA_MANAGER see Coverage tab and dashboard renders cleanly; AGENT does not. Other tabs continue working. No console errors.

### Discoveries / lessons
- **CSS-var rename approach is the safest scoping pattern when host shares variable names.** 3 actual clashes (`--cream`, `--ink`, `--red`) — host versions and coverage versions had different hex values, so unscoped vars would have silently shifted dashboard colours. Renaming all 17 to `--cov-*` is overkill defensively but cheap, and removes the question entirely.
- **Coverage dashboard is fully self-contained — no `fetch()`, no `API_URL`, no `google.script.run`.** Embedded `REPORT_DATA` snapshot dated 2026-05-03T17:03:58Z (4,541 tours, 114 cities). For "live" data the snapshot needs a regenerator script — out of scope for 1A.
- **`bindTabs()` wired event listeners on `document.querySelectorAll('.tab')` globally.** Host has 7 `.tab` elements (no styles, just classnames). Unscoped, every host `.tab` would have gained a listener that called `bindTabs`'s handler, blowing up on `t.dataset.view` being undefined. Caught + patched before injection landed.
- **The 6A URL-preservation fix paid off immediately on its second real promote.** Today's promote went through the new anchored-regex helper without drama; the previous (5/7) leak that took manual sed to fix would have re-fired here.

### Pending
- Bug #7 (date edit on loaded itinerary) + Bug #8 (GYG/Viator links not returned by `getSights`) — still next-up per Brief 5A.
- Coverage dashboard data freshness: build a regenerator script to refresh `EMBEDDED_REPORT` from current Sheet on a cadence (manual rerun is fine for now).
- Sumit-manual: delete `smoketest_2026_05_07_brief4` row from LIVE Users (long-pending from Brief 4); revoke service-account write on `_OLD` Sheet; re-protect LIVE Quote_Log + Saved_Itineraries with service-account whitelisted (long-pending from Step 3/5).
- The pre-existing dirty `SESSIONS.md` in `~/Desktop/Itinerary-Create/` (Brief 6 series session-end update from 2026-05-07 evening) was stashed during the rebase and restored — still uncommitted. Decide separately whether to commit that block forward.

### Backups
- `~/Desktop/Itinerary-Create/dev/index_fit.tripstore.DEV.html.pre_1A_131609.bak`
- `~/Desktop/tripstore-pipeline/clasp-live.backup_20260508_133937/`

### Stopped at
- Brief 1A complete and visible to ADMIN/MANAGER/DATA_MANAGER on fit.tripstoreholidays.com. Holding.


## Session — 2026-05-08 14:00–17:00 — Briefs 2A → 2C: tag taxonomy noise fixes + shared tagger + dashboard refresh

**Outcome:** All 5 noise issues fixed at code level. Live `Sightseeing` tab fully retagged (twice — first 1593 rows, then 626 deltas after taxonomy rebuild). Coverage Dashboard now serves a 2026-05-08 snapshot from a freshly rebuilt taxonomy. xlsx dependency in `12files/` is dead (gspread switch landed in both `coverage_auditor.py` and `build_tag_taxonomy.py`). Tagger logic deduplicated into a shared `tagger.py` module — three callers were carrying triplicate copies, now zero.

### What was built / changed in `12files/`
- **`tagger.py`** (new, 256 lines) — single source of truth for tagging. Carries Brief 2A Fixes 1-5, Brief 2B Option B suffix-strip, and Brief 2C `EXTRA_KEYWORDS` (escape-room, immersive, comedy-show, nightlife, simulator, sports-event, ski, adventure, cooking-class, gaming, adult-only, disney). Auto-merges EXTRA_KEYWORDS into taxonomy at `load_taxonomy()` time so they apply across all callers without rebuild.
- **`build_tag_taxonomy.py`** — apostrophe-collapse in `norm_name()`, foreign noise added to `GENERIC_TAG_TOKENS`, `_hr_to_tag` floor at 0.75h, `SUBSUMING_UNIGRAMS` set for landmark over-split. xlsx loader replaced with gspread reader over 5 source tabs + Day_Plans_Lookup. Old MASTER_XLSX constant removed.
- **`retag_sightseeing.py`** — refactored to import from `tagger.py` (320 → 131 lines).
- **`retag_live.py`** — refactored to import from `tagger.py` (332 → 178 lines). New file built earlier in 2B.
- **`coverage_auditor.py`** — refactored to import from `tagger.py`; xlsx loader replaced with gspread reader over `Sightseeing` + `DONE_Sightseeing` + `Day_Plans_Lookup`. Old MASTER_XLSX constant + openpyxl import removed.
- **`tag_taxonomy.json`** — rebuilt against LIVE (5 source tabs + Day_Plans_Lookup). Backup at `tag_taxonomy.json.pre_2A_152244.bak`.
- **`coverage_report.json` + `.md`** — regenerated 2026-05-08 10:53Z (2,920 tours / 111 cities / 130 audits).
- **Backups:** `build_tag_taxonomy.py.pre_2A_152244.bak` + `tag_taxonomy.json.pre_2A_152244.bak`.

### LIVE writes
- **Sheet `Sightseeing` col K (Attraction Tags):** two retag passes via `retag_live.py`.
  - First pass (Brief 2B, with old taxonomy + Option B): 1,593/1,605 rows updated, 0 errors.
  - Second pass (Brief 2C, after taxonomy rebuild + EXTRA_KEYWORDS merge): 626/1,605 rows updated, 0 errors.
- **HTML promote (Brief 2C Step 8):** `dev/index_fit.tripstore.DEV.html` + `coverage_dashboard.html` template received fresh `EMBEDDED_REPORT` (368 KB JSON inline). `bash promote_to_live.sh` ran clean. All 7 .gs NO CHANGE. LIVE Apps Script `LIVE_DEPLOY_ID` @82→@84, `LIVE_BF_DEPLOY_ID` @83→@85. Commit `be43215` on `v2`. fit.tripstoreholidays.com last-modified 2026-05-08 11:01:39 GMT.
- **End-to-end verified:** `curl -s` of LIVE URL returns dashboard with `tours_analyzed: 2920`, `cities_audited: 111`, `generated_at: 2026-05-08T10:53:41Z`.

### Discoveries / lessons
- **Triplicated tagger logic was a real maintainability landmine.** Brief 2A fixed `_hr_to_tag` and `detect_keyword_tags` in two of three places; coverage_auditor.py carried stale copies that would have re-emitted `1hr` artifacts and `-subject`/`-format`/`-mode` malformed tags on every audit run. Brief 2C unified them. New rule: any fix to tagger logic goes in `tagger.py` only.
- **`tag_to_keywords` had a long-standing prefix-as-suffix bug.** 12 keys like `subject:underground-subject`, `format:guided-tour-format`, `mode:hot-air-balloon-mode` were emitting tags with the dimension suffix baked in. Option B strip in `detect_keyword_tags` is a defensive fix at the consumer; the upstream key-constructor in `build_tag_taxonomy.py` still produces them. Patching the constructor too is a future cleanup item — the runtime stripping makes it cosmetic.
- **`legends-theme` looks like the bug above but isn't.** It's a legitimate Antalya attraction bigram from "Land of Legends Theme Park" tour names — it's an attraction-vocab entry, not a `theme:`-dimension keyword leak. Distinction matters when grepping for malformed tags.
- **`city` is leaking as a top-emitted tag.** Post-rebuild, `city` shows up 95× as the #1 attraction tag — coming from "Paris City Tour"-style names. Should be added to `STOPWORDS` in the next noise-fix pass; not blocking for current dashboard refresh.
- **27 cities have <5 attraction tags including 2 with junk in the City column** — `San Francisco: Muir Woods... | GetYourGuide` (tour name in city column) and `https://www.getyourguide.com/...` (URL in city column). Source-data hygiene issue; flag for sheet-side cleanup.
- **`Sightseeing_LEGACY` (2,114r) and `Copy of Sightseeing_v2` (2,329r) tabs surfaced** during Brief 2C tab audit — neither is in TRUTH.md or DECISIONS.md. Likely Drive housekeeping debt. Excluded from corpus per Decision B; logged as UNRESOLVED BLOCKERS rows 10 + 11 in TRUTH.md for future cleanup.
- **CDN propagation took ~30 sec** between push and `last-modified` flip for fit.tripstoreholidays.com (verified via `until ... do sleep` loop). Earlier briefs assumed up to 2-3 min — actual is much faster.

### Pending follow-ups
- Patch `build_tag_taxonomy.py`'s key constructor to stop emitting `dimension:tag-dimension` malformed keys.
- Add `city` and a few siblings to STOPWORDS in next noise-fix pass.
- Sheet-side cleanup: junk City-column values flagged in audit; Sumit-side decisions on `Sightseeing_LEGACY` and `Copy of Sightseeing_v2` (archive vs delete).
- Carryover from prior sessions: Bug #7 (date edit), Bug #8 (GYG/Viator links), v3.1 LIVE promotion, Anthropic API key rotation.

### Backups
- `~/Desktop/tripstore-pipeline/clasp-live.backup_20260508_163029/`
- `~/Desktop/tripstore-pipeline/12files/{build_tag_taxonomy.py,tag_taxonomy.json}.pre_2A_152244.bak`

### Stopped at
- Brief 2C series complete and live. Holding for next instruction.


## Session — 2026-05-08 evening → 2026-05-09 ~02:30 — Briefs 2I + 2J: V3.1 dedup overhaul

**Outcome:** Versailles-twice customer bug root-caused and fixed. Two-layer dedup now in place — per-city cluster lock (LIVE @92/@93) plus per-city canonical-landmark lock (DEV-only, held). T1 landmark repeats: 18/18 PASS on DEV harness, every customer-reported class of duplicate cleared.

### What was built / changed in `clasp-dev/ItineraryEngine.gs`

**Brief 2I (shipped to LIVE):**
- `_v31CityClusters(tourPicks, excludePickIdx, ctx)` — sibling to `_v31DayClusters`, walks all city picks (no day filter) to compute the set of cluster IDs already in use.
- Per-city cluster check added at 3 sites: picker cascade in `pickTours_byBucket` (uses existing `usedClusterCity[c][cid]` counter as lock), `tryAddTour` (cascade backfill), `tryTourUpgrade` (cascade upgrade — uses cityClustersExclCur to allow same-cluster swap of cur).
- `_v31ClusterIdOf` reordered to prefer `ctx.nameToCluster` lookup over `tour._clusterId`. The latter is set via `Master_Row_Index` from Sightseeing_Clusters tab — which turned out to be the row index in `Embeddings_Sightseeing` tab, NOT `Sightseeing` master tab → off-by-N → scrambled `_clusterId` values across tours. Name-keyed lookup is the source of truth.
- `getMasterClusters_v3` + `getNameToClusterMap_v3` accept either `Sightseeing_Clusters` (LIVE post-2F rename) or `Sightseeing_v2_Clusters` (DEV legacy from 2E B2). DEV testing now meaningful — previously the cluster map loaded empty on DEV because the engine looked only for the LIVE name.

**Brief 2J (DEV-only, NOT promoted):**
- New sheet tab `Canonical_Landmarks` (City | Keyword | Canonical_ID): 60 rows seeded across 17 cities. Multiple keywords can share a canonical (e.g. `parthenon` and `acropolis museum` both → `ATHENS_ACROPOLIS`).
- Engine helpers: `_loadCanonicalLandmarks_(ss)` (returns Map<city, [{keyword, canonicalId}]>), `_v31LandmarkLocked_(name, city, used, map)` (substring check; returns true if any keyword in name maps to a canonical already in `used[city]`), `_v31RecordLandmark_(name, city, used, map)` (mark all canonicals hit by this pick).
- Wired at same 3 sites as 2I. tryTourUpgrade rebuilds `usedCanonicals[c]` from current `tourPicks` after each successful swap (since cur is replaced by t — surgical removal of cur's contributions and addition of t's would be more efficient but error-prone).
- `pickTours_byBucket` returns `usedCanonicals` so orchestrator can seed `ctx.usedCanonicals` for the cascade pass. `landmarkMap` loaded once and threaded through.

### LIVE writes (during this session)
- `Canonical_Landmarks` tab created on LIVE Sheet `1U3f6Ph…` (60 rows, header + 59 data).
- LIVE Apps Script: `LIVE_DEPLOY_ID` @90→@92, `LIVE_BF_DEPLOY_ID` @91→@93 (Brief 2I + a dev push of 2J was made earlier as @94→@90 BF…). Per `clasp-live` is on @92/@93 (2I final). 2J in `clasp-dev` only — not promoted.
- DEV Apps Script (`1Mr-dMvu…`): pushed multiple times during 2I + 2J iteration (DEV @40 → @43 → newer 2J variants). Latest DEV deploy is the 2J build.

### Discoveries / lessons
- **Per-day cluster cap was a placebo on DEV for months.** The cluster tab had been renamed `Sightseeing_v2_Clusters → Sightseeing_Clusters` on LIVE during 2F but DEV's tab kept the legacy name. Engine code only looked for `Sightseeing_Clusters` → got empty map on DEV → all cluster checks silently no-op'd. Brief 2E B2 testing thought the cap was working; it was just not running. Tab-name fallback in 2I closes this loop.
- **`Master_Row_Index` is row-in-Embeddings_Sightseeing, not row-in-Sightseeing.** The `_bucket_compute_step1.py` script enumerates the Embeddings tab and writes that row number. The engine's `getMasterClusters_v3` treats it as offset into `sightsMaster` (which comes from `Sightseeing` tab). Two different orderings + different row counts → systematic mis-assignment of `_clusterId` to wrong master tours. Name-keyed fallback is the only correct path. Future: rebuild `_bucket_compute_step1.py` to write the correct master-tab row index, OR drop masterIdx entirely (downstream code can use name-keyed lookup).
- **The cluster system isn't always wrong about splits.** Athens Acropolis is genuinely split into 3 clusters (Athens_1 ticket-only, Athens_2 guided museum, Athens_3 private) because they're different products. Brief 2J handles this by making the editorial layer (`Canonical_Landmarks`) claim them all as ATHENS_ACROPOLIS regardless of cluster — shifting the dedup decision from data-driven to editorial.
- **Substring landmark detection is too greedy at the margins.** Disneyland Express Shuttle's name "...from Eiffel Tower Area Pickup" claims PARIS_EIFFEL canonical because it contains "eiffel". This blocks the real Eiffel Summit tour. Word-boundary matching with first-N-chars scope (subject vs descriptive text) would help. Held LIVE promote pending this decision.

### Backups
- `~/Desktop/tripstore-pipeline/clasp-dev/_backups/ItineraryEngine.gs.pre_2I_233004.bak`
- `~/Desktop/tripstore-pipeline/clasp-dev/_backups/ItineraryEngine.gs.pre_2J_003847.bak`
- `~/Desktop/tripstore-pipeline/clasp-live.backup_20260509_*` (from 2I promote)

### Pending
- **2J LIVE promote decision** — refine substring-match (b/c) or accept conservative-block (a). Currently the Disneyland Shuttle would consume PARIS_EIFFEL and block Eiffel Summit on Paris itineraries.
- **Master_Row_Index correction** — long-term fix in `_bucket_compute_step1.py`. Currently masked by name-keyed fallback so not blocking.
- **Sightseeing_v2_Clusters cleanup** — DEV has the legacy tab AND now also has Canonical_Landmarks. Eventually rename DEV's `Sightseeing_v2_Clusters` → `Sightseeing_Clusters` to match LIVE convention; remove the engine-side fallback.
- **Carry-overs:** Bug #7 (date edit on loaded itinerary), Bug #8 (GYG/Viator links not returned by getSights). Sumit-manual: smoketest_2026_05_07_brief4 row deletion from LIVE Users; service-account write revoke on _OLD Sheet; protect LIVE Quote_Log + Saved_Itineraries.

### Stopped at
- 2J built and verified on DEV. LIVE has 2I (@92/@93). Holding for substring-match decision.


## Session — 2026-05-09 (PM) — Briefs 2K + 2L: Canonical_ID population + (canonical, day_slot) dedup wired into v3.1

**Outcome:** Sightseeing master gained 4 new columns (P–S: Canonical_ID, Day_Slot, Duration, Tour_Type) populated for all 1,602 LIVE rows via a two-tier classifier (Claude API for landmarks, col-K tags for the rest). Engine-side, v3.1 picker gained a `(canonical_id, day_slot)` dedup gate (Brief 2L) wired at all 3 pick sites, pushed to DEV @47. DEV 60-city sweep dropped cross-cluster repeats 18 → 0 (target was <5). LIVE promote HELD on a Paris-luxury-7N regression (-7.8pp util).

### Brief 2K — populate Canonical_ID + 3 dimension cols (LIVE Sightseeing)
- New script `assign_canonical_ids.py` (two-tier): Claude API (`claude-sonnet-4-6`) for the ~17-city landmark set; col-K tag-stream fallback for the long tail. Writes col P (Canonical_ID), Q (Day_Slot), R (Duration), S (Tour_Type).
- 50-row spot check (v1, Claude-only): 0 errors, 24 distinct IDs — but weak tag-stream IDs flagged on follow-up audit. Held for v2 redesign.
- 50-row spot check (v2, two-tier): 0 errors, 0 `EXPERIENCE` placeholder, 0 duration leaks. Approved → full run.
- Full run: 1,602 rows written. Post-run normalization pass had a `_TOWER$` regex bug that incorrectly collapsed 7 non-Paris tower IDs (Belém, Pisa, etc.); rolled back and rerun cleanly.
- Final state on LIVE: col P populated with **1,163 distinct Canonical_IDs**, 0 `EXPERIENCE`, 0 duration leaks. Cols Q/R/S also populated.
- Old col S/T content (legacy junk) noted as housekeeping debt — separate pass.

### Brief 2L — wire (Canonical_ID, Day_Slot) dedup into v3.1 picker (DEV @47, HELD for LIVE)
- New per-quote tracker `usedCanonicalSlots[city][canonical|slot]`; engine helper `_v31CanonSlotLocked_` rejects if pair already claimed in same city.
- Wired at all 3 v3.1 pick sites (bucket cascade, `tryAddTour`, `tryTourUpgrade`). All gated on `ctx.bucketAware` so v2.2 byte-equivalent. tryTourUpgrade refresh rebuilds the tracker post-swap.
- Pushed to DEV via `dev_push.sh "Brief 2L"` → DEV pinned @47.
- **DEV 60-city sweep results (pre-2L LIVE vs post-2L DEV):**

| Metric | Pre-2L (LIVE) | Post-2L (DEV) |
|--------|---------------|---------------|
| Cities OK | 55/60 | 56/60 |
| Total tours picked | 380 | 351 |
| OLD keyword repeats | 4 | 0 |
| CAN repeats (canonical-only) | 21 | 3 |
| CAN+SLOT repeats | 18 | **0 ✓** |

- The 3 remaining CAN-only flags (Lisbon, Budapest, Chamonix) are same-canonical-different-day_slot pairs — exactly what 2L's design intentionally permits.
- 4 timeouts (Interlaken, Split, Gothenburg, Madeira) — Apps Script 60s ceiling, pre-existing, not 2L-caused.

- **Adversarial harness (3 routes, 76s wall):**

| Route | v2.2 util | v3.1+2L util | Δ tours | Verdict |
|-------|-----------|--------------|---------|---------|
| A — Paris 7N luxury ₹600K | 85.0% | 77.2% | +1 (+1 empty day) | v2.2 better (-7.8pp) |
| B — Berlin/Prague/Vienna 12N ₹350K | 99.7% | 99.3% | +8 | v3.1 better |
| C — Rome 5N budget ₹180K | 99.6% | 96.5% | +2 | v3.1 better |

### Discoveries / lessons
- The two-tier classifier (Claude for landmarks, tags for long tail) is the right shape: pure-Claude v1 had no anchor for non-landmark tours; pure-tag-stream had weak IDs. Two-tier passes both clean.
- Post-normalize regex `_TOWER$` was too broad — caught Belém / Pisa / Galata. Lesson: any global canonical normalizer must be tested against the full distinct-ID set before write, not after.
- B + C routes confirm 2L isn't blocking — it's letting the picker fill empty days the keyword-only system left open. A is the only single-city dense-luxury regression.

### Backups
- `~/Desktop/tripstore-pipeline/clasp-dev/ItineraryEngine.gs.pre_2L_*`
- `~/Desktop/tripstore-pipeline/12files/assign_canonical_ids.py.pre_v2_*` and `.pre_TOWER_rollback_*`
- LIVE Sightseeing col-P pre-write snapshot saved in `_2K_pre_write_backup_*.csv`

### Pending
- **2L LIVE promote HELD** pending Sumit decision on Paris 7N luxury regression. Three paths offered: (A) accept — 77.2% still above warning threshold, dedup win across 56 cities outweighs single-route 7-pt drop; (B) investigate — read `~/Desktop/Itinerary-Create/dev/V31_ADVERSARIAL_REPORT.md`, check whether 2L is double-blocking what 2I/2J already caught and reorder gates; (C) soften — make 2L non-blocking when other dedup gates already filtered.
- User picked **(B) investigate** at session end. Specific questions queued: which Paris slots went empty post-2L; what Canonical_IDs the gate rejected; whether 2I/2J already covered those rejections; how many unique Canonical_IDs Paris has in the master (capacity check).
- 2J substring-match aggression decision still pending from prior session.

### Stopped at
- DEV pinned @47 with 2L wired. LIVE still on 2I (@92/@93). User chose Option B; investigation queued before any LIVE promote of 2L.


## Session — 2026-05-10 → 2026-05-11 02:30 — Briefs 2M + 2N: diversity sort, pass-2 upgrader, UC1-vs-UC2 proof, v4 engine on DEV

**Outcome:** Diversity gap quantified across 5 cities (12-27% category coverage). Brief 2M Part 1 (cluster-diversity sort) shown to be a no-op against 2I and dropped. Brief 2M Part 2 (pass-2 upgrader) wired, debugged through two placement bugs, and run on a 60-city DEV matrix. UC1 algorithm (from `test_optimizer_intel.html runUltimate()` in Itinerary-Create) ran head-to-head vs current UC2 and won 14/14 with +20pp mean util. Brief 2N implemented user's 3-step spec end-to-end as a new engine variant — v4-premium and v4-balanced — pushed to DEV @54 with HTML radios wired. No LIVE promotes this session.

### Diversity gap diagnostic (Paris / Budapest / Barcelona / Rome / Amsterdam, 4N each)

| City | Master tours | Categories in master | Picked | Categories covered | Missed | Coverage |
|------|--------------|----------------------|--------|--------------------|--------|----------|
| Paris | 45 | 33 | 4 | 4 | 29 | 12% |
| Budapest | 53 | 37 | 9 | 9 | 28 | 24% |
| Barcelona | 51 | 37 | 10 | 10 | 27 | 27% |
| Rome | 58 | 46 | 9 | 9 | 37 | 20% |
| Amsterdam | 52 | 38 | 10 | 9 | 29 | 24% |

Long-tail experiences are invisible. Even cities filling 9-10 slots cover only ~25% of available categories. Caveats: 4N quote has only ~11 slot capacity (~33% theoretical max), some "categories" are noise tags (`service`, `cart`, `access` → tag taxonomy cleanup is a precondition).

### Brief 2M Part 1 — diversity-first cluster sort (DROPPED)

- Sort change at `pickTours_byBucket` L4267: cluster ordering by (1) uncovered first, (2) Day Plans preferred among equal-coverage, (3) round-robin within bucket.
- Pre-edit DEV baseline (Paris 4N): 11 picks / 11 categories / 85.49% util.
- Post-edit: byte-identical picks. **Part 1 is a no-op** — Brief 2I's per-city cluster lock (L4291) already enforces 1 pick per cluster per city, so picks are already maximally cluster-diverse. The gap is at finer dimensions (canonical_id / primary_tag) and at slot capacity, not at cluster granularity.
- Reverted L4267 to the original 4-line round-robin sort. Brief updated to document Part 1 as dropped.

### Brief 2M Part 2 — pass-2 upgrader (wired, ran, then revealed picker-no-op problem)

- New constants `V31_PASS2_*` and functions `_v31Pass2_*` added; wired into `computeItinerary_v31` between picker and cascade_v22.
- First push: `pass2Log: []` for every city. Diagnostic `skip` traces added.
- Second push: every city reports `skip: "no_picks"` — `state.tourPicks[city]` is empty when pass-2 runs. **Finding: `pickTours_byBucket` is effectively a no-op in DEV; cascade_v22 does ALL the picking.** Pass-2 was running before the actual picks existed.
- Third push: pass-2 moved to run AFTER cascade_v22. Re-ran 60-city DEV matrix with pass-2 active and `utilBefore`/`spentBefore` exposed in `pass2Log`.
- DEV matrix completed (60 cities, exit 0). Numbers captured in `_ab_matrix_dev_pass2.log` / `_ab_matrix_dev_raw/`.

### UC1 vs UC2 head-to-head — UC1 wins 14/14

- Ported `runUltimate()` JS algorithm (`~/Desktop/Itinerary-Create/test_optimizer_intel.html` L555-710) into a Python harness `_uc1_vs_uc2.py`.
- Matrix: 14 cities × `runUltimate()` (UC1) vs current engine (UC2).
- **UC1 wins 14/14. +20pp mean util. 10/14 cities >80%.**
- User verdict: "Data is proven. UC1 wins 14/14." → became the basis for Brief 2N's 3-step spec.

### 3-step spec iteration (Python-side validation before engine port)

Multiple smoke runs (`/tmp/spec_test_v2.py`, `/tmp/final_25_test.py`, `/tmp/spec_abc.py`) testing user's spec:
- Step 1: Day Plans freq-DESC + fuzzy match with JUNK_TAGS filter (`service, access, full, cart, ...`).
- Step 2: fill remaining slots with diversity (3 sort variants tested: A=rating-DESC, B=canonical-only diversity, C=price-DESC, then later D=rank-hybrid).
- Step 3: if city-util <80%, upgrade pass.
- Cap-policy decision (fairness): UC2 results where util>95% (cap fired) re-scored as automatic SPEC win, since UC2 only "won" by overspending its city sight budget.
- Final 25-city matrix (cap-respecting): 5/8 cities cross 80% on spec. Vienna canonical-fallback edge case noted (canonical_id empty for long tail → diversity signal disappears).
- A/B/D head-to-head on 25 cities settled the Step 2 sort: rank-hybrid (D) and price-DESC (C) both viable — productised as v4-balanced and v4-premium.

### Brief 2N — v4 engine wired into DEV (HELD, no LIVE promote)

**Engine (`clasp-dev/ItineraryEngine.gs`, ~330 new lines):**
- New constants for v4 spec (JUNK_TAGS, primary-tag helper, fuzzy match threshold).
- 3 new step functions (`_v4Step1_dayPlansFuzzy_`, `_v4Step2_diversity_`, `_v4Step3_upgrade_`).
- New orchestrator `computeItinerary_v4(params, step2Mode)` accepting `'price'` or `'rank_hybrid'`.
- Dispatcher branches added: `algo === 'v4-premium' | 'v4_premium' | 'v4premium'` → `computeItinerary_v4(params, 'price')`; `'v4-balanced' | 'v4_balanced' | 'v4balanced'` → `computeItinerary_v4(params, 'rank_hybrid')`.
- v3.1 / v3-beta-semantic / v2.2 / v1 untouched (additive change).

**DEV HTML (`Itinerary-Create/dev/index_fit.tripstore.DEV.html`):**
- 2 new algorithm radios: `algoV4Premium` (`v4-premium`), `algoV4Balanced` (`v4-balanced`). NEW badge styling matches v3.1 row.
- `DOMContentLoaded` restore-from-localStorage updated to recognise v4-premium / v4-balanced.

**DEV deploy:**
- `bash dev_push.sh "Brief 2N v4-premium + v4-balanced (3-step spec)"` → DEV pinned deploy advanced to `@54` (deployment ID `AKfycbxrC4tULOlFLPvTIDt8HpJtmsiuueF2gurUxaoaiHQzns_fxeLyMoKP2WZrt6OhalWkPQ`).

**Smoke (3 cities × 2 modes, 4N, budgetPerPerson=700K × 2 pax, city-budget=₹362,851):**

| City | Algo | Tours | Trip-Util | S1 | S2 | S3 | Cats | City-Util |
|------|------|-------|-----------|----|----|----|------|-----------|
| Paris | v4-premium | 11 | 62.5% | 4 | 8 | 0 | 10 | 83.7% |
| Paris | v4-balanced | 11 | 62.0% | 4 | 8 | 0 | 10 | 77.5% |
| Amsterdam | v4-premium | 12 | 68.4% | 4 | 9 | 0 | 10 | 76.9% |
| Amsterdam | v4-balanced | 15 | 69.3% | 4 | 11 | 0 | 13 | 78.5% |
| Madrid | v4-premium | 8 | 55.7% | 3 | 5 | 0 | 8 | 38.5% |
| Madrid | v4-balanced | 10 | 52.5% | 3 | 7 | 0 | 10 | 27.6% |

**Verified:**
- Both algorithms route correctly (response `algorithm` field matches).
- `v4Log` populates with per-city S1/S2/S3 counts, budget, util.
- S1 (Day Plans fuzzy) firing — 4 picks/day in Paris+Amsterdam, 3 in Madrid.
- S2 firing differently per variant — Amsterdam balanced 11 vs premium 9 (matches Python validation).
- S3 = 0 every city — city-util ≥80% trigger met, by design.
- HTML radios surface in the algo row.

**Trip-util gap explained:** v4 trip-util 62-68% vs v3.1's typical 80-85% because v4 has no cascade_v22 — it strictly respects the city sight cap. v3.1's cascade was effectively leaking the cap by spending global residual on more sights. Cap-fairness behaviour we discussed lands here as "lower-but-honest" util.

**Madrid v4-balanced anomaly:** 10 picks but only 27.6% city-util — implies sub-₹10K average tour price under rank-hybrid sort. Premium got 38.5% with only 8 picks. Worth eyeballing the Madrid pick mix.

### Backups (this session)

- `~/Desktop/tripstore-pipeline/clasp-dev/ItineraryEngine.gs.pre_2N_20260510_224345`
- `~/Desktop/Itinerary-Create/dev/index_fit.tripstore.DEV.pre_2N_20260510_224345.html`
- Brief 2M intermediate backups via `dev_push.sh` (4 DEV deploys during 2M iteration).

### Pending

- **2N LIVE promote decision** — held pending Sumit review. Open questions: (a) is "lower-but-honest" trip-util acceptable, or does v4 need a residual-redistribution pass (a v4 cascade) for trip-util parity with v3.1; (b) investigate Madrid v4-balanced 27.6% city-util anomaly; (c) eyeball Paris pick mix for sanity.
- **Picker (`pickTours_byBucket`) is effectively a no-op on DEV** — cascade_v22 does all picking. This is a systemic finding from 2M Part 2 diagnostics, not specific to one city. Not blocking v4 (v4 doesn't use cascade_v22) but worth a deliberate audit of v3.1's intended picker behaviour.
- Tag taxonomy junk-word cleanup (`service`, `access`, `cart`, `full`, etc.) as precondition for any tag-axis diversity work — surfaced multiple times across this session.
- 2J (canonical-landmark substring-match aggression) still pending from prior session.
- Carry-overs unchanged: Bug #7 (date edit), Bug #8 (GYG/Viator links), Anthropic key rotation, GitHub PAT rotation.

### Where we stopped

DEV pinned @54 serving v4-premium + v4-balanced. DEV HTML has the radios. DEV vs LIVE drift on `ItineraryEngine.gs` is expected and intentional — 2N is held, awaiting your review before any promote.

---

## 2026-05-11 — Brief 2N + 2O LIVE promote + post-promote v4 fixes + 2O Pass B redesign

### Context

Brief 2N (v4 algorithms) and Brief 2O (unspent redistribution) had been built on DEV in the prior session, held pending review. Today: shipped both to LIVE, then surfaced four bugs in post-promote testing and built fixes through three additional DEV cycles. Final state: LIVE running v4 with three patches; DEV has additional 2O Pass B / Step 1 fallback held pending sign-off on a Zaanse Schans diagnosis.

### Sequence

**1. Initial LIVE promote (Brief 2M + 2N + 2O original):**
- Sightseeing tab schema audit: LIVE 19 cols, DEV 11 cols (Canonical_ID/Day_Slot/Tour_Type/etc absent on DEV). DEV smoke ran with dedup degraded.
- Mirror LIVE Sightseeing → DEV attempted, blocked by tab-level protection on Google Sheets — DEV backup saved at `_backups/DEV_Sightseeing_pre_mirror_20260511_141331.csv`, no DEV writes made.
- `promote_to_live.sh` confirmed diff direction is DEV → LIVE (script does `diff "$dev_file" "$live_file"` → `<` = DEV, `>` = LIVE). DEV had 680 lines of BRIEF 2M that LIVE didn't → promote ADDS, no destructive drift.
- `yes yes |` piped to handle the literal "yes" confirmation prompt (plain `yes` outputs single `y`, doesn't match).
- Promoted LIVE @98 / LIVE_BF @99 — Brief 2M + 2N v4-premium/balanced + 2O.

**2. Step 1 canonical-dedup bug found:**
- User flagged two Disneyland-canonical tours appearing in the same LIVE quote.
- Investigation: `fillDaysFromIntelligence_v4` (line 2050) WRITES `used.canonicals[match.canonical] = 1` after picking but NEVER reads it before. Only Step 2 and Step 3 check canonical dedup. So Step 1 + day_plans could double-pick same-canonical variants.
- Fix: one line at line 2041 — `if (match.canonical && used.canonicals[match.canonical]) continue;` after `if (!match) continue;`.
- DEV smoke (Paris 5N, 7N v4-premium + v4-balanced) all showed 1 Disney/trip post-fix. DEV can't prove the FIX itself because DEV has no canonical_id values, but no-crash + correct shape verified.
- Promoted LIVE @100 / LIVE_BF @101.

**3. v4 util audit on three logged quotes (Q-96078393/Q-96777163/Q-97291946):**
- All Paris+Amsterdam 9-10N quotes, 2pax, ₹800K budget. All showed ~78% trip util. Hotel/transfer/rail near-identical across v4 vs v4-premium vs v4-balanced. Sightseeing ±₹2.5K spread.
- Quote_Log schema (32 cols) has no per-tour breakdown column, no algorithm field — only summary totals + Pax Name string carrying the algorithm label.

**4. Root cause of low v4 util — multi-step diagnosis:**
- a. v4 reads ALL 8 LIVE-only Sightseeing columns (canonical_id, day_slot, tour_type, experience_id, etc) via `getSights` (Code.gs line 305) and uses them across the engine (30+ hits).
- b. DEV Sightseeing is content-drifted (only 41% row overlap with LIVE) AND schema-drifted (no canonicals). Mirror blocked by protection. DEV smokes therefore measured v4 with dedup running through the name-prefix fallback path, not the experience_id path.
- c. On the engine itself: Step 2 (`fillDifferentExperiences_v4`) had a hard `if (!t.canonical) continue;` gate that skipped every non-canonical tour. On LIVE (canonicals populated) Step 2 still skipped tours with empty canonical_id rows; on DEV (canonicals all empty) Step 2 skipped EVERYTHING. Pre-fix: Step 2 picked 1 tour/city. Post-fix: 2 tours/city.
- d. Arrival days were over the intended 4h cap — Paris Day 0 was 4.5h (Cruise 1h + Versailles 1.5h + Golf Cart 2h). v4 had a single 10h `V4_DAY_HOURS_CAP` for all days; no special-case for Day 0.

**5. Fix 1 (arrival 4h cap) + Fix 2 (canonical gate loosening):**
- Fix 1: `var dayHoursCap = (d === 0) ? 4 : V4_DAY_HOURS_CAP;` added inside both `fillDaysFromIntelligence_v4` and `fillDifferentExperiences_v4` day loops. Per-city Day 0 = 4h max.
- Fix 2: `if (!t.canonical) continue;` → `if (t.canonical && used.canonicals[t.canonical]) continue;` in Step 2.
- DEV smoke Paris+Amsterdam 9N v4-premium post-fix: trip util 77.73% → 77.86% (small), Paris Day 0 4.5h → 4.0h, Step 2 picks 1 → 3 per city. Paris Day 3 still empty (budget exhausted at 94% sight cap).
- Promoted LIVE @102 / LIVE_BF @103.

**6. 78% ceiling diagnosis — `cascade_v22` analog missing from v4:**
- Grep'd `cascade_v22` usage: called from v2.2 + v3.1 paths (lines 3298, 4499, 5254). v4 has no equivalent. Line 2396 comment: *"v4 has no cascade_v22 — Step 3 is the spec's own upgrade pass."*
- Step 3 (`cascadeUpgrade_v4`) only does per-city same-canonical upsell, gated on `util < 80%`. Trip-level residual sits on the table.
- 2O original was supposed to be the v4 analog but only consumed unspent SIGHT (~₹2K, since sight is saturated). Real trip residual is ~₹155K, untouched.

**7. 2O retarget + Pass B insertion (DEV only):**
- Change 1: replaced `for each city, sum unspent sight` with `var totalUnspent = state.netBudget - totalSpent(state);`. Now sees real residual.
- Change 2 (Pass B): new pass inserted between transfer-upgrade and hotel-upgrade. For each city, for each day with hours remaining, picks from city pool (sorted price DESC, deduped by name + canonical, 4h cap on Day 0, junk-tag filter). Uses residual budget directly. Source tagged `v4_2O_passB`.
- Change 3 (Step 1 fallback): inside `fillDaysFromIntelligence_v4`, when day_plans walk produces no pick for a day, fall back to highest-rated unused tour from master pool. Source tagged `v4_s1_fallback`.

**8. DEV smoke Paris+Amsterdam 9N v4-premium post-retarget+PassB:**
- Trip util **77.86% → 99.86%**.
- Pass B added 5 tours, ₹127,476 spent:
  - Paris Day 1: Moulin Rouge Cabaret (₹37,700)
  - Paris Day 3: Golf Cart Tours (₹30,480) — Day 3 was previously empty
  - Paris Day 4: Lunch Cruise (₹29,932)
  - Paris Day 1: Seine River Dinner Cruise (₹25,500)
  - Amsterdam Day 1: Art Zoo Museum (₹3,864)
- Transfer (Pass A): 2 upgrades (Paris arrival + Amsterdam departure both Economy→Executive Sedan, ₹26,689 total).
- Hotel (Pass C): 0 upgrades — Pass B consumed nearly all residual, only ₹961 left.
- Side note: Amsterdam hotel came back 4★ NH Caransa ₹130K on this run vs 5★ NH Collection Barbizon Palace ₹158K on prior run — same params. `pickHotels_v2` has non-determinism (or input-sensitivity beyond what's captured in params).

**9. Zaanse Schans diagnosis (in progress, not closed):**
- User noted top-booked Amsterdam tour (Zaanse Schans) missing from picks.
- Master sheet has 4 Zaanse variants (₹4,350 - ₹52,661), all canonical-tagged.
- Day_Plans_Lookup has 14 Zaanse entries for Amsterdam (freq=7 for top entry on N=3 and N=5).
- For 4N Amsterdam Day 2, rank-1 day_plans entry is "From Amsterdam: Zaanse Schans, Volendam, and Marken Day Trip - All Inclusive" — the master row is the same name MINUS " - All Inclusive". Fuzzy match likely rejecting due to suffix delta.
- Open: pull master Duration values + V4_JUNK_TAGS contents to confirm fuzzy-match is the cause vs duration/tag rejection.

### Promoted to LIVE (today)
- @98/@99: BRIEF 2M (v3.1 pass-2) + Brief 2N (v4-premium, v4-balanced) + Brief 2O (sight-only)
- @100/@101: Step 1 canonical dedup fix
- @102/@103: Fix 1 (arrival 4h cap) + Fix 2 (canonical gate loosening)

### NOT promoted (DEV @58, held)
- 2O retarget (sight → trip residual)
- 2O Pass B (residual → day-fill tour adds)
- Step 1 master-pool fallback

### Backups (this session)
- DEV engine: pre_2O_131221, pre_step1canonfix_154243, pre_fix2canongate_172720, pre_fix1arrivalcap_*, pre_2Otripresidual_181932, pre_2OpassB_*
- LIVE engine: clasp-live.backup_20260511_{151136, 160542, 173715}
- DEV Sightseeing CSV: _backups/DEV_Sightseeing_pre_mirror_20260511_141331.csv

### Where we stopped
LIVE @102/@103 serving v3.1 (default) + v4-premium + v4-balanced with Step 1 canonical fix + Fix 1 + Fix 2. DEV pinned @58 holding 2O retarget + Pass B + Step 1 fallback. Last DEV smoke (Paris+Amsterdam 9N v4-premium) shows 99.86% trip util with all days filled. Zaanse Schans diagnosis pending duration + junk-tags dump before deciding on a fuzzy-match adjustment.

### Pending
- Zaanse Schans pick failure root cause (suspected fuzzy-match suffix rejection)
- `pickHotels_v2` non-determinism on identical params
- Promote DEV @58 (2O retarget + Pass B + Step 1 fallback) once Zaanse pinned down
- DEV Sightseeing tab unprotect + mirror — currently DEV smoke is structurally degraded
- Quote_Log: add `algorithm` + per-tour JSON cols for future auditability
- Carry-overs: Bug #7 (date edit), Bug #8 (GYG/Viator links), Anthropic key rotation, GitHub PAT rotation, Madrid v4-balanced 27.6% city-util anomaly
