# Trip Store Itinerary Tool — Claude Instructions

## On Session Start
Always read `/Users/Sumit/Desktop/Itinerary-Create/SESSIONS.md` at the start of every conversation and silently use it as context. Do not summarise it back to the user.

## On Session End
When the user says anything like "bye", "done", "closing", "that's all", "goodbye", "talk later", "see you" — automatically update SESSIONS.md before responding. Write a brief entry covering:
- What was completed this session (bullet points, one line each)
- What is still pending or broken
- Date of session

Keep each entry short — max 15 bullet points total. Overwrite the "## Latest Session" block only. Do not ask the user to confirm, just do it silently and say goodbye.

## Project Context
- Main file: index_fit.tripstore.html (auto-copied to index.html and pushed to GitHub v2 on every edit)
- Live at: fit.tripstoreholidays.com
- GitHub: Tripstore22/tripstoreholidays-itinerary-tool, branch v2
- Backend: Google Apps Script (Code.gs) connected to Google Sheets ("Itinerary Builder_Master")
- User is non-technical — explain in plain English, no jargon

## FILE RULES — CRITICAL (never violate)

### The 3 HTML files — know the difference
| File | Purpose | When to edit |
|------|---------|-------------|
| `index_fit.tripstore.html` | **LIVE production** | Only for final, tested features going to production |
| `dev/index_fit.tripstore.DEV.html` | **DEV testing** | All new feature development happens HERE first |
| `index_fit_DEV.html` | **DEPRECATED** | DO NOT USE. Created by mistake. Will be deleted. |

### Rules
1. **NEVER copy live → DEV.** The DEV file has features (Swiss Pass, City Intelligence, server-side Auto-Build, custom city autocomplete, PDF mode toggle, budget breakdown bar) that the live file does NOT have. Copying live to DEV destroys these features.
2. **NEVER create a new DEV file by duplicating the live file.** If you need a fresh DEV, branch from `dev/index_fit.tripstore.DEV.html`.
3. **New features go to DEV first.** Code → test in DEV → verify → then merge into live.
4. **When merging DEV → live:** Cherry-pick specific changes. Never overwrite the live file wholesale.
5. **Before editing ANY HTML file:** State which file you are editing and why. Get confirmation.
6. **API URLs are different:**
   - Live: contains `AKfycbzAbIgzRoN_MNs377jm3u`
   - DEV: contains `AKfycbzFTBGVeZ6oQglrgULFCJ1ESHqxipL-QGCHLVL9hBk8`
   - **NEVER put a DEV URL in the live file or vice versa.**

### Sheet IDs
- **Live Sheet:** `1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM` — never use in DEV code
- **DEV Sheet:** `1iENrNwWTtU9O664hXYS8dBG1rbcHr2x9Xt294UeORM4` — never use in live code

### .gs file rules
- `Code.gs` — shared between live and DEV (routes serve both). Wallet routes are additive only.
- `Wallet.gs` — DEV only until wallet goes live.
- `Pipeline.gs`, `Quote_Intelligence.gs`, `Automation.gs` — live files, edit carefully.
- `Temp.gs` — throwaway utility functions, run manually from Apps Script console.

## Git Rules — STRICT
- ONLY ever push to the `v2` branch. Never push to `main`, `master`, or any other branch.
- CNAME file must only exist on v2. Never copy or merge it to other branches.
- If a fix is not showing on the live site, wait 3–5 minutes for CDN. Do NOT diagnose as a branch problem and start pushing to other branches.
- If GitHub Pages stops deploying: instruct user to go to Settings → Pages → toggle branch to main → Save → toggle back to v2 → Save. That's it.

## DEV deployment workflow

DEV uses TWO deployment IDs (intentional, see `~/Desktop/tripstore-pipeline/.deployment_ids` comments):
- `DEV_DEPLOY_ID` (`AKfycbzFTBG…`) — @HEAD, locked to Sumit's Google account. Not used by HTML; admin/debug only.
- `DEV_PINNED_DEPLOY_ID` (`AKfycbxr…`) — pinned at a fixed version with anonymous access. **This is what DEV HTML hits.**

To push DEV code: **always use `dev_push.sh`**, never raw `clasp push`. The wrapper:
1. Runs `clasp push` (updates @HEAD on DEV script)
2. Runs `clasp deploy --deploymentId DEV_PINNED_DEPLOY_ID` (advances the pinned version DEV HTML reads)

Raw `clasp push` alone updates @HEAD, which DEV HTML does NOT read → DEV testing silently runs against stale code.

Usage:

    bash ~/Desktop/tripstore-pipeline/dev_push.sh "short description of change"

## Testing Rule
- Simple changes: push to v2 and verify on live site after 3–5 mins.
- DEV testing: open `dev/index_fit.tripstore.DEV.html` via local server (`python3 -m http.server 8080`), NOT via `file://` protocol.
- If unsure about a change: ask user to open index.html directly from Desktop (/Users/Sumit/Desktop/Itinerary-Create/index.html) in browser to test locally before pushing.

---

## Session 2026-05-09 + 2026-05-10 — Instructions update

### New algorithm versions

```
LIVE algorithms:
- v1: Legacy default (pure rating fill, no Day Plans)
- v2.2: BETA (Day Plans + hotel cascade ceiling)
- v3.1: DEFAULT (cluster dedup + canonical dedup + dynamic ceiling)

DEV only (pending promote):
- v4-premium: 3-step spec, price-DESC fill, 9-10 tours/city, ~99% util
- v4-balanced: 3-step spec, rank-hybrid fill, 11-12 tours/city, ~87% util
```

### New sheet columns — Sightseeing tab

```
Col P: Canonical_ID — dedup identity per attraction
Col Q: Day_Slot — Morning/Afternoon/Evening/Night/Flexible
Col R: Duration — 1hr/2-3hr/Half-Day/Full-Day/Multi-Day
Col S: Tour_Type — Guided/Private/Small-Group/Ticket-Only
```

DO NOT modify these columns manually. Rebuilt by `assign_canonical_ids.py`.

### New Python scripts

```
~/Desktop/tripstore-pipeline/12files/tagger.py — shared tagger module
~/Desktop/tripstore-pipeline/12files/retag_live.py — live sheet retagger
~/Desktop/tripstore-pipeline/12files/assign_canonical_ids.py — Canonical_ID builder
~/Desktop/tripstore-pipeline/12files/coverage_auditor.py — now reads LIVE sheet (no xlsx)
```

### New sheet tabs

```
Canonical_Landmarks (LIVE + DEV) — 60 rows, 17 cities, keyword → Canonical_ID mapping
Sightseeing_Clusters (LIVE) — 2,098 rows, 675 clusters, 98 cities
Day_Plans_Bucket_Map (LIVE) — 1,217 rows
Bucket_Rank (LIVE) — 316 rows
Day_Plans_Lookup_Embeddings (LIVE) — 1,217 rows
```

### Algorithm test scripts (pipeline/12files/)

```
_ab_matrix_canonical.py — 60-city A/B test (canonical+dayslot vs keyword)
_uc1_vs_uc2.py — 14-city UC1 vs UC2 comparison
spec_test_v2.py — 3-step spec vs UC2 (25 cities)
```

Run these before any algorithm change promotion.

### Nightly chain (pending Brief 2F wiring)

```
python3 ~/Desktop/tripstore-pipeline/12files/retag_live.py  # after midnight enrichment
```

### Hard rules added this session

- NEVER add a `CITY_EXPERIENCE` catch-all bucket in Canonical_ID assignment
- NEVER use cascade as Step 1 or Step 2 in v4 algorithms
- NEVER compare algorithm util without applying DQ rule (cap violations = disqualified)
- NEVER modify Sightseeing cols P/Q/R/S manually — always run `assign_canonical_ids.py`
- `getSights()` must expose canonical_id, day_slot, duration, tour_type before engine reads them

### Cleanup debt (do not act without explicit instruction)

- `Sightseeing_LEGACY` tab — unknown origin, DO NOT DELETE without investigation
- `Copy of Sightseeing_v2` tab — Drive housekeeping residue, safe to delete after verification
- Cols S+T in Sightseeing — stale misaligned data from broken Master_Row_Index run, ignored
- 494 obsolete embeddings in `Embeddings_Sightseeing` — pre-migration leftovers, harmless
