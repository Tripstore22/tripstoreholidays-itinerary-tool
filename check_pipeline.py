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
    # function must not appear WITHOUT _LEGACY suffix
    pattern = rf'^function\s+{fn}\s*\('
    if re.search(pattern, auto_src, re.MULTILINE):
        fail(f'Automation.gs still has "{fn}()" without _LEGACY suffix — naming conflict with Pipeline.gs')
    else:
        ok(f'Automation.gs: "{fn}" correctly renamed to _LEGACY')

# ── 3. COLUMN MAP vs SETUP HEADERS ────────────────────────────────────────────

pipe_src = read(PIPELINE)

# Extract HC, SC, TC, XC STATUS values
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

# Extract headers from _buildInputSheet calls
def get_setup_headers(src, sheet_name):
    # Find _buildInputSheet(ss, 'INPUT_Hotels', [...], ...) pattern
    pattern = rf"_buildInputSheet\s*\(\s*ss\s*,\s*(?:CFG\.INPUT\.\w+|'{sheet_name}')\s*,\s*\[(.*?)\]\s*,"
    m = re.search(pattern, src, re.DOTALL)
    if not m:
        return []
    raw = m.group(1)
    return [h.strip().strip("'") for h in raw.split(',') if h.strip().strip("'")]

expected_cols = {
    'Hotels':      {'const': 'HC', 'total': get_col_total(pipe_src, 'HC'), 'status': get_col_const(pipe_src, 'HC', 'STATUS'), 'err': get_col_const(pipe_src, 'HC', 'ERR')},
    'Sightseeing': {'const': 'SC', 'total': get_col_total(pipe_src, 'SC'), 'status': get_col_const(pipe_src, 'SC', 'STATUS'), 'err': get_col_const(pipe_src, 'SC', 'ERR')},
    'Trains':      {'const': 'TC', 'total': get_col_total(pipe_src, 'TC'), 'status': get_col_const(pipe_src, 'TC', 'STATUS'), 'err': get_col_const(pipe_src, 'TC', 'ERR')},
    'Transfers':   {'const': 'XC', 'total': get_col_total(pipe_src, 'XC'), 'status': get_col_const(pipe_src, 'XC', 'STATUS'), 'err': get_col_const(pipe_src, 'XC', 'ERR')},
}

# Hardcode expected headers (source of truth = setupSheets in Pipeline.gs)
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
    headers = KNOWN_HEADERS[name]
    total   = len(headers)
    status_col = headers.index('Pipeline_Status') + 1  # 1-based
    err_col    = headers.index('Error_Reason') + 1

    # Check TOTAL
    if meta['total'] != total:
        fail(f'{meta["const"]}.TOTAL = {meta["total"]} but setupSheets defines {total} headers for INPUT_{name}')
    else:
        ok(f'{meta["const"]}.TOTAL = {total} matches setupSheets header count')

    # Check STATUS col
    if meta['status'] != status_col:
        fail(f'{meta["const"]}.STATUS = {meta["status"]} but "Pipeline_Status" is at col {status_col} in setupSheets — WRONG COLUMN MAP')
    else:
        ok(f'{meta["const"]}.STATUS = {status_col} → "Pipeline_Status" ✓')

    # Check ERR col
    if meta['err'] != err_col:
        fail(f'{meta["const"]}.ERR = {meta["err"]} but "Error_Reason" is at col {err_col} in setupSheets — WRONG COLUMN MAP')
    else:
        ok(f'{meta["const"]}.ERR = {err_col} → "Error_Reason" ✓')

# ── 4. DANGEROUS SHEET OPERATIONS ─────────────────────────────────────────────

dangerous = {
    r'\.deleteRow\(':       'deleteRow — will shift all rows below; only safe if deleting bottom-to-top',
    r'\.deleteRows\(':      'deleteRows — bulk delete; verify indices are correct',
    r'\.clearContent\(':    'clearContent — wipes cell data',
    r'\.clear\(':           'clear() — wipes everything including formatting',
    r'getRange\([^)]+\)\.setValue\s*\(\s*["\']PROCESSED': 'Writing PROCESSED status — check column index is correct',
    r'getRange\([^)]+\)\.setValue\s*\(\s*["\']DUPLICATE': 'Writing DUPLICATE status — check column index is correct',
}

for pattern, label in dangerous.items():
    matches = [(i+1, line.strip()) for i, line in enumerate(read(PIPELINE).splitlines())
               if re.search(pattern, line)]
    if matches:
        for lineno, line in matches:
            warn(f'Pipeline.gs:{lineno} — {label}\n      → {line[:100]}')

# ── 5. FUNCTIONS CALLED BUT NOT DEFINED ───────────────────────────────────────

all_defined = set(seen.keys())
# Find internal calls in Pipeline.gs (simple heuristic)
calls_in_pipeline = re.findall(r'\b(\w+)\s*\(', pipe_src)
internal_calls = {c for c in calls_in_pipeline if c[0].islower() and len(c) > 4
                  and not c.startswith('get') and not c.startswith('set')
                  and not c.startswith('new') and not c.startswith('has')
                  and not c.startswith('for') and not c.startswith('if')}
# Known builtins to ignore
builtins = {'parseInt','parseFloat','isNaN','String','Array','Object','Math','Date',
            'JSON','Logger','SpreadsheetApp','PropertiesService','UrlFetchApp',
            'Utilities','ScriptApp','console','GmailApp','MailApp',
            'slice','split','join','map','filter','catch','switch','while',
            'forEach','reduce','push','indexOf','includes','toLowerCase','toUpperCase',
            'toString','trim','replace','match','startsWith','endsWith',
            'round','floor','ceil','max','min','abs','keys','values','entries',
            'fromCharCode','computeDigest','sleep','fetch','repeat','padEnd','padStart',
            'appendRow','getValues','setValues','setValue','getValue',
            'getRange','getLastRow','getLastColumn','getDataRange',
            'setBackground','setFontColor','setFontWeight','setFrozenRows','setWrap',
            'setDataValidation','insertSheet','getSheetByName','newDataValidation',
            'requireValueInList','setAllowInvalid','build','getActiveSpreadsheet',
            'getScriptProperties','getProperty','setProperty',
            'newTrigger','timeBased','atHour','everyDays','create',
            'getProjectTriggers','deleteTrigger','deleteRow','deleteRows',
            'merge','setFontStyle','setFontSize','setFontFamily',
            'setHorizontalAlignment','setVerticalAlignment','setRowHeight','insertRowBefore',
            'getContentText','getResponseCode','parse','stringify',
            'toISOString','toLocaleDateString','toLocaleString','toDateString',
            'getTime','charAt','openById','sendEmail','alert','toast',
            'ButtonSet','getUi','isArray','available'}

missing_fns = []
for call in internal_calls:
    if call not in all_defined and call not in builtins:
        missing_fns.append(call)

if missing_fns:
    for fn in sorted(set(missing_fns)):
        warn(f'Pipeline.gs calls "{fn}()" but it is not defined in any .gs file (may be a false positive)')
else:
    ok('No obviously missing function calls detected')

# ── 6. ARCHIVE AUTO-CALL CHECK ────────────────────────────────────────────────

# Make sure _archiveAndClear is NOT called inside processSheet automatically
process_fn_match = re.search(r'function processSheet\s*\(.*?\nfunction ', pipe_src, re.DOTALL)
if process_fn_match:
    process_body = process_fn_match.group(0)
    if '_archiveAndClear' in process_body:
        fail('processSheet() still calls _archiveAndClear() automatically — this will wipe the input sheet on every run!')
    else:
        ok('_archiveAndClear is NOT called automatically in processSheet — safe')
else:
    warn('Could not parse processSheet body to check for _archiveAndClear call')

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
