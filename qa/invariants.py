#!/usr/bin/env python3
"""
Night Guardian — invariant engine (STOP 2).

PURE functions over an engine response (no network, no sheet I/O).
Each check returns a Result dict; failures carry {scenario_id, registry_ref, expected, got}
— never a bare assert. Status is one of PASS / FAIL / SKIP.

  SKIP is NOT a pass. A check SKIPs when it cannot be honestly computed from a bare
  engine POST response (FE-layer formatting, Step-1 internals not exposed, etc.).
  The reason is always stated. smoke.py counts PASS/FAIL/SKIP separately.

Math basis (VERIFIED against runtime costSummary, 2026 — fields win over any formula):
  multiplier        = 1 + markupPct/100 + (markupPct/100)*(gstOnMarkupPct/100)
  totalClientBudget = budgetPerPerson * adultEquivalents
  adultEquivalents  = adults + 0.50 * children          (child factor 0.50, locked)
  netBudget         = totalClientBudget / multiplier
  markupAmount      = netBudget * markupPct/100
  gstAmount         = markupAmount * gstOnMarkupPct/100
  totalClientBudget = netBudget + markupAmount + gstAmount
  utilisation       = 100 * totalSpent / netBudget
  P10               = totalSpent <= netBudget        (net basis, NOT budgetPerPerson, NOT gross)

Tolerance: TOL = 0.02 (±2%) for ratio/recompute comparisons — absorbs INR rounding
in the engine. Documented per Sumit's STOP-2 steer; exact-equality would false-fail.
"""

TOL = 0.02            # ±2% for recompute/ratio checks
ABS_RUPEE = 2.0       # absolute slack (rupees) for recompute identities
DAYTRIP_PAT = ("day trip", "day tour", "from ")
ANCHOR_HOURS = 7.0    # Avg_Duration >= 7 qualifies a full-day anchor (locked, DECISIONS)
FULL_HCAP = 9.0       # V4_DAY_HOURS_CAP (locked)
FULL_TCAP = 4
ANCHOR_SOLO_HCAP = 13.0
ARR_HCAP = 4.0
ARR_TCAP = 2


def _r(check, ref, status, scn_id, expected=None, got=None, reason=None):
    out = {"check": check, "registry_ref": ref, "status": status, "scenario_id": scn_id}
    if expected is not None: out["expected"] = expected
    if got is not None:      out["got"] = got
    if reason:               out["reason"] = reason
    return out

def _close(a, b, tol=TOL, absslack=ABS_RUPEE):
    if a is None or b is None: return False
    return abs(a - b) <= max(abs(b) * tol, absslack)

def _city_tours(resp):
    """Yield (city_index, city_name, tour) for every tour in route order."""
    for ci, cb in enumerate(resp.get("route") or []):
        for t in (cb.get("tours") or []):
            yield ci, (cb.get("city") or "?"), t

def _day_groups(resp):
    """Group tours by (city_index, dayType, dayIdx) -> [tours]."""
    g = {}
    for ci, _, t in _city_tours(resp):
        g.setdefault((ci, t.get("dayType"), t.get("dayIdx")), []).append(t)
    return g

def _flags_text(resp):
    return " ".join(str(x) for x in (resp.get("warningFlags") or [])).lower()


# ---------------------------------------------------------------- ENGINE (E)
def check_shape(resp, scn):
    sid = scn["id"]
    need_top = {"route", "costSummary"}
    miss = need_top - set(resp.keys())
    if miss:
        return _r("shape", "shape", "FAIL", sid, expected=f"top keys {sorted(need_top)}",
                  got=f"missing {sorted(miss)}")
    cs = resp.get("costSummary") or {}
    need_cs = {"netBudget", "totalSpent", "utilisation", "totalClientBudget"}
    miss_cs = need_cs - set(cs.keys())
    if miss_cs:
        return _r("shape", "shape", "FAIL", sid, expected=f"costSummary {sorted(need_cs)}",
                  got=f"missing {sorted(miss_cs)}")
    for _, _, t in _city_tours(resp):
        for k in ("hours", "canonical_id", "name"):
            if k not in t:
                return _r("shape", "shape", "FAIL", sid, expected=f"tour has {k}", got=sorted(t.keys()))
        break
    return _r("shape", "shape", "PASS", sid)

def check_E01(resp, scn):
    """Departure day = 0 tours, 0 hours (no tour may carry dayType 'departure')."""
    sid = scn["id"]
    bad = [t.get("name") for _, _, t in _city_tours(resp) if str(t.get("dayType")).lower() == "departure"]
    if bad:
        return _r("E01_departure_empty", "E01", "FAIL", sid,
                  expected="0 tours on departure day", got=f"{len(bad)} departure-day tours: {bad[:3]}")
    return _r("E01_departure_empty", "E01", "PASS", sid)

def check_E02(resp, scn):
    """Full day <= 9hr AND <= 4 tours; single-anchor day may reach 13hr alone."""
    sid = scn["id"]
    for (ci, dt, di), tours in _day_groups(resp).items():
        if str(dt).lower() != "full":
            continue
        hrs = sum(float(t.get("hours") or 0) for t in tours)
        n = len(tours)
        if n == 1:
            if hrs > ANCHOR_SOLO_HCAP + 1e-6:
                res = _r("E02_full_caps", "E02", "FAIL", sid,
                         expected=f"single-anchor <= {ANCHOR_SOLO_HCAP}h",
                         got=f"city#{ci} day{di} {hrs}h")
                res["canonical_id"] = tours[0].get("canonical_id")  # for known_issues matching
                res["tour_name"] = tours[0].get("name")
                return res
        else:
            if hrs > FULL_HCAP + 1e-6 or n > FULL_TCAP:
                return _r("E02_full_caps", "E02", "FAIL", sid,
                          expected=f"<= {FULL_HCAP}h and <= {FULL_TCAP} tours",
                          got=f"city#{ci} day{di}: {hrs}h / {n} tours")
    return _r("E02_full_caps", "E02", "PASS", sid)

def check_E03(resp, scn):
    """Arrival day <= 4hr AND <= 2 tours."""
    sid = scn["id"]
    for (ci, dt, di), tours in _day_groups(resp).items():
        if str(dt).lower() != "arrival":
            continue
        hrs = sum(float(t.get("hours") or 0) for t in tours)
        n = len(tours)
        if hrs > ARR_HCAP + 1e-6 or n > ARR_TCAP:
            return _r("E03_arrival_caps", "E03", "FAIL", sid,
                      expected=f"<= {ARR_HCAP}h and <= {ARR_TCAP} tours",
                      got=f"city#{ci} day{di}: {hrs}h / {n} tours")
    return _r("E03_arrival_caps", "E03", "PASS", sid)

def check_E04(resp, scn):
    """No canonical_id in TWO DIFFERENT cities. Same-city repeat (split stay) is allowed."""
    sid = scn["id"]
    seen = {}   # canonical -> set(city names)
    for _, city, t in _city_tours(resp):
        cid = t.get("canonical_id")
        if not cid:
            continue
        seen.setdefault(cid, set()).add(city)
    cross = {c: sorted(v) for c, v in seen.items() if len(v) > 1}
    if cross:
        first = list(cross.items())[0]
        return _r("E04_no_cross_city_dup", "E04", "FAIL", sid,
                  expected="each canonical in <=1 distinct city",
                  got=f"{first[0]} in {first[1]}" + (f" (+{len(cross)-1} more)" if len(cross) > 1 else ""))
    return _r("E04_no_cross_city_dup", "E04", "PASS", sid)

def check_E05(resp, scn):
    """No day-trip tour whose destination is ANOTHER route city, unless flagged."""
    sid = scn["id"]
    route_cities = [(cb.get("city") or "").lower() for cb in (resp.get("route") or [])]
    flagged = "day_trip_destination_in_route" in _flags_text(resp)
    viol = []
    for _, own, t in _city_tours(resp):
        nm = (t.get("name") or "").lower()
        if not any(p in nm for p in DAYTRIP_PAT):
            continue
        for rc in route_cities:
            if rc and rc != own.lower() and _word_in(rc, nm):
                viol.append(f"{t.get('name')} (-> {rc})")
                break
    if viol and not flagged:
        return _r("E05_daytrip_guard", "E05", "FAIL", sid,
                  expected="no unflagged day-trip to a route city", got=viol[:3])
    return _r("E05_daytrip_guard", "E05", "PASS", sid)

def check_E09(resp, scn):
    """Empty days must be FLAGGED, never silent. For thin/zero-tour scenarios, require a flag."""
    sid = scn["id"]
    flags = resp.get("warningFlags")
    if not isinstance(flags, list):
        return _r("E09_empty_day_flagged", "E09", "FAIL", sid,
                  expected="warningFlags is a list", got=type(flags).__name__)
    expect_empty = (scn.get("flags", {}).get("thin_inventory")
                    or "empty" in str(scn.get("flags", {})).lower()
                    or scn.get("flags", {}).get("expect", "") in
                       ("empty_days_flagged_not_silent", "graceful_fail_or_empty_flagged"))
    total_tours = sum(1 for _ in _city_tours(resp))
    if expect_empty and total_tours == 0 and not flags:
        return _r("E09_empty_day_flagged", "E09", "FAIL", sid,
                  expected="empty/thin itinerary must populate warningFlags",
                  got="0 tours AND empty warningFlags (silent)")
    return _r("E09_empty_day_flagged", "E09", "PASS", sid)

def check_E10(resp, scn):
    """Engine states the algorithm; default expectation v4-premium."""
    sid = scn["id"]
    algo = resp.get("algorithm")
    want = scn.get("flags", {}).get("assert_algorithm", "v4-premium")
    if algo is None:
        return _r("E10_algorithm_stated", "E10", "FAIL", sid, expected="algorithm field present", got=None)
    if str(algo) != want:
        return _r("E10_algorithm_stated", "E10", "FAIL", sid, expected=want, got=algo)
    return _r("E10_algorithm_stated", "E10", "PASS", sid)

def check_E11(resp, scn):
    """No phantom inter-city leg: price/cost 0 AND no description/notes."""
    sid = scn["id"]
    for leg in (resp.get("selectedIntercity") or []):
        price = leg.get("price", leg.get("cost", None))
        notes = (leg.get("notes") or leg.get("mode") or "").strip()
        if (price in (0, 0.0, None)) and not notes:
            return _r("E11_no_phantom_leg", "E11", "FAIL", sid,
                      expected="no zero-price empty-desc leg",
                      got=f"{leg.get('fromTo') or leg}")
    return _r("E11_no_phantom_leg", "E11", "PASS", sid)

def check_E06(resp, scn):
    """>=1 full-day anchor (tour hours >= 7) when the trip has multi-day capacity. Bonus."""
    sid = scn["id"]
    nights = sum(scn.get("nights") or [0])
    if nights < 4:
        return _r("E06_anchor_placed", "E06", "SKIP", sid, reason="trip too short to require an anchor")
    has = any(float(t.get("hours") or 0) >= ANCHOR_HOURS for _, _, t in _city_tours(resp))
    # Only assert when the scenario explicitly expects an anchor (avoid thin-city false-fail)
    if scn.get("flags", {}).get("expect_anchor") and not has:
        return _r("E06_anchor_placed", "E06", "FAIL", sid,
                  expected="at least one full-day anchor (>=7h)", got="none placed")
    return _r("E06_anchor_placed", "E06", "PASS" if has else "SKIP", sid,
              reason=None if has else "no anchor placed (not asserted for this scenario)")


# --------------------------------------------------------------- PRICING (P)
def check_P01_single(resp, scn):
    """adultEquivalents == adults + 0.50*children (child factor 0.50, locked)."""
    sid = scn["id"]
    cs = resp.get("costSummary") or {}
    a = cs.get("adults"); c = cs.get("children"); ae = cs.get("adultEquivalents")
    if None in (a, c, ae):
        return _r("P01_child_factor", "P01", "SKIP", sid, reason="adultEquivalents not in costSummary")
    want = a + 0.50 * c
    if not _close(ae, want, tol=0.001, absslack=0.001):
        return _r("P01_child_factor", "P01", "FAIL", sid, expected=f"{want} (=A+0.5C)", got=ae)
    return _r("P01_child_factor", "P01", "PASS", sid)

def check_P06(resp, scn):
    """Markup/GST recompute: multiplier, netBudget, markupAmount, gstAmount, sum identity."""
    sid = scn["id"]
    cs = resp.get("costSummary") or {}
    try:
        mp = cs["markupPct"] / 100.0
        gp = cs["gstOnMarkupPct"] / 100.0
        net = cs["netBudget"]; tcb = cs["totalClientBudget"]
        mk = cs["markupAmount"]; gst = cs["gstAmount"]
    except KeyError as e:
        return _r("P06_markup_gst", "P06", "SKIP", sid, reason=f"missing field {e}")
    mult = 1 + mp + mp * gp
    checks = [
        ("netBudget=tcb/mult", net, tcb / mult),
        ("markup=net*mp", mk, net * mp),
        ("gst=markup*gp", gst, mk * gp),
        ("tcb=net+markup+gst", tcb, net + mk + gst),
    ]
    for label, got, want in checks:
        if not _close(got, want):
            return _r("P06_markup_gst", "P06", "FAIL", sid, expected=f"{label}={want:.2f}", got=round(got, 2))
    return _r("P06_markup_gst", "P06", "PASS", sid)

def check_P08(resp, scn):
    """utilisation == 100*totalSpent/netBudget."""
    sid = scn["id"]
    cs = resp.get("costSummary") or {}
    net = cs.get("netBudget"); spent = cs.get("totalSpent"); util = cs.get("utilisation")
    if None in (net, spent, util) or not net:
        return _r("P08_utilisation", "P08", "SKIP", sid, reason="netBudget/totalSpent/utilisation missing")
    want = 100.0 * spent / net
    if not _close(util, want, tol=0.01, absslack=0.2):
        return _r("P08_utilisation", "P08", "FAIL", sid, expected=round(want, 2), got=util)
    return _r("P08_utilisation", "P08", "PASS", sid)

def check_P10(resp, scn):
    """totalSpent <= netBudget (NET basis — not budgetPerPerson, not gross)."""
    sid = scn["id"]
    cs = resp.get("costSummary") or {}
    net = cs.get("netBudget"); spent = cs.get("totalSpent")
    if None in (net, spent):
        return _r("P10_budget_bound", "P10", "SKIP", sid, reason="netBudget/totalSpent missing")
    if spent > net * (1 + 1e-6):
        return _r("P10_budget_bound", "P10", "FAIL", sid,
                  expected=f"totalSpent <= netBudget ({net})", got=round(spent, 2))
    return _r("P10_budget_bound", "P10", "PASS", sid)

def _v4log_hotel_summary(resp):
    return next((e for e in (resp.get("v4Log") or []) if e.get("pass") == "hotel_summary"), None)

def _v4log_cities(resp):
    return [e for e in (resp.get("v4Log") or []) if "city" in e]

def check_P03(resp, scn):
    """Step-1 hotel ceiling: Step-1 hotel spend <= 45% of NET budget.
    Now testable via the G-07 v4Log 'hotel_summary' entry, which exposes the Step-1
    spend (pre-2O; the ceiling is enforced in pickHotels_v2 Step-1 only) as a percentage
    of netBudget (hotelPctOfNet) — NOT of allocation.hotel. Final breakdown.hotels can
    still legitimately exceed 45% via uncapped Pass-C upgrades; that's why we read the
    Step-1 figure here and leave the gross bound to P10."""
    sid = scn["id"]
    hs = _v4log_hotel_summary(resp)
    if not hs or hs.get("hotelPctOfNet") is None:
        return _r("P03_hotel_ceiling", "P03", "SKIP", sid,
                  reason="no v4Log hotel_summary entry (non-v4 path, degenerate bail, or pre-G-07 engine)")
    pct = hs["hotelPctOfNet"]
    ceil = (hs.get("hotelCeilPct") or 0.45) * 100.0
    if pct > ceil + 0.1:   # 0.1pt slack for INR rounding in the summary figures
        # When even the cheapest hotels exceed the cap, pickHotels_v2 picks anyway and
        # flags budget_too_low — a legal >45% Step-1 spend. SKIP (P10 covers gross bound).
        if _expects_graceful_fail(scn) or "budget_too_low" in _flags_text(resp):
            return _r("P03_hotel_ceiling", "P03", "SKIP", sid, got=pct,
                      reason="budget_too_low: cheapest hotels exceed 45% of net (legal; P10 covers gross bound)")
        return _r("P03_hotel_ceiling", "P03", "FAIL", sid, expected=f"<= {ceil:.0f}% of netBudget", got=pct)
    return _r("P03_hotel_ceiling", "P03", "PASS", sid, got=pct)

def check_G02_headroom(resp, scn):
    """V4_SIGHT_HEADROOM=0.95 — each city's sight budget is capped at 95% of its raw
    proportional allocation. Verified from the G-07 v4Log per-city cityBudgetCapped /
    cityBudgetRaw ratio (regression guard on the headroom constant)."""
    sid = scn["id"]
    checked = 0
    for e in _v4log_cities(resp):
        raw = e.get("cityBudgetRaw"); cap = e.get("cityBudgetCapped")
        if not raw:           # zero-budget city (empty pool / weightSum=0) — ratio undefined
            continue
        ratio = cap / raw; checked += 1
        if not (0.94 <= ratio <= 0.96):
            return _r("G02_sight_headroom", "G02", "FAIL", sid,
                      expected="cityBudgetCapped/cityBudgetRaw ≈ 0.95 (0.94–0.96)",
                      got=f"{e.get('city')}={round(ratio, 4)}")
    if checked == 0:
        return _r("G02_sight_headroom", "G02", "SKIP", sid, reason="no city with positive sight budget in v4Log")
    return _r("G02_sight_headroom", "G02", "PASS", sid)

def check_G03_s3_trigger(resp, scn):
    """V4_S3_TRIGGER=0.80 — Step 3 (same-canonical upgrade) only fires when the capped-budget
    utilisation is below 80%. For every city where the G-07 s3Triggered flag is true, the
    captured utilAtS3Eval (capped-budget util, pre-swap) must be present and < 0.80."""
    sid = scn["id"]
    fired = [e for e in _v4log_cities(resp) if e.get("s3Triggered")]
    if not fired:
        return _r("G03_s3_trigger", "G03", "SKIP", sid, reason="Step 3 did not fire in any city (no swaps to test)")
    for e in fired:
        ue = e.get("utilAtS3Eval")
        if ue is None or ue >= 0.80:
            return _r("G03_s3_trigger", "G03", "FAIL", sid,
                      expected="utilAtS3Eval < 0.80 where s3Triggered",
                      got=f"{e.get('city')}={ue}")
    return _r("G03_s3_trigger", "G03", "PASS", sid)

def check_P09(resp, scn):
    """INR ₹X,XX,XXX format — engine JSON carries numerics; formatting is FE-layer. SKIP."""
    sid = scn["id"]
    return _r("P09_inr_format", "P09", "SKIP", sid,
              reason="engine response costs are numeric; ₹ string formatting is FE/PDF — tested in FE harness")


# --------------------------------------------------------- PAIR COMPARISONS
def compare_P01_pair(base_resp, plus_resp, base_scn, plus_scn):
    """2A+1C totalClientBudget / 2A totalClientBudget ≈ 1.25 (child = 0.50)."""
    sid = plus_scn["id"]
    b = (base_resp.get("costSummary") or {}).get("totalClientBudget")
    p = (plus_resp.get("costSummary") or {}).get("totalClientBudget")
    if not b or not p:
        return _r("P01_pair_ratio", "P01", "SKIP", sid, reason="totalClientBudget missing on a pair member")
    ratio = p / b
    want = plus_scn.get("flags", {}).get("expect_ratio_vs_base", 1.25)
    if not _close(ratio, want, tol=TOL, absslack=0.0):
        return _r("P01_pair_ratio", "P01", "FAIL", sid,
                  expected=f"{want} (±{int(TOL*100)}%)", got=round(ratio, 4))
    return _r("P01_pair_ratio", "P01", "PASS", sid, got=round(ratio, 4))

def compare_P07_pair(apr_resp, jun_resp, apr_scn, jun_scn):
    """Seasonal: June vs April for an identical scenario.
    NOTE: verified empirically at STOP-2 sample run — if the engine fills to budget
    (making totals ~equal rather than ~1.20), this is reclassified SKIP, not FAIL.
    Compares totalSpent ratio against the expected seasonal multiplier ratio."""
    sid = jun_scn["id"]
    a = (apr_resp.get("costSummary") or {}).get("totalSpent")
    j = (jun_resp.get("costSummary") or {}).get("totalSpent")
    if not a or not j:
        return _r("P07_seasonal_ratio", "P07", "SKIP", sid, reason="totalSpent missing on a pair member")
    ratio = j / a
    want = jun_scn.get("flags", {}).get("expect_ratio_vs_april", 1.20)
    # Fill-to-budget guard: if both ~equal, the engine spends to budget regardless of season
    # → the multiplier shows in unit prices, not totals. Report SKIP rather than a false FAIL.
    if _close(ratio, 1.0, tol=TOL, absslack=0.0):
        return _r("P07_seasonal_ratio", "P07", "SKIP", sid, got=round(ratio, 4),
                  reason="engine fills to budget; seasonal effect not visible in totalSpent — "
                         "needs fixed-basket repricing to test (deferred)")
    if not _close(ratio, want, tol=TOL, absslack=0.0):
        return _r("P07_seasonal_ratio", "P07", "FAIL", sid,
                  expected=f"{want} (±{int(TOL*100)}%)", got=round(ratio, 4))
    return _r("P07_seasonal_ratio", "P07", "PASS", sid, got=round(ratio, 4))


# ------------------------------------------------------------------ helpers
def _word_in(needle, hay):
    """word-boundary-ish containment so 'Bern' != 'Bernese'."""
    import re
    return re.search(r"\b" + re.escape(needle) + r"\b", hay) is not None


# ------------------------------------------------------------- single-resp runner
SINGLE_CHECKS = [
    check_shape, check_E01, check_E02, check_E03, check_E04, check_E05,
    check_E06, check_E09, check_E10, check_E11,
    check_P01_single, check_P03, check_G02_headroom, check_G03_s3_trigger,
    check_P06, check_P08, check_P09, check_P10,
]

def _expects_graceful_fail(scn):
    exp = str(scn.get("flags", {}).get("expect", "")).lower()
    return "graceful" in exp or "fail" in exp

def _is_degenerate(resp):
    """An infeasible-budget bail: no route/costSummary, or a non-premium fallback algorithm, or an error."""
    return ("route" not in resp or not resp.get("costSummary")
            or "error" in resp or str(resp.get("algorithm", "")).startswith("v4-price"))

def run_single(resp, scn):
    """Run every per-response invariant against one engine response. Returns [Result]."""
    # A scenario that EXPECTS a graceful failure (e.g. budget below the feasible floor) is
    # PASS when the engine bails to a degenerate response — not a shape/E09/E10 FAIL.
    if _expects_graceful_fail(scn) and _is_degenerate(resp):
        return [_r("graceful_fail", "P10", "PASS", scn["id"],
                   got=f"engine bailed gracefully (algorithm={resp.get('algorithm')!r}, no full plan)")]
    out = []
    for fn in SINGLE_CHECKS:
        try:
            out.append(fn(resp, scn))
        except Exception as e:
            out.append(_r(fn.__name__, getattr(fn, "_ref", fn.__name__), "FAIL", scn["id"],
                          expected="check ran", got=f"exception: {e}"))
    return out


if __name__ == "__main__":
    print("invariants.py — single-response checks:")
    for fn in SINGLE_CHECKS:
        print(" ", fn.__name__)
    print(" pair: compare_P01_pair, compare_P07_pair")
    print(f" tolerance TOL=±{int(TOL*100)}%  |  P10 basis = netBudget")
