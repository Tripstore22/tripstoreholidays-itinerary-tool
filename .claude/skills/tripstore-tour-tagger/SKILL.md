---
name: tripstore-tour-tagger
description: Use when retagging the TripStore Sightseeing tab (col K Attraction Tags), rebuilding tag taxonomy, or adding new keyword categories. Triggers on "retag", "tag taxonomy", "retag_live", "build_tag_taxonomy", "tagger.py", "add keyword", "EXTRA_KEYWORDS", or any work on the 12files/ tagger module. The shared tagger lives in 12files/tagger.py — three callers used to carry triplicate copies; never reintroduce that.
---

# TripStore: Tour Tagger

## Why this exists

`12files/tagger.py` is the **single source of truth** for tagging logic. Before 2026-05-08, three callers (`retag_sightseeing.py`, `retag_live.py`, `coverage_auditor.py`) carried triplicate copies of `_hr_to_tag` and `detect_keyword_tags`. The 2026-05-07 fix to one of them missed the others; coverage audits silently re-emitted broken tags. Unified into `tagger.py`; new rule: any tagger change goes in `tagger.py` only, callers import.

## Files

```
12files/
├── tagger.py                  # shared module — single source of truth
├── build_tag_taxonomy.py      # rebuilds tag_taxonomy.json from LIVE corpus
├── retag_live.py              # writes col K on LIVE Sightseeing via gspread
├── retag_sightseeing.py       # legacy local-file version (rarely used)
├── coverage_auditor.py        # consumes tagger.py, writes coverage_report.json
├── assign_canonical_ids.py    # different module — populates cols P/Q/R/S
└── tag_taxonomy.json          # ~1MB taxonomy data
```

## Common workflows

### Rebuild taxonomy after adding new keywords

```bash
cd ~/Desktop/tripstore-pipeline/12files

# Add new keywords to EXTRA_KEYWORDS dict in tagger.py
# (auto-merged into tag_to_keywords at load_taxonomy() time — no rebuild
# required for them to apply across all callers)

# Or for proper attraction-vocab additions, rebuild from corpus:
python3 build_tag_taxonomy.py    # reads 5 LIVE tabs via gspread
# Output: tag_taxonomy.json (regenerated)
```

`build_tag_taxonomy.py` reads from LIVE: `Sightseeing`, `DONE_Sightseeing`, `Non EU Sights`, `Swiss Pass Tours`, `INPUT_Sightseeing`, plus `Day_Plans_Lookup`. xlsx dependency is dead — never reintroduce it.

### Retag LIVE Sightseeing col K

```bash
cd ~/Desktop/tripstore-pipeline/12files

# Dry-run first — shows what would change
python3 retag_live.py --dry-run

# Apply
python3 retag_live.py
# Batches of 50 with 1s sleep — full retag runs well under the Apps Script ceiling, 0 errors typical
```

After retag, regenerate the coverage dashboard (see the Coverage Dashboard regen section in `tripstore-pipeline`).

## Known gotchas (don't reintroduce)

### 1. Option B suffix-strip — defensive, leave in place

12 taxonomy keys in `tag_taxonomy.json` have a prefix-as-suffix bug: keys like `subject:underground-subject`, `format:guided-tour-format`, `mode:hot-air-balloon-mode`. They emit tags with the dimension suffix baked in (e.g. `underground-subject`). Fix is in `detect_keyword_tags()`:

```python
# Strip "-<prefix>" suffix from emitted tags
if '-' in tag and tag.endswith(f'-{prefix}'):
    tag = tag[:-len(prefix)-1]
```

Verified zero rows emit malformed dimension-suffix tags post-strip. The single hit `legends-theme` is a **legitimate** Antalya attraction bigram from "Land of Legends Theme Park" — NOT the bug. Distinguish before "fixing".

Upstream fix in `build_tag_taxonomy.py`'s key constructor is still pending — cosmetic, the runtime strip handles it.

### 2. Foreign-language noise — must be in GENERIC_TAG_TOKENS

Italian/German/etc. tags leaked into output before 2026-05-08. Maintain in `tagger.py`:

```python
GENERIC_TAG_TOKENS = {
    # Italian
    'roma', 'firenze', 'venezia', 'milano', 'spettri', 'alchimisti',
    # German
    'wien', 'praha', 'lisboa', 'oporto',
    # French articles
    'vers', 'apres', 'avant', 'entre',
    # Defensive stems
    'dorsay', 'hollandsche', "'s",
    # …
}
```

When adding a new language corpus to Sightseeing, eyeball the top 50 emitted tags for foreign-language city names and articles.

### 3. `_hr_to_tag` floor at 0.75h

```python
def _hr_to_tag(h):
    if h < 0.75:
        return None    # sub-45-min is a parse artifact, drop it
    # … else emit "1hr"/"2-3hr"/…
```

Don't lower this — sub-45-min durations were emitting spurious `1hr` tags rampant pre-2026-05-08.

### 4. Bigram subsumes unigram

If a tour name has both `walking-tour` (bigram) and `walking` + `tour` (unigrams), keep only the bigram. `subsume_unigrams()` in `tagger.py` handles this via `BIGRAM_SUBSUME_RULES`. Don't disable.

### 5. Landmark unigram absorbs extensions

When `colosseum` is present, drop `colosseum-floor`, `colosseum-roman`, `colosseum-palatine`, etc. `SUBSUMING_UNIGRAMS` set in `build_tag_taxonomy.py`. Pre-fix, one Colosseum tour over-split into 4 tags; post-fix, one tag.

### 6. Apostrophes

`norm_name()` collapses apostrophes inside words: `d'orsay → dorsay`, `l'arc → larc`, possessive `'s` stripped. Don't allow `'` to survive into tags.

## Adding a new keyword category

Two options:

**A. Fast path — EXTRA_KEYWORDS (no rebuild):**

```python
# in tagger.py
EXTRA_KEYWORDS = {
    'escape-room':    ['escape room', 'escape game'],
    'comedy-show':    ['comedy', 'stand-up', 'comedy club'],
    'simulator':      ['simulator', 'flight simulator', 'vr experience'],
    'sports-event':   ['football match', 'tennis open', 'f1 race'],
    'ski':            ['ski lesson', 'ski school', 'ski rental'],
    'disney':         ['disneyland', 'disney park'],
    'NEW-CATEGORY':   ['keyword1', 'phrase 2', ...],   # ← add here
}
```

Auto-merged at `load_taxonomy()` time. No rebuild. All three callers pick it up next run.

**B. Proper path — corpus-driven (requires rebuild):**

Useful when the keyword is a real attraction-vocab term (a named landmark/category present in many tour names). Add seed tour names to a relevant tab, then `python3 build_tag_taxonomy.py`.

## What NOT to do

- ❌ Patch tagger logic in `retag_live.py` or `coverage_auditor.py`. Fix `tagger.py`; the others import.
- ❌ Add a `city` to STOPWORDS without grepping for legitimate uses. (`city` can be both a leak AND legitimate — "Paris City Tour"-style names — so grep before adding.)
- ❌ Run a tagger change without diffing emitted tags pre/post on 50 random rows.
- ❌ Touch `Sightseeing` cols P/Q/R/S — that's `assign_canonical_ids.py`, not the tagger. Cols K and P are independent layers.
