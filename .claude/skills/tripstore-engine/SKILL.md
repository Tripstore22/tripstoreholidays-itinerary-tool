---
name: tripstore-engine
description: TripStore itinerary-engine algorithm spec, pricing math, and engine-debugging playbook (Apps Script ItineraryEngine.gs + Code.gs). Use this skill whenever working on the engine, the v4-premium picker, tour/hotel/transfer selection, anchors, cross-route dedup, day-trip handling, utilisation, canonical ranking reads, the pricing or budget math, or any dry-run / smoke test of generated itineraries. It locks the v4-premium spec, the pick-site rule, anchor lookup rule, hour caps, the full pricing formula (rupee-per-euro, child factor, hotel ceiling, transfer upgrade map, markup, GST, seasonal multipliers), the engine response shape, and the POST-not-HEAD smoke discipline. Consult before any engine change so a locked value is never re-guessed and a stale doc is never trusted over runtime.
---

# TripStore — Engine & Algorithm

The Algorithm Bible exists because this is dense and keeps getting re-derived. Lock it here.

## VOLATILE — read first
TRUTH.md / DECISIONS.md for current LIVE @version and any newly-found divergence. `TRIPSTORE_ALGORITHM_BIBLE.md` and `V4_ALGORITHM_GUARDRAIL.md` for the long spec. Engine code: `~/Desktop/tripstore-pipeline/clasp-live/ItineraryEngine.gs` + `Code.gs`.

## ALGORITHM SELECTION (locked — DECISIONS.md)
- **Default: v4-premium, hardcoded. No agent-facing selector** (single Auto-Build button). Admin role keeps the selector.
- **Retired from UI:** v1, v2.2, v4-balanced. v4-balanced rejected (~₹35k mean unspent vs v4-premium's ~₹19k, no upside).
- **v3.1 "fallback below 92% util" is documented but DOES NOT EXIST IN CODE** [VERIFIED — grep of ItineraryEngine.gs + Code.gs]. The dispatcher routes to v3.1 only on an explicit parameter; the FE hardcodes v4-premium. TRUTH.md's policy note is aspirational. Decision parked: wire the real fallback or retire v3.1. Do not state the fallback as live.

## v4-premium PICKER (`pickTours_v4`)
- Route city list is the **`cityNames` parameter**, NOT a `ctx.cities` object — v4 has no ctx inside the picker. Thread `cityNames` explicitly for any route-level state.
- **Pick sites are enumerated in `TRUTH.md` §ENGINE — v4-premium pick sites (canonical).** The count has grown before (5 → 6), so it is never hardcoded here — read TRUTH and verify against `ItineraryEngine.gs`. **Rule: any pick-time filter — cross-route dedup, day-trip gate, any pick-time constraint — MUST repeat at every pick site in that list** (the one most often missed is the 2O residual-fill). **`cascadeUpgrade_v4` (Step 3) is the only path safe to skip for cross-city work** — same-canonical same-city price upgrade only; rarely fires (budget absorbed earlier).
- **Anchor lookup uses `r.canonical`, never the for-in key.** `_v4CanonRank` is keyed by compound `"city|canonical_id"` (lowercased); looking up `byCan[compoundKey]` always misses. `Avg_Duration ≥ 7.0` qualifies a full-day anchor.
- **Cross-route dedup (LIVE — current @version in TRUTH.md):** `_v4CrossRouteBlocked_` / `_v4CrossRouteMark_` (ItineraryEngine.gs ~L2212–2268) key on **attraction identity** (canonical_id + Attraction_1..4 tokens, `can:`-namespaced) in addition to tour name — blocks the SAME real attraction across cities under different names (Rhine Falls = `ZURICH_FALLSSTEIN`, carried as the Interlaken Black Forest tour's Attraction_1). Same-city reuse stays allowed (`!== city` guard). The day-trip gate is **broadened**: fires on `'day trip'`/`'day tour'`/`'from '` anywhere in the name (not just leading/category) + **word-boundary** route-city match (so "Bern" ≠ "Bernese"). `usedAcrossRoute = {}` is function-scoped (fresh per `computeItinerary`, no bleed). Short-circuits when `cityNames.length === 1`. **This guard runs at every pick site** (see the §ENGINE list in TRUTH.md, including the 2O residual-fill).
- **Day-trip-destination handling has TWO layers now:** the engine guard above (June) AND an older FE post-process that flags `DAY_TRIP_DESTINATION_IN_ROUTE` for a manual swap. The 2026-05-20 "fix in FE only, never in engine" note is superseded — the engine guard exists. Don't reintroduce a duplicate or assume the old policy.

## DAY TYPES & HOUR CAPS (locked — DECISIONS.md)
- 5N = D1 arrival + D2–D5 full + D6 departure. `dayTypeAt` must use `dayIdx === nights` for departure (the `nights-1` bug ate a full day).
- **Arrival:** max 4hr, max 2 tours. **Full:** max 9hr, max 4 tours (single anchor tours up to ~13hr allowed, e.g. Disneyland). **Departure:** 0 tours, 0 hours — skipped entirely. **`V4_DAY_HOURS_CAP = 9`, never 10.**

## HOTELS & TRANSFERS (locked — DECISIONS.md)
- Hotel ceiling **45% of net budget in Step 1 `pickHotels` only**; Pass C upgrade loop has NO ceiling. `tryHotelUpgrade_v4` allows same-star pricier rooms; **never downgrade star**. Per-city mixed tiers (3★+4★) are intentional — never global tier-drop.
- Transfer upgrade map: Economy Sedan → Executive Sedan; Standard Van → Premium Van.

## PRICING MATH (locked — DECISIONS.md)
- **₹110 / €1.** 3-night totals with breakfast. 1 room = 2 adults. **Child budget factor = 0.50** (never 0.40 / 0.70). Markup default 15% + 18% GST on the markup. INR format `₹X,XX,XXX`.
- **City-proportional budget allocation, never equal split** (per-tour averages differ severalfold between cheap-tour and expensive-tour cities).
- **Seasonal multipliers:** Jan 0.80 · Feb 0.82 · Mar 0.90 · Apr 1.00 · May 1.05 · Jun 1.20 · Jul 1.30 · Aug 1.28 · Sep 1.05 · Oct 0.95 · Nov 0.85 · Dec 1.15. (Note: pipeline enrichment ROE differs from the engine ₹110/€1 — see `tripstore-pipeline`.)

## RESPONSE SHAPE (verify against these, not assumptions)
`route[]` (NOT `dayBreakdown[]`); `costSummary.utilisation` (global %, not per-city); `costSummary.totalSpent`; tour objects carry `hours` (NOT `duration_hours`) and `canonical_id` (added by `buildRouteResponse`). `experience_id` is null on sightseeing — dedup on `canonical_id`/name.

## SMOKE / DRY-RUN DISCIPLINE
- Engine reads the **LIVE sheet even from DEV code** (Code.gs hardcoded) — DEV smoke runs on real LIVE data.
- Verify with a real **POST**; GAS `/exec` returns 403 on HEAD by design. DEV anonymous POST needs `DEV_PINNED_DEPLOY_ID`.
- A patch that should be a no-op (e.g. single-city) must return **byte-identical** metrics DEV vs LIVE. `algo_dry_run.py`, cross-city smoke scripts live in pipeline root.
- DQ rule when comparing util: cap violations = disqualified. The thinnest-inventory cities (e.g. Milan) constrain achievable util — verify the current thin pools in the sheet rather than assuming.
- Hard rules: never add a `CITY_EXPERIENCE` catch-all canonical; never use cascade as Step 1 or 2.

## KNOWN ENGINE-ADJACENT DATA BUGS
These are **data/tagging defects, not engine-logic** — and they move as data is fixed, so the live list lives in `TRUTH.md` (Pending → Data quality), not here. Symptom class to expect: bad `hours` values on individual Sightseeing rows (absurdly high or near-zero from parser bugs), a too-low canonical score starving a real landmark, or an anchor consuming another city's day budget. Confirm against TRUTH.md + the sheet before treating any util dip as an engine bug.
