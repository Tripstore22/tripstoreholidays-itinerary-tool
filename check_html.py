#!/usr/bin/env python3
"""
index_fit.tripstore.html static validator.
Run before making ANY change to the HTML file.
Usage: python3 check_html.py
"""

import re, sys, os

ROOT     = os.path.dirname(os.path.abspath(__file__))
HTML     = os.path.join(ROOT, 'index_fit.tripstore.html')
INDEX    = os.path.join(ROOT, 'index.html')

errors   = []
warnings = []

def fail(msg): errors.append('❌  ' + msg)
def warn(msg): warnings.append('⚠️   ' + msg)
def ok(msg):   print('✅  ' + msg)

# ── READ FILE ──────────────────────────────────────────────────────────────────

if not os.path.exists(HTML):
    fail(f'HTML file not found: {HTML}')
    print('═══ RESULT: ❌  ISSUES FOUND ═══')
    sys.exit(1)

with open(HTML, encoding='utf-8') as f:
    src = f.read()

# ── 1. DUPLICATE JAVASCRIPT FUNCTION DEFINITIONS ───────────────────────────────
# Catches the same risk as Pipeline.gs duplicate functions.
# Two definitions of the same function = the second silently overwrites the first.

fn_names  = re.findall(r'function\s+(\w+)\s*\(', src)
seen      = {}
dupl_found = False

for fn in fn_names:
    seen[fn] = seen.get(fn, 0) + 1

for fn, count in sorted(seen.items()):
    if count > 1:
        fail(f'DUPLICATE FUNCTION: "{fn}" defined {count} times — second definition silently overwrites the first')
        dupl_found = True

if not dupl_found:
    ok(f'No duplicate function definitions ({len(seen)} unique functions found)')

# ── 2. CRITICAL FEATURE PRESENCE ──────────────────────────────────────────────
# Same list as Guard 3 in pre-push hook — caught early at commit time.

REQUIRED = [
    # Core app functions
    ("function runOptimizer",          "Optimizer engine"),
    ("function renderTables",          "Render itinerary tables"),
    ("function saveItinerary",         "Save itinerary"),
    ("function loadAndOpen",           "Load saved itinerary"),
    ("function downloadPDF",           "PDF export"),
    ("function downloadExcel",         "Excel export"),

    # Hotel swap
    ("function openHotelSwap",         "Hotel swap modal"),
    ("function applyHotelFilters",     "Hotel swap filters"),
    ("_currentHotelCost",              "Hotel swap: current cost tracking"),
    ("diffLabel",                      "Hotel swap: price difference label"),
    ("Within ±20",                     "Hotel swap: ±20% best match grouping"),
    ("currentHotelBar",                "Hotel swap: current hotel bar"),

    # Budget hints
    ("hotelBudgetHint",                "Budget hint: hotel range"),
    ("sightBudgetHint",                "Budget hint: land range"),
    ("function suggestBudgets",        "Budget hint: suggest function"),
    ("function applyBudgetSuggestion", "Budget hint: apply mid value"),

    # Admin dashboard
    ("tab-itinerary",                  "Admin nav: Itinerary tab"),
    ("tab-saved",                      "Admin nav: My Itineraries tab"),
    ("tab-quote",                      "Admin nav: Quote Dashboard tab"),
    ("tab-data",                       "Admin nav: Data Dashboard tab"),
    ("function switchAdminTab",        "Admin tab switcher"),
    ("function loadSavedList",         "My Itineraries loader"),

    # Version control
    ("_loadedFromName",                "Version control: loaded name tracking"),

    # API
    # NOTE: If Apps Script is redeployed, update the URL fragment below.
    # Get it from: Apps Script → Deploy → Manage Deployments → copy unique ID here.
    ("AKfycbwP9KQH39hcBcLQsPsOL_c4hKIuV3TTlm1XW2CT2e72W-TYVP01-adjsVAKtAAArhGQWA",    "Correct API URL"),

    # Login / auth
    ("function launchApp",             "Login / launch"),
    ("function checkAutoLogin",        "Auto-login from session"),
]

missing = 0
for pattern, label in REQUIRED:
    if pattern not in src:
        fail(f'MISSING: {label}  (pattern: {pattern})')
        missing += 1

if missing == 0:
    ok(f'All {len(REQUIRED)} critical features present')

# ── 3. INDEX.HTML SYNC CHECK ───────────────────────────────────────────────────
# index.html is what GitHub Pages actually serves.
# If it differs from index_fit.tripstore.html, the live site is out of date.

if os.path.exists(INDEX):
    with open(INDEX, encoding='utf-8') as f:
        index_src = f.read()
    if src == index_src:
        ok('index.html is in sync with index_fit.tripstore.html')
    else:
        fail('index.html is OUT OF SYNC with index_fit.tripstore.html — live site will serve stale code')
        fail('  Fix: cp index_fit.tripstore.html index.html  then commit both files together')
else:
    warn('index.html not found — cannot verify sync with index_fit.tripstore.html')

# ── 4. API URL INTEGRITY ───────────────────────────────────────────────────────
# Check that the API URL appears exactly once.
# 0 = already caught by section 2; >1 = may point to different deployments.

api_count = src.count('AKfycbwP9KQH39hcBcLQsPsOL_c4hKIuV3TTlm1XW2CT2e72W-TYVP01-adjsVAKtAAArhGQWA')
if api_count > 1:
    warn(f'API URL fragment appears {api_count} times — verify all point to the same deployment')
elif api_count == 1:
    ok('API URL appears exactly once — no duplicate endpoint risk')
# api_count == 0 already caught as MISSING in section 2

# ── 5. SCRIPT TAG BALANCE ──────────────────────────────────────────────────────
# A mismatched <script>/<\/script> pair is a silent killer — JS below the error
# simply doesn't run, and the browser shows no obvious error.

open_tags  = len(re.findall(r'<script[\s>]', src, re.IGNORECASE))
close_tags = len(re.findall(r'</script>', src, re.IGNORECASE))
if open_tags == close_tags:
    ok(f'<script> tags balanced ({open_tags} open / {close_tags} close)')
else:
    fail(f'<script> tags UNBALANCED: {open_tags} open vs {close_tags} close — JS may not load correctly')

# ── SUMMARY ────────────────────────────────────────────────────────────────────

print()
if warnings:
    print('WARNINGS:')
    for w in warnings:
        print(' ', w)
    print()

if errors:
    print('ERRORS:')
    for e in errors:
        print(' ', e)
    print()
    print('═══ RESULT: ❌  ISSUES FOUND — fix before committing or pushing ═══')
    sys.exit(1)
else:
    print('═══ RESULT: ✅  ALL CHECKS PASSED — safe to proceed ═══')
    sys.exit(0)
