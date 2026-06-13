---
name: tripstore-pipeline
description: TripStore nightly data-enrichment automation (Google Apps Script pipeline that grows live cities and fills inventory). Use this skill whenever working on the coverage feeder, the midnight enrichment chain, the gap scanner, city auto-flip, Coverage_Targets, the Claude-API enrichment calls, ROE values, OAuth scopes for triggers, or any Pipeline.gs / Automation.gs work. It locks the Part A and Part B trigger split (the 6-minute ceiling), header-driven feeder column mapping, the Claude-API JSON-truncation trim, the falsy-zero parse guard, the Sightseeing Rule 9 gate, backend-only promote, and the hard rule to never use the Claude API for work that can be done by uploading a file to this chat. Consult before touching any nightly or enrichment automation.
---

# TripStore — Enrichment Pipeline

The machine that grows live cities (target 67→100) and fills missing inventory. Runs nightly in Apps Script. All sheet writes follow `tripstore-sheets`.

## VOLATILE — read first
TRUTH.md / DECISIONS.md for current live-city count, LIVE @version, and pending pipeline items. Code: `Pipeline.gs`, `Automation.gs` (LIVE). Python helpers: `~/Desktop/tripstore-pipeline/12files/` (`tagger.py`, `retag_live.py`, `assign_canonical_ids.py`, `coverage_auditor.py`).

## THE MIDNIGHT CHAIN (split for the 6-min ceiling)
Apps Script kills any single execution at ~6 minutes. The chain is TWO triggers, never one:
- **`runMidnightPipelinePartA` @00:00 IST** — Steps 1–4: Coverage Feeder → Enrichment → Tagger → Canonical IDs.
- **`runMidnightPipelinePartB` @01:30 IST** — Steps 5–9: Whitelist Refresh → AutoFlip → Gap Scanner → Coverage Targets sync → summary Email → Archive.
- Triggers run @HEAD — a backend-only change needs `clasp push` but NO `clasp deploy` (pinned IDs only govern the customer `/exec`). New `/exec` routes DO need deploy.

## COVERAGE FEEDER (`runCoverageFeeder`)
- Processes **5 cities/run**, calls Claude Sonnet to generate real hotel / tour / train / transfer rows, appends PENDING rows to INPUT_Hotels / INPUT_Sightseeing / INPUT_Trains / INPUT_Transfers.
- **Dedup against BOTH the INPUT tab AND the master** (transfers bug: only checking INPUT let dupes through).
- **Header-driven column map (`_feederColMap_`)** — never hardcode indices; a hardcoded-index run wrote rows to the wrong columns.
- `pickTargetCities` scores non-live whitelist cities by demand (City_Intelligence pairings + Quote_Log), writes ranked `Coverage_Targets`. **Preserve `FEED_DONE` for gap=0 cities** — don't overwrite all statuses to `PENDING_FEED` each run (it made the feeder repeat the same cities).

## GAP SCANNER (`runLiveCityTourGapScanner`)
Scans **Live=Y cities only** (feeder seeds non-live). "Thin" = `< 2` tours in a category. Writes `gap_scanner_v1` PENDING rows to INPUT_Sightseeing. `MAX_GAPS_PER_RUN = 20` keeps it under the ceiling; remainder defers. Wired as Part B Step 6.5 + a manual menu item.

## AUTO-FLIP (`autoFlipReadyCities`)
Flips a whitelist city `Live=Y` when its gaps clear. **The falsy-zero bug:** `parseInt('0') || -1 === -1` blocked gap=0 cities from flipping. Always `var x = parseInt(val,10); if (isNaN(x)) x = sentinel;`. This is the locked numeric-parse rule everywhere a 0 is legal.

## CLAUDE-API ENRICHMENT CALLS
- **JSON truncation trim:** the model sometimes adds prose after the closing bracket → parse fails. Trim with `lastIndexOf` of the closing bracket before `JSON.parse` (fix applied at ~6 call sites).
- **Dedup BEFORE every API call** (in JS, before the request fires) — never pay for or pollute with dupes.
- `ANTHROPIC_API_KEY` lives in Script Properties (was once missing entirely → silent failures).
- Transfer rows with economy price = 0 are **ACCEPTED** now (team fills prices manually); don't re-add a price>0 gate.

## SIGHTSEEING RULE 9 GATE
Per `SIGHTSEEING_ENRICHMENT_RULEBOOK.md`: validate Canonical_ID format, Is_Combo ∈ {YES,NO}, Attraction_1 validity, non-blank tags before a row enters the master. `CANONICAL_NOT_IN_RANK` is deferred until Canonical_Rank is fully populated. Feeder-generated rows must carry canonical_id / is_combo / attraction_1 to pass.

## TRIGGER LANDMINES
- **OAuth scope expansion silently breaks triggers** (100% error since a scope change) until manually re-authorised. Keep `appsscript.json` scopes correct (`script.scriptapp`, `gmail.send`, sheets, etc.) and re-auth after any scope edit.
- **Never `SpreadsheetApp.getUi()` in trigger code** — it throws/hangs in no-UI context. Use `Logger.log`.
- `_archiveAndClear` must pad/trim rows to `col.TOTAL` or it crashes on length mismatch.

## THE HARD RULE — DO NOT BURN CLAUDE API ON WORK THIS CHAT CAN DO
Never use the Claude API (anthropic python client, overnight_classify-style scripts) for classification, enrichment, scoring, or analysis that can be done by **uploading the file to this chat**. API scripts are ONLY for unattended automation that must write to sheets/disk with no human present. Before proposing an API run, check `/tmp/`, `~/Desktop/TripStore/intelligence/csv_output/`, and session summaries — the result is often already saved.

## ROE NOTE
Enrichment ROE (e.g. EUR≈115, USD≈96) is set in multiple Pipeline.gs prompt locations and is **distinct from the engine's ₹110/€1 budget math**. Verify the current value in code before changing; update all locations together.

## INPUT_* QUEUE TRIAGE (the ingestion side)
The `INPUT_Hotels / INPUT_Sightseeing / INPUT_Trains / INPUT_Transfers` tabs are ingestion queues; rows carry a `Pipeline_Status` the handlers key on: `PENDING` (awaiting enrichment) → `PROCESSED` (written to master, leave alone) / `DUPLICATE` (already in master) / `ERROR` (failed) / **blank** (pipeline may not handle that tab — investigate, INPUT_Transfers often blank). Current backlog counts are state → read TRUTH.md / the sheet, never a past snapshot.
- **ERROR triage:** read the row + its error message → fix inline (blank From/To, missing price, city-not-in-whitelist) or delete if junk → `resetErrorRows()` flips ERROR→PENDING → re-run enrichment. **Never mass-delete ERROR rows** (agent-submitted data; fix-and-retry).
- **Reprocessing is editor-bound, not a web route.** `resetErrorRows()` and the legacy `runMidnightEnrichment()` (the old single-trigger handler, preserved for manual reprocessing — the nightly chain is now the Part A/Part B split above) run from the Apps Script editor, NOT via POST.
- **Python feed path** (cwd `~/Desktop/tripstore-pipeline/`): `extract_archive.py` → `clean_pipeline_data.py` → `write_inputs_to_sheets.py` (appends `PENDING`) → `cross_reference.py`. Python only *queues*; Apps Script enrichment moves rows to the master.
- **Archive-gap rows:** append to INPUT_Sightseeing with `Pipeline_Status=PENDING`, `Added_By='archive_gap_*'`, URLs blank for ops to enrich. **Don't pre-filter on ops' behalf** — submit all candidates, document what you added. Never write archive-gap rows straight to `Sightseeing` (bypasses price/dedup/canonical_id/duration enrichment).

## COVERAGE DASHBOARD REGEN (self-contained snapshot)
The admin/manager/data_manager Coverage Dashboard is **self-contained — no fetch/API_URL**; the whole report is an inline `EMBEDDED_REPORT` constant (~hundreds of KB) in the app HTML. Refresh = re-inject fresh JSON + promote.
1. `python3 12files/coverage_auditor.py` (cwd `tripstore-pipeline/`) reads LIVE (`Sightseeing` + `DONE_Sightseeing` + `Day_Plans_Lookup`; **excludes** `Sightseeing_LEGACY` and `Copy of Sightseeing_v2`) → writes `12files/coverage_report.json` (+`.md`).
2. Inject the JSON as the `EMBEDDED_REPORT` object literal. **Current target is `dev/app/index.html`** (the constant moved here with the 2026-05-16 landing split — the old `dev/index_fit.tripstore.DEV.html` is retired; verify the live file before editing). `regenerate_dashboard.py` automates the swap.
3. **Scoping is load-bearing:** dashboard CSS/JS is scoped under `.coverage-dash` (vars are `--cov-*`, selectors are `.coverage-dash .tab`). A hand-edit must change **only the JSON literal** — never rename `--cov-*`→`--cream/--ink/--red` (real hex clashes) or drop the `.coverage-dash` selector ancestor (host has unrelated `.tab` elements; `bindTabs()` will hijack them and throw).
4. Promote HTML per `tripstore-promote` (manual surgical — **not** `promote_to_live.sh`). Verify on LIVE: `curl` the live URL, parse `EMBEDDED_REPORT`, confirm `generated_at` matches your run (else CDN lag — wait/re-check). It's a manual-cadence snapshot; no scheduled job.
