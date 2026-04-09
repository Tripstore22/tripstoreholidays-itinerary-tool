// ============================================================
// ⚠️  LEGACY FILE — superseded by Pipeline.gs
// All functions below are renamed with _LEGACY suffix to avoid
// naming conflicts. DO NOT run these — use Pipeline.gs instead.
// ============================================================

// ============================================================
// TRIP STORE HOLIDAYS — Data Enrichment Automation
// Paste this into a NEW Apps Script file called Automation.gs
// in the same Apps Script project as Code.gs
//
// SETUP STEPS (one time):
// 1. In Apps Script editor: Project Settings → Script Properties
//    Add property: CLAUDE_API_KEY = your key from console.anthropic.com
// 2. To schedule midnight run:
//    Apps Script editor → Triggers (clock icon) → Add Trigger
//    Function: runMidnightEnrichment | Event: Time-driven | Day timer | 11pm-midnight
// ============================================================


// ============================================================
// SHEET & COLUMN CONFIGURATION
// ============================================================

const INPUT_TABS = {
  sightseeing: 'INPUT_Sightseeing',
  hotels:      'INPUT_Hotels',
  transfers:   'INPUT_Transfers',
  trains:      'INPUT_Trains'
};

const MASTER_TABS = {
  sightseeing: 'Sightseeing',
  hotels:      'Hotels',
  transfers:   'Transfers',
  trains:      'Trains'
};

// Status values written into the Status column of input tabs
const STATUS = {
  PENDING:   'PENDING',
  PROCESSED: 'PROCESSED',
  DUPLICATE: 'DUPLICATE',
  ERROR:     'ERROR'
};

// Batch size: how many rows to send to Claude at once
const BATCH_SIZE = 15;


// ============================================================
// MAIN ENTRY POINT — called by the midnight trigger
// ============================================================

function runMidnightEnrichment_LEGACY() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const log = [];

  log.push('=== Trip Store Enrichment Run: ' + new Date().toLocaleString() + ' ===');

  try { processSightseeing(ss, log); } catch(e) { log.push('SIGHTSEEING ERROR: ' + e.message); }
  try { processHotels(ss, log);      } catch(e) { log.push('HOTELS ERROR: '      + e.message); }
  try { processTransfers(ss, log);   } catch(e) { log.push('TRANSFERS ERROR: '   + e.message); }
  try { processTrains(ss, log);      } catch(e) { log.push('TRAINS ERROR: '      + e.message); }

  log.push('=== Run complete ===');

  // Write run log to a LOG tab
  writeLog(ss, log);
}


// ============================================================
// SIGHTSEEING PROCESSOR
// Input columns (A–K):
// City | Tour Name | Category | Rating | Duration |
// Avg Price | GYG Price | Viator Price | Notes | Status | Error Reason
// ============================================================

function processSightseeing(ss, log) {
  const inputSheet  = ss.getSheetByName(INPUT_TABS.sightseeing);
  const masterSheet = ss.getSheetByName(MASTER_TABS.sightseeing);
  if (!inputSheet || !masterSheet) { log.push('Sightseeing sheets not found — skipping'); return; }

  const inputData  = inputSheet.getDataRange().getValues();
  const masterData = masterSheet.getDataRange().getValues();

  // Build duplicate check set: "city||tourname"
  const masterSet = new Set();
  for (let i = 1; i < masterData.length; i++) {
    const key = (String(masterData[i][0]).trim() + '||' + String(masterData[i][1]).trim()).toLowerCase();
    if (key !== '||') masterSet.add(key);
  }

  // Collect PENDING rows
  const pendingRows = [];
  for (let i = 1; i < inputData.length; i++) {
    const row    = inputData[i];
    const status = String(row[9] || '').trim().toUpperCase();
    if (status === STATUS.PENDING || status === '') pendingRows.push({ rowIndex: i, data: row });
  }

  if (pendingRows.length === 0) { log.push('Sightseeing: no pending rows'); return; }
  log.push('Sightseeing: ' + pendingRows.length + ' pending rows found');

  // Validate and separate errors
  const toEnrich  = [];
  const errors    = [];

  for (const item of pendingRows) {
    const r    = item.data;
    const city = String(r[0] || '').trim();
    const name = String(r[1] || '').trim();
    const price = parseFloat(String(r[5] || r[6] || r[7] || '0').replace(/[₹,\s]/g, ''));

    if (!city)        { errors.push({ item, reason: 'MISSING: City is empty' }); continue; }
    if (!name)        { errors.push({ item, reason: 'MISSING: Tour Name is empty' }); continue; }
    if (price <= 0)   { errors.push({ item, reason: 'INVALID: Price is 0 or missing' }); continue; }

    const key = (city + '||' + name).toLowerCase();
    if (masterSet.has(key)) { errors.push({ item, reason: 'DUPLICATE: Already exists in master sheet' }); continue; }

    toEnrich.push(item);
  }

  log.push('Sightseeing: ' + toEnrich.length + ' valid, ' + errors.length + ' errors/duplicates');

  // Mark errors in input sheet
  for (const { item, reason } of errors) {
    const isDup = reason.startsWith('DUPLICATE');
    inputSheet.getRange(item.rowIndex + 1, 10).setValue(isDup ? STATUS.DUPLICATE : STATUS.ERROR);
    inputSheet.getRange(item.rowIndex + 1, 11).setValue(reason);
  }

  // Process valid rows in batches
  for (let b = 0; b < toEnrich.length; b += BATCH_SIZE) {
    const batch = toEnrich.slice(b, b + BATCH_SIZE);

    // Build JSON for Claude
    const batchJson = batch.map(item => ({
      city:         String(item.data[0]).trim(),
      tourName:     String(item.data[1]).trim(),
      category:     String(item.data[2] || '').trim(),
      rating:       String(item.data[3] || '').trim(),
      duration:     String(item.data[4] || '').trim(),
      avgPrice:     String(item.data[5] || '').trim(),
      gygPrice:     String(item.data[6] || '').trim(),
      viatorPrice:  String(item.data[7] || '').trim(),
      notes:        String(item.data[8] || '').trim()
    }));

    const enriched = enrichSightseeingWithClaude(batchJson, log);
    if (!enriched) { log.push('Sightseeing batch ' + b + ': Claude call failed, skipping batch'); continue; }

    // Write enriched rows to master sheet
    for (let i = 0; i < enriched.length; i++) {
      const e   = enriched[i];
      const src = batch[i];

      masterSheet.appendRow([
        e.city,
        e.tourName,
        e.category,
        e.rating,
        e.duration,
        e.avgPrice    || src.data[5],
        e.gygPrice    || src.data[6],
        '',                             // GYG Link (manual)
        e.viatorPrice || src.data[7],
        '',                             // Viator Link (manual)
        e.tags || ''                    // Column K: Attraction Tags
      ]);

      // Mark as processed in input sheet
      inputSheet.getRange(src.rowIndex + 1, 10).setValue(STATUS.PROCESSED);
      inputSheet.getRange(src.rowIndex + 1, 11).setValue('Added to master: ' + new Date().toLocaleDateString());
    }

    log.push('Sightseeing batch ' + (b + 1) + '–' + (b + batch.length) + ': written to master');
    Utilities.sleep(2000); // pause between batches to respect API rate limits
  }
}


// ============================================================
// HOTELS PROCESSOR
// Input columns (A–J):
// City | Hotel Name | Star Rating | Category | Chain | Room Type |
// Annual Avg Price | Notes | Status | Error Reason
// ============================================================

function processHotels(ss, log) {
  const inputSheet  = ss.getSheetByName(INPUT_TABS.hotels);
  const masterSheet = ss.getSheetByName(MASTER_TABS.hotels);
  if (!inputSheet || !masterSheet) { log.push('Hotels sheets not found — skipping'); return; }

  const inputData  = inputSheet.getDataRange().getValues();
  const masterData = masterSheet.getDataRange().getValues();

  // Duplicate check: city + hotel name + room type
  const masterSet = new Set();
  for (let i = 1; i < masterData.length; i++) {
    const key = [masterData[i][0], masterData[i][1], masterData[i][5]].map(v => String(v).trim().toLowerCase()).join('||');
    masterSet.add(key);
  }

  const pendingRows = [];
  for (let i = 1; i < inputData.length; i++) {
    const status = String(inputData[i][8] || '').trim().toUpperCase();
    if (status === STATUS.PENDING || status === '') pendingRows.push({ rowIndex: i, data: inputData[i] });
  }

  if (pendingRows.length === 0) { log.push('Hotels: no pending rows'); return; }

  const toEnrich = [], errors = [];

  for (const item of pendingRows) {
    const r     = item.data;
    const city  = String(r[0] || '').trim();
    const name  = String(r[1] || '').trim();
    const room  = String(r[5] || '').trim();
    const price = parseFloat(String(r[6] || '0').replace(/[₹,\s]/g, ''));

    if (!city)      { errors.push({ item, reason: 'MISSING: City is empty' });         continue; }
    if (!name)      { errors.push({ item, reason: 'MISSING: Hotel Name is empty' });   continue; }
    if (price <= 0) { errors.push({ item, reason: 'INVALID: Price is 0 or missing' }); continue; }

    const key = [city, name, room].map(v => v.toLowerCase()).join('||');
    if (masterSet.has(key)) { errors.push({ item, reason: 'DUPLICATE: Already exists in master sheet' }); continue; }

    toEnrich.push(item);
  }

  log.push('Hotels: ' + toEnrich.length + ' valid, ' + errors.length + ' errors/duplicates');

  for (const { item, reason } of errors) {
    inputSheet.getRange(item.rowIndex + 1, 9).setValue(reason.startsWith('DUPLICATE') ? STATUS.DUPLICATE : STATUS.ERROR);
    inputSheet.getRange(item.rowIndex + 1, 10).setValue(reason);
  }

  for (let b = 0; b < toEnrich.length; b += BATCH_SIZE) {
    const batch    = toEnrich.slice(b, b + BATCH_SIZE);
    const batchJson = batch.map(item => ({
      city:        String(item.data[0]).trim(),
      hotelName:   String(item.data[1]).trim(),
      starRating:  String(item.data[2] || '').trim(),
      category:    String(item.data[3] || '').trim(),
      chain:       String(item.data[4] || '').trim(),
      roomType:    String(item.data[5] || '').trim(),
      annualAvg:   String(item.data[6] || '').trim()
    }));

    const enriched = enrichHotelsWithClaude(batchJson, log);
    if (!enriched) { log.push('Hotels batch ' + b + ': Claude call failed'); continue; }

    for (let i = 0; i < enriched.length; i++) {
      const e   = enriched[i];
      const src = batch[i];

      // Master sheet has 19 columns: City|Name|Stars|Category|Chain|RoomType|Jan..Dec|AnnualAvg
      // For simplicity, fill all monthly prices with annualAvg (team can update later)
      const avg = parseFloat(String(e.annualAvg || src.data[6]).replace(/[₹,\s]/g, '')) || 0;
      masterSheet.appendRow([
        e.city, e.hotelName, e.starRating, e.category, e.chain, e.roomType,
        avg, avg, avg, avg, avg, avg, avg, avg, avg, avg, avg, avg, avg  // Jan–Dec + AnnualAvg
      ]);

      inputSheet.getRange(src.rowIndex + 1, 9).setValue(STATUS.PROCESSED);
      inputSheet.getRange(src.rowIndex + 1, 10).setValue('Added to master: ' + new Date().toLocaleDateString());
    }

    log.push('Hotels batch ' + (b + 1) + '–' + (b + batch.length) + ': written to master');
    Utilities.sleep(2000);
  }
}


// ============================================================
// TRANSFERS PROCESSOR
// Input columns (A–N):
// City | Country | Airport Code | Direction | From | To |
// Economy Sedan | Standard Van | Premium Van | Executive Sedan |
// Schedule | Notes | Status | Error Reason
// ============================================================

function processTransfers(ss, log) {
  const inputSheet  = ss.getSheetByName(INPUT_TABS.transfers);
  const masterSheet = ss.getSheetByName(MASTER_TABS.transfers);
  if (!inputSheet || !masterSheet) { log.push('Transfers sheets not found — skipping'); return; }

  const inputData  = inputSheet.getDataRange().getValues();
  const masterData = masterSheet.getDataRange().getValues();

  // Duplicate: city + direction + from + to
  const masterSet = new Set();
  for (let i = 1; i < masterData.length; i++) {
    const key = [masterData[i][0], masterData[i][6], masterData[i][7], masterData[i][8]]
                  .map(v => String(v).trim().toLowerCase()).join('||');
    masterSet.add(key);
  }

  const pendingRows = [], toEnrich = [], errors = [];
  for (let i = 1; i < inputData.length; i++) {
    const status = String(inputData[i][12] || '').trim().toUpperCase();
    if (status === STATUS.PENDING || status === '') pendingRows.push({ rowIndex: i, data: inputData[i] });
  }

  if (pendingRows.length === 0) { log.push('Transfers: no pending rows'); return; }

  for (const item of pendingRows) {
    const r         = item.data;
    const city      = String(r[0] || '').trim();
    const direction = String(r[3] || '').trim().toUpperCase();
    const from      = String(r[4] || '').trim();
    const to        = String(r[5] || '').trim();
    const price     = parseFloat(String(r[6] || '0').replace(/[₹,\s]/g, ''));

    if (!city)                                  { errors.push({ item, reason: 'MISSING: City is empty' }); continue; }
    if (!from || !to)                           { errors.push({ item, reason: 'MISSING: From or To is empty' }); continue; }
    if (price <= 0)                             { errors.push({ item, reason: 'INVALID: Economy Sedan price is 0 or missing' }); continue; }
    if (!['ARRIVAL','DEPARTURE'].includes(direction)) { errors.push({ item, reason: 'INVALID: Direction must be ARRIVAL or DEPARTURE' }); continue; }

    const key = [city, direction, from, to].map(v => v.toLowerCase()).join('||');
    if (masterSet.has(key)) { errors.push({ item, reason: 'DUPLICATE: Same route already in master sheet' }); continue; }

    toEnrich.push(item);
  }

  log.push('Transfers: ' + toEnrich.length + ' valid, ' + errors.length + ' errors/duplicates');

  for (const { item, reason } of errors) {
    inputSheet.getRange(item.rowIndex + 1, 13).setValue(reason.startsWith('DUPLICATE') ? STATUS.DUPLICATE : STATUS.ERROR);
    inputSheet.getRange(item.rowIndex + 1, 14).setValue(reason);
  }

  // Transfers don't need Claude enrichment — just validate and move
  for (const item of toEnrich) {
    const r = item.data;
    masterSheet.appendRow([
      String(r[0]).trim(),  // City
      String(r[1]).trim(),  // Country
      String(r[2]).trim(),  // Airport Code
      '',                   // Airport Name (optional)
      '',                   // Zone
      '',                   // Transfer Type
      String(r[3]).trim().toUpperCase(), // Direction
      String(r[4]).trim(),  // From
      String(r[5]).trim(),  // To
      r[6] || 0,            // Economy Sedan
      r[7] || 0,            // Standard Van
      r[8] || 0,            // Premium Van
      r[9] || 0,            // Executive Sedan
      String(r[10] || '').trim(), // Schedule
      String(r[11] || '').trim(), // Notes
      'active'              // Data Status
    ]);

    inputSheet.getRange(item.rowIndex + 1, 13).setValue(STATUS.PROCESSED);
    inputSheet.getRange(item.rowIndex + 1, 14).setValue('Added to master: ' + new Date().toLocaleDateString());
  }

  if (toEnrich.length > 0) log.push('Transfers: ' + toEnrich.length + ' rows written to master');
}


// ============================================================
// TRAINS / INTERCITY PROCESSOR
// Input columns (A–I):
// Mode | From City | To City | Stops | Stopover City | INR Price |
// Notes | Status | Error Reason
// ============================================================

function processTrains(ss, log) {
  const inputSheet  = ss.getSheetByName(INPUT_TABS.trains);
  const masterSheet = ss.getSheetByName(MASTER_TABS.trains);
  if (!inputSheet || !masterSheet) { log.push('Trains sheets not found — skipping'); return; }

  const inputData  = inputSheet.getDataRange().getValues();
  const masterData = masterSheet.getDataRange().getValues();

  // Duplicate: mode + from + to
  const masterSet = new Set();
  for (let i = 1; i < masterData.length; i++) {
    const key = [masterData[i][0], masterData[i][1], masterData[i][2]]
                  .map(v => String(v).trim().toLowerCase()).join('||');
    masterSet.add(key);
  }

  const pendingRows = [], toAdd = [], errors = [];
  for (let i = 1; i < inputData.length; i++) {
    const status = String(inputData[i][7] || '').trim().toUpperCase();
    if (status === STATUS.PENDING || status === '') pendingRows.push({ rowIndex: i, data: inputData[i] });
  }

  if (pendingRows.length === 0) { log.push('Trains: no pending rows'); return; }

  for (const item of pendingRows) {
    const r     = item.data;
    const mode  = String(r[0] || '').trim();
    const from  = String(r[1] || '').trim();
    const to    = String(r[2] || '').trim();
    const price = parseFloat(String(r[5] || '0').replace(/[₹,\s]/g, ''));

    if (!from)      { errors.push({ item, reason: 'MISSING: From City is empty' }); continue; }
    if (!to)        { errors.push({ item, reason: 'MISSING: To City is empty' });   continue; }
    if (price <= 0) { errors.push({ item, reason: 'INVALID: Price is 0 or missing' }); continue; }

    const key = [mode || 'train', from, to].map(v => v.toLowerCase()).join('||');
    if (masterSet.has(key)) { errors.push({ item, reason: 'DUPLICATE: Same route already in master sheet' }); continue; }

    toAdd.push(item);
  }

  log.push('Trains: ' + toAdd.length + ' valid, ' + errors.length + ' errors/duplicates');

  for (const { item, reason } of errors) {
    inputSheet.getRange(item.rowIndex + 1, 8).setValue(reason.startsWith('DUPLICATE') ? STATUS.DUPLICATE : STATUS.ERROR);
    inputSheet.getRange(item.rowIndex + 1, 9).setValue(reason);
  }

  for (const item of toAdd) {
    const r = item.data;
    masterSheet.appendRow([
      String(r[0] || 'Train').trim(), // Mode
      String(r[1]).trim(),            // From City
      String(r[2]).trim(),            // To City
      String(r[3] || '0').trim(),     // Stops
      String(r[4] || '').trim(),      // Stopover City
      r[5] || 0                       // INR Price
    ]);

    inputSheet.getRange(item.rowIndex + 1, 8).setValue(STATUS.PROCESSED);
    inputSheet.getRange(item.rowIndex + 1, 9).setValue('Added to master: ' + new Date().toLocaleDateString());
  }

  if (toAdd.length > 0) log.push('Trains: ' + toAdd.length + ' rows written to master');
}


// ============================================================
// CLAUDE API — SIGHTSEEING ENRICHMENT
// Adds: tags, standardises category, fills duration
// ============================================================

function enrichSightseeingWithClaude(rows, log) {
  const prompt = `You are enriching European travel sightseeing data for a tour operator.

For each tour in the JSON array below, add or improve these fields:
1. "tags": 2–5 specific attraction tags, comma-separated, lowercase. Be specific to the actual venue/experience (e.g. "colosseum,ancient-rome,gladiators" NOT generic "sightseeing,tour"). These tags prevent booking duplicate experiences.
2. "category": standardise to exactly one of: Landmark | Day Trip | Food & Culture | Walking Tour | Museum | Historical | Outdoor & Adventure | Wellness | Night Life | Cultural Show
3. "duration": if empty or unclear, estimate realistically (e.g. "2 hrs", "3 hrs", "Half Day", "Full Day", "5-6 hrs")

Return ONLY a valid JSON array. No explanation, no markdown, no extra text. Keep all original fields and add the enriched ones.

Input:
${JSON.stringify(rows, null, 2)}`;

  const response = callClaudeAPI_LEGACY(prompt, log);
  if (!response) return null;

  try {
    // Extract JSON array from response (Claude sometimes adds whitespace)
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) { log.push('Claude sightseeing: could not parse JSON from response'); return null; }
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    log.push('Claude sightseeing JSON parse error: ' + e.message);
    return null;
  }
}


// ============================================================
// CLAUDE API — HOTELS ENRICHMENT
// Standardises category and room type
// ============================================================

function enrichHotelsWithClaude(rows, log) {
  const prompt = `You are standardising European hotel data for a tour operator.

For each hotel in the JSON array below, standardise these fields:
1. "category": standardise to exactly one of: Budget | Standard | Superior | Deluxe | Luxury | Ultra-Luxury
2. "roomType": clean up the room type name to be clear and consistent (e.g. "Superior Double Room", "Deluxe Twin Room", "Standard Double Room")
3. "starRating": if missing, estimate from hotel name and category (return as number 1–5)

Return ONLY a valid JSON array. No explanation, no markdown, no extra text. Keep all original fields.

Input:
${JSON.stringify(rows, null, 2)}`;

  const response = callClaudeAPI_LEGACY(prompt, log);
  if (!response) return null;

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) { log.push('Claude hotels: could not parse JSON from response'); return null; }
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    log.push('Claude hotels JSON parse error: ' + e.message);
    return null;
  }
}


// ============================================================
// CLAUDE API — RAW HTTP CALL
// ============================================================

function callClaudeAPI_LEGACY(prompt, log) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    log.push('ERROR: CLAUDE_API_KEY not set in Script Properties');
    return null;
  }

  const payload = {
    model:      'claude-haiku-4-5-20251001',  // Fast + affordable for data enrichment
    max_tokens: 4096,
    messages:   [{ role: 'user', content: prompt }]
  };

  const options = {
    method:          'post',
    contentType:     'application/json',
    headers: {
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01'
    },
    payload:          JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    const code     = response.getResponseCode();

    if (code !== 200) {
      log.push('Claude API error ' + code + ': ' + response.getContentText().substring(0, 200));
      return null;
    }

    const result = JSON.parse(response.getContentText());
    return result.content[0].text;

  } catch (e) {
    log.push('Claude API call failed: ' + e.message);
    return null;
  }
}


// ============================================================
// LOG WRITER — writes run summary to a LOG tab
// ============================================================

function writeLog(ss, log) {
  let logSheet = ss.getSheetByName('ENRICHMENT_LOG');
  if (!logSheet) {
    logSheet = ss.insertSheet('ENRICHMENT_LOG');
    logSheet.appendRow(['Timestamp', 'Message']);
  }

  const timestamp = new Date();
  for (const entry of log) {
    logSheet.appendRow([timestamp, entry]);
  }

  // Keep only last 500 rows to avoid sheet growing too large
  const maxRows = 500;
  const total   = logSheet.getLastRow();
  if (total > maxRows + 1) {
    logSheet.deleteRows(2, total - maxRows - 1);
  }
}


// ============================================================
// SETUP HELPER — run this ONCE manually to create input tabs
// with correct headers. Go to Apps Script → Run → createInputTabs
// ============================================================

function createInputTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const tabs = [
    {
      name: INPUT_TABS.sightseeing,
      headers: [
        'City', 'Tour Name', 'Category', 'Rating', 'Duration',
        'Avg Price (INR)', 'GYG Price (INR)', 'Viator Price (INR)',
        'Notes', 'Status', 'Error Reason'
      ],
      color: '#4CAF50'
    },
    {
      name: INPUT_TABS.hotels,
      headers: [
        'City', 'Hotel Name', 'Star Rating', 'Category', 'Chain', 'Room Type',
        'Annual Avg Price (INR)', 'Notes', 'Status', 'Error Reason'
      ],
      color: '#2196F3'
    },
    {
      name: INPUT_TABS.transfers,
      headers: [
        'City', 'Country', 'Airport Code', 'Direction (ARRIVAL/DEPARTURE)',
        'From', 'To', 'Economy Sedan (INR)', 'Standard Van (INR)',
        'Premium Van (INR)', 'Executive Sedan (INR)',
        'Schedule', 'Notes', 'Status', 'Error Reason'
      ],
      color: '#FF9800'
    },
    {
      name: INPUT_TABS.trains,
      headers: [
        'Mode (Train/Ferry/Bus)', 'From City', 'To City',
        'Stops', 'Stopover City', 'INR Price',
        'Notes', 'Status', 'Error Reason'
      ],
      color: '#9C27B0'
    }
  ];

  for (const tab of tabs) {
    let sheet = ss.getSheetByName(tab.name);
    if (sheet) {
      SpreadsheetApp.getUi().alert(tab.name + ' already exists — skipping.');
      continue;
    }

    sheet = ss.insertSheet(tab.name);
    sheet.appendRow(tab.headers);

    // Style header row
    const headerRange = sheet.getRange(1, 1, 1, tab.headers.length);
    headerRange.setBackground(tab.color);
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);

    // Add data validation for Status column
    const statusCol    = tab.headers.indexOf('Status') + 1;
    const statusRule   = SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS.PENDING, STATUS.PROCESSED, STATUS.DUPLICATE, STATUS.ERROR])
      .build();
    sheet.getRange(2, statusCol, 1000, 1).setDataValidation(statusRule);

    // Pre-fill Status column with PENDING for empty rows
    sheet.getRange(2, statusCol, 1000, 1).setValue(STATUS.PENDING);

    SpreadsheetApp.getUi().alert(tab.name + ' created successfully!');
  }
}


// ============================================================
// MANUAL TRIGGER — run enrichment immediately (for testing)
// Go to Apps Script → Run → runNow
// ============================================================

function runNow() {
  runMidnightEnrichment();
  SpreadsheetApp.getUi().alert('Enrichment complete. Check ENRICHMENT_LOG tab for details.');
}


// ============================================================
// SETUP SHEETS — creates all required tabs in the spreadsheet
// Run once manually: Apps Script → Run → setupSheets
// ============================================================

function setupSheets_LEGACY() {
  createInputTabs(); // creates INPUT_Hotels, INPUT_Sightseeing, INPUT_Trains, INPUT_Transfers

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Also create log tabs if they don't exist
  const logTabs = [
    { name: 'ENRICHMENT_LOG', headers: ['Run Time', 'Type', 'Processed', 'Duplicates', 'Errors', 'Notes'], color: '#607D8B' },
    { name: 'ERROR_LOG',      headers: ['Logged At', 'Type', 'City', 'Name', 'Error Reason'],             color: '#F44336' },
    { name: 'DUPLICATE_LOG',  headers: ['Logged At', 'Type', 'City', 'Name', 'Matched To'],               color: '#FF9800' },
  ];

  for (const tab of logTabs) {
    if (ss.getSheetByName(tab.name)) continue; // already exists
    const sheet = ss.insertSheet(tab.name);
    sheet.appendRow(tab.headers);
    const hr = sheet.getRange(1, 1, 1, tab.headers.length);
    hr.setBackground(tab.color);
    hr.setFontColor('#ffffff');
    hr.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  SpreadsheetApp.getUi().alert('✅ setupSheets complete. All required tabs are ready.');
}


// ============================================================
// SETUP TRIGGER — creates midnight automation trigger
// Run once manually: Apps Script → Run → setupTrigger
// WARNING: removes all existing project triggers first
// ============================================================

function setupTrigger_LEGACY() {
  // Remove any existing triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Create daily trigger at midnight (00:00–01:00 Apps Script time)
  ScriptApp.newTrigger('runMidnightEnrichment')
    .timeBased()
    .atHour(0)
    .everyDays(1)
    .create();

  SpreadsheetApp.getUi().alert('✅ Midnight trigger created. runMidnightEnrichment will run daily at ~12:00 AM.');
}
