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
    // Auto-create if missing
    setupQuoteLog();
    return logQuote(paxName, data); // retry
  }

  try {
    const row = buildQuoteLogRow(paxName, data);
    logSheet.appendRow(row);
    colorLogRow(logSheet, logSheet.getLastRow(), row);
  } catch (e) {
    Logger.log('Quote log error (non-fatal): ' + e.message);
    // Never let logging break the save operation
  }
}


// ── ROW BUILDER ───────────────────────────────────────────────────

function buildQuoteLogRow(paxName, d) {
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
      travelMonth = dt.toLocaleString('default', { month: 'long', year: 'numeric' });
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
  const gstAmt       = Math.round(markupAmt * gstPct / 100);
  const grandTotal   = subTotal + markupAmt + gstAmt;

  // ── BUDGET & UTILISATION ──
  // Budget entered by agent (sum of component budgets, or a single totalBudget field)
  const budgetEntered = (Number(d.totalBudget) || 0)
    || (Number(d.hotelBudget || 0) + Number(d.sightBudget || 0) + Number(d.transferBudget || 0))
    || 0;
  const utilPct = budgetEntered > 0
    ? Math.round((grandTotal / budgetEntered) * 100 * 10) / 10
    : '';
  const overUnderFlag = budgetEntered > 0
    ? (grandTotal > budgetEntered ? 'OVER' : (utilPct >= 95 ? '✅ TARGET' : (utilPct >= 90 ? 'NEAR' : 'UNDER')))
    : 'No Budget';

  // ── COMPOSITION ──
  const avgCategory  = _mostCommon(hotelCategories) || '';
  const vehicleMix   = _mostCommon(vehicleTypes)    || '';

  // ── QUOTE ID: timestamp-based ──
  const quoteId = 'Q-' + new Date().getTime().toString().slice(-8);

  return [
    quoteId,                    // A: Quote ID
    paxName,                    // B: Pax Name
    new Date(),                 // C: Logged At
    travelMonth,                // D: Travel Month
    adults,                     // E: Adults
    children,                   // F: Children
    paxCount,                   // G: Total PAX
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
  const flag = row[21]; // column V: Budget Flag
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
    'Pax Name',         // B
    'Logged At',        // C
    'Travel Month',     // D
    'Adults',           // E
    'Children',         // F
    'Total PAX',        // G
    'Cities',           // H
    'Total Nights',     // I
    'No. of Cities',    // J
    'Hotel Net (₹)',    // K
    'Sightseeing Net (₹)', // L
    'Transfers Net (₹)',  // M
    'Trains Net (₹)',   // N
    'Sub Total (₹)',    // O
    'Markup %',         // P
    'Markup Amount (₹)', // Q
    'GST Amount (₹)',   // R
    'Grand Total (₹)',  // S
    'Budget Entered (₹)', // T
    'Utilisation %',    // U
    'Budget Flag',      // V
    'Hotel Manual Overrides', // W
    'Sightseeing Manual', // X
    'Intercity Manual', // Y
    'Dominant Hotel Category', // Z
    'Vehicle Type',     // AA
    'Outcome',          // AB
    'Notes',            // AC
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
  ws.setFrozenColumns(2); // Freeze Quote ID + Pax Name

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

  // Outcome dropdown on AB column (col 28)
  const dv = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pending', 'Won', 'Lost', 'Cancelled'], true)
    .setAllowInvalid(false)
    .build();
  ws.getRange('AB2:AB2000').setDataValidation(dv);

  // Number formatting for INR columns
  const inrFmt = '₹#,##0';
  ws.getRange('K2:S2000').setNumberFormat(inrFmt);
  ws.getRange('T2:T2000').setNumberFormat(inrFmt);
  ws.getRange('P2:P2000').setNumberFormat('0"%"');
  ws.getRange('U2:U2000').setNumberFormat('0.0"%"');

  Logger.log('✅ Quote_Log tab created. Now run backfillQuoteLog() to import existing itineraries.');
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
