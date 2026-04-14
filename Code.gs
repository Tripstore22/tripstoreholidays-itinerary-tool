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
    if (action === 'getSavedList') {
      return getSavedList();
    }
    if (action === 'validateSession') {
      return validateSession(e.parameter.user || '', e.parameter.token || '');
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

  const data       = sheet.getDataRange().getValues();
  const hashedPass = hashPass(pass.trim());

  for (let i = 1; i < data.length; i++) {
    const dbUser = String(data[i][0]).trim().toLowerCase();
    const dbPass = String(data[i][1]).trim();
    const dbRole = String(data[i][2]).trim().toUpperCase();

    // Accept hashed match OR plain-text match (migration path for existing users)
    const passMatch = (dbPass === hashedPass) || (dbPass === pass.trim());

    if (dbUser === user.trim().toLowerCase() && passMatch) {
      if (dbRole === 'PENDING') return ContentService.createTextOutput('PENDING_APPROVAL');

      // Migrate plain-text password to hashed on first login after update
      if (dbPass === pass.trim()) {
        sheet.getRange(i + 1, 2).setValue(hashedPass);
      }

      // Record last login (col I = index 8) and generate session token (col J = index 9)
      const token = Utilities.getUuid();
      sheet.getRange(i + 1, 9).setValue(new Date());
      sheet.getRange(i + 1, 10).setValue(token);

      if (dbRole === 'ADMIN') return ContentService.createTextOutput('ADMIN:' + token);
      return ContentService.createTextOutput('USER:' + token);
    }
  }

  return ContentService.createTextOutput('INVALID');
}


// ------------------------------------------------------------
// AUTH — Validate session token (used by auto-login)
// Returns role (ADMIN / USER) if token is valid, else INVALID
// ------------------------------------------------------------

function validateSession(user, token) {
  if (!user || !token) return ContentService.createTextOutput('INVALID');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return ContentService.createTextOutput('INVALID');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const dbUser  = String(data[i][0]).trim().toLowerCase();
    const dbRole  = String(data[i][2]).trim().toUpperCase();
    const dbToken = String(data[i][9] || '').trim(); // Column J

    if (dbUser === user.trim().toLowerCase() && dbToken && dbToken === token) {
      if (dbRole === 'PENDING') return ContentService.createTextOutput('INVALID');
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

  sheet.appendRow([username.trim(), hashPass(password.trim()), 'PENDING', new Date(), agencyName.trim(), personName.trim(), mobile.trim(), email.trim()]);
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
      logQuote(paxName, payload); // Smart dedup inside — only logs if financials changed meaningfully
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
      quoteId:        r[0]  || '',
      agentName:      r[1]  || '',
      paxName:        r[2]  || '',
      loggedAt:       (function(v){ try { var d=new Date(v); return (!v||isNaN(d.getTime())) ? '' : d.toISOString().slice(0,10); } catch(e){ return ''; } })(r[3]),
      travelMonth:    r[4]  || '',
      adults:         r[5]  || 0,
      children:       r[6]  || 0,
      totalPax:       r[7]  || 0,
      cities:         r[8]  || '',
      totalNights:    r[9]  || 0,
      numCities:      r[10] || 0,
      hotelNet:       r[11] || 0,
      sightNet:       r[12] || 0,
      transferNet:    r[13] || 0,
      trainsNet:      r[14] || 0,
      subTotal:       r[15] || 0,
      markupPct:      r[16] || 0,
      markupAmt:      r[17] || 0,
      gstAmt:         r[18] || 0,
      grandTotal:     r[19] || 0,
      budgetEntered:  r[20] || 0,
      utilPct:        r[21] || '',
      budgetFlag:     r[22] || '',
      hotelsManual:   r[23] || 0,
      sightsManual:   r[24] || 0,
      intercityManual:r[25] || 0,
      category:       r[26] || '',
      vehicle:        r[27] || '',
      outcome:        r[28] || 'Pending',
      notes:          r[29] || '',
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
// SAVED LIST — returns summary of all saved itineraries for the
// "My Itineraries" tab. Parses each payload to extract key fields.
// ------------------------------------------------------------

function getSavedList() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Saved_Itineraries');
  if (!sheet) return ContentService
    .createTextOutput(JSON.stringify([]))
    .setMimeType(ContentService.MimeType.JSON);

  const data   = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const paxName = String(data[i][0] || '').trim();
    if (!paxName) continue;

    let payload = {};
    try { payload = JSON.parse(String(data[i][1] || '{}')); } catch(e) {}

    const savedAt = data[i][2] ? new Date(data[i][2]).toISOString() : '';

    // Extract cities and nights from selectedRoute (most reliable)
    const route = payload.selectedRoute || payload.currentPlan || [];
    const cities = route.map(function(r) { return String(r.city || '').trim(); }).filter(Boolean);
    const totalNights = route.reduce(function(s, r) { return s + (Number(r.nights) || 0); }, 0);

    const adults   = Number(payload.adults)   || Number(payload.paxCount) || 0;
    const children = Number(payload.children) || 0;
    const totalPax = adults + children;

    result.push({
      paxName:      paxName,
      adults:       adults,
      children:     children,
      totalPax:     totalPax,
      totalNights:  totalNights,
      numCities:    cities.length,
      cities:       cities.join(', '),
      hotelBudget:  payload.hotelBudget || '',
      sightBudget:  payload.sightBudget || '',
      markup:       payload.markup      || '',
      vehicleType:  payload.vehicleType || '',
      savedAt:      savedAt
    });
  }

  // Sort newest first
  result.sort(function(a, b) { return new Date(b.savedAt) - new Date(a.savedAt); });

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


// ------------------------------------------------------------
// MASTER INVENTORY — counts hotel and sightseeing entries per city
// from the master Hotels and Sightseeing sheets.
// Used by the dashboard to identify coverage gaps.
// ------------------------------------------------------------

function getMasterInventory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Helper: parse star rating string to a number ─────────────
  function parseStars(s) {
    s = String(s || '').trim();
    var n = (s.match(/[⭐★]/g) || []).length;
    if (n) return n;
    n = parseInt(s);
    return isNaN(n) ? 0 : n;
  }

  // ── 1. HOTELS — count + star breakdown per city ───────────────
  var hotelMap = {};   // city → { count, s3, s4, s5, sOther }
  var hotelSheet = ss.getSheetByName('Hotels');
  if (hotelSheet) {
    var rows = hotelSheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var city = String(rows[i][0] || '').trim();
      var name = String(rows[i][1] || '').trim();
      if (!city || !name) continue;
      if (!hotelMap[city]) hotelMap[city] = { count:0, s3:0, s4:0, s5:0, sOther:0 };
      hotelMap[city].count++;
      var stars = parseStars(rows[i][2]);
      if      (stars === 3) hotelMap[city].s3++;
      else if (stars === 4) hotelMap[city].s4++;
      else if (stars === 5) hotelMap[city].s5++;
      else                  hotelMap[city].sOther++;
    }
  }

  // ── 2. SIGHTSEEING — count + unique tags per city ─────────────
  var sightMap = {};   // city → { count, tagSet }
  var sightSheet = ss.getSheetByName('Sightseeing');
  if (sightSheet) {
    var rows2 = sightSheet.getDataRange().getValues();
    for (var j = 1; j < rows2.length; j++) {
      var scity = String(rows2[j][0] || '').trim();
      var sname = String(rows2[j][1] || '').trim();
      if (!scity || !sname) continue;
      if (!sightMap[scity]) sightMap[scity] = { count:0, tagSet:{} };
      sightMap[scity].count++;
      var tagStr = String(rows2[j][10] || '');  // Col K = Attraction Tags
      tagStr.split(',').forEach(function(t) {
        var tt = t.trim().toLowerCase();
        if (tt) sightMap[scity].tagSet[tt] = 1;
      });
    }
  }

  // ── 3. TRANSFERS — city coverage from master Transfers sheet ──
  var transferMap = {};
  var xferSheet = ss.getSheetByName('Transfers');
  if (xferSheet) {
    var xrows = xferSheet.getDataRange().getValues();
    for (var k = 1; k < xrows.length; k++) {
      var xcity = String(xrows[k][0] || '').trim();
      if (!xcity) continue;
      var xstatus = String(xrows[k][15] || '').trim().toLowerCase();
      if (xstatus && xstatus !== 'active' && xstatus !== 'zone-averaged') continue;
      transferMap[xcity] = (transferMap[xcity] || 0) + 1;
    }
  }

  // ── 4. TRAINS — route count + covered cities ──────────────────
  var trainRouteSet = {};
  var trainCitySet  = {};
  var trainSheet = ss.getSheetByName('Trains');
  if (trainSheet) {
    var trows = trainSheet.getDataRange().getValues();
    for (var m = 1; m < trows.length; m++) {
      var tfrom = String(trows[m][1] || '').trim();
      var tto   = String(trows[m][2] || '').trim();
      if (!tfrom || !tto) continue;
      trainRouteSet[tfrom + '|' + tto] = 1;
      trainCitySet[tfrom] = 1;
      trainCitySet[tto]   = 1;
    }
  }
  var trainRouteCount = Object.keys(trainRouteSet).length;
  var trainCities     = Object.keys(trainCitySet);

  // ── 5. PIPELINE STATUS — PENDING/ERROR/DUP counts per INPUT sheet
  function getPipeStatus(sheetName, statusColIdx) {
    var ws = ss.getSheetByName(sheetName);
    var r  = { pending:0, error:0, dup:0, processed:0 };
    if (!ws) return r;
    var d = ws.getDataRange().getValues();
    for (var x = 2; x < d.length; x++) {   // row 1=header, row 2=banner → data from row 3
      if (!d[x][0]) continue;
      var s = String(d[x][statusColIdx] || '').trim().toUpperCase();
      if      (s === '' || s === 'PENDING')   r.pending++;
      else if (s === 'ERROR')                 r.error++;
      else if (s === 'DUPLICATE')             r.dup++;
      else if (s === 'PROCESSED')             r.processed++;
    }
    return r;
  }
  var pipeline = {
    hotels:      getPipeStatus('INPUT_Hotels',      22),  // col 23 (1-based)
    sightseeing: getPipeStatus('INPUT_Sightseeing', 13),  // col 14
    trains:      getPipeStatus('INPUT_Trains',      14),  // col 15
    transfers:   getPipeStatus('INPUT_Transfers',   18),  // col 19
  };

  // ── 6. DEMAND GAPS — cities most quoted but thin on data ──────
  var cityDemand = {};
  var qSheet = ss.getSheetByName('Quote_Log');
  if (qSheet) {
    var qrows = qSheet.getDataRange().getValues();
    for (var q = 1; q < qrows.length; q++) {
      if (!qrows[q][0]) continue;
      var citiesStr = String(qrows[q][8] || '').trim(); // col I (index 8) = Cities
      if (!citiesStr) continue;
      citiesStr.split(',').forEach(function(c) {
        var cc = c.trim();
        if (cc) cityDemand[cc] = (cityDemand[cc] || 0) + 1;
      });
    }
  }

  // ── 6b. INPUT SHEET PENDING — per city breakdown ─────────────
  var inputHotelsByCity = {};
  var ihSheet = ss.getSheetByName('INPUT_Hotels');
  if (ihSheet) {
    var ihRows = ihSheet.getDataRange().getValues();
    for (var ih = 2; ih < ihRows.length; ih++) {
      if (!ihRows[ih][0]) continue;
      var ihCity = String(ihRows[ih][0]).trim();
      var ihStat = String(ihRows[ih][22] || '').trim().toUpperCase(); // col 23 = Pipeline_Status
      if (ihStat === '' || ihStat === 'PENDING') {
        inputHotelsByCity[ihCity] = (inputHotelsByCity[ihCity] || 0) + 1;
      }
    }
  }

  var inputSightsByCity = {};
  var isSheet = ss.getSheetByName('INPUT_Sightseeing');
  if (isSheet) {
    var isRows = isSheet.getDataRange().getValues();
    for (var is = 2; is < isRows.length; is++) {
      if (!isRows[is][0]) continue;
      var isCity = String(isRows[is][0]).trim();
      var isStat = String(isRows[is][13] || '').trim().toUpperCase(); // col 14 = Pipeline_Status
      if (isStat === '' || isStat === 'PENDING') {
        inputSightsByCity[isCity] = (inputSightsByCity[isCity] || 0) + 1;
      }
    }
  }

  // ── 7. BUILD OUTPUT ──────────────────────────────────────────
  var hotels = Object.keys(hotelMap).map(function(city) {
    var v = hotelMap[city];
    return { city:city, count:v.count, stars:{ 3:v.s3, 4:v.s4, 5:v.s5, other:v.sOther } };
  }).sort(function(a,b){ return b.count-a.count; });

  var sights = Object.keys(sightMap).map(function(city) {
    var v = sightMap[city];
    return { city:city, count:v.count, uniqueTags: Object.keys(v.tagSet).length };
  }).sort(function(a,b){ return b.count-a.count; });

  var transfers = Object.keys(transferMap).map(function(city) {
    return { city:city, count:transferMap[city] };
  }).sort(function(a,b){ return b.count-a.count; });

  // Cities with hotels but no sightseeing, or sightseeing but no hotels
  var allCities = {};
  Object.keys(hotelMap).forEach(function(c){ allCities[c]=1; });
  Object.keys(sightMap).forEach(function(c){ allCities[c]=1; });
  var gapCities = [];
  Object.keys(allCities).forEach(function(city) {
    var h = hotelMap[city] ? hotelMap[city].count : 0;
    var s = sightMap[city] ? sightMap[city].count : 0;
    if (h > 0 && s === 0) gapCities.push({ city:city, hotels:h, sights:0, gap:'no-sights' });
    else if (s > 0 && h === 0) gapCities.push({ city:city, hotels:0, sights:s, gap:'no-hotels' });
  });
  gapCities.sort(function(a,b){ return (b.hotels+b.sights)-(a.hotels+a.sights); });

  // High demand but thin data
  var demandGaps = Object.keys(cityDemand).map(function(city) {
    return {
      city:        city,
      quoteCount:  cityDemand[city],
      hotels:      hotelMap[city]  ? hotelMap[city].count  : 0,
      sights:      sightMap[city]  ? sightMap[city].count  : 0,
      hasTransfer: !!transferMap[city],
      hasTrains:   !!trainCitySet[city],
    };
  }).filter(function(d) {
    return d.hotels < 10 || d.sights < 8 || !d.hasTrains || !d.hasTransfer;
  }).sort(function(a,b){ return b.quoteCount - a.quoteCount; }).slice(0, 10);

  return ContentService
    .createTextOutput(JSON.stringify({
      hotels:      hotels,
      sights:      sights,
      transfers:   transfers,
      trains:      { routeCount: trainRouteCount, cityCount: trainCities.length, cities: trainCities },
      pipeline:    pipeline,
      gapCities:   gapCities.slice(0, 20),
      demandGaps:  demandGaps,
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ------------------------------------------------------------
// HELPER — SHA-256 password hash
// ------------------------------------------------------------

function hashPass(pass) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass);
  return raw.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
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
