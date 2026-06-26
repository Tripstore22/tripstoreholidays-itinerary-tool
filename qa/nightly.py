#!/usr/bin/env python3
"""
Night Guardian — nightly runner (STOP 4).  Runs the FULL scenario bank (not just the
12 goldens) through the invariants, applies the SAME known_issues ratchet as smoke.py,
writes a dated report, and exits non-zero ONLY on a brand-new FAIL (or a known issue
exceeding its max_count). GREEN here == the same "green-with-known" as the promote gate.

  python3 nightly.py            # engine + pricing over all engine-testable scenarios

Public-repo / CI reality: the data seam (sheet scans + code greps) needs credentials and
the clasp .gs code, neither of which exists in this public repo, so those checks SKIP in CI
(they run locally via smoke.py). The engine POST uses the anonymous DEV pin (env var in CI).

Alerting is the workflow's job: it opens a GitHub Issue iff this script exits non-zero.
Silent on green.
"""
import concurrent.futures as cf
import datetime, json, os, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import invariants as inv
from smoke import (load_scenarios, load_known, apply_known, engine_url, post,
                   seam_data, _emit)

E_CHECKS = {"shape", "E01_departure_empty", "E02_full_caps", "E03_arrival_caps",
            "E04_no_cross_city_dup", "E05_daytrip_guard", "E06_anchor_placed",
            "E09_empty_day_flagged", "E10_algorithm_stated", "E11_no_phantom_leg"}
P_CHECKS = {"P01_child_factor", "P03_hotel_ceiling", "P06_markup_gst",
            "P08_utilisation", "P09_inr_format", "P10_budget_bound",
            "G02_sight_headroom", "G03_s3_trigger"}

def engine_testable(s):
    f = s.get("flags", {})
    if f.get("deferred") or f.get("requires_dev_write"):
        return False
    if str(f.get("scope", "")) in ("fe_state", "data_poison", "billing", "whatsapp", "future"):
        return False
    return True

def main():
    bank = load_scenarios()
    known = load_known()
    scns = [s for s in bank if engine_testable(s)]
    url = engine_url("dev")
    print(f"== Night Guardian NIGHTLY ==  {len(scns)} engine-testable scenarios (of {len(bank)})")

    # pre-fetch concurrently (<=3, polite to GAS quotas); cache shared by engine+pricing
    def fetch(s):
        try:
            return s["id"], post(url, s)
        except Exception as e:
            return s["id"], {"_error": str(e)}
    with cf.ThreadPoolExecutor(max_workers=3) as ex:
        responses = dict(ex.map(fetch, scns))

    results = []
    for s in scns:
        r = responses[s["id"]]
        if "_error" in r:
            results.append(inv._r("engine_post", "shape", "FAIL", s["id"], got=f"POST failed: {r['_error']}"))
            continue
        for res in inv.run_single(r, s):
            if res["check"] in E_CHECKS or res["check"] in P_CHECKS:
                results.append(apply_known(res, known))

    # pair comparisons (members are in scns; reuse cached responses)
    byid = {s["id"]: s for s in scns}
    for a, b, fn in [("pair_child_01_a", "pair_child_01_b", inv.compare_P01_pair),
                     ("pair_season_01_apr", "pair_season_01_jun", inv.compare_P07_pair)]:
        if a in responses and b in responses and "_error" not in responses[a] and "_error" not in responses[b]:
            results.append(apply_known(fn(responses[a], responses[b], byid[a], byid[b]), known))

    # data seam (local-only; SKIPs cleanly in public CI)
    results += seam_data(False, known)

    c = Counter(x["status"] for x in results)
    fails = [x for x in results if x["status"] == "FAIL"]

    # write dated report
    today = os.environ.get("NIGHTLY_DATE") or datetime.date.today().isoformat()
    os.makedirs(os.path.join(HERE, "reports"), exist_ok=True)
    rp = os.path.join(HERE, "reports", f"{today}.md")
    with open(rp, "w") as f:
        f.write(f"# Night Guardian — {today}\n\n")
        f.write(f"**PASS {c['PASS']} · FAIL {c['FAIL']} · KNOWN {c['KNOWN']} · SKIP {c['SKIP']}** "
                f"— verdict **{'RED' if fails else 'GREEN'}**\n\n")
        if fails:
            f.write("## NEW FAILURES (action required)\n")
            for x in fails:
                f.write(f"- [{x['registry_ref']}] `{x['check']}` {x['scenario_id']} — "
                        f"expected {x.get('expected','?')}, got {x.get('got','?')}\n")
            f.write("\n")
        f.write("## Known (tracked, not failing)\n")
        for x in results:
            if x["status"] == "KNOWN":
                f.write(f"- [{x['registry_ref']}] `{x['check']}` {x['scenario_id']}\n")

    print(f"\n=== NIGHTLY  PASS={c['PASS']}  FAIL={c['FAIL']}  KNOWN={c['KNOWN']}  SKIP={c['SKIP']} ===")
    print(f"report: {os.path.relpath(rp)}")
    if fails:
        print("NEW FAILURES:")
        for x in fails:
            print(f"  [{x['registry_ref']}] {x['check']} {x['scenario_id']} -> {x.get('got')}")
        print("VERDICT: RED")
        sys.exit(1)
    print(f"VERDICT: GREEN ({c['KNOWN']} known, {c['SKIP']} deferred)")
    sys.exit(0)

if __name__ == "__main__":
    main()
