---
name: tripstore-day-plans-rebuild
description: Use when rebuilding the TripStore Day_Plans_Lookup / Day_Plans_Fallback / Day_Plans_Match_Index tabs on the LIVE Sheet from city_tour_patterns.csv. Triggers on "rebuild day plans", "rebuild match index", "fuzzy match day plans", "rebuild_day_plans_with_match", or any work that touches the day-plan intelligence layer. Critical preconditions apply — running the rebuild on un-cleaned source CSV produces a sub-75% match rate and trashes the hand-curated manual_city_remap rows.
---

# TripStore: Day_Plans Rebuild

## Why this exists

`Day_Plans_Match_Index` is the engine's primary path for picking Step 1 tours in v4 (and a runtime input for v3.1 cluster lock via name-keyed lookup). Its 4-tier cascade (exact → normalized → substring → token_overlap) reaches ~81% match in production. Rebuilds fail two ways:

1. **CSV typos + cross-city pollution** drop match rate below the 75% abort threshold → rebuild aborts → no LIVE writes → wasted run. (A rebuild on un-cleaned CSV has aborted below threshold more than once — even with the `base_city_rescue` tier added.)
2. **The 75% abort threshold preserves hand-curated rows.** The `manual_city_remap` and `REMAP_NO_MATCH` rows on LIVE Match_Index are editorial decisions, not auto-generated. A successful rebuild overwrites them. (Current counts → check the sheet.)

## The procedure

### Step 1: Always clean the CSV first

`~/Desktop/TripStore/intelligence/csv_output/city_tour_patterns.csv` is the source. Known issues that recur:

- Embedded `\n` inside city values (`Disney\nLand`)
- Misspellings: `Rovaneimi` → `Rovaniemi`, `Edinburg` → `Edinburgh`, `Trondhiem` → `Trondheim`, `Albufiera` → `Albufeira`
- Disney variants: `Disneyland`, `Disney Land`, `Disneyland Paris`, `DisneyLand` all → `Paris` (Disney content lives only under Paris; all 9 master rows share `PARIS_DISNEYLAND`)
- "From <City>" tour names where parent city is wrong (Brussels tours under Amsterdam, Levi tours under Amsterdam)
- City-name variants (`Amsterdam Look Out`, `Eiffel Tower Skip The Line` as cities)

Two cleanup passes:

```bash
cd ~/Desktop/tripstore-pipeline

# Pass 1: typo + embedded newline cleanup (manual sed, or use a one-shot script)
# Pass 2: cross-city pollution
python3 fix_cross_city_pollution.py
```

`fix_cross_city_pollution.py` is idempotent — re-running on a cleaned sheet finds 0 fresh pollution. It writes 20 `Match_Tier='manual_city_remap'` rows (conf=0.75) at the archive source and 7 `REMAP_NO_MATCH` rows where target city has no fitting master.

Pre-cleanup → 113 distinct cities. Post-cleanup → 104 distinct cities (32 + 3 row remaps).

### Step 2: Decide whether to rebuild at all

If `manual_city_remap` rows are still load-bearing (they almost always are), and you cannot guarantee ≥75% match rate, **do not run the rebuild**. The script will abort, but if you lower the threshold you destroy editorial curation.

Options when below 75%:

| Option | When | Trade-off |
|---|---|---|
| (a) Lower threshold + accept overwrite | manual_city_remap rows are stale or already merged upstream | Loses editorial layer |
| (b) Modify rebuilder to merge (preserve manual rows) | Want both | Needs script change; not implemented today |
| (c) Add INPUT_Sightseeing PENDING rows to master first | Master coverage is the gap | +~2pp, no curation loss; right call when coverage is the diagnosis |
| (d) Leave as-is | Current Match_Index is acceptable | Drift accumulates |

The current `manual_city_remap` row count, the last rebuild's match rate, and whether a rebuild is held are **state** — read the live sheet / TRUTH.md before acting, never assume a past snapshot. When master coverage is the diagnosis, option (c) — add INPUT_Sightseeing PENDING rows to master first, then rebuild — is generally the right path (no curation loss).

### Step 3: Run the rebuild (when conditions allow)

```bash
cd ~/Desktop/tripstore-pipeline
python3 rebuild_day_plans_with_match.py
```

The script:

1. Reads `city_tour_patterns.csv`
2. Reads LIVE `Sightseeing` master via gspread
3. Runs 4-tier match cascade: exact → normalized (NFKD diacritic strip + city-suffix strip) → substring → token_overlap ≥0.5 (≥2-token min)
4. Optionally retries unmatched via `base_city_rescue` tier (matches against master rows where `Base_Cities` contains the archive city — recovers Lucerne/Interlaken via Grindelwald + Mt Titlis)
5. Aborts at <75% global match rate — no LIVE writes
6. On success: clears Lookup/Fallback, writes Match_Index sorted ascending by Match_Confidence (riskiest at top for spot-check)

### Step 4: Post-rebuild verification

```bash
# Spot-check the top of Match_Index — lowest-confidence rows should be sensible
# Verify Sightseeing master row #18 by tour name → if stored Master_Row_Index
# doesn't match current row position, the drift bug returned
```

Known: `Master_Row_Index` column is drifted +600 positions vs current `Sightseeing` row numbers because `_bucket_compute_step1.py` writes Embeddings_Sightseeing tab row indices, not Sightseeing master indices. v4 Step 1 reads `Master_Tour_Name` directly and resolves via `poolByNameKey` lookup, bypassing the bug. v2.x/v3.1 still call `lookupSightFromMaster_v2(... masterIndex)` and silently get `null` for ~600 rows — known issue, masked by name-keyed fallback in v3.1, ugly in v2.x but v2.x is BETA.

## Match tier reference

| Tier | Confidence | What it means |
|---|---|---|
| `exact` | 1.0 | Name strings identical post-trim |
| `normalized` | ~0.9 | After NFKD + city-suffix strip |
| `substring` | ~0.7 | Either name contains the other |
| `token_overlap` | ~0.375–0.6 | ≥0.5 Jaccard, ≥2-token min — ~50% TP rate at floor |
| `manual_city_remap` | 0.75 | Hand-curated archive-source remap (fix_cross_city_pollution.py) |
| `base_city_rescue` | varies | Via `Base_Cities` column expansion |
| `no_match` | 0 | No master tour for this archive entry — engine must skip with warning |
| `no_master_city` | 0 | Archive city has no master at all |

## What NOT to do

- ❌ Lower the 75% threshold without weighing the manual_city_remap loss
- ❌ Skip CSV cleanup — embedded newlines + misspellings alone drop the rate by 5–10pp
- ❌ Add a `CITY_EXPERIENCE` catch-all bucket for Canonical_ID (banned per 2026-05-10 decision)
- ❌ Re-run `_bucket_compute_step1.py` expecting it to fix the Master_Row_Index drift — it's the source of the drift
