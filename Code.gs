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
    if (action === 'getActiveUsers') {
      return getActiveUsers();
    }
    if (action === 'getCityStats') {
      return getCityStats();
    }
    if (action === 'getMasterInventory') {
      return getMasterInventory();
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
      return handleSignup(data.username || '', data.password || '', data.agencyName || '', data.personName || '', data.mobile || '', data.email || '');
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
      // Record last login timestamp in column I (index 8)
      sheet.getRange(i + 1, 9).setValue(new Date());
      if (dbRole === 'ADMIN')   return ContentService.createTextOutput('ADMIN');
      return ContentService.createTextOutput('USER');
    }
  }

  return ContentService.createTextOutput('INVALID');
}


// ------------------------------------------------------------
// ONE-TIME SETUP — adds LastLogin header to Users sheet column I
// Run this once manually from Apps Script editor
// ------------------------------------------------------------

function setupLastLogin() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return;
  const header = sheet.getRange(1, 9).getValue();
  if (!header || String(header).trim() === '') {
    sheet.getRange(1, 9).setValue('LastLogin');
  }
}


// ------------------------------------------------------------
// AUTH — Signup (new user → PENDING until admin approves)
// ------------------------------------------------------------

function handleSignup(username, password, agencyName, personName, mobile, email) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return ContentService.createTextOutput('Setup Error: Users sheet not found');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === username.trim().toLowerCase()) {
      return ContentService.createTextOutput('Username already taken');
    }
  }

  sheet.appendRow([username.trim(), password.trim(), 'PENDING', new Date(), agencyName.trim(), personName.trim(), mobile.trim(), email.trim()]);
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
// ACTIVE USERS — returns users who logged in within last 24 hours
// Reads Users sheet column I (LastLogin)
// ------------------------------------------------------------

function getActiveUsers() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return ContentService
    .createTextOutput(JSON.stringify({ count: 0, users: [] }))
    .setMimeType(ContentService.MimeType.JSON);

  const data    = sheet.getDataRange().getValues();
  const cutoff  = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  const active  = [];

  for (let i = 1; i < data.length; i++) {
    const username   = String(data[i][0] || '').trim();
    const role       = String(data[i][2] || '').trim().toUpperCase();
    const agencyName = String(data[i][4] || '').trim();
    const personName = String(data[i][5] || '').trim();
    const lastLogin  = data[i][8]; // Column I

    if (!username || role === 'PENDING') continue;

    if (lastLogin && lastLogin instanceof Date && lastLogin > cutoff) {
      active.push({
        username:   username,
        agencyName: agencyName,
        personName: personName,
        role:       role,
        lastLogin:  lastLogin.toISOString()
      });
    }
  }

  // Sort most recently active first
  active.sort((a, b) => new Date(b.lastLogin) - new Date(a.lastLogin));

  return ContentService
    .createTextOutput(JSON.stringify({ count: active.length, users: active }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ------------------------------------------------------------
// CITY STATS — parses all saved itineraries to build per-city
// hotel and sightseeing stats for the admin dashboard
// ------------------------------------------------------------

function getCityStats() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Saved_Itineraries');
  if (!sheet) return ContentService
    .createTextOutput(JSON.stringify({ hotels: [], sights: [] }))
    .setMimeType(ContentService.MimeType.JSON);

  const data = sheet.getDataRange().getValues();

  const hotelMap = {}; // city → { quoteCount, totalCost, totalNights }
  const sightMap = {}; // city → { quoteCount, totalSpend }

  for (let i = 1; i < data.length; i++) {
    if (!data[i][1]) continue;
    let payload;
    try {
      payload = JSON.parse(String(data[i][1]));
    } catch (e) {
      continue;
    }

    const plan = payload.currentPlan || [];
    const pax  = (payload.adults || 1) + (payload.children || 0);

    plan.forEach(function(cityBlock) {
      const city   = String(cityBlock.city || '').trim();
      const nights = Number(cityBlock.nights) || 1;
      if (!city) return;

      // Hotel stats
      const hotel = cityBlock.hotel;
      if (hotel && hotel.cost > 0) {
        if (!hotelMap[city]) hotelMap[city] = { quoteCount: 0, totalCost: 0, totalNights: 0 };
        hotelMap[city].quoteCount++;
        hotelMap[city].totalCost   += hotel.cost * nights;
        hotelMap[city].totalNights += nights;
      }

      // Sightseeing stats
      const sights     = cityBlock.sights || [];
      const sightSpend = sights.reduce(function(sum, s) {
        return sum + (Number(s.price) || 0) * pax;
      }, 0);

      if (!sightMap[city]) sightMap[city] = { quoteCount: 0, totalSpend: 0 };
      sightMap[city].quoteCount++;
      sightMap[city].totalSpend += sightSpend;
    });
  }

  // Convert to arrays and compute averages
  const hotelStats = Object.keys(hotelMap).map(function(city) {
    const h = hotelMap[city];
    return {
      city:        city,
      quoteCount:  h.quoteCount,
      avgCostPerNight: h.totalNights > 0 ? Math.round(h.totalCost / h.totalNights) : 0,
      totalSpend:  Math.round(h.totalCost)
    };
  }).sort(function(a, b) { return b.quoteCount - a.quoteCount; });

  const sightStats = Object.keys(sightMap).map(function(city) {
    const s = sightMap[city];
    return {
      city:       city,
      quoteCount: s.quoteCount,
      avgSpend:   s.quoteCount > 0 ? Math.round(s.totalSpend / s.quoteCount) : 0,
      totalSpend: Math.round(s.totalSpend)
    };
  }).sort(function(a, b) { return b.quoteCount - a.quoteCount; });

  return ContentService
    .createTextOutput(JSON.stringify({ hotels: hotelStats, sights: sightStats }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ------------------------------------------------------------
// MASTER INVENTORY — counts hotel and sightseeing entries per city
// from the master Hotels and Sightseeing sheets.
// Used by the dashboard to identify coverage gaps.
// ------------------------------------------------------------

function getMasterInventory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Hotels: Col A = City
  const hotelMap = {};
  const hotelSheet = ss.getSheetByName('Hotels');
  if (hotelSheet) {
    const rows = hotelSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const city = String(rows[i][0] || '').trim();
      if (!city) continue;
      const annualAvg = parsePrice(rows[i][18]);
      if (annualAvg <= 0) continue; // skip inactive
      hotelMap[city] = (hotelMap[city] || 0) + 1;
    }
  }

  // Sightseeing: Col A = City
  const sightMap = {};
  const sightSheet = ss.getSheetByName('Sightseeing');
  if (sightSheet) {
    const rows = sightSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const city = String(rows[i][0] || '').trim();
      if (!city) continue;
      const price = parsePrice(rows[i][5]) || parsePrice(rows[i][6]) || parsePrice(rows[i][8]);
      if (price <= 0) continue; // skip inactive
      sightMap[city] = (sightMap[city] || 0) + 1;
    }
  }

  const hotels = Object.entries(hotelMap)
    .map(function(e) { return { city: e[0], count: e[1] }; })
    .sort(function(a, b) { return b.count - a.count; });

  const sights = Object.entries(sightMap)
    .map(function(e) { return { city: e[0], count: e[1] }; })
    .sort(function(a, b) { return b.count - a.count; });

  return ContentService
    .createTextOutput(JSON.stringify({ hotels: hotels, sights: sights }))
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
