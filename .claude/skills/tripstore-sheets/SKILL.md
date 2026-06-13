---
name: tripstore-sheets
description: Safe Google Sheets read and write patterns for the TripStore data layer (the LIVE sheet, via gspread or Apps Script). Use this skill whenever reading from or writing to any TripStore tab — Sightseeing, Hotels, Trains, Transfers, INPUT_Sightseeing/Hotels/Trains/Transfers, Canonical_Rank, Quote_Log, Users, Agent_Wallet, Saved_Itineraries, City_Intelligence, Launch_Cities_Whitelist — or whenever the task involves enrichment, canonical IDs, appending rows, minting, or editing cells. It enforces the append_row ban (it destroyed data twice), direct range-write by computed row index, content-keyed matching not row numbers, header-driven column mapping, append-only on masters, frozen schema on Quote_Log, and the Canonical_Rank column rules. Consult before any sheet write — the downside it prevents is unrecoverable.
---

# TripStore — Safe Sheet Operations

Business data lives on LIVE only. A bad write here is not revertable except by Google version history. Read this before any write.

## SHEET IDs
- **LIVE:** `1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM` — real data. Never put this ID in DEV code.
- **DEV:** `1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4`.
- **The engine reads from LIVE even when run from DEV code** (hardcoded in Code.gs). So DEV smoke tests run against real LIVE data — DEV sheet schema drift is irrelevant for engine tests.
- gspread credentials: `~/Desktop/tripstore-pipeline/sheets-credentials.json` (service account). Never move.
- For anonymous Python POST to DEV engine, use `DEV_PINNED_DEPLOY_ID` (not `DEV_DEPLOY_ID`, which is auth-restricted).

## CARDINAL RULE — NEVER `gspread.append_row()`
`values.append` finds the "table range" by heuristic; on tabs with blank-row-separated blocks, filters, or conditional formatting it lands MID-SHEET and silently overwrites live data. It destroyed Canonical_Rank row 693 (PORTO_DOURO) on 2026-05-19. Banned permanently on every TripStore tab.

**Safe append pattern:**
```python
N = len(ws.get_all_values()) + 1
ws.update(f'A{N}:<lastCol>{N}', values=[row], value_input_option='USER_ENTERED')
```
Append-to-bottom only. Never mid-sheet insertion (shifts downstream rows, collides with filters).

## MATCH BY CONTENT, NOT ROW NUMBER
Row numbers drift when rows are inserted/deleted between a snapshot and the write — caused 80%+ of entries to mis-target in a real run. Generate fix JSON against the CURRENT live sheet, and match by tuple, e.g. `(City, Canonical_ID)`, not by row index. Handle ambiguity explicitly (e.g. pick the row where A1 is still free-text, not a valid canonical).

## HEADER-DRIVEN COLUMN MAPPING
Never hardcode column indices — schema has moved and a hardcoded-index write landed feeder rows in the wrong columns. Build a `header → index` map from row 1 at runtime (the `_feederColMap_` pattern) and write by header name.

## NUMERIC PARSING
`parseInt(x) || sentinel` is FORBIDDEN where 0 is a legal value (it turned gap=0 into -1 and blocked cities from flipping live). Always:
```js
var x = parseInt(raw, 10); if (isNaN(x)) x = sentinel;
```
A tolerant `num_()` parser is needed for cells holding ₹-formatted strings (returns null otherwise).

## MASTERS vs INPUTS
- **Masters the engine reads FROM:** Sightseeing, Hotels, Trains, Transfers. **Append only. Never delete rows. Never overwrite on enrichment.**
- **Inputs the coverage feeder writes TO:** INPUT_Sightseeing, INPUT_Hotels, INPUT_Trains, INPUT_Transfers. Pipeline enriches INPUT → writes to master. Never change INPUT column structure — indexes are hardcoded downstream.
- **`Sightseeing_v2` does NOT exist on LIVE. Never reference or write to it.** (`Sightseeing_LEGACY` exists, unknown origin — do not delete.)

## FROZEN SCHEMA — DO NOT REORDER OR ADD COLUMNS
- **Quote_Log** (~29–32 cols): downstream consumers depend on order. Never reorder. It is rich (cities, nights, pax mix, full price breakdown, utilisation, hotel category, manual-edit counts), not summary-only.
- Never create new sheet tabs without explicit approval.
- Dedup keys (locked): Hotels = Name + City; Sightseeing = Tour Name + City; Trains = From + To (bidirectional); Transfers = City + From + To.

## CANONICAL_RANK RULES
- Engine reads `Smoothed_Score` (col O) and `Density_Score` (col P) — NOT `Smoothed`/`Density` (col T). Verify which column the reader uses before propagating between columns; populating the wrong one is inert.
- `Avg_Duration ≥ 7.0` qualifies a canonical as a Full-Day anchor candidate (`_v4ReserveFullDayAnchors_`). Half-day stays below 7.
- **Conflict scan is mandatory before any mint** — classify each new canonical into drop (already exists), merge (remap to existing), or mint (truly new); surface anything that fits none before writing. Catches typos and NEW_SUBSTR_OF_EXISTING collisions.
- Attraction_1..4 must hold canonical_ids (not free-text) — free text breaks engine dedup → duplicate attractions in a quote. Option A: when A1 equals the row's own Canonical_ID (col P), blank A1.
- Transitive collapse mandatory for batch remap chains (A→B, B→C must be written A→C).
- `canonical_rank_final.csv` source still holds pre-rename canonicals — after any rewrite run `python3 12files/fix_multicity_canonicals.py step3-write` or the renames revert.
- `experience_id` is null on all sightseeing rows — use `canonical_id` as the reliable identifier.
- Keyword-heuristic auto-merge is permanently abandoned (it merged Eiffel Tower → Disneyland). Human-reviewed merges only.

## WRITING FROM PYTHON (gspread)
- **cwd matters.** Active scripts open `./sheets-credentials.json` by **relative** path — run them from `~/Desktop/tripstore-pipeline/` or the credentials file won't resolve. SA is `tripstore-python@tripstore-python.iam.gserviceaccount.com` (Editor on both sheets).
- **Pick the sheet the *consumer* binds to, not "where I want it."** The classic silent bug: a script hardcodes the LIVE Sheet ID, but the Apps Script that reads the data is container-bound to the DEV sheet (or vice versa) → the write lands where nothing reads it → runtime no-op (e.g. embeddings written, engine sees zero). Match the write target to the sheet the **deployed** Apps Script reads. (Use the safe append/update patterns above — **never `append_row`/`append_rows`**, banned regardless of source.)
- **Protected ranges fail silent or `PERMISSION_DENIED`** (LIVE Quote_Log, Saved_Itineraries, sometimes Sightseeing). Fix is Sumit-side only: add the SA to that range's protection editors in the Sheets UI; the script can't whitelist itself.
- **Verify the round-trip from the deployed web-app URL, never the Apps Script editor** — the editor's `getActiveSpreadsheet()` can return a different sheet than `doPost` does at runtime, masking a wrong-sheet write. POST `{"action":"<name>","params":{…}}` (flat payload → `Invalid action`); use `urllib`/browser, not curl (the 302 drops the body).

## DISCIPLINE
- **Backup before any batch write** — a CSV snapshot of the tab (`_backups/<tab>_pre_<YYYYMMDD_HHMMSS>.csv`) is the rollback path. **Dry-run small first** (50 rows / 1 city) before the full run — skipping it produced ERROR rows.
- DEV Sightseeing tab is protected; cannot be mirrored via gspread.
- Cols P/Q/R/S in Sightseeing are rebuilt by `assign_canonical_ids.py` — never edit manually.
- Verify a brief's assumptions about helper/function/column names against the live sheet before writing against them.
