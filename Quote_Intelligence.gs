/**
 * ================================================================
 * TRIPSTORE QUOTE INTELLIGENCE — Quote_Log Extension
 * ================================================================
 *
 * HOW TO INTEGRATE:
 *   1. Add this entire file as a new tab in Apps Script (File → New Script → paste here)
 *   2. Run setupQuoteLog() ONCE to create the Quote_Log sheet with headers
 *   3. In your saveItinerary() function, add this line at the end (before return):
 *        logQuote(paxName, parsedData);
 *      where parsedData is the same JSON object you write to Saved_Itineraries
 *
 * WHAT IT LOGS (30 columns):
 *   Identity     — Quote ID, Agent, Pax Name, Timestamp, Travel Month
 *   PAX          — Adults, Children, Total PAX
 *   Destinations — Cities (comma-separated), Total Nights, Number of Cities
 *   Financials   — Hotel Net, Sightseeing Net, Transfers Net, Trains Net
 *                  Markup %, Markup Amount, GST Amount, Grand Total
 *   Budget Intel — Budget Entered, Utilization %, Over/Under Flag
 *   Composition  — Hotels Manual Override count, Sights Manual count,
 *                  Intercity Manual count, Avg Hotel Category, Vehicle Type mix
 *   Outcome      — Manually updated: Won / Lost / Pending (default: Pending)
 * ================================================================
 */


// ── MAIN FUNCTION: call this from saveItinerary() ─────────────────

function logQuote(paxName, data) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('Quote_Log');

  if (!logSheet) {
    setupQuoteLog();
    return logQuote(paxName, data); // retry after creating sheet
  }

  try {
    if (!data || !paxName) return;
    const row = buildQuoteLogRow(paxName, data);
    if (!row || !row.length) return;

    // ── SMART DEDUP ──────────────────────────────────────────────────
    // Prevents duplicate entries on repeated save / print / PDF of the
    // same itinerary, but still logs a new entry when a hotel, sight or
    // transfer swap meaningfully changes the cost (variant tracking).
    //
    // Rule: skip if the new Grand Total is within 2% AND within ₹1,000
    //       of the last logged entry for this paxName.
    //       Log whenever the cost moves beyond either threshold.
    const newGrandTotal = row[19]; // index 19 = Grand Total
    const allRows = logSheet.getDataRange().getValues();
    if (allRows.length > 1) {
      const paxLower = paxName.trim().toLowerCase();
      let lastGrandTotal = null;
      for (let i = 1; i < allRows.length; i++) {
        // col C (index 2) = Pax Name in the current schema
        if (String(allRows[i][2] || '').trim().toLowerCase() === paxLower) {
          lastGrandTotal = Number(allRows[i][19]) || 0;
          // Keep iterating — want the LAST (most recent) match
        }
      }
      if (lastGrandTotal !== null) {
        const diff    = Math.abs(newGrandTotal - lastGrandTotal);
        const pctDiff = lastGrandTotal > 0 ? (diff / lastGrandTotal * 100) : 100;
        if (pctDiff < 2 && diff < 1000) return; // No meaningful change — skip
      }
    }
    // ── END SMART DEDUP ──────────────────────────────────────────────

    logSheet.appendRow(row);
    colorLogRow(logSheet, logSheet.getLastRow(), row);
  } catch (e) {
    Logger.log('Quote log error (non-fatal): ' + e.message);
    // Never let logging break the save operation
  }
}


// ── ROW BUILDER ───────────────────────────────────────────────────

function buildQuoteLogRow(paxName, d) {
  if (!d || typeof d !== 'object') return [];
  const agentName  = d.agentName         || '';
  const plan       = d.currentPlan       || [];
  const transfers  = d.selectedTransfers || [];
  const intercity  = d.selectedIntercity || [];

  // ── PAX ──
  const adults   = d.adults   || 0;
  const children = d.children || 0;
  const paxCount = (adults + children) > 0 ? (adults + children) : (d.paxCount || 0);

  // ── DESTINATIONS ──
  const cities     = plan.map(p => _titleCase(p.city || '')).filter(Boolean);
  const cityStr    = [...new Set(cities)].join(', ');
  const totalNights = plan.reduce((s, p) => s + (p.nights || 0), 0);
  const numCities  = new Set(cities).size;

  // ── TRAVEL MONTH: use check-in of first city ──
  let travelMonth = '';
  if (plan.length > 0 && plan[0].cin) {
    try {
      const dt = new Date(plan[0].cin);
      const _months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      travelMonth = String(dt.getDate()).padStart(2,'0') + '-' + _months[dt.getMonth()] + '-' + String(dt.getFullYear()).slice(-2);
    } catch(e) {}
  }

  // ── FINANCIAL COMPONENTS ──
  let hotelNet = 0, sightNet = 0, transferNet = 0, intercityNet = 0;
  let hotelsManual = 0, sightsManual = 0, intercityManual = 0;
  const hotelCategories = [];
  const vehicleTypes = [];

  plan.forEach(p => {
    const h = p.hotel || {};
    const cost = (h.cost || 0) * (p.nights || 0);
    hotelNet += cost;
    if (p.isHotelManual) hotelsManual++;
    if (h.category) hotelCategories.push(h.category);

    (p.sights || []).forEach(s => {
      sightNet += (s.price || 0);
      if (s.isManual) sightsManual++;
    });
  });

  transfers.forEach(t => {
    transferNet += (t.vehiclePrice || 0);
    // Infer vehicle type from price ratios
    const eco = t.economySedan || 0;
    const vp  = t.vehiclePrice || 0;
    if (eco > 0) {
      const ratio = vp / eco;
      if (ratio <= 1.1)      vehicleTypes.push('Economy');
      else if (ratio <= 1.5) vehicleTypes.push('Standard Van');
      else if (ratio <= 1.9) vehicleTypes.push('Premium Van');
      else                   vehicleTypes.push('Executive');
    }
  });

  intercity.forEach(ic => {
    intercityNet += (ic.price || 0);
    if (ic.isManual) intercityManual++;
  });

  // ── MARKUP & GST ──
  const markupPct    = Number(d.markup) || 0;
  const subTotal     = hotelNet + sightNet + transferNet + intercityNet;
  const markupAmt    = Math.round(subTotal * markupPct / 100);
  let gstPct = 0;
  if (d.gstMode === '18svc') gstPct = 18;
  else if (d.gstMode === '5pkg') gstPct = 5;
  else if (typeof d.gst === 'number') gstPct = d.gst; // legacy fallback
  // GST base: 5pkg applies to full package; 18svc applies to markup only (matches frontend)
  const gstBase      = d.gstMode === '5pkg' ? (subTotal + markupAmt) : markupAmt;
  const gstAmt       = Math.round(gstBase * gstPct / 100);
  const grandTotal   = subTotal + markupAmt + gstAmt;

  // ── BUDGET & UTILISATION ──
  // Budget entered by agent = net component budgets (before markup/GST)
  // Compare against subTotal (net cost) so markup/GST don't inflate utilisation
  const budgetEntered = (Number(d.totalBudget) || 0)
    || (Number(d.hotelBudget || 0) + Number(d.sightBudget || 0))
    || 0;
  const utilPct = budgetEntered > 0
    ? Math.round((subTotal / budgetEntered) * 100 * 10) / 10
    : '';
  const overUnderFlag = budgetEntered > 0
    ? (subTotal > budgetEntered ? 'OVER' : (utilPct >= 95 ? '✅ TARGET' : (utilPct >= 90 ? 'NEAR' : 'UNDER')))
    : 'No Budget';

  // ── COMPOSITION ──
  const avgCategory  = _mostCommon(hotelCategories) || '';
  const vehicleMix   = _mostCommon(vehicleTypes)    || '';

  // ── QUOTE ID: timestamp-based ──
  const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);

  return [
    quoteId,                    // A: Quote ID
    agentName,                  // B: Agent Name
    paxName,                    // C: Pax Name
    new Date(),                 // D: Logged At
    travelMonth,                // E: Travel Month
    adults,                     // F: Adults
    children,                   // G: Children
    paxCount,                   // H: Total PAX
    cityStr,                    // H: Cities
    totalNights,                // I: Total Nights
    numCities,                  // J: No. of Cities
    hotelNet,                   // K: Hotel Net (₹)
    sightNet,                   // L: Sightseeing Net (₹)
    transferNet,                // M: Transfers Net (₹)
    intercityNet,               // N: Trains/Intercity Net (₹)
    subTotal,                   // O: Sub Total (₹)
    markupPct,                  // P: Markup %
    markupAmt,                  // Q: Markup Amount (₹)
    gstAmt,                     // R: GST Amount (₹)
    grandTotal,                 // S: Grand Total (₹)
    budgetEntered,              // T: Budget Entered (₹)
    utilPct,                    // U: Utilisation %
    overUnderFlag,              // V: Budget Flag
    hotelsManual,               // W: Hotel Manual Overrides
    sightsManual,               // X: Sightseeing Manual Adds
    intercityManual,            // Y: Intercity Manual
    avgCategory,                // Z: Dominant Hotel Category
    vehicleMix,                 // AA: Dominant Vehicle Type
    'Pending',                  // AB: Outcome (agent updates manually)
    '',                         // AC: Notes (agent fills manually)
  ];
}


// ── COLOR ROW BY BUDGET FLAG ──────────────────────────────────────

function colorLogRow(sheet, rowNum, row) {
  const flag = row[22]; // column W: Budget Flag (index 22 — shifted after Agent Name added at col B)
  let bg = '#ffffff';
  if      (flag === '✅ TARGET') bg = '#d4edda'; // green
  else if (flag === 'OVER')      bg = '#f8d7da'; // red
  else if (flag === 'NEAR')      bg = '#fff3cd'; // amber
  else if (flag === 'UNDER')     bg = '#e8f4fd'; // light blue
  sheet.getRange(rowNum, 1, 1, row.length).setBackground(bg);
}


// ── SETUP: run once to create Quote_Log tab ───────────────────────

function setupQuoteLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ws = ss.getSheetByName('Quote_Log');
  if (!ws) ws = ss.insertSheet('Quote_Log');

  ws.clear();

  const headers = [
    'Quote ID',         // A
    'Agent Name',       // B
    'Pax Name',         // C
    'Logged At',        // D
    'Travel Month',     // E
    'Adults',           // F
    'Children',         // G
    'Total PAX',        // H
    'Cities',           // I
    'Total Nights',     // J
    'No. of Cities',    // K
    'Hotel Net (₹)',    // L
    'Sightseeing Net (₹)', // M
    'Transfers Net (₹)',  // N
    'Trains Net (₹)',   // O
    'Sub Total (₹)',    // P
    'Markup %',         // Q
    'Markup Amount (₹)', // R
    'GST Amount (₹)',   // S
    'Grand Total (₹)',  // T
    'Budget Entered (₹)', // U
    'Utilisation %',    // V
    'Budget Flag',      // W
    'Hotel Manual Overrides', // X
    'Sightseeing Manual', // Y
    'Intercity Manual', // Z
    'Dominant Hotel Category', // AA
    'Vehicle Type',     // AB
    'Outcome',          // AC
    'Notes',            // AD
  ];

  const headerRange = ws.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#1a3c5e');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);
  headerRange.setFontFamily('Arial');
  headerRange.setHorizontalAlignment('center');
  headerRange.setVerticalAlignment('middle');
  ws.setRowHeight(1, 36);
  ws.setFrozenRows(1);
  ws.setFrozenColumns(3); // Freeze Quote ID + Agent Name + Pax Name

  // Column widths
  const widths = {
    1:100, 2:130, 3:150, 4:120, 5:60, 6:70, 7:70,
    8:260, 9:80, 10:80,
    11:110, 12:130, 13:110, 14:100, 15:110,
    16:80, 17:120, 18:100, 19:120,
    20:120, 21:100, 22:110,
    23:150, 24:130, 25:110,
    26:160, 27:120, 28:100, 29:150
  };
  Object.entries(widths).forEach(([col, w]) => {
    ws.setColumnWidth(parseInt(col), w);
  });

  // Outcome dropdown on AC column (col 29)
  const dv = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pending', 'Won', 'Lost', 'Cancelled'], true)
    .setAllowInvalid(false)
    .build();
  ws.getRange('AC2:AC2000').setDataValidation(dv);

  // Number formatting — new column layout (Agent Name added as col B shifts everything)
  // Cols A–K: text / plain numbers (Quote ID, Agent, Pax, Date, Travel Month, Adults, Children, PAX, Cities, Nights, No.Cities)
  // Cols L–P: INR (Hotel Net, Sightseeing, Transfers, Trains, Sub Total)
  // Col  Q:   plain number (Markup %)
  // Cols R–U: INR (Markup Amount, GST Amount, Grand Total, Budget Entered)
  // Col  V:   custom % display (Utilisation %)
  const inrFmt = '₹#,##0';
  ws.getRange('L2:P2000').setNumberFormat(inrFmt);   // Hotel Net → Sub Total
  ws.getRange('R2:U2000').setNumberFormat(inrFmt);   // Markup Amount → Budget Entered
  ws.getRange('Q2:Q2000').setNumberFormat('0');       // Markup % — plain integer
  ws.getRange('V2:V2000').setNumberFormat('0.0"%"'); // Utilisation % — e.g. 90.5%
  ws.getRange('D2:D2000').setNumberFormat('dd/mm/yyyy hh:mm'); // Logged At

  Logger.log('✅ Quote_Log tab created. Now run backfillQuoteLog() to import existing itineraries.');
}


// ── FIX HEADERS: run once to patch header row without clearing data ──
// Use this instead of setupQuoteLog() when you want to keep existing rows.

function fixQuoteLogHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ws = ss.getSheetByName('Quote_Log');
  if (!ws) { Logger.log('Quote_Log not found — run setupQuoteLog() first'); return; }

  const headers = [
    'Quote ID',              // A
    'Agent Name',            // B
    'Pax Name',              // C
    'Logged At',             // D
    'Travel Month',          // E
    'Adults',                // F
    'Children',              // G
    'Total PAX',             // H
    'Cities',                // I
    'Total Nights',          // J
    'No. of Cities',         // K
    'Hotel Net (₹)',         // L
    'Sightseeing Net (₹)',   // M
    'Transfers Net (₹)',     // N
    'Trains Net (₹)',        // O
    'Sub Total (₹)',         // P
    'Markup %',              // Q
    'Markup Amount (₹)',     // R
    'GST Amount (₹)',        // S
    'Grand Total (₹)',       // T
    'Budget Entered (₹)',    // U
    'Utilisation %',         // V
    'Budget Flag',           // W
    'Hotel Manual Overrides',// X
    'Sightseeing Manual',    // Y
    'Intercity Manual',      // Z
    'Dominant Hotel Category',// AA
    'Vehicle Type',          // AB
    'Outcome',               // AC
    'Notes',                 // AD
  ];

  const headerRange = ws.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#1a3c5e');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);
  headerRange.setFontFamily('Arial');
  headerRange.setHorizontalAlignment('center');
  headerRange.setVerticalAlignment('middle');
  ws.setRowHeight(1, 36);

  Logger.log('✅ Quote_Log headers updated. Run fixQuoteLogFormats() next to repair data formatting.');
}


// ── FIX FORMATS: run once to repair column formats on existing data ──

function fixQuoteLogFormats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
          || SpreadsheetApp.openById('1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM');
  const ws = ss.getSheetByName('Quote_Log');
  if (!ws) { Logger.log('Quote_Log not found'); return; }

  const lastRow = Math.max(ws.getLastRow(), 2);
  const dataRows = lastRow - 1;

  // 1. Clear all number formats on data range (rows 2 onwards)
  ws.getRange(2, 1, dataRows, 30).setNumberFormat('@'); // reset to plain text first
  ws.getRange(2, 1, dataRows, 30).setNumberFormat('General');

  // 2. Apply correct formats
  const inrFmt = '₹#,##0';
  ws.getRange('L2:P' + lastRow).setNumberFormat(inrFmt);
  ws.getRange('R2:U' + lastRow).setNumberFormat(inrFmt);
  ws.getRange('Q2:Q' + lastRow).setNumberFormat('0');
  ws.getRange('V2:V' + lastRow).setNumberFormat('0.0"%"');
  ws.getRange('D2:D' + lastRow).setNumberFormat('dd/mm/yyyy hh:mm');

  // 3. Re-apply row colors based on Budget Flag (column W = col index 23, 0-based index 22)
  const data = ws.getRange(2, 1, dataRows, 30).getValues();
  data.forEach((row, i) => {
    const flag = row[22]; // Budget Flag at 0-based index 22 = column W
    let bg = '#ffffff';
    if      (flag === '✅ TARGET') bg = '#d4edda';
    else if (flag === 'OVER')      bg = '#f8d7da';
    else if (flag === 'NEAR')      bg = '#fff3cd';
    else if (flag === 'UNDER')     bg = '#e8f4fd';
    ws.getRange(i + 2, 1, 1, 30).setBackground(bg);
  });

  Logger.log('✅ fixQuoteLogFormats complete. ' + dataRows + ' rows reformatted.');
}


// ── DEDUPLICATE: remove duplicate rows from existing Quote_Log data ──
// Run ONCE after deployment to clean up rows created by the old bug
// (logQuote was called on every save/update, not just the first save).
//
// Keeps: first entry + any entry where Grand Total changed by ≥2% OR ≥₹1,000
//        vs the previous kept entry for the same Pax Name.
// Deletes: all rows where Grand Total is within 2% AND ₹1,000 of the prior entry.
//
// Run order: deduplicateQuoteLog → fixQuoteLogHeaders → fixQuoteLogFormats

function deduplicateQuoteLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ws = ss.getSheetByName('Quote_Log');
  if (!ws) { Logger.log('Quote_Log not found'); return; }

  const all = ws.getDataRange().getValues();
  if (all.length <= 1) { Logger.log('No data rows found'); return; }

  // Build a lightweight row map (skip header row at index 0)
  // Schema: col C (index 2) = Pax Name, col D (index 3) = Logged At, col T (index 19) = Grand Total
  const rows = all.slice(1).map((r, i) => ({
    sheetRow:   i + 2,                                   // 1-based, +2 because header is row 1
    paxKey:     String(r[2] || '').trim().toLowerCase(), // Pax Name, normalised
    loggedAt:   r[3] instanceof Date ? r[3] : new Date(r[3] || 0),
    grandTotal: Number(r[19]) || 0,
  }));

  // Group by paxName
  const groups = {};
  rows.forEach(r => {
    if (!groups[r.paxKey]) groups[r.paxKey] = [];
    groups[r.paxKey].push(r);
  });

  const toDelete = new Set();

  Object.values(groups).forEach(group => {
    // Sort chronologically (oldest first) so we keep earliest meaningful entries
    group.sort((a, b) => a.loggedAt - b.loggedAt);

    let lastKept = null;
    group.forEach(r => {
      if (lastKept === null) {
        lastKept = r.grandTotal; // always keep the first entry
        return;
      }
      const diff    = Math.abs(r.grandTotal - lastKept);
      const pctDiff = lastKept > 0 ? (diff / lastKept * 100) : 100;
      if (pctDiff < 2 && diff < 1000) {
        toDelete.add(r.sheetRow); // duplicate — same cost, no meaningful variant
      } else {
        lastKept = r.grandTotal;  // meaningful variant — keep and update baseline
      }
    });
  });

  if (toDelete.size === 0) {
    Logger.log('✅ Quote_Log is already clean — no duplicates found');
    return;
  }

  // Delete rows from bottom to top so row indices stay valid
  const sorted = [...toDelete].sort((a, b) => b - a);
  sorted.forEach(rowNum => ws.deleteRow(rowNum));
  SpreadsheetApp.flush();

  Logger.log(`✅ Deduplication done — ${toDelete.size} duplicate rows removed. ${rows.length - toDelete.size} rows kept.`);
}


// ── BACKFILL: parse existing Saved_Itineraries into Quote_Log ─────
// Run ONCE after setupQuoteLog() to import historical quotes

function backfillQuoteLog() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const saved    = ss.getSheetByName('Saved_Itineraries');
  const logSheet = ss.getSheetByName('Quote_Log');

  if (!saved || !logSheet) {
    SpreadsheetApp.getUi().alert('Run setupQuoteLog() first.');
    return;
  }

  const data = saved.getDataRange().getValues().slice(1); // skip header
  let imported = 0, skipped = 0;

  data.forEach(row => {
    const paxName = row[0];
    const jsonStr = row[1];
    if (!paxName || !jsonStr) { skipped++; return; }

    try {
      const d = JSON.parse(jsonStr);
      const logRow = buildQuoteLogRow(paxName, d);
      logSheet.appendRow(logRow);
      colorLogRow(logSheet, logSheet.getLastRow(), logRow);
      imported++;
    } catch (e) {
      Logger.log('Backfill skip ' + paxName + ': ' + e.message);
      skipped++;
    }
  });

  Logger.log(`✅ Backfill complete. ${imported} quotes imported | ${skipped} skipped.`);
}


// ── UTILITY ───────────────────────────────────────────────────────

function _titleCase(str) {
  return str.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.substr(1).toLowerCase());
}

function _mostCommon(arr) {
  if (!arr.length) return '';
  const freq = {};
  arr.forEach(v => freq[v] = (freq[v] || 0) + 1);
  return Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
}
