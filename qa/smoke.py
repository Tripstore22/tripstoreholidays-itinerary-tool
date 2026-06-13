#!/usr/bin/env python3
"""
Night Guardian — smoke gate (STOP 3).  THE pre-promote gate.

  python3 smoke.py --seam engine|pricing|data|all --env dev|live [--capture]

Seams:
  engine   golden scenarios -> engine invariants (E*) + shape + golden diff
  pricing  golden scenarios -> pricing invariants (P*) + P01/P07 pair comparisons
  data     read-only sheet scans (T04/T05/T08/T14) + code greps (T01/T11/T15/D08)
  all      all of the above

Env:
  dev   POST -> DEV_PINNED_DEPLOY_ID; engine/pricing run the FIXED 12 golden scenarios
  live  POST -> LIVE_DEPLOY_ID; engine/pricing run ONLY live_safe scenarios (read-only,
        a bare engine POST writes nothing — verified at STOP 5)

--capture  (re)write qa/goldens/<id>.json for the golden set, and qa/quote_log_header.lock.
           Capture establishes the baseline; normal runs DIFF against it.

Status model — FOUR states, all counted separately:
  PASS  · FAIL (red, exits non-zero) · SKIP (not testable here, reason given)
  KNOWN (a FAIL matching qa/known_issues.json, keyed to a registry # — yellow, tracked,
         never silent-passed, never red).  Exit code is non-zero ONLY when FAIL > 0.

Runtime target < 3 min.  Read-only against sheets.  Touches no clasp/app/HTML.
"""
import argparse, json, os, re, sys, urllib.request, subprocess
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))   # qa/ — lives in the Itinerary-Create repo
# tripstore-pipeline holds .deployment_ids, sheets-credentials.json and the clasp .gs code.
# It is NOT part of this repo. Local runs find it as a sibling (or $TRIPSTORE_PIPELINE);
# GitHub-Actions CI has no access to it -> PIPE is None there and pipeline-dependent checks SKIP.
PIPE = os.environ.get("TRIPSTORE_PIPELINE") or os.path.expanduser("~/Desktop/tripstore-pipeline")
if not os.path.isdir(PIPE):
    PIPE = None
LIVE_SHEET = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
VOLATILE_KEYS = {"v4Log", "timestamp", "generatedAt", "genId", "id", "_id", "requestId"}

sys.path.insert(0, HERE)
import invariants as inv


# ----------------------------------------------------------------- infra
def load_ids():
    d = {}
    if not PIPE:
        return d
    p = os.path.join(PIPE, ".deployment_ids")
    if not os.path.exists(p):
        return d
    for line in open(p):
        line = line.strip()
        if line and "=" in line and not line.startswith("#") and not line.startswith("//"):
            k, v = line.split("=", 1); d[k.strip()] = v.strip()
    return d

def engine_url(env):
    key = "DEV_PINNED_DEPLOY_ID" if env == "dev" else "LIVE_DEPLOY_ID"
    # CI (public repo): the anonymous DEV pin comes from a repo VARIABLE in the env.
    # Local: from tripstore-pipeline/.deployment_ids.
    pin = os.environ.get(key) or load_ids().get(key)
    if not pin:
        raise SystemExit(f"[smoke] no deploy id for {key}: set env {key} (CI repo variable) "
                         f"or provide {PIPE or '~/Desktop/tripstore-pipeline'}/.deployment_ids")
    return f"https://script.google.com/macros/s/{pin}/exec"

def post(url, scn):
    p = {"algorithm": "v4-premium", "adults": scn["pax"]["adults"], "children": scn["pax"]["children"],
         "cities": [{"city": c, "nights": n} for c, n in zip(scn["cities"], scn["nights"])],
         "budgetPerPerson": scn["budget"], "vehicle": "sedan", "markupPct": 15, "gstOnMarkupPct": 18,
         "travelStartDate": scn.get("travelStartDate", f"2026-{scn.get('month', 7):02d}-15")}
    req = urllib.request.Request(url, data=json.dumps({"action": "computeItinerary", "params": p}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode())

def load_scenarios():
    return json.load(open(os.path.join(HERE, "scenarios.json")))["scenarios"]

def load_known():
    try:
        return json.load(open(os.path.join(HERE, "known_issues.json")))["known"]
    except Exception:
        return []

def apply_known(res, known):
    """Reclassify a FAIL -> KNOWN if it matches an allowlist entry (all match-fields must match)."""
    if res["status"] != "FAIL":
        return res
    for k in known:
        m = k.get("match", {})
        if not all(res.get(field) == val for field, val in m.items()):
            continue
        # ratchet: a count-bearing FAIL is only KNOWN while count <= max_count;
        # a NEW occurrence beyond the known baseline stays a red FAIL.
        if "max_count" in k and res.get("count", 0) > k["max_count"]:
            continue
        res = dict(res)
        res["status"] = "KNOWN"
        res["registry_ref"] = k["registry_ref"]
        res["known_note"] = k.get("note", "")
        return res
    return res


# ----------------------------------------------------------------- golden diff
def normalize(resp):
    """Strip volatile fields + round numerics so a deterministic engine diffs clean."""
    def walk(x):
        if isinstance(x, dict):
            return {k: walk(v) for k, v in x.items() if k not in VOLATILE_KEYS}
        if isinstance(x, list):
            return [walk(v) for v in x]
        if isinstance(x, float):
            return round(x)            # nearest rupee
        return x
    return walk(resp)

def golden_path(sid):
    return os.path.join(HERE, "goldens", f"{sid}.json")

def golden_check(sid, resp, capture):
    norm = normalize(resp)
    gp = golden_path(sid)
    if capture:
        with open(gp, "w") as f:
            json.dump(norm, f, indent=1, ensure_ascii=False)
        return inv._r("golden_capture", "golden", "PASS", sid, got="captured")
    if not os.path.exists(gp):
        return inv._r("golden_diff", "golden", "SKIP", sid, reason="no golden yet — run --capture")
    want = json.load(open(gp))
    if normalize(want) == norm:          # normalize(want) re-rounds in case file is older
        return inv._r("golden_diff", "golden", "PASS", sid)
    # locate first divergence at top level for a useful message
    diffk = [k for k in set(list(norm) + list(want)) if norm.get(k) != want.get(k)]
    return inv._r("golden_diff", "golden", "FAIL", sid,
                  expected="match golden (volatile-stripped)", got=f"diverged at {sorted(diffk)}")


# ----------------------------------------------------------------- seams
def seam_engine(scns, env, capture, known):
    url = engine_url(env)
    results = []
    e_checks = {"shape", "E01_departure_empty", "E02_full_caps", "E03_arrival_caps",
                "E04_no_cross_city_dup", "E05_daytrip_guard", "E06_anchor_placed",
                "E09_empty_day_flagged", "E10_algorithm_stated", "E11_no_phantom_leg"}
    for scn in scns:
        try:
            resp = post(url, scn)
        except Exception as e:
            results.append(inv._r("engine_post", "shape", "FAIL", scn["id"], got=f"POST failed: {e}"))
            continue
        for res in inv.run_single(resp, scn):
            if res["check"] in e_checks:
                results.append(apply_known(res, known))
        results.append(golden_check(scn["id"], resp, capture))
    return results

def seam_pricing(scns, env, capture, known):
    url = engine_url(env)
    results = []
    p_checks = {"P01_child_factor", "P03_hotel_ceiling", "P06_markup_gst",
                "P08_utilisation", "P09_inr_format", "P10_budget_bound"}
    cache = {}
    for scn in scns:
        try:
            resp = post(url, scn); cache[scn["id"]] = resp
        except Exception as e:
            results.append(inv._r("engine_post", "shape", "FAIL", scn["id"], got=f"POST failed: {e}"))
            continue
        for res in inv.run_single(resp, scn):
            if res["check"] in p_checks:
                results.append(apply_known(res, known))
    # pair comparisons (need both members; fetch any missing from full bank)
    allbank = {s["id"]: s for s in load_scenarios()}
    def get(sid):
        if sid in cache: return cache[sid]
        cache[sid] = post(url, allbank[sid]); return cache[sid]
    for pid, a, b, fn in [
        ("child_01", "pair_child_01_a", "pair_child_01_b", inv.compare_P01_pair),
        ("season_01", "pair_season_01_apr", "pair_season_01_jun", inv.compare_P07_pair),
    ]:
        if a in allbank and b in allbank:
            try:
                results.append(apply_known(fn(get(a), get(b), allbank[a], allbank[b]), known))
            except Exception as e:
                results.append(inv._r(f"pair_{pid}", "P07" if "season" in pid else "P01", "FAIL",
                                      b, got=f"pair failed: {e}"))
    return results

def _grep(pattern, paths, exclude=("_backups", ".venv", "/qa/", "node_modules", ".git")):
    """Return list of 'file:line: text' matches; read-only."""
    hits = []
    for base in paths:
        if not os.path.exists(base): continue
        for root, dirs, files in os.walk(base):
            if any(x in root for x in exclude): continue
            for fn in files:
                if not fn.endswith((".gs", ".js", ".py")): continue
                fp = os.path.join(root, fn)
                if any(x in fp for x in exclude): continue
                try:
                    for i, line in enumerate(open(fp, errors="ignore"), 1):
                        if re.search(pattern, line):
                            hits.append(f"{os.path.relpath(fp, PIPE)}:{i}")
                except Exception:
                    pass
    return hits

def seam_data(capture, known):
    results = []
    # --- code greps: need the clasp .gs code, which lives in tripstore-pipeline (NOT this repo) ---
    if not PIPE:
        for ref, chk in [("T01", "T01_no_append_row"), ("T11", "T11_falsy_zero_neg_sentinel"),
                         ("T15", "T15_no_sightseeing_v2"), ("D08", "D08_no_debug_markers")]:
            results.append(inv._r(chk, ref, "SKIP", "data",
                                  reason="clasp .gs code not in this repo — code greps are local-only (public-CI safe)"))
    else:
        clasp_live = os.path.join(PIPE, "clasp-live")
        code_paths = [os.path.join(PIPE, "clasp-dev"), clasp_live, os.path.join(PIPE, "12files")]
        t01 = _grep(r"\.append_row\b", code_paths)
        results.append(_chk("T01", "T01_no_append_row", t01, "zero append_row calls"))
        # T11: the bug is falsy-zero clobbered by a NEGATIVE sentinel (parseInt('0')||-1 blocked gap=0).
        # `|| 0`, `|| 999`, `|| 1` are benign default idioms — only the negative-sentinel form is dangerous.
        t11 = _grep(r"parseInt\s*\([^)]*\)\s*\|\|\s*-\s*\d", code_paths)
        results.append(_chk("T11", "T11_falsy_zero_neg_sentinel", t11, "zero `parseInt(x) || -N` patterns"))
        t15 = _grep(r"Sightseeing_v2", [clasp_live])
        results.append(_chk("T15", "T15_no_sightseeing_v2", t15, "zero Sightseeing_v2 refs in clasp-live", known=known))
        d08 = _grep(r"testAgentProfileLookup", [clasp_live])
        results.append(_chk("D08", "D08_no_debug_markers", d08, "no testAgentProfileLookup() in clasp-live",
                            known=known))

    # --- sheet scans: need sheets-credentials.json. NEVER in a public repo -> local-only ---
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or (PIPE and os.path.join(PIPE, "sheets-credentials.json"))
    if not creds or not os.path.exists(creds):
        for ref, chk in [("T04", "T04_hours_gt_14"), ("T05", "T05_hours_lt_0.25"),
                         ("T08", "T08_combo_a1_self_ref"), ("T14", "T14_quote_log_schema")]:
            results.append(inv._r(chk, ref, "SKIP", "data",
                                  reason="no sheet credentials (expected in public CI) — sheet scans run locally"))
        return results
    try:
        import gspread
        gc = gspread.service_account(filename=creds)
        ss = gc.open_by_key(LIVE_SHEET)
        ws = ss.worksheet("Sightseeing")
        rows = ws.get_all_values()
        hdr = {h.strip(): i for i, h in enumerate(rows[0])}
        ci_h = _col(hdr, "Duration", "Average Hours", "Avg_Duration", "Hours")   # col E "8 hrs"/"2.5 hours"
        ci_can = _col(hdr, "Canonical_ID", "Canonical Id")
        ci_a1 = _col(hdr, "Attraction_1", "Attraction1")
        ci_combo = _col(hdr, "Is_Combo", "Is Combo")
        ci_name = _col(hdr, "Tour Name", "Tour_Name", "Name") or 0
        # T04 hours>14, T05 0<hours<0.25 — parse leading number WITH its unit.
        # col E mixes "8 hrs" / "75 minutes" / "2 days"; minutes->/60, day-unit excluded
        # (legit multiday, not a parser bug). Prevents minute-rows reading as 75h false-positives.
        def parse_hours(v):
            # Unit of the leading number is whichever unit-token appears FIRST.
            # Handles "8 hrs", "75 minutes", ranges ("40 - 45 minutes", "110 minutes - 2 hours"),
            # typos ("45 miln"), mixed ("1 hour 30 minutes"), and excludes multiday ("2 days").
            s = str(v).strip().lower()
            if not s or "day" in s: return None
            lead = re.match(r"([\d.]+)", s)
            if not lead: return None
            n = float(lead.group(1))
            hm = re.search(r"h(?:ou)?r|hrs", s)
            mm = re.search(r"min|miln|mln|minute", s)
            if hm and mm:
                return n if hm.start() < mm.start() else n / 60.0
            if mm: return n / 60.0
            if hm: return n
            return n   # bare number -> hours
        t04, t05 = [], []
        if ci_h is not None:
            for r in rows[1:]:
                h = parse_hours(r[ci_h])
                if h is None: continue
                if h > 14: t04.append(f"{r[ci_name]}={r[ci_h]}")
                elif 0 < h < 0.25: t05.append(f"{r[ci_name]}={r[ci_h]}")
            results.append(_chk("T04", "T04_hours_gt_14", t04, "no Sightseeing hours > 14", known=known))
            results.append(_chk("T05", "T05_hours_lt_0.25", t05, "no Sightseeing 0 < hours < 0.25", known=known))
        else:
            results.append(inv._r("T04_hours_gt_14", "T04", "SKIP", "data", reason="Duration column not found"))
            results.append(inv._r("T05_hours_lt_0.25", "T05", "SKIP", "data", reason="Duration column not found"))
        # T08 — registry scope is COMBO self-reference: Is_Combo=YES AND Attraction_1 == own Canonical_ID
        if None not in (ci_can, ci_a1, ci_combo):
            t08 = [r[ci_can] for r in rows[1:]
                   if str(r[ci_combo]).strip().upper() == "YES"
                   and r[ci_a1].strip() and r[ci_a1].strip() == r[ci_can].strip()]
            results.append(_chk("T08", "T08_combo_a1_self_ref", t08,
                                "no combo row where Attraction_1 == own Canonical_ID", known=known))
        else:
            results.append(inv._r("T08_combo_a1_self_ref", "T08", "SKIP", "data",
                                  reason="A1/Canonical_ID/Is_Combo column not found"))
        # T14 Quote_Log header hash vs lock
        import hashlib
        qhdr = ss.worksheet("Quote_Log").row_values(1)
        qhash = hashlib.sha256("|".join(qhdr).encode()).hexdigest()[:16]
        lock = os.path.join(HERE, "quote_log_header.lock")
        if capture or not os.path.exists(lock):
            open(lock, "w").write(qhash)
            results.append(inv._r("T14_quote_log_schema", "T14", "PASS", "data", got=f"lock set {qhash}"))
        else:
            want = open(lock).read().strip()
            if want == qhash:
                results.append(inv._r("T14_quote_log_schema", "T14", "PASS", "data"))
            else:
                results.append(inv._r("T14_quote_log_schema", "T14", "FAIL", "data",
                                      expected=f"header hash {want}", got=qhash))
    except Exception as e:
        for ref, chk in [("T04", "T04_hours_gt_14"), ("T05", "T05_hours_lt_0.25"),
                         ("T08", "T08_a1_self_ref"), ("T14", "T14_quote_log_schema")]:
            results.append(inv._r(chk, ref, "SKIP", "data", reason=f"sheet scan unavailable: {type(e).__name__}: {e}"))
    return results

def _col(hdr, *names):
    for n in names:
        if n in hdr: return hdr[n]
    return None

def _chk(ref, check, hits, expected, known=None):
    if not hits:
        return inv._r(check, ref, "PASS", "data")
    res = inv._r(check, ref, "FAIL", "data", expected=expected, got=f"{len(hits)} hit(s): {hits[:3]}")
    res["count"] = len(hits)            # for max_count ratchet matching
    return apply_known(res, known) if known else res


# ----------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seam", choices=["engine", "pricing", "data", "all"], default="all")
    ap.add_argument("--env", choices=["dev", "live"], default="dev")
    ap.add_argument("--capture", action="store_true")
    a = ap.parse_args()

    bank = load_scenarios()
    known = load_known()
    if a.env == "live":
        scns = [s for s in bank if s.get("live_safe")]
        scope = f"{len(scns)} live_safe scenarios"
    else:
        scns = [s for s in bank if s.get("golden")]
        scope = f"{len(scns)} golden scenarios"

    print(f"== Night Guardian smoke ==  seam={a.seam}  env={a.env}  ({scope})"
          + ("  [CAPTURE]" if a.capture else ""))
    results = []
    if a.seam in ("engine", "all"):
        print(f"\n-- engine seam --"); results += _emit(seam_engine(scns, a.env, a.capture, known))
    if a.seam in ("pricing", "all"):
        print(f"\n-- pricing seam --"); results += _emit(seam_pricing(scns, a.env, a.capture, known))
    if a.seam in ("data", "all"):
        print(f"\n-- data seam --"); results += _emit(seam_data(a.capture, known))

    c = Counter(r["status"] for r in results)
    print(f"\n=== SUMMARY  PASS={c['PASS']}  FAIL={c['FAIL']}  KNOWN={c['KNOWN']}  SKIP={c['SKIP']} ===")
    if c["KNOWN"]:
        print("KNOWN (tracked, not failing):")
        for r in results:
            if r["status"] == "KNOWN":
                print(f"  [{r['registry_ref']}] {r['check']} {r['scenario_id']}")
    verdict = "GREEN" if c["FAIL"] == 0 else "RED"
    tail = "" if c["KNOWN"] == 0 and c["SKIP"] == 0 else f" ({c['KNOWN']} known, {c['SKIP']} deferred)"
    print(f"VERDICT: {verdict}{tail}")
    sys.exit(1 if c["FAIL"] else 0)

def _emit(results):
    for r in results:
        line = f"  {r['status']:5s} [{r['registry_ref']:6s}] {r['check']:24s} {r.get('scenario_id','')}"
        if r["status"] in ("FAIL", "KNOWN"):
            line += f"  -> {r.get('got', r.get('known_note',''))}"
        elif r["status"] == "SKIP":
            line += f"  ({r.get('reason','')[:60]})"
        print(line)
    return results

if __name__ == "__main__":
    main()
