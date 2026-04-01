/**
 * ================================================================
 * TRIPSTORE ENRICHMENT PIPELINE — FINAL v2.1
 *
 * ⚠️  IMPORTANT: Paste this into a NEW file called Pipeline.gs
 *     DO NOT replace or delete Code.gs — it powers the live app.
 *     In Apps Script: click + (Add File) → name it Pipeline → paste.
 * ================================================================
 *
 * ONE-TIME SETUP:
 *  1. Extensions → Apps Script → Project Settings → Script Properties
 *     ANTHROPIC_API_KEY = sk-ant-xxxx  (get from console.anthropic.com)
 *     SUMMARY_EMAIL     = sumit@tripstoreholidays.com
 *  2. Run setupSheets()  — creates headers on all INPUT + LOG tabs
 *  3. Run setupTrigger() — sets midnight daily automation
 *
 * MANUAL FUNCTIONS:
 *  runMidnightEnrichment() — run pipeline right now
 *  resetErrorRows()        — reset ERROR rows to PENDING after team fixes them
 *  showInputStats()        — show count of pending/error/duplicate rows
 *
 * WHAT THIS SCRIPT DOES:
 *  - Reads PENDING rows from INPUT_Hotels / INPUT_Sightseeing / INPUT_Trains / INPUT_Transfers
 *  - Checks duplicates against master IN JAVASCRIPT (no API cost)
 *  - Sends only NEW rows to Claude for validation + enrichment
 *  - Appends enriched rows to Hotels / Sightseeing / Trains / Transfers master sheets
 *  - Flags ERROR rows red, DUPLICATE rows amber in INPUT sheets
 *  - Logs everything to ERRORS_LOG, DUPLICATES_LOG, AUDIT_LOG
 *  - Sends summary email on completion
 * ================================================================
 */


// ================================================================
// SECTION 1 — CONFIGURATION
// ================================================================

const CFG = {
  MODEL:      'claude-haiku-4-5-20251001',
  MAX_TOKENS: 4096,
  BATCH_SIZE: 5,

  MASTER: {
    HOTELS:      'Hotels',
    SIGHTSEEING: 'Sightseeing',
    TRAINS:      'Trains',
    TRANSFERS:   'Transfers',
  },

  INPUT: {
    HOTELS:      'INPUT_Hotels',
    SIGHTSEEING: 'INPUT_Sightseeing',
    TRAINS:      'INPUT_Trains',
    TRANSFERS:   'INPUT_Transfers',
  },

  LOG: {
    ERRORS:     'ERRORS_LOG',
    DUPLICATES: 'DUPLICATES_LOG',
    AUDIT:      'AUDIT_LOG',
  },

  STATUS: {
    PENDING:   'PENDING',
    PROCESSED: 'PROCESSED',
    ERROR:     'ERROR',
    DUPLICATE: 'DUPLICATE',
  },

  COLOR: {
    PROCESSED: '#d4edda',  // green
    ERROR:     '#f8d7da',  // red
    DUPLICATE: '#fff3cd',  // amber
    PENDING:   '#ffffff',  // white
    HEADER:    '#1a3c5e',  // navy
  },
};


// ================================================================
// SECTION 2 — COLUMN MAPS (1-based, matching INPUT sheet headers)
// ================================================================

// INPUT_Hotels (25 columns):
// 1:City 2:Hotel Name 3:Star Rating 4:Hotel Category 5:Chain/Brand 6:Room Type
// 7:Jan 8:Feb 9:Mar 10:Apr 11:May 12:Jun 13:Jul 14:Aug 15:Sep 16:Oct 17:Nov 18:Dec
// 19:Annual Avg(INR) 20:Added_By 21:Source_URL 22:Notes_Input
// 23:Pipeline_Status 24:Error_Reason 25:Processed_Date
const HC = {
  CITY:1, NAME:2, STAR:3, CATEGORY:4, CHAIN:5, ROOM:6,
  JAN:7, FEB:8, MAR:9, APR:10, MAY:11, JUN:12,
  JUL:13, AUG:14, SEP:15, OCT:16, NOV:17, DEC:18,
  AVG:19, ADDED_BY:20, SOURCE:21, NOTES:22,
  STATUS:23, ERR:24, PROC_DATE:25,
  TOTAL:25
};

// INPUT_Sightseeing (16 columns):
// 1:City 2:Tour Name 3:Category 4:Rating 5:Duration
// 6:Avg Price 7:GYG Price 8:GYG Link 9:Viator Price 10:Viator Link 11:Attraction Tags
// 12:Added_By 13:Notes_Input
// 14:Pipeline_Status 15:Error_Reason 16:Processed_Date
const SC = {
  CITY:1, NAME:2, CAT:3, RATING:4, DUR:5,
  AVG:6, GYG_P:7, GYG_L:8, VIA_P:9, VIA_L:10, TAGS:11,
  ADDED_BY:12, NOTES:13,
  STATUS:14, ERR:15, PROC_DATE:16,
  TOTAL:16
};

// INPUT_Trains (17 columns):
// 1:Mode 2:From City 3:To City 4:Stops 5:Stopover City
// 6:INR Price(₹) 7:May(€) 8:Aug(€) 9:Oct(€) 10:Dec(€) 11:Avg(€)
// 12:Added_By 13:Source_URL 14:Notes_Input
// 15:Pipeline_Status 16:Error_Reason 17:Processed_Date
const TC = {
  MODE:1, FROM:2, TO:3, STOPS:4, STOPOVER:5,
  INR:6, MAY_E:7, AUG_E:8, OCT_E:9, DEC_E:10, AVG_E:11,
  ADDED_BY:12, SOURCE:13, NOTES:14,
  STATUS:15, ERR:16, PROC_DATE:17,
  TOTAL:17
};

// INPUT_Transfers (21 columns):
// 1:City 2:Country 3:Airport Code 4:Airport/Hub Name 5:Zone
// 6:Transfer Type 7:Direction 8:From 9:To
// 10:Economy ₹ 11:Standard ₹ 12:Premium ₹ 13:Executive ₹
// 14:Schedule 15:Notes 16:Data Status
// 17:Added_By 18:Source_URL
// 19:Pipeline_Status 20:Error_Reason 21:Processed_Date
const XC = {
  CITY:1, COUNTRY:2, AIRPORT:3, HUB:4, ZONE:5,
  TYPE:6, DIR:7, FROM:8, TO:9,
  ECO:10, STD:11, PRE:12, EXE:13,
  SCHEDULE:14, NOTES:15, DATA_STATUS:16,
  ADDED_BY:17, SOURCE:18,
  STATUS:19, ERR:20, PROC_DATE:21,
  TOTAL:21
};


// ================================================================
// SECTION 3 — MAIN ENTRY POINT
// ================================================================

function runMidnightEnrichment() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const start = new Date();
  auditLog(ss, `━━━ PIPELINE START: ${start.toISOString()} ━━━`);

  const results = {
    hotels:      processSheet(ss, 'hotels'),
    sightseeing: processSheet(ss, 'sightseeing'),
    trains:      processSheet(ss, 'trains'),
    transfers:   processSheet(ss, 'transfers'),
  };

  const secs = Math.round((new Date() - start) / 1000);
  auditLog(ss, `━━━ PIPELINE COMPLETE in ${secs}s ━━━`);
  sendSummaryEmail(results, secs);
}


// ================================================================
// SECTION 4 — SHEET PROCESSOR
// Duplicate detection happens HERE in JavaScript — zero API cost.
// Only confirmed-new rows are sent to Claude.
// ================================================================

function processSheet(ss, type) {
  const map = {
    hotels:      { input: CFG.INPUT.HOTELS,      master: CFG.MASTER.HOTELS,      col: HC, fn: enrichHotels      },
    sightseeing: { input: CFG.INPUT.SIGHTSEEING, master: CFG.MASTER.SIGHTSEEING, col: SC, fn: enrichSightseeing },
    trains:      { input: CFG.INPUT.TRAINS,      master: CFG.MASTER.TRAINS,      col: TC, fn: enrichTrains      },
    transfers:   { input: CFG.INPUT.TRANSFERS,   master: CFG.MASTER.TRANSFERS,   col: XC, fn: enrichTransfers   },
  };

  const cfg   = map[type];
  const inp   = ss.getSheetByName(cfg.input);
  const mst   = ss.getSheetByName(cfg.master);
  const stats = { processed: 0, errors: 0, duplicates: 0 };

  if (!inp) { auditLog(ss, `SKIP ${type}: ${cfg.input} tab not found`); return stats; }
  if (!mst) { auditLog(ss, `SKIP ${type}: ${cfg.master} tab not found`); return stats; }

  const allPending = getPendingRows(inp, cfg.col.STATUS);
  if (!allPending.length) {
    auditLog(ss, `${type.toUpperCase()}: no pending rows`);
    return stats;
  }

  // Build master key Set once in memory — no API call needed
  const masterKeySet = buildMasterKeySet(mst, type);

  const toEnrich = [];
  const dupRows  = [];

  allPending.forEach(row => {
    const isDup = isDuplicate(row.data, type, masterKeySet);
    if (isDup) {
      dupRows.push(row);
    } else {
      toEnrich.push(row);
    }
  });

  // Mark duplicates immediately — Claude not involved
  dupRows.forEach(row => {
    markRow(inp, row.rowIndex, CFG.STATUS.DUPLICATE,
      `Already exists in ${cfg.master}`, cfg.col);
    appendToLog(ss, CFG.LOG.DUPLICATES, type, row, 'Matched existing master entry');
    stats.duplicates++;
    auditLog(ss, `  DUPLICATE row ${row.rowIndex}`);
  });

  if (!toEnrich.length) {
    auditLog(ss, `${type.toUpperCase()}: ${dupRows.length} duplicates found, nothing new to enrich`);
    return stats;
  }

  auditLog(ss, `${type.toUpperCase()}: ${dupRows.length} duplicates | ${toEnrich.length} new rows → sending to Claude`);

  // Send only new rows to Claude in batches
  for (let i = 0; i < toEnrich.length; i += CFG.BATCH_SIZE) {
    const batch   = toEnrich.slice(i, i + CFG.BATCH_SIZE);
    const results = cfg.fn(batch);

    results.forEach((res, idx) => {
      const row = batch[idx];
      if (!row) return;

      if (!res.valid) {
        markRow(inp, row.rowIndex, CFG.STATUS.ERROR, res.error_reason, cfg.col);
        appendToLog(ss, CFG.LOG.ERRORS, type, row, res.error_reason);
        stats.errors++;
        auditLog(ss, `  ERROR row ${row.rowIndex}: ${res.error_reason}`);
      } else {
        // Trains and transfers return multiple rows (bidirectional)
        const masterRows = Array.isArray(res.rows) ? res.rows : [res.row];
        masterRows.forEach(r => {
          mst.appendRow(r);
          // Add to in-memory set so within-batch duplicates are caught too
          masterKeySet.add(buildMasterKey(r, type).toLowerCase());
        });
        markRow(inp, row.rowIndex, CFG.STATUS.PROCESSED, '', cfg.col);
        stats.processed++;
      }
    });

    Utilities.sleep(1500); // rate limit buffer between Claude calls
  }

  return stats;
}


// ================================================================
// SECTION 5 — DUPLICATE DETECTION (JavaScript, no API cost)
// ================================================================

function buildMasterKeySet(masterSheet, type) {
  const data = masterSheet.getDataRange().getValues().slice(1); // skip header row
  const keySet = new Set();
  data.forEach(row => {
    const key = buildMasterKey(row, type);
    if (key) keySet.add(key.toLowerCase());
  });
  return keySet;
}

// Build lookup key from a MASTER sheet row
function buildMasterKey(row, type) {
  switch (type) {
    case 'hotels':
      // Master: col1=City, col2=Hotel Name
      return `${(row[1]||'').trim()}|${(row[0]||'').trim()}`;
    case 'sightseeing':
      // Master: col1=City, col2=Tour Name
      return `${(row[1]||'').trim()}|${(row[0]||'').trim()}`;
    case 'trains':
      // Master: col2=From City, col3=To City
      return `${(row[1]||'').trim()}|${(row[2]||'').trim()}`;
    case 'transfers':
      // Master: col9=To (hotel name), col1=City, col3=Airport Code
      return `${(row[8]||row[7]||'').trim()}|${(row[0]||'').trim()}|${(row[2]||'').trim()}`;
    default:
      return '';
  }
}

// Build lookup key from an INPUT row (0-based data array)
function buildInputKey(data, type) {
  switch (type) {
    case 'hotels':
      return `${(data[HC.NAME-1]||'').trim()}|${(data[HC.CITY-1]||'').trim()}`;
    case 'sightseeing':
      return `${(data[SC.NAME-1]||'').trim()}|${(data[SC.CITY-1]||'').trim()}`;
    case 'trains':
      return `${(data[TC.FROM-1]||'').trim()}|${(data[TC.TO-1]||'').trim()}`;
    case 'transfers':
      return `${(data[XC.TO-1]||'').trim()}|${(data[XC.CITY-1]||'').trim()}|${(data[XC.AIRPORT-1]||'').trim()}`;
    default:
      return '';
  }
}

function isDuplicate(data, type, masterKeySet) {
  const key = buildInputKey(data, type).toLowerCase();
  if (!key || key === '|' || key === '||') return false;

  if (masterKeySet.has(key)) return true;

  // Trains: also check reverse direction
  if (type === 'trains') {
    const from = (data[TC.FROM-1]||'').trim().toLowerCase();
    const to   = (data[TC.TO-1]||'').trim().toLowerCase();
    if (masterKeySet.has(`${to}|${from}`)) return true;
  }

  return false;
}


// ================================================================
// SECTION 6 — CLAUDE ENRICHMENT: HOTELS
// No master key list in prompt. Claude validates + enriches only.
// ================================================================

function enrichHotels(pending) {
  const input = pending.map((r, idx) => ({
    idx,
    city:        r.data[HC.CITY-1]     || '',
    hotel_name:  r.data[HC.NAME-1]     || '',
    star_rating: r.data[HC.STAR-1]     || '',
    category:    r.data[HC.CATEGORY-1] || '',
    chain:       r.data[HC.CHAIN-1]    || '',
    room_type:   r.data[HC.ROOM-1]     || '',
    jan:  r.data[HC.JAN-1] ||0, feb: r.data[HC.FEB-1] ||0,
    mar:  r.data[HC.MAR-1] ||0, apr: r.data[HC.APR-1] ||0,
    may:  r.data[HC.MAY-1] ||0, jun: r.data[HC.JUN-1] ||0,
    jul:  r.data[HC.JUL-1] ||0, aug: r.data[HC.AUG-1] ||0,
    sep:  r.data[HC.SEP-1] ||0, oct: r.data[HC.OCT-1] ||0,
    nov:  r.data[HC.NOV-1] ||0, dec_: r.data[HC.DEC-1]||0,
    source_url:  r.data[HC.SOURCE-1]   || '',
    notes:       r.data[HC.NOTES-1]    || '',
    added_by:    r.data[HC.ADDED_BY-1] || '',
  }));

  const prompt = `You are a travel data enrichment engine for TripStore Holidays — luxury European travel for Indian HNI clients. Prices in INR (3-night totals).

These rows are confirmed non-duplicates. Your job is to VALIDATE then ENRICH.

INPUT ROWS:
${JSON.stringify(input, null, 2)}

VALIDATE — set valid=false if:
- hotel_name is empty, test data, or gibberish
- star_rating is missing or not recognisable as 1-5 stars
- All monthly prices are 0 (at least 4 months must be provided)
- City is not a real European location

ENRICH (only if valid=true):
- Standardise star_rating to emoji format: ⭐ ⭐⭐ ⭐⭐⭐ ⭐⭐⭐⭐ ⭐⭐⭐⭐⭐
- category: if blank, infer from star+price: Budget(<40k) | Standard(40-70k) | Superior(70-100k) | Luxury(100-150k) | Ultra-Luxury(>150k)
- chain: use "Independent" if blank or unknown
- Derive missing monthly prices from the populated months using EU seasonal multipliers:
  Jan=0.80 Feb=0.82 Mar=0.90 Apr=1.00 May=1.05 Jun=1.20 Jul=1.30 Aug=1.28 Sep=1.05 Oct=0.95 Nov=0.85 Dec=1.15
  Adjust for ski resorts (higher Dec-Mar) and beach destinations (higher Jun-Aug)
- annual_avg: average of all 12 monthly values rounded to nearest integer
- Format all price values as strings with ₹ prefix and comma formatting e.g. "₹54,250"

OUTPUT — JSON array only, no markdown, no explanation:
[{
  "idx": 0,
  "valid": true,
  "error_reason": "",
  "row": ["City","Hotel Name","⭐⭐⭐⭐","Category","Chain / Brand","Room Type",
          "₹Jan","₹Feb","₹Mar","₹Apr","₹May","₹Jun","₹Jul","₹Aug","₹Sep","₹Oct","₹Nov","₹Dec",
          annual_avg_as_number]
}]`;

  return callClaudeAPI(prompt, pending.length);
}


// ================================================================
// SECTION 7 — CLAUDE ENRICHMENT: SIGHTSEEING
// ================================================================

function enrichSightseeing(pending) {
  const input = pending.map((r, idx) => ({
    idx,
    city:         r.data[SC.CITY-1]     || '',
    tour_name:    r.data[SC.NAME-1]     || '',
    category:     r.data[SC.CAT-1]      || '',
    rating:       r.data[SC.RATING-1]   || '',
    duration:     r.data[SC.DUR-1]      || '',
    gyg_price:    r.data[SC.GYG_P-1]    || 0,
    gyg_link:     r.data[SC.GYG_L-1]    || '',
    viator_price: r.data[SC.VIA_P-1]    || 0,
    viator_link:  r.data[SC.VIA_L-1]    || '',
    tags:         r.data[SC.TAGS-1]     || '',
    notes:        r.data[SC.NOTES-1]    || '',
    added_by:     r.data[SC.ADDED_BY-1] || '',
  }));

  const prompt = `You are a travel data enrichment engine for TripStore Holidays. Prices in INR.

These rows are confirmed non-duplicates. VALIDATE then ENRICH.

INPUT ROWS:
${JSON.stringify(input, null, 2)}

VALIDATE — valid=false if:
- tour_name is empty or gibberish
- city is not a real European destination
- Both gyg_price and viator_price are 0 or missing

ENRICH (if valid=true):
- category: confirm or assign from: Museum & Gallery, Historical & Cultural, Food & Culture, Adventure & Outdoor, City Tour, Walking Tour, Day Trip, Cruise, Evening Show, Landmark, Seasonal, Sightseeing, Water Sports
- rating: if blank, assign realistic ⭐ 4.X rating (most EU tours range 4.4–4.9)
- duration: standardise format e.g. "2 hrs", "Full Day", "60 min", "3-4 hrs"
- avg_price: (gyg_price + viator_price) / 2. If only one price exists, use that value
- tags: generate 3-5 lowercase comma-separated tags if blank
- Keep all URLs exactly as provided — do not modify

OUTPUT — JSON array only, no markdown:
[{
  "idx": 0,
  "valid": true,
  "error_reason": "",
  "row": ["City","Tour Name","Category","⭐ 4.7","Duration",avg_price,gyg_price,"GYG Link",viator_price,"Viator Link","attraction, tags"]
}]`;

  return callClaudeAPI(prompt, pending.length);
}


// ================================================================
// SECTION 8 — CLAUDE ENRICHMENT: TRAINS
// ================================================================

function enrichTrains(pending) {
  const input = pending.map((r, idx) => ({
    idx,
    mode:      r.data[TC.MODE-1]     || '',
    from_city: r.data[TC.FROM-1]     || '',
    to_city:   r.data[TC.TO-1]       || '',
    stops:     r.data[TC.STOPS-1]    || 0,
    stopover:  r.data[TC.STOPOVER-1] || '',
    inr_price: r.data[TC.INR-1]      || 0,
    may_e:     r.data[TC.MAY_E-1]    || '',
    aug_e:     r.data[TC.AUG_E-1]    || '',
    oct_e:     r.data[TC.OCT_E-1]    || '',
    dec_e:     r.data[TC.DEC_E-1]    || '',
    avg_e:     r.data[TC.AVG_E-1]    || '',
    notes:     r.data[TC.NOTES-1]    || '',
    added_by:  r.data[TC.ADDED_BY-1] || '',
  }));

  const prompt = `You are a travel data enrichment engine for TripStore Holidays. INR price at ₹110/€.

These rows are confirmed non-duplicates (bidirectional check already done). VALIDATE then ENRICH.

INPUT ROWS:
${JSON.stringify(input, null, 2)}

VALIDATE — valid=false if:
- from_city or to_city is empty or not a real city
- inr_price is 0 or missing
- mode is not Train / Ferry / Bus / Coach

ENRICH (if valid=true):
- Standardise city name capitalisation e.g. "amsterdam" → "Amsterdam"
- Standardise mode capitalisation
- avg_e: calculate average of provided € columns. If all € columns blank, back-calculate: round(inr_price / 110, 1)
- Generate BOTH directions as two separate rows (same price for the return)

OUTPUT — JSON array only, no markdown:
[{
  "idx": 0,
  "valid": true,
  "error_reason": "",
  "rows": [
    ["Mode","From City","To City",stops_number,"Stopover or null",inr_price,may_e,aug_e,oct_e,dec_e,avg_e],
    ["Mode","To City","From City",stops_number,"Stopover or null",inr_price,may_e,aug_e,oct_e,dec_e,avg_e]
  ]
}]`;

  return callClaudeAPI(prompt, pending.length);
}


// ================================================================
// SECTION 9 — CLAUDE ENRICHMENT: TRANSFERS
// ================================================================

function enrichTransfers(pending) {
  const input = pending.map((r, idx) => ({
    idx,
    city:        r.data[XC.CITY-1]        || '',
    country:     r.data[XC.COUNTRY-1]     || '',
    airport:     r.data[XC.AIRPORT-1]     || '',
    hub_name:    r.data[XC.HUB-1]         || '',
    zone:        r.data[XC.ZONE-1]        || '',
    direction:   r.data[XC.DIR-1]         || '',
    from_loc:    r.data[XC.FROM-1]        || '',
    to_loc:      r.data[XC.TO-1]          || '',
    economy:     r.data[XC.ECO-1]         || 0,
    standard:    r.data[XC.STD-1]         || 0,
    premium:     r.data[XC.PRE-1]         || 0,
    executive:   r.data[XC.EXE-1]         || 0,
    notes:       r.data[XC.NOTES-1]       || '',
    data_status: r.data[XC.DATA_STATUS-1] || 'Active',
    added_by:    r.data[XC.ADDED_BY-1]    || '',
  }));

  const prompt = `You are a travel data enrichment engine for TripStore Holidays. Prices in INR.

These rows are confirmed non-duplicates. VALIDATE then ENRICH.

INPUT ROWS:
${JSON.stringify(input, null, 2)}

VALIDATE — valid=false if:
- city is empty
- airport is not a recognisable IATA code
- economy price is 0 or missing

ENRICH (if valid=true):
- Validate and correct airport IATA code if wrong e.g. Paris → CDG, Amsterdam → AMS, London → LHR
- Fill hub_name if blank e.g. "Paris Charles de Gaulle Airport"
- Confirm or assign zone: Z1 – City Centre | Z2 – Outskirts/Resort | Z3 – Airport Area
- Missing vehicle tiers: Standard = round(economy×1.35/500)×500 | Premium = round(economy×1.70/500)×500 | Executive = round(economy×2.20/500)×500
- transfer_type: "Airport → Hotel" for ARRIVAL | "Hotel → Airport" for DEPARTURE
- schedule: auto-generate as "One way Transfer from [From] to [To] in Sedan or Van or similar"
- data_status: "Zone-Averaged" if any prices were estimated | "Active" if all supplier-confirmed

OUTPUT — JSON array only, no markdown:
[{
  "idx": 0,
  "valid": true,
  "error_reason": "",
  "row": ["City","Country","AIRPORT","Hub Name","Zone","Transfer Type","ARRIVAL or DEPARTURE",
          "From","To",economy,standard,premium,executive,"Schedule text","Notes","Active or Zone-Averaged"]
}]`;

  return callClaudeAPI(prompt, pending.length);
}


// ================================================================
// SECTION 10 — CLAUDE API
// ================================================================

function getApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY not set in Script Properties. Go to Extensions → Apps Script → Project Settings → Script Properties.');
  return key;
}

function callClaudeAPI(prompt, expectedCount) {
  try {
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': getApiKey(),
        'anthropic-version': '2023-06-01',
      },
      payload: JSON.stringify({
        model: CFG.MODEL,
        max_tokens: CFG.MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`Claude API returned ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`);
    }

    const responseData = JSON.parse(response.getContentText());
    const text         = responseData.content[0].text;
    const cleaned      = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);

  } catch (e) {
    Logger.log(`Claude API error: ${e.message}`);
    // Return error result for every row in the batch — they will be retried next run
    return Array(expectedCount).fill({
      valid: false,
      error_reason: `Claude API error — will retry next run: ${e.message}`,
    });
  }
}


// ================================================================
// SECTION 11 — SHEET UTILITIES
// ================================================================

function getPendingRows(sheet, statusColIndex) {
  const data    = sheet.getDataRange().getValues();
  const pending = [];

  // Row 1 = header, Row 2 = info banner, data starts Row 3
  for (let i = 2; i < data.length; i++) {
    const row    = data[i];
    const keyVal = (row[0] || '').toString().trim(); // first column (City or Mode)
    if (!keyVal) continue; // skip blank rows

    const status = (row[statusColIndex - 1] || '').toString().trim().toUpperCase();
    if (status === '' || status === CFG.STATUS.PENDING) {
      pending.push({ rowIndex: i + 1, data: row }); // rowIndex is 1-based for sheet operations
    }
  }

  return pending;
}

function markRow(sheet, rowIndex, status, reason, col) {
  sheet.getRange(rowIndex, col.STATUS).setValue(status);
  sheet.getRange(rowIndex, col.ERR).setValue(reason || '');
  sheet.getRange(rowIndex, col.PROC_DATE).setValue(new Date().toISOString());

  const colorMap = {
    [CFG.STATUS.PROCESSED]: CFG.COLOR.PROCESSED,
    [CFG.STATUS.ERROR]:     CFG.COLOR.ERROR,
    [CFG.STATUS.DUPLICATE]: CFG.COLOR.DUPLICATE,
  };

  const bg = colorMap[status] || CFG.COLOR.PENDING;
  sheet.getRange(rowIndex, 1, 1, col.TOTAL).setBackground(bg);

  const statusCell = sheet.getRange(rowIndex, col.STATUS);
  statusCell.setFontWeight('bold');
  statusCell.setHorizontalAlignment('center');
}

function appendToLog(ss, sheetName, dataType, row, reason) {
  const logSheet = ss.getSheetByName(sheetName);
  if (!logSheet) return;
  const d = row.data;
  logSheet.appendRow([
    new Date().toISOString(),
    dataType,
    (d[0] || '').toString(),   // City or From City
    (d[1] || '').toString(),   // Hotel Name or Tour Name or To City
    reason,
    JSON.stringify(d).slice(0, 500),
  ]);
}

function auditLog(ss, message) {
  Logger.log(message);
  try {
    const s = ss.getSheetByName(CFG.LOG.AUDIT);
    if (s) s.appendRow([new Date().toISOString(), message]);
  } catch (e) {
    // Fail silently — audit log should never break the pipeline
  }
}


// ================================================================
// SECTION 12 — SUMMARY EMAIL
// ================================================================

function sendSummaryEmail(results, durationSeconds) {
  const email = PropertiesService.getScriptProperties().getProperty('SUMMARY_EMAIL');
  if (!email) return;

  const totalProcessed  = Object.values(results).reduce((a, v) => a + v.processed, 0);
  const totalErrors     = Object.values(results).reduce((a, v) => a + v.errors, 0);
  const totalDuplicates = Object.values(results).reduce((a, v) => a + v.duplicates, 0);

  const breakdown = Object.entries(results)
    .map(([k, v]) => `  ${k.padEnd(14)}: ✅ ${v.processed} processed  ❌ ${v.errors} errors  ⚠️  ${v.duplicates} duplicates`)
    .join('\n');

  const subject = totalErrors > 0
    ? `TripStore Pipeline ⚠️ ACTION REQUIRED — ${new Date().toDateString()}`
    : `TripStore Pipeline ✅ All Clear — ${new Date().toDateString()}`;

  const body = [
    `TRIPSTORE NIGHTLY ENRICHMENT REPORT`,
    `${new Date().toDateString()} | Run time: ${durationSeconds}s`,
    ``,
    `TOTALS`,
    `  ✅ Processed  : ${totalProcessed}`,
    `  ❌ Errors     : ${totalErrors}`,
    `  ⚠️  Duplicates : ${totalDuplicates}`,
    ``,
    `BREAKDOWN BY DATA TYPE`,
    breakdown,
    ``,
    totalErrors > 0
      ? `ACTION REQUIRED\nOpen the Google Sheet → check red rows in INPUT tabs → read Error_Reason column → fix the data → run resetErrorRows() in Apps Script.\n`
      : `No action required. All new rows have been added to the master sheets.`,
    ``,
    `─────────────────────────────────────────`,
    `TripStore Enrichment Pipeline v2.1 | Automated message`,
  ].join('\n');

  GmailApp.sendEmail(email, subject, body);
}


// ================================================================
// SECTION 13 — ONE-TIME SETUP
// ================================================================

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  _buildInputSheet(ss, CFG.INPUT.HOTELS, [
    'City','Hotel Name','Star Rating','Hotel Category','Chain / Brand','Room Type',
    'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
    'Annual Avg (INR)','Added_By','Source_URL','Notes_Input',
    'Pipeline_Status','Error_Reason','Processed_Date'
  ], HC.STATUS,
  'Enter raw hotel data below. Prices as plain numbers (no ₹ symbol). Leave Pipeline_Status as PENDING. Claude enriches at midnight.');

  _buildInputSheet(ss, CFG.INPUT.SIGHTSEEING, [
    'City','Tour Name','Category','Rating','Duration',
    'Avg Price','GYG Price (INR)','GYG Link','Viator Price (INR)','Viator Link','Attraction Tags',
    'Added_By','Notes_Input',
    'Pipeline_Status','Error_Reason','Processed_Date'
  ], SC.STATUS,
  'At least one of GYG Price or Viator Price must be filled. Avg Price is auto-calculated. Leave Pipeline_Status as PENDING.');

  _buildInputSheet(ss, CFG.INPUT.TRAINS, [
    'Mode','From City','To City','Stops','Stopover City',
    'INR Price (₹)','May (€)','Aug (€)','Oct (€)','Dec (€)','Avg (€)',
    'Added_By','Source_URL','Notes_Input',
    'Pipeline_Status','Error_Reason','Processed_Date'
  ], TC.STATUS,
  'Enter ONE direction only (e.g. Paris → Brussels). Claude auto-generates the return leg. INR Price is mandatory.');

  _buildInputSheet(ss, CFG.INPUT.TRANSFERS, [
    'City','Country','Airport Code','Airport / Hub Name','Zone','Transfer Type',
    'Direction','From','To',
    'Economy Sedan (1-way) ₹','Standard Van (1-way) ₹','Premium Van (1-way) ₹','Executive Sedan (1-way) ₹',
    'Schedule','Notes','Data Status',
    'Added_By','Source_URL',
    'Pipeline_Status','Error_Reason','Processed_Date'
  ], XC.STATUS,
  'Enter BOTH ARRIVAL and DEPARTURE as separate rows. Economy price is mandatory. Missing vehicle tiers are estimated automatically.');

  _buildLogSheet(ss, CFG.LOG.ERRORS,     'c0392b', ['Logged_At','Data_Type','City / Route','Name','Error_Reason','Row_Data']);
  _buildLogSheet(ss, CFG.LOG.DUPLICATES, 'e67e22', ['Logged_At','Data_Type','City / Route','Name','Duplicate_Reason','Row_Data']);
  _buildLogSheet(ss, CFG.LOG.AUDIT,      '2c3e50', ['Timestamp','Event']);

  ui.alert('✅ Setup complete!\n\nAll INPUT and LOG tabs have been prepared.\n\nNext: run setupTrigger() to activate the midnight automation.');
}

function _buildInputSheet(ss, name, headers, statusColIndex, infoText) {
  let ws = ss.getSheetByName(name);
  if (!ws) ws = ss.insertSheet(name);

  // Header row
  const headerRange = ws.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground(CFG.COLOR.HEADER);
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);
  headerRange.setFontFamily('Arial');
  headerRange.setHorizontalAlignment('center');
  headerRange.setVerticalAlignment('middle');
  headerRange.setWrap(true);
  ws.setRowHeight(1, 36);

  // Info banner row
  ws.insertRowBefore(2);
  const bannerRange = ws.getRange(2, 1, 1, headers.length);
  bannerRange.merge();
  bannerRange.setValue(`ℹ️  ${infoText}`);
  bannerRange.setBackground('#eff3fb');
  bannerRange.setFontColor('#333333');
  bannerRange.setFontStyle('italic');
  bannerRange.setFontSize(9);
  bannerRange.setFontFamily('Arial');
  ws.setRowHeight(2, 20);

  // Status dropdown on data rows
  const statusLetter = _colLetter(statusColIndex);
  const dv = SpreadsheetApp.newDataValidation()
    .requireValueInList(['PENDING','PROCESSED','ERROR','DUPLICATE'], true)
    .setAllowInvalid(false)
    .build();
  ws.getRange(`${statusLetter}3:${statusLetter}2000`).setDataValidation(dv);

  ws.setFrozenRows(1);
  Logger.log(`Tab ready: ${name}`);
}

function _buildLogSheet(ss, name, headerColor, headers) {
  let ws = ss.getSheetByName(name);
  if (!ws) ws = ss.insertSheet(name);

  const r = ws.getRange(1, 1, 1, headers.length);
  r.setValues([headers]);
  r.setBackground(`#${headerColor}`);
  r.setFontColor('#FFFFFF');
  r.setFontWeight('bold');
  r.setFontSize(10);
  r.setFontFamily('Arial');
  r.setHorizontalAlignment('center');
  ws.setFrozenRows(1);
  ws.setRowHeight(1, 28);
  Logger.log(`Log tab ready: ${name}`);
}

function _colLetter(colIndex) {
  let letter = '';
  let n = colIndex;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}


// ================================================================
// SECTION 14 — TRIGGER SETUP
// ================================================================

function setupTrigger() {
  // Remove any existing trigger for this function to avoid duplicates
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runMidnightEnrichment')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Create new daily trigger at midnight (00:00–01:00 window)
  ScriptApp.newTrigger('runMidnightEnrichment')
    .timeBased()
    .atHour(0)
    .everyDays(1)
    .create();

  SpreadsheetApp.getUi().alert(
    '✅ Trigger activated!\n\nThe pipeline will run automatically every night between 12:00 AM and 1:00 AM IST.\n\nYou will receive a summary email after each run.'
  );
}


// ================================================================
// SECTION 15 — MAINTENANCE UTILITIES
// ================================================================

/**
 * Resets all ERROR rows back to PENDING so they are reprocessed tonight.
 * Run this after your team has corrected the error data in the INPUT sheets.
 */
function resetErrorRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = [
    { name: CFG.INPUT.HOTELS,      col: HC },
    { name: CFG.INPUT.SIGHTSEEING, col: SC },
    { name: CFG.INPUT.TRAINS,      col: TC },
    { name: CFG.INPUT.TRANSFERS,   col: XC },
  ];

  let totalReset = 0;

  sheets.forEach(({ name, col }) => {
    const ws = ss.getSheetByName(name);
    if (!ws) return;

    const data = ws.getDataRange().getValues();
    for (let i = 2; i < data.length; i++) {
      const status = (data[i][col.STATUS - 1] || '').toString().trim().toUpperCase();
      if (status === CFG.STATUS.ERROR) {
        ws.getRange(i + 1, col.STATUS).setValue(CFG.STATUS.PENDING);
        ws.getRange(i + 1, col.ERR).setValue('');
        ws.getRange(i + 1, col.PROC_DATE).setValue('');
        ws.getRange(i + 1, 1, 1, col.TOTAL).setBackground(CFG.COLOR.PENDING);
        totalReset++;
      }
    }
  });

  SpreadsheetApp.getUi().alert(
    `✅ Reset complete.\n\n${totalReset} ERROR row(s) reset to PENDING.\nThey will be reprocessed tonight at midnight.`
  );
}

/**
 * Shows a quick count of row statuses across all INPUT sheets.
 * Run this anytime to see what is queued.
 */
function showInputStats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = [
    { name: CFG.INPUT.HOTELS,      col: HC },
    { name: CFG.INPUT.SIGHTSEEING, col: SC },
    { name: CFG.INPUT.TRAINS,      col: TC },
    { name: CFG.INPUT.TRANSFERS,   col: XC },
  ];

  let msg = 'INPUT SHEET STATUS\n' + '─'.repeat(44) + '\n';

  sheets.forEach(({ name, col }) => {
    const ws = ss.getSheetByName(name);
    if (!ws) { msg += `\n${name}: TAB NOT FOUND\n`; return; }

    const data   = ws.getDataRange().getValues().slice(2); // skip header + banner
    const counts = { PENDING: 0, PROCESSED: 0, ERROR: 0, DUPLICATE: 0 };

    data.forEach(row => {
      if (!(row[0] || '').toString().trim()) return; // skip blank rows
      const s = (row[col.STATUS - 1] || 'PENDING').toString().trim().toUpperCase();
      counts[s] = (counts[s] || 0) + 1;
    });

    msg += `\n${name}:\n`;
    msg += `  PENDING: ${counts.PENDING}  |  PROCESSED: ${counts.PROCESSED}  |  ERROR: ${counts.ERROR}  |  DUPLICATE: ${counts.DUPLICATE}\n`;
  });

  SpreadsheetApp.getUi().alert(msg);
}

