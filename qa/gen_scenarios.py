#!/usr/bin/env python3
"""
Night Guardian — scenario-bank generator (STOP 1).
Emits qa/scenarios.json: ~100 itinerary scenarios as PURE DATA.

Each scenario:
  { id, category, registry_refs[], cities[], nights[], pax{adults,children,child_ages?},
    budget (per-person INR), month (1-12), travelStartDate?, flags{}, golden?, live_safe? }

The runner zips cities[]+nights[] into the engine's params.cities=[{city,nights}].
No invariant logic lives here — this file is the data bank only.
Coverage goal: every row in MASTER_BUG_REGISTRY "EDGE CASES" section -> >=1 scenario.
"""
import json, os

S = []

def add(**kw):
    kw.setdefault("flags", {})
    kw.setdefault("month", 7)  # default July (peak season, 1.30) unless overridden
    S.append(kw)

# ---------------------------------------------------------------------------
# A) ~40 TOP ITINERARIES — realistic spread across live cities, mid budgets.
#    registry_refs = the always-on invariants every healthy response must pass.
# ---------------------------------------------------------------------------
BASE_E = ["E01", "E02", "E03", "E09", "E11"]      # day/cap/empty/phantom-leg
BASE_P = ["P06", "P08", "P09", "P10"]             # markup-GST / util / INR / budget
TOP = BASE_E + BASE_P

top_routes = [
    # (label, [(city,nights),...], adults, children, budget_pp, month)
    ("paris_5n_couple",        [("Paris",5)], 2, 0, 200000, 7),
    ("london_4n_couple",       [("London",4)], 2, 0, 180000, 6),
    ("rome_5n_couple",         [("Rome",5)], 2, 0, 190000, 5),
    ("amsterdam_4n_couple",    [("Amsterdam",4)], 2, 0, 170000, 9),
    ("barcelona_5n_couple",    [("Barcelona",5)], 2, 0, 175000, 6),
    ("prague_4n_couple",       [("Prague",4)], 2, 0, 150000, 5),
    ("budapest_4n_couple",     [("Budapest",4)], 2, 0, 145000, 4),
    ("vienna_4n_couple",       [("Vienna",4)], 2, 0, 165000, 5),
    ("madrid_5n_couple",       [("Madrid",5)], 2, 0, 175000, 6),
    ("lisbon_4n_couple",       [("Lisbon",4)], 2, 0, 150000, 9),
    ("milan_4n_couple",        [("Milan",4)], 2, 0, 185000, 6),
    ("florence_4n_couple",     [("Florence",4)], 2, 0, 180000, 5),
    ("venice_3n_couple",       [("Venice",3)], 2, 0, 175000, 6),
    ("berlin_4n_couple",       [("Berlin",4)], 2, 0, 150000, 7),
    ("zurich_3n_couple",       [("Zurich",3)], 2, 0, 200000, 7),
    # multi-city
    ("paris_amsterdam_7n",     [("Paris",4),("Amsterdam",3)], 2, 0, 260000, 7),
    ("rome_florence_venice_8n",[("Rome",3),("Florence",2),("Venice",3)], 2, 0, 300000, 6),
    ("swiss_classic_10n",      [("Zurich",2),("Lucerne",3),("Interlaken",3),("Geneva",2)], 2, 0, 1050000, 7),
    ("paris_swiss_9n",         [("Paris",4),("Zurich",2),("Interlaken",3)], 2, 0, 500000, 7),
    ("london_paris_8n",        [("London",4),("Paris",4)], 2, 0, 320000, 8),
    ("barcelona_madrid_8n",    [("Barcelona",4),("Madrid",4)], 2, 0, 290000, 6),
    ("prague_vienna_budapest", [("Prague",3),("Vienna",3),("Budapest",3)], 2, 0, 280000, 5),
    ("amsterdam_paris_rome",   [("Amsterdam",3),("Paris",3),("Rome",3)], 2, 0, 330000, 9),
    ("italy_grand_10n",        [("Rome",3),("Florence",2),("Venice",2),("Milan",3)], 2, 0, 360000, 6),
    ("lisbon_madrid_barcelona",[("Lisbon",3),("Madrid",3),("Barcelona",3)], 2, 0, 300000, 9),
    # families (2A + children)
    ("paris_family_6n",        [("Paris",6)], 2, 2, 240000, 7),
    ("london_family_5n",       [("London",5)], 2, 1, 220000, 8),
    ("swiss_family_8n",        [("Zurich",2),("Lucerne",3),("Interlaken",3)], 2, 2, 600000, 7),
    ("rome_family_5n",         [("Rome",5)], 2, 2, 230000, 6),
    ("amsterdam_family_4n",    [("Amsterdam",4)], 2, 1, 200000, 9),
    ("barcelona_family_6n",    [("Barcelona",6)], 2, 3, 240000, 6),
    ("paris_disney_family",    [("Paris",5)], 2, 2, 260000, 4),
    ("prague_family_4n",       [("Prague",4)], 2, 1, 170000, 5),
    ("madrid_family_5n",       [("Madrid",5)], 2, 2, 220000, 6),
    # longer / richer
    ("euro_whirlwind_10n",     [("London",2),("Paris",2),("Amsterdam",2),("Rome",2),("Barcelona",2)], 2, 0, 400000, 7),
    ("paris_7n_couple_lux",    [("Paris",7)], 2, 0, 400000, 7),
    ("swiss_montreux_7n",      [("Geneva",2),("Montreux",2),("Zurich",3)], 2, 0, 450000, 7),
    ("italy_couple_6n",        [("Rome",3),("Venice",3)], 2, 0, 250000, 6),
    ("london_5n_lux",          [("London",5)], 2, 0, 320000, 6),
    ("vienna_budapest_6n",     [("Vienna",3),("Budapest",3)], 2, 0, 240000, 5),
]
GOLD_TOP = {"paris_5n_couple", "swiss_classic_10n", "rome_florence_venice_8n",
            "london_paris_8n", "paris_family_6n", "amsterdam_4n_couple"}
LIVE_SAFE = {"prague_4n_couple", "budapest_4n_couple", "lisbon_4n_couple"}  # smallest/cheapest single-city

for label, route, a, c, b, m in top_routes:
    cities = [x[0] for x in route]
    nights = [x[1] for x in route]
    add(id=f"top_{label}", category="top", registry_refs=TOP,
        cities=cities, nights=nights, pax={"adults": a, "children": c},
        budget=b, month=m,
        golden=(label in GOLD_TOP), live_safe=(label in LIVE_SAFE))

# ---------------------------------------------------------------------------
# B) ~60 EDGE CASES — every row in the registry EDGE CASES section -> >=1 scenario.
#    Engine-testable ones carry real invariant refs. FE-state / data-poison /
#    wallet / whatsapp ones are tagged scope+deferred (not bare-POST testable)
#    but kept in the bank for the ratchet (registry completeness).
# ---------------------------------------------------------------------------

# -- Pax & rooms --
add(id="edge_pax_1adult_solo", category="pax_rooms", registry_refs=["E08"]+BASE_P,
    cities=["Paris"], nights=[4], pax={"adults":1,"children":0}, budget=180000, golden=True)
add(id="edge_pax_2a4c", category="pax_rooms", registry_refs=["P01"]+BASE_P,
    cities=["Paris"], nights=[5], pax={"adults":2,"children":4,"child_ages":[3,5,7,9]}, budget=240000)
add(id="edge_pax_child_age_1", category="pax_rooms", registry_refs=["P01"],
    cities=["Rome"], nights=[4], pax={"adults":2,"children":1,"child_ages":[1]}, budget=200000,
    flags={"child_boundary":"low"})
add(id="edge_pax_child_age_17", category="pax_rooms", registry_refs=["P01"],
    cities=["Rome"], nights=[4], pax={"adults":2,"children":1,"child_ages":[17]}, budget=200000,
    flags={"child_boundary":"high"})
add(id="edge_pax_6adults_3rooms", category="pax_rooms", registry_refs=["E08"]+BASE_P,
    cities=["Amsterdam"], nights=[4], pax={"adults":6,"children":0}, budget=180000,
    flags={"rooms_expected":3})
add(id="edge_pax_3adults_oddroom", category="pax_rooms", registry_refs=["E08"]+BASE_P,
    cities=["Barcelona"], nights=[4], pax={"adults":3,"children":0}, budget=180000,
    flags={"odd_adults":True})

# P01 paired sets (2A vs 2A+1C, identical otherwise) — child math == ×1.25
for i,(city,n,b,m) in enumerate([("Paris",5,200000,7),("Rome",4,190000,6),("Prague",4,150000,5)],1):
    pid=f"child_{i:02d}"
    add(id=f"pair_{pid}_a", category="pax_rooms", registry_refs=["P01"],
        cities=[city], nights=[n], pax={"adults":2,"children":0}, budget=b, month=m,
        flags={"pair":pid,"pair_role":"base_2A"})
    add(id=f"pair_{pid}_b", category="pax_rooms", registry_refs=["P01"],
        cities=[city], nights=[n], pax={"adults":2,"children":1,"child_ages":[8]}, budget=b, month=m,
        flags={"pair":pid,"pair_role":"plus_1C","expect_ratio_vs_base":1.25})

# -- Nights --
add(id="edge_nights_1n", category="nights", registry_refs=["E01","E09"],
    cities=["Paris"], nights=[1], pax={"adults":2,"children":0}, budget=120000,
    flags={"zero_full_days":True,"expect":"no_crash_no_tours_on_only_day"}, golden=True)
add(id="edge_nights_2n", category="nights", registry_refs=["E01"]+BASE_P,
    cities=["Rome"], nights=[2], pax={"adults":2,"children":0}, budget=140000)
add(id="edge_nights_14n", category="nights", registry_refs=["E01","E02"]+BASE_P,
    cities=["Paris"], nights=[14], pax={"adults":2,"children":0}, budget=500000,
    flags={"long_tail":True})
add(id="edge_nights_mismatch", category="nights", registry_refs=["E01"],
    cities=["Paris","Rome"], nights=[3,4], pax={"adults":2,"children":0}, budget=260000,
    flags={"note":"city-nights sum=7; assert engine echoes per-city nights consistently"})

# -- Budget extremes --
add(id="edge_budget_below_floor", category="budget", registry_refs=["P10"],
    cities=["Zurich","Interlaken"], nights=[3,3], pax={"adults":2,"children":0}, budget=40000,
    flags={"expect":"graceful_fail_or_flag","not":"garbage"})
add(id="edge_budget_absurd_50L", category="budget", registry_refs=["E02","P03","P10"],
    cities=["Paris"], nights=[5], pax={"adults":2,"children":0}, budget=5000000,
    flags={"expect":"caps_still_bind"}, golden=True)
add(id="edge_budget_boundary", category="budget", registry_refs=["P10","P03"],
    cities=["Rome"], nights=[4], pax={"adults":2,"children":0}, budget=120000,
    flags={"expect":"at_or_near_min_feasible"})

# -- Route shapes --
add(id="edge_route_same_city_twice", category="route_shape", registry_refs=["E04"]+BASE_P,
    cities=["Paris","Nice","Paris"], nights=[3,2,2], pax={"adults":2,"children":0}, budget=280000,
    flags={"same_city_repeat":"Paris","note":"E04 dedup must allow legit same-city repeat (split stay)"},
    golden=True)
add(id="edge_route_single_7n", category="route_shape", registry_refs=["E01","E02"]+BASE_P,
    cities=["Paris"], nights=[7], pax={"adults":2,"children":0}, budget=300000)
add(id="edge_route_5city_10n", category="route_shape", registry_refs=["E04","E09"]+BASE_P,
    cities=["London","Paris","Amsterdam","Rome","Barcelona"], nights=[2,2,2,2,2],
    pax={"adults":2,"children":0}, budget=400000)
add(id="edge_route_zero_tour_city", category="route_shape", registry_refs=["E09"],
    cities=["Hallstatt"], nights=[3], pax={"adults":2,"children":0}, budget=180000,
    flags={"thin_inventory":True,"expect":"empty_days_flagged_not_silent"})
add(id="edge_route_not_whitelisted", category="route_shape", registry_refs=["E09","E10"],
    cities=["Reykjavik"], nights=[3], pax={"adults":2,"children":0}, budget=180000,
    flags={"expect":"graceful_fail_or_empty_flagged"})

# -- Dates / seasonal --
add(id="edge_date_month_boundary", category="dates", registry_refs=["P07"],
    cities=["Paris"], nights=[5], pax={"adults":2,"children":0}, budget=220000, month=5,
    travelStartDate="2026-05-29",
    flags={"spans":"May->June","assert":"which_rule_applies_seasonal_switch"})
add(id="edge_date_dec31_jan1", category="dates", registry_refs=["P07","F04"],
    cities=["Paris"], nights=[4], pax={"adults":2,"children":0}, budget=220000, month=12,
    travelStartDate="2026-12-31",
    flags={"year_rollover":True,"spread":"0.80_vs_1.15"})
add(id="edge_date_leap_feb29", category="dates", registry_refs=["F04"],
    cities=["Rome"], nights=[3], pax={"adults":2,"children":0}, budget=190000, month=2,
    travelStartDate="2028-02-29", flags={"leap_day":True})
add(id="edge_date_booking_eq_travel", category="dates", registry_refs=["F04"],
    cities=["Amsterdam"], nights=[3], pax={"adults":2,"children":0}, budget=170000, month=7,
    travelStartDate="2026-07-15", flags={"booking_eq_travel":True})

# P07 paired sets (April vs June, identical otherwise) — June/April total ~= 1.20
for i,(city,n,b) in enumerate([("Paris",5,220000),("Rome",4,200000),("Barcelona",5,210000)],1):
    pid=f"season_{i:02d}"
    add(id=f"pair_{pid}_apr", category="dates", registry_refs=["P07"],
        cities=[city], nights=[n], pax={"adults":2,"children":0}, budget=b, month=4,
        travelStartDate="2026-04-15", flags={"pair":pid,"pair_role":"april_1.00"})
    add(id=f"pair_{pid}_jun", category="dates", registry_refs=["P07"],
        cities=[city], nights=[n], pax={"adults":2,"children":0}, budget=b, month=6,
        travelStartDate="2026-06-15",
        flags={"pair":pid,"pair_role":"june_1.20","expect_ratio_vs_april":1.20})

# -- Swiss Pass --
add(id="edge_swisspass_no_swiss_cities", category="swiss_pass", registry_refs=["P12"],
    cities=["Paris","Rome"], nights=[3,3], pax={"adults":2,"children":0}, budget=260000,
    flags={"swiss_pass":True,"expect":"no_discount_leak_non_swiss"}, golden=True)
add(id="edge_swisspass_with_swiss", category="swiss_pass", registry_refs=["P12"],
    cities=["Zurich","Interlaken"], nights=[3,3], pax={"adults":2,"children":0}, budget=500000,
    flags={"swiss_pass":True,"expect":"discount_applies"})
add(id="edge_swisspass_toggle_midedit", category="swiss_pass", registry_refs=["F02","P12"],
    cities=["Lucerne"], nights=[3], pax={"adults":2,"children":0}, budget=300000,
    flags={"swiss_pass":"toggle","scope":"fe_state","deferred":"fe_harness"})
add(id="edge_swisspass_class_toggle", category="swiss_pass", registry_refs=["P12"],
    cities=["Interlaken"], nights=[3], pax={"adults":2,"children":0}, budget=300000,
    flags={"swiss_pass":"1st_2nd_class","scope":"future","deferred":"feature_unshipped"})

# -- Concurrency / state (save/version/wallet/ownership — not bare-POST testable) --
add(id="edge_state_two_agents_same_name", category="concurrency_state", registry_refs=["S04"],
    cities=["Paris"], nights=[4], pax={"adults":2,"children":0}, budget=200000,
    flags={"scope":"fe_state","deferred":"fe_harness","note":"ownership filter"})
add(id="edge_state_approve_while_edit", category="concurrency_state", registry_refs=["S02"],
    cities=["Rome"], nights=[4], pax={"adults":2,"children":0}, budget=200000,
    flags={"scope":"fe_state","deferred":"fe_harness"})
add(id="edge_state_save_during_pdf", category="concurrency_state", registry_refs=["S01","D01"],
    cities=["Amsterdam"], nights=[4], pax={"adults":2,"children":0}, budget=200000,
    flags={"scope":"fe_state","deferred":"fe_harness"})

# -- Data poison (needs DEV-sheet write; this brief is read-only -> deferred) --
for poison in ["hours_null","price_str_NA","negative_price","emoji_tour_name","hotel_name_500char"]:
    add(id=f"edge_poison_{poison}", category="data_poison",
        registry_refs=["T04","T05"] if "hours" in poison else ["E11","P10"],
        cities=["Paris"], nights=[4], pax={"adults":2,"children":0}, budget=200000,
        flags={"poison":poison,"scope":"data_poison","requires_dev_write":True,
               "deferred":"read_only_brief_cannot_inject"})

# -- Wallet (billing — not bare-POST testable) --
add(id="edge_wallet_balance_99", category="wallet", registry_refs=["S03"],
    cities=["Paris"], nights=[4], pax={"adults":2,"children":0}, budget=200000,
    flags={"wallet_balance":99,"scope":"billing","deferred":"fe_harness"})
add(id="edge_wallet_balance_0", category="wallet", registry_refs=["S03","S09"],
    cities=["Rome"], nights=[4], pax={"adults":2,"children":0}, budget=200000,
    flags={"wallet_balance":0,"scope":"billing","deferred":"fe_harness","expect":"clean_block_no_halfsave"})
add(id="edge_wallet_double_click_save", category="wallet", registry_refs=["S03"],
    cities=["Madrid"], nights=[4], pax={"adults":2,"children":0}, budget=200000,
    flags={"double_click_save":True,"scope":"billing","deferred":"fe_harness","expect":"idempotent"})

# -- WhatsApp (send-layer — not engine) --
add(id="edge_whatsapp_emoji_name", category="whatsapp", registry_refs=["D06"],
    cities=["Paris"], nights=[4], pax={"adults":2,"children":0}, budget=200000,
    flags={"pax_name":"Riya 🌸 \"VIP\"","scope":"whatsapp","deferred":"send_harness"})
add(id="edge_whatsapp_long_name", category="whatsapp", registry_refs=["D06"],
    cities=["Rome"], nights=[4], pax={"adults":2,"children":0}, budget=200000,
    flags={"pax_name":"A"*70,"scope":"whatsapp","deferred":"send_harness","expect":"truncation_safe"})

# extra engine-testable edge variants to round out coverage (~60)
add(id="edge_thin_milan_pressure", category="route_shape", registry_refs=["E12","E02"]+BASE_P,
    cities=["Milan"], nights=[6], pax={"adults":2,"children":0}, budget=600000,
    flags={"thin_pool":True,"expect":"caps_hold_util_may_drop"})
add(id="edge_anchor_disney_paris", category="route_shape", registry_refs=["E06","E02"],
    cities=["Paris"], nights=[5], pax={"adults":2,"children":0}, budget=260000,
    flags={"expect_anchor":"full_day_>=7h"})  # not golden — anchor coverage already in the 12
add(id="edge_xroute_swiss_daytrip", category="route_shape", registry_refs=["E04","E05"],
    cities=["Zurich","Lucerne","Interlaken"], nights=[2,3,3], pax={"adults":2,"children":0}, budget=900000,
    flags={"expect":"no_daytrip_to_route_city,no_cross_city_dup"}, golden=True)
add(id="edge_algo_assert", category="route_shape", registry_refs=["E10"],
    cities=["Prague"], nights=[4], pax={"adults":2,"children":0}, budget=170000,
    flags={"assert_algorithm":"v4-premium"})

# ---------------------------------------------------------------------------
out = os.path.join(os.path.dirname(__file__), "scenarios.json")
with open(out, "w") as f:
    json.dump({"version": 1, "count": len(S), "scenarios": S}, f, indent=2, ensure_ascii=False)
print(f"wrote {out}: {len(S)} scenarios")
