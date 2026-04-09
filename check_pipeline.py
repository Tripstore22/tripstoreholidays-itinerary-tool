#!/usr/bin/env python3
"""
Pipeline.gs static validator.
Run before making ANY change to Pipeline.gs or Automation.gs.
Usage: python3 check_pipeline.py
"""

import re, sys, os

# Optional argument: which file triggered this check
# Values: 'pipeline' | 'automation' | 'code' | 'quote' | (none = full check)
SCOPE = sys.argv[1].lower() if len(sys.argv) > 1 else 'pipeline'

ROOT = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.join(ROOT, 'Pipeline.gs')
AUTOMATION = os.path.join(ROOT, 'Automation.gs')
CODE_GS = os.path.join(ROOT, 'Code.gs')
QUOTE_GS = os.path.join(ROOT, 'Quote_Intelligence.gs')

errors = []
warnings = []

def fail(msg):  errors.append('❌  ' + msg)
def warn(msg):  warnings.append('⚠️   ' + msg)
def ok(msg):    print('✅  ' + msg)

def read(path):
    with open(path) as f:
        return f.read()

# ── 1. NAMING CONFLICTS ────────────────────────────────────────────────────────

def get_functions(src):
    return re.findall(r'^function\s+(\w+)\s*\(', src, re.MULTILINE)

pipeline_fns   = get_functions(read(PIPELINE))
automation_fns = get_functions(read(AUTOMATION))
codegen_fns    = get_functions(read(CODE_GS)) if os.path.exists(CODE_GS) else []

quote_fns = get_functions(read(QUOTE_GS)) if os.path.exists(QUOTE_GS) else []

all_files = {
    'Pipeline.gs':          pipeline_fns,
    'Automation.gs':        automation_fns,
    'Code.gs':              codegen_fns,
    'Quote_Intelligence.gs': quote_fns,
}

seen = {}
conflict_found = False
for filename, fns in all_files.items():
    for fn in fns:
        if fn in seen:
            fail(f'NAMING CONFLICT: "{fn}" defined in both {seen[fn]} and {filename}')
            conflict_found = True
        else:
            seen[fn] = filename

if not conflict_found:
    ok('No naming conflicts across Pipeline.gs / Automation.gs / Code.gs')

# ── 2. AUTOMATION.GS LEGACY RENAMES (only when Automation.gs or Pipeline.gs changed) ──────────

if SCOPE in ('pipeline', 'automation'):
    auto_src = read(AUTOMATION)
    legacy_must_not_exist = ['runMidnightEnrichment', 'callClaudeAPI', 'setupSheets', 'setupTrigger']
    for fn in legacy_must_not_exist:
        pattern = rf'^function\s+{fn}\s*\('
        if re.search(pattern, auto_src, re.MULTILINE):
            fail(f'Automation.gs still has "{fn}()" without _LEGACY suffix — naming conflict with Pipeline.gs')
        else:
            ok(f'Automation.gs: "{fn}" correctly renamed to _LEGACY')

# ── 3–6. PIPELINE-ONLY CHECKS (column maps, dangerous ops, archive safety) ────

if SCOPE == 'pipeline':
    pipe_src = read(PIPELINE)

    # ── 3. COLUMN MAP vs SETUP HEADERS ────────────────────────────────────────

    def get_col_const(src, const_name, key):
        m = re.search(rf'const {const_name}\s*=\s*\{{([^}}]+)\}}', src, re.DOTALL)
        if not m:
            fail(f'Could not find const {const_name} in Pipeline.gs')
            return None
        body = m.group(1)
        km = re.search(rf'\b{key}\s*:\s*(\d+)', body)
        return int(km.group(1)) if km else None

    def get_col_total(src, const_name):
        return get_col_const(src, const_name, 'TOTAL')

    expected_cols = {
        'Hotels':      {'const': 'HC', 'total': get_col_total(pipe_src, 'HC'), 'status': get_col_const(pipe_src, 'HC', 'STATUS'), 'err': get_col_const(pipe_src, 'HC', 'ERR')},
        'Sightseeing': {'const': 'SC', 'total': get_col_total(pipe_src, 'SC'), 'status': get_col_const(pipe_src, 'SC', 'STATUS'), 'err': get_col_const(pipe_src, 'SC', 'ERR')},
        'Trains':      {'const': 'TC', 'total': get_col_total(pipe_src, 'TC'), 'status': get_col_const(pipe_src, 'TC', 'STATUS'), 'err': get_col_const(pipe_src, 'TC', 'ERR')},
        'Transfers':   {'const': 'XC', 'total': get_col_total(pipe_src, 'XC'), 'status': get_col_const(pipe_src, 'XC', 'STATUS'), 'err': get_col_const(pipe_src, 'XC', 'ERR')},
    }

    KNOWN_HEADERS = {
        'Hotels': ['City','Hotel Name','Star Rating','Hotel Category','Chain / Brand','Room Type',
                   'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
                   'Annual Avg (INR)','Added_By','Source_URL','Notes_Input',
                   'Pipeline_Status','Error_Reason','Processed_Date'],
        'Sightseeing': ['City','Tour Name','Category','Rating','Duration',
                        'Avg Price','GYG Price (INR)','GYG Link','Viator Price (INR)','Viator Link','Attraction Tags',
                        'Added_By','Notes_Input','Pipeline_Status','Error_Reason','Processed_Date'],
        'Trains': ['Mode','From City','To City','Stops','Stopover City',
                   'INR Price (₹)','May (€)','Aug (€)','Oct (€)','Dec (€)','Avg (€)',
                   'Added_By','Source_URL','Notes_Input','Pipeline_Status','Error_Reason','Processed_Date'],
        'Transfers': ['City','Country','Airport Code','Airport / Hub Name','Zone','Transfer Type',
                      'Direction','From','To','Economy Sedan (1-way) ₹','Standard Van (1-way) ₹',
                      'Premium Van (1-way) ₹','Executive Sedan (1-way) ₹','Schedule','Notes','Data Status',
                      'Added_By','Source_URL','Pipeline_Status','Error_Reason','Processed_Date'],
    }

    for name, meta in expected_cols.items():
        headers    = KNOWN_HEADERS[name]
        total      = len(headers)
        status_col = headers.index('Pipeline_Status') + 1
        err_col    = headers.index('Error_Reason') + 1

        if meta['total'] != total:
            fail(f'{meta["const"]}.TOTAL = {meta["total"]} but setupSheets defines {total} headers for INPUT_{name}')
        else:
            ok(f'{meta["const"]}.TOTAL = {total} matches setupSheets header count')

        if meta['status'] != status_col:
            fail(f'{meta["const"]}.STATUS = {meta["status"]} but "Pipeline_Status" is at col {status_col} — WRONG COLUMN MAP')
        else:
            ok(f'{meta["const"]}.STATUS = {status_col} → "Pipeline_Status" ✓')

        if meta['err'] != err_col:
            fail(f'{meta["const"]}.ERR = {meta["err"]} but "Error_Reason" is at col {err_col} — WRONG COLUMN MAP')
        else:
            ok(f'{meta["const"]}.ERR = {err_col} → "Error_Reason" ✓')

    # ── 4. DANGEROUS SHEET OPERATIONS ─────────────────────────────────────────

    dangerous = {
        r'\.deleteRow\(':    'deleteRow — only safe bottom-to-top',
        r'\.deleteRows\(':   'deleteRows — verify indices are correct',
        r'\.clearContent\(': 'clearContent — wipes cell data',
        r'\.clear\(':        'clear() — wipes everything including formatting',
        r'getRange\([^)]+\)\.setValue\s*\(\s*["\']PROCESSED': 'Writing PROCESSED — check column index',
        r'getRange\([^)]+\)\.setValue\s*\(\s*["\']DUPLICATE': 'Writing DUPLICATE — check column index',
    }
    for pattern, label in dangerous.items():
        matches = [(i+1, line.strip()) for i, line in enumerate(pipe_src.splitlines())
                   if re.search(pattern, line)]
        for lineno, line in matches:
            warn(f'Pipeline.gs:{lineno} — {label}\n      → {line[:100]}')

    # ── 5. ARCHIVE AUTO-CALL CHECK ────────────────────────────────────────────

    process_fn_match = re.search(r'function processSheet\s*\(.*?\nfunction ', pipe_src, re.DOTALL)
    if process_fn_match:
        if '_archiveAndClear' in process_fn_match.group(0):
            fail('processSheet() calls _archiveAndClear() automatically — will wipe input sheet on every run!')
        else:
            ok('_archiveAndClear is NOT called automatically in processSheet — safe')
    else:
        warn('Could not parse processSheet body to check for _archiveAndClear call')

    # ── 6. ENRICHMENT PROMPT LOGIC RULES ─────────────────────────────────────
    # These checks catch business logic inside Claude prompt strings that cannot
    # be inferred from code structure alone. Each entry is a rule that must hold.
    # Add a new entry whenever a prompt bug is discovered and fixed.

    # Each entry: (function_name, search_pattern, description)
    # function_name = which enrichXxx() to extract and search within
    # search_pattern = regex that must match inside that function
    # description = what the rule enforces and why it exists
    prompt_rules = [

        # ── Sightseeing ──────────────────────────────────────────────────────────
        # Bug: old wording "Both gyg_price and viator_price are 0 or missing" was
        # ambiguous — Claude AI sometimes rejected rows that had only one price.
        # Fix: explicit ✅/❌ examples showing one price is enough.
        ('enrichSightseeing',
         r'ONLY gyg_price.*?is VALID',
         'enrichSightseeing: must explicitly allow GYG-only rows as valid '
         '(old ambiguous wording caused single-price rows to error)'),

        ('enrichSightseeing',
         r'ONLY viator_price.*?is VALID',
         'enrichSightseeing: must explicitly allow Viator-only rows as valid'),

        # ── Hotels ───────────────────────────────────────────────────────────────
        # Bug: "City is not a real European location" blocks hotels outside Europe
        # (Dubai, Maldives, etc.). Sightseeing was already fixed to "real location".
        # Fix: remove "European" restriction from Hotels prompt.
        ('enrichHotels',
         r'City is not a real location',
         'enrichHotels: must NOT restrict to European cities only '
         '(old wording blocked Dubai, Maldives, etc.)'),

        # ── Trains ───────────────────────────────────────────────────────────────
        # Bug: "inr_price is 0 or missing" as a standalone invalid condition
        # contradicts the ENRICH section which says "if blank, calculate from avg_e × 110".
        # If inr_price=0, Claude marks invalid and never reaches the calculate path.
        # Fix: only invalid if BOTH inr_price AND all monthly € prices are missing.
        ('enrichTrains',
         r'(?i)only invalid if BOTH inr_price AND all monthly',
         'enrichTrains: must allow €-only rows (INR=0 is valid if monthly € prices exist) '
         '— old validation blocked the enrichment path that calculates INR from avg_e'),

    ]

    # Extract each function body and run its checks
    fn_cache = {}
    for fn_name, pattern, description in prompt_rules:
        if fn_name not in fn_cache:
            m = re.search(rf'function {fn_name}\s*\(.*?(?=^function )', pipe_src, re.MULTILINE | re.DOTALL)
            fn_cache[fn_name] = m.group(0) if m else ''
        fn_src = fn_cache[fn_name]
        if not fn_src:
            warn(f'Could not locate {fn_name}() body to check prompt logic')
            continue
        if re.search(pattern, fn_src, re.DOTALL):
            ok(f'Prompt rule OK: {description[:70]}...')
        else:
            fail(f'PROMPT RULE MISSING: {description}')

    # ── processSheet: must use res.idx, not forEach index ────────────────────────
    # Bug: original code used forEach((res, idx) => batch[idx]) — assumes Claude
    # always returns results in the same order. If Claude reorders, wrong input
    # row gets marked PROCESSED/ERROR. Fix: use res.idx to look up the correct row.
    process_fn = re.search(r'function processSheet\s*\(.*?(?=^function )', pipe_src, re.MULTILINE | re.DOTALL)
    if process_fn:
        process_src = process_fn.group(0)
        if 'batch[res.idx]' in process_src:
            ok('processSheet uses res.idx (not forEach index) to look up batch row — safe against Claude reordering')
        else:
            fail('processSheet must use batch[res.idx] not batch[forEach_idx] — '
                 'if Claude reorders results, wrong input row gets marked PROCESSED/ERROR')

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
    print('═══ RESULT: ❌  ISSUES FOUND — do NOT push or run enrichment until fixed ═══')
    sys.exit(1)
else:
    print('═══ RESULT: ✅  ALL CHECKS PASSED — safe to proceed ═══')
    sys.exit(0)
