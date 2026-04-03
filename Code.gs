// ============================================================
// TRIP STORE HOLIDAYS — Google Apps Script Backend
// FILE: Code.gs
// PURPOSE: Powers the live itinerary builder at fit.tripstoreholidays.com
//          Handles data fetch, login, signup, save & load itineraries.
//
// HOW TO DEPLOY:
//   Extensions > Apps Script > paste this file as Code.gs
//   Deploy > New Deployment > Web App > Anyone > Execute as Me
//   Copy the /exec URL into index_fit.tripstore.html (API_URL line)
// ============================================================


// ------------------------------------------------------------
// MAIN ENTRY POINTS
// ------------------------------------------------------------

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) ? e.parameter.action : 'getData';

    if (action === 'getData' || action === '') {
      return getData();
    }
    if (action === 'checkLogin') {
      return checkLogin(e.parameter.user || '', e.parameter.pass || '');
    }
    if (action === 'getAllSaved') {
      return getAllSaved();
    }
    if (action === 'search') {
      return searchItinerary(e.parameter.name || '');
    }
    if (action === 'getQuoteLog') {
      return getQuoteLog();
    }
    return ContentService.createTextOutput('Invalid action');
  } catch (err) {
    return ContentService.createTextOutput('Server Error: ' + err.message);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || '';

    if (action === 'signup') {
      return handleSignup(data.username || '', data.password || '');
    }
    if (action === 'saveItinerary') {
      return saveItinerary(data.paxName || '', data.payload || {});
    }
    return ContentService.createTextOutput('Invalid action');
  } catch (err) {
    return ContentService.createTextOutput('Server Error: ' + err.message);
  }
}


// ------------------------------------------------------------
// DATA FETCH — returns all master data as JSON
// ------------------------------------------------------------

function getData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const result = {
    hotels:    getHotels(ss),
    sights:    getSights(ss),
    transfers: getTransfers(ss),
    intercity: getIntercity(ss)
  };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


// ------------------------------------------------------------
// HOTELS  (Sheet: "Hotels")
// Columns: City | Hotel Name | Star Rating | Hotel Category |
//          Chain / Brand | Room Type | Jan | Feb | Mar | Apr |
//          May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | Annual Avg (INR)
// ------------------------------------------------------------

function getHotels(ss) {
  const sheet = ss.getSheetByName('Hotels');
  if (!sheet) return [];

  const data   = sheet.getDataRange().getValues();
  const hotels = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] || !r[1]) continue;

    const annualAvg = parsePrice(r[18]); // Column S = Annual Avg (INR)
    if (annualAvg <= 0) continue;

    hotels.push({
      city:       String(r[0]).trim(),
      name:       String(r[1]).trim(),
      starRating: String(r[2] || '').trim(),
      category:   String(r[3] || '').trim(),
      chain:      String(r[4] || '').trim(),
      roomType:   String(r[5] || '').trim(),
      type:       String(r[5] || '').trim(), // kept for backward compatibility
      cost:       annualAvg                  // annualAvg used as "cost" by the optimizer
    });
  }

  return hotels;
}


// ------------------------------------------------------------
// SIGHTSEEING  (Sheet: "Sightseeing")
// Columns: City | Tour Name | Category | Rating | Duration |
//          Avg Price (INR) | GYG Price (INR) | GYG Link |
//          Viator Price (INR) | Viator Link | Attraction Tags (Col K)
// ------------------------------------------------------------

function getSights(ss) {
  const sheet = ss.getSheetByName('Sightseeing');
  if (!sheet) return [];

  const data   = sheet.getDataRange().getValues();
  const sights = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] || !r[1]) continue;

    const avgPrice    = parsePrice(r[5]); // Column F: Average of GYG + Viator
    const gygPrice    = parsePrice(r[6]); // Column G: GYG Price
    const viatorPrice = parsePrice(r[8]); // Column I: Viator Price
    const price = avgPrice > 0 ? avgPrice : (gygPrice > 0 ? gygPrice : viatorPrice);
    if (price <= 0) continue;

    // Rating: "⭐ 4.6" → "4.6"
    const ratingRaw = String(r[3] || '').trim().replace(/[⭐★\s]/g, '');

    sights.push({
      city:         String(r[0]).trim(),
      info:         String(r[1]).trim(),
      category:     String(r[2] || '').trim(),
      rating:       ratingRaw,
      duration:     String(r[4] || '').trim(),
      price:        price,
      gygPrice:     gygPrice,
      viatorPrice:  viatorPrice,
      tags:         String(r[10] || '').trim()  // Column K: Attraction Tags
    });
  }

  return sights;
}


// ------------------------------------------------------------
// TRANSFERS  (Sheet: "Transfers")
// Columns: City | Country | Airport Code | Airport/Hub Name |
//          Zone | Transfer Type | Direction | From | To |
//          Economy Sedan ₹ | Standard Van ₹ | Premium Van ₹ |
//          Executive Sedan ₹ | Schedule | Notes | Data Status
// ------------------------------------------------------------

function getTransfers(ss) {
  const sheet = ss.getSheetByName('Transfers');
  if (!sheet) return [];

  const data      = sheet.getDataRange().getValues();
  const transfers = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] || !r[7]) continue;

    // Skip non-active rows
    const status = String(r[15] || '').trim().toLowerCase();
    if (status && status !== 'active' && status !== 'zone-averaged') continue;

    const economySedan   = parsePrice(r[9]);
    const standardVan    = parsePrice(r[10]);
    const premiumVan     = parsePrice(r[11]);
    const executiveSedan = parsePrice(r[12]);

    transfers.push({
      city:           String(r[0]).trim(),
      country:        String(r[1] || '').trim(),
      airportCode:    String(r[2] || '').trim(),
      zone:           String(r[4] || '').trim(),
      transferType:   String(r[5] || '').trim(),
      direction:      String(r[6] || '').trim(),  // "ARRIVAL" or "DEPARTURE"
      from:           String(r[7]).trim(),
      to:             String(r[8]).trim(),
      economySedan:   economySedan,
      standardVan:    standardVan,
      premiumVan:     premiumVan,
      executiveSedan: executiveSedan,
      notes:          String(r[13] || '').trim(), // Column N: Schedule
      avgPrice:       economySedan                // backward compatibility
    });
  }

  return transfers;
}


// ------------------------------------------------------------
// INTERCITY TRANSPORT  (Sheet: "Trains")
// Columns: Mode | From City | To City | Stops | Stopover City |
//          INR Price (₹) | May (€) | Aug (€) | Oct (€) | Dec (€) | Avg (€)
// ------------------------------------------------------------

function getIntercity(ss) {
  const sheet = ss.getSheetByName('Trains');
  if (!sheet) return [];

  const data      = sheet.getDataRange().getValues();
  const intercity = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[1] || !r[2]) continue;

    intercity.push({
      mode:         String(r[0] || 'Train').trim(),
      from:         String(r[1]).trim(),
      to:           String(r[2]).trim(),
      stops:        String(r[3] || '0').trim(),
      stopoverCity: String(r[4] || '').trim(),
      price:        parsePrice(r[5])
    });
  }

  return intercity;
}


// ------------------------------------------------------------
// AUTH — Login
// Sheet "Users" columns: Username | Password | Role | Created
// Role values: ADMIN | USER | PENDING
// ------------------------------------------------------------

function checkLogin(user, pass) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return ContentService.createTextOutput('INVALID');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const dbUser = String(data[i][0]).trim().toLowerCase();
    const dbPass = String(data[i][1]).trim();
    const dbRole = String(data[i][2]).trim().toUpperCase();

    if (dbUser === user.trim().toLowerCase() && dbPass === pass.trim()) {
      if (dbRole === 'PENDING') return ContentService.createTextOutput('PENDING_APPROVAL');
      if (dbRole === 'ADMIN')   return ContentService.createTextOutput('ADMIN');
      return ContentService.createTextOutput('USER');
    }
  }

  return ContentService.createTextOutput('INVALID');
}


// ------------------------------------------------------------
// AUTH — Signup (new user → PENDING until admin approves)
// ------------------------------------------------------------

function handleSignup(username, password) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return ContentService.createTextOutput('Setup Error: Users sheet not found');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === username.trim().toLowerCase()) {
      return ContentService.createTextOutput('Username already taken');
    }
  }

  sheet.appendRow([username.trim(), password.trim(), 'PENDING', new Date()]);
  return ContentService.createTextOutput('Signup Successful');
}


// ------------------------------------------------------------
// CLOUD STORAGE — Get all saved pax names (admin panel)
// Sheet "Saved_Itineraries" columns: PaxName | SavedData | Timestamp
// ------------------------------------------------------------

function getAllSaved() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Saved_Itineraries');
  if (!sheet) return ContentService.createTextOutput('[]').setMimeType(ContentService.MimeType.JSON);

  const data  = sheet.getDataRange().getValues();
  const names = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) names.push(String(data[i][0]).trim());
  }

  return ContentService
    .createTextOutput(JSON.stringify(names))
    .setMimeType(ContentService.MimeType.JSON);
}


// ------------------------------------------------------------
// CLOUD STORAGE — Search / Load itinerary by pax name
// ------------------------------------------------------------

function searchItinerary(name) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Saved_Itineraries');
  if (!sheet) return ContentService.createTextOutput('Not Found');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === name.trim().toLowerCase()) {
      return ContentService.createTextOutput(String(data[i][1]));
    }
  }

  return ContentService.createTextOutput('Not Found');
}


// ------------------------------------------------------------
// CLOUD STORAGE — Save / Update itinerary
// ------------------------------------------------------------

function saveItinerary(paxName, payload) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Saved_Itineraries');
  if (!sheet) return ContentService.createTextOutput('Setup Error: Saved_Itineraries sheet not found');

  const data       = sheet.getDataRange().getValues();
  const payloadStr = JSON.stringify(payload);
  const now        = new Date();

  // Update if already exists
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === paxName.trim().toLowerCase()) {
      sheet.getRange(i + 1, 2).setValue(payloadStr);
      sheet.getRange(i + 1, 3).setValue(now);
      logQuote(paxName, payload);
      return ContentService.createTextOutput('Updated Successfully');
    }
  }

  // New record
  sheet.appendRow([paxName.trim(), payloadStr, now]);
  logQuote(paxName, payload);
  return ContentService.createTextOutput('Saved Successfully');
}


// ------------------------------------------------------------
// QUOTE LOG — returns all Quote_Log rows as JSON for the dashboard
// ------------------------------------------------------------

function getQuoteLog() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Quote_Log');
  if (!sheet) return ContentService
    .createTextOutput(JSON.stringify([]))
    .setMimeType(ContentService.MimeType.JSON);

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const result  = rows.slice(1)
    .filter(r => r[0]) // skip blank rows
    .map(r => ({
      quoteId:      r[0]  || '',
      paxName:      r[1]  || '',
      loggedAt:     r[2]  ? new Date(r[2]).toISOString().slice(0,10) : '',
      travelMonth:  r[3]  || '',
      adults:       r[4]  || 0,
      children:     r[5]  || 0,
      totalPax:     r[6]  || 0,
      cities:       r[7]  || '',
      totalNights:  r[8]  || 0,
      numCities:    r[9]  || 0,
      hotelNet:     r[10] || 0,
      sightNet:     r[11] || 0,
      transferNet:  r[12] || 0,
      trainsNet:    r[13] || 0,
      subTotal:     r[14] || 0,
      markupPct:    r[15] || 0,
      markupAmt:    r[16] || 0,
      gstAmt:       r[17] || 0,
      grandTotal:   r[18] || 0,
      budgetEntered:r[19] || 0,
      utilPct:      r[20] || '',
      budgetFlag:   r[21] || '',
      hotelsManual: r[22] || 0,
      sightsManual: r[23] || 0,
      intercityManual: r[24] || 0,
      category:     r[25] || '',
      vehicle:      r[26] || '',
      outcome:      r[27] || 'Pending',
      notes:        r[28] || '',
    }));

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


// ------------------------------------------------------------
// HELPER — Parse price strings like "₹54,250" or 54250.0
// ------------------------------------------------------------

function parsePrice(val) {
  if (val === null || val === undefined || val === '') return 0;
  const str = String(val).replace(/[₹,\s]/g, '');
  const num  = parseFloat(str);
  return isNaN(num) ? 0 : Math.round(num);
}
