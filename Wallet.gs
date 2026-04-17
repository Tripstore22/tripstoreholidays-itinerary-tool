// ================================================================
// WALLET + QUOTE PRICING SYSTEM
// DEV only — do not deploy to live sheet
// ================================================================

const WALLET_CAP_PER_CLIENT = 246;  // max charge per PAX per agent
const PRICE_FIRST_BUNDLE    = 99;   // covers quotes 1, 2, 3
const PRICE_PER_EXTRA       = 49;   // quote 4+ until cap


// ----------------------------------------------------------------
// ONE-TIME SETUP — creates Agent_Wallet and Quote_Counter tabs
// Safe to run repeatedly (skips existing tabs)
// ----------------------------------------------------------------

function createWalletTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Agent_Wallet
  if (!ss.getSheetByName('Agent_Wallet')) {
    const ws = ss.insertSheet('Agent_Wallet');
    ws.appendRow([
      'Transaction_ID', 'Agent_ID', 'Agent_Name', 'Date',
      'Type', 'Amount', 'Description', 'Balance_After', 'Added_By'
    ]);
    ws.setFrozenRows(1);
    ws.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#e2e8f0');
    ws.setColumnWidth(7, 250); // Description
    Logger.log('Created Agent_Wallet tab');
  } else {
    Logger.log('Agent_Wallet tab already exists — skipped');
  }

  // Quote_Counter
  if (!ss.getSheetByName('Quote_Counter')) {
    const qs = ss.insertSheet('Quote_Counter');
    qs.appendRow([
      'Agent_ID', 'PAX_Name', 'Quote_Count',
      'First_Quote_Date', 'Last_Quote_Date', 'Total_Charged'
    ]);
    qs.setFrozenRows(1);
    qs.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#e2e8f0');
    Logger.log('Created Quote_Counter tab');
  } else {
    Logger.log('Quote_Counter tab already exists — skipped');
  }
}


// ----------------------------------------------------------------
// GET WALLET BALANCE
// Computes from all transactions (not just last row) for safety
// ----------------------------------------------------------------

function getWalletBalance(agentId) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Agent_Wallet');
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const data    = sheet.getDataRange().getValues();
  let balance   = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() !== agentId.trim().toLowerCase()) continue;
    const type   = String(data[i][4]).trim().toUpperCase();
    const amount = Number(data[i][5]) || 0;
    if (type === 'CREDIT') balance += amount;
    else if (type === 'DEBIT') balance -= amount;
  }

  return balance;
}


// ----------------------------------------------------------------
// TOP UP WALLET (admin only)
// ----------------------------------------------------------------

function topUpWallet(agentId, amount, addedBy, bankRef) {
  if (!agentId || !amount || amount <= 0) {
    return { success: false, message: 'Invalid agent or amount' };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, message: 'System busy, try again' };
  }

  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Agent_Wallet');
    if (!sheet) return { success: false, message: 'Agent_Wallet tab not found. Run createWalletTabs() first.' };

    const agentName = getAgentDisplayName_(ss, agentId);
    const newBalance = getWalletBalance(agentId) + amount;
    const txnId = Utilities.getUuid().slice(0, 8).toUpperCase();
    const desc = bankRef || ('Top-up by ' + addedBy);

    sheet.appendRow([
      txnId, agentId, agentName, new Date(),
      'CREDIT', amount, desc, newBalance, addedBy
    ]);

    return { success: true, newBalance: newBalance, message: '₹' + amount + ' credited. Balance: ₹' + newBalance };
  } finally {
    lock.releaseLock();
  }
}


// ----------------------------------------------------------------
// CALCULATE QUOTE CHARGE
// Returns { charge, quoteNumber, message } without mutating anything
// ----------------------------------------------------------------

function calculateQuoteCharge(agentId, paxName) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Quote_Counter');
  if (!sheet) return { charge: 0, quoteNumber: 1, message: 'Quote_Counter tab missing' };

  const data = sheet.getDataRange().getValues();
  const agentKey = agentId.trim().toLowerCase();
  const paxKey   = paxName.trim().toLowerCase();

  // Find existing row for this agent + PAX combo
  let quoteCount   = 0;
  let totalCharged = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === agentKey &&
        String(data[i][1]).trim().toLowerCase() === paxKey) {
      quoteCount   = Number(data[i][2]) || 0;
      totalCharged = Number(data[i][5]) || 0;
      break;
    }
  }

  const nextQuote = quoteCount + 1;

  // Cap reached — free
  if (totalCharged >= WALLET_CAP_PER_CLIENT) {
    return { charge: 0, quoteNumber: nextQuote, message: 'Cap reached (₹' + WALLET_CAP_PER_CLIENT + '). No charge.' };
  }

  // First quote for this PAX — ₹99
  if (quoteCount === 0) {
    return { charge: PRICE_FIRST_BUNDLE, quoteNumber: nextQuote, message: 'New client — ₹' + PRICE_FIRST_BUNDLE + ' (covers 3 quotes)' };
  }

  // Quotes 2-3 — covered by initial ₹99
  if (quoteCount < 3) {
    return { charge: 0, quoteNumber: nextQuote, message: 'Quote ' + nextQuote + '/3 — included in initial ₹' + PRICE_FIRST_BUNDLE };
  }

  // Quote 4+ — ₹49, unless it would exceed cap
  const remaining = WALLET_CAP_PER_CLIENT - totalCharged;
  const charge = Math.min(PRICE_PER_EXTRA, remaining);
  return { charge: charge, quoteNumber: nextQuote, message: 'Requote #' + nextQuote + ' — ₹' + charge };
}


// ----------------------------------------------------------------
// PROCESS QUOTE DEDUCTION
// Full flow: calculate → check balance → debit → update counter
// ----------------------------------------------------------------

function processQuoteDeduction(agentId, paxName, description) {
  if (!agentId || !paxName) {
    return { success: false, charge: 0, message: 'Missing agent or PAX name' };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, charge: 0, message: 'System busy, try again' };
  }

  try {
    const chargeInfo = calculateQuoteCharge(agentId, paxName);

    // Update counter FIRST (before debit) — counter is the pricing authority
    updateQuoteCounter_(agentId, paxName, chargeInfo.charge);

    if (chargeInfo.charge > 0) {
      const balance = getWalletBalance(agentId);
      if (balance < chargeInfo.charge) {
        return {
          success: false,
          charge: chargeInfo.charge,
          newBalance: balance,
          quoteNumber: chargeInfo.quoteNumber,
          message: 'Insufficient balance (₹' + balance + '). Need ₹' + chargeInfo.charge + '. Please top up.'
        };
      }

      // Debit wallet
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const wallet = ss.getSheetByName('Agent_Wallet');
      const agentName = getAgentDisplayName_(ss, agentId);
      const newBalance = balance - chargeInfo.charge;
      const txnId = Utilities.getUuid().slice(0, 8).toUpperCase();

      wallet.appendRow([
        txnId, agentId, agentName, new Date(),
        'DEBIT', chargeInfo.charge,
        'Quote: ' + paxName + (description ? ' — ' + description : ''),
        newBalance, 'System'
      ]);

      return {
        success: true,
        charge: chargeInfo.charge,
        newBalance: newBalance,
        quoteNumber: chargeInfo.quoteNumber,
        message: '₹' + chargeInfo.charge + ' deducted. Balance: ₹' + newBalance
      };
    }

    return {
      success: true,
      charge: 0,
      newBalance: getWalletBalance(agentId),
      quoteNumber: chargeInfo.quoteNumber,
      message: chargeInfo.message
    };
  } finally {
    lock.releaseLock();
  }
}


// ----------------------------------------------------------------
// INTERNAL: update or insert Quote_Counter row
// ----------------------------------------------------------------

function updateQuoteCounter_(agentId, paxName, chargeAmount) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Quote_Counter');
  if (!sheet) return;

  const data     = sheet.getDataRange().getValues();
  const agentKey = agentId.trim().toLowerCase();
  const paxKey   = paxName.trim().toLowerCase();
  const now      = new Date();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === agentKey &&
        String(data[i][1]).trim().toLowerCase() === paxKey) {
      // Existing row — increment
      const row = i + 1;
      const oldCount   = Number(data[i][2]) || 0;
      const oldCharged = Number(data[i][5]) || 0;
      sheet.getRange(row, 3).setValue(oldCount + 1);          // Quote_Count
      sheet.getRange(row, 5).setValue(now);                    // Last_Quote_Date
      sheet.getRange(row, 6).setValue(oldCharged + chargeAmount); // Total_Charged
      return;
    }
  }

  // New row
  sheet.appendRow([agentId, paxName, 1, now, now, chargeAmount]);
}


// ----------------------------------------------------------------
// INTERNAL: look up agent display name from Users sheet
// ----------------------------------------------------------------

function getAgentDisplayName_(ss, agentId) {
  const users = ss.getSheetByName('Users');
  if (!users) return agentId;

  const data = users.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === agentId.trim().toLowerCase()) {
      // Col E (index 4) = AgencyName, Col F (index 5) = PersonName
      return String(data[i][4] || data[i][5] || agentId).trim();
    }
  }
  return agentId;
}


// ----------------------------------------------------------------
// GET RECENT TRANSACTIONS (for admin modal + agent dropdown)
// ----------------------------------------------------------------

function getRecentTransactions(agentId, limit) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Agent_Wallet');
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const rows = [];
  const n    = limit || 5;

  for (let i = data.length - 1; i >= 1 && rows.length < n; i--) {
    if (String(data[i][1]).trim().toLowerCase() === agentId.trim().toLowerCase()) {
      rows.push({
        txnId:       data[i][0],
        date:        data[i][3],
        type:        data[i][4],
        amount:      data[i][5],
        description: data[i][6],
        balance:     data[i][7]
      });
    }
  }

  return rows;
}


// ----------------------------------------------------------------
// GET AGENT LIST (for admin top-up modal dropdown)
// Returns all non-PENDING users with their current wallet balance
// ----------------------------------------------------------------

function getAgentList() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const users = ss.getSheetByName('Users');
  if (!users) return ContentService.createTextOutput('[]').setMimeType(ContentService.MimeType.JSON);

  const data   = users.getDataRange().getValues();
  const agents = [];

  for (let i = 1; i < data.length; i++) {
    const username   = String(data[i][0] || '').trim();
    const role       = String(data[i][2] || '').trim().toUpperCase();
    const agencyName = String(data[i][4] || '').trim();
    const personName = String(data[i][5] || '').trim();

    if (!username || role === 'PENDING') continue;

    agents.push({
      agentId:     username,
      agencyName:  agencyName,
      personName:  personName,
      role:        role,
      balance:     getWalletBalance(username)
    });
  }

  return ContentService
    .createTextOutput(JSON.stringify(agents))
    .setMimeType(ContentService.MimeType.JSON);
}
