function markDuplicateInputHotels() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName('Hotels');
  var input  = ss.getSheetByName('INPUT_Hotels');

  // Build master Set: key = "hotelname|city" (lowercase trimmed)
  var masterData = master.getDataRange().getValues().slice(1);
  var masterSet  = new Set();
  masterData.forEach(function(r) {
    var key = (r[1] || '').toString().trim().toLowerCase() + '|' + (r[0] || '').toString().trim().toLowerCase();
    if (key !== '|') masterSet.add(key);
  });

  // Walk INPUT_Hotels rows
  var inputData = input.getDataRange().getValues();
  var dupCount = 0, pendingCount = 0;

  for (var i = 1; i < inputData.length; i++) {
    var status = (inputData[i][22] || '').toString().trim().toUpperCase();
    if (status === 'PROCESSED' || status === 'DUPLICATE') continue;

    var key = (inputData[i][1] || '').toString().trim().toLowerCase() + '|' + (inputData[i][0] || '').toString().trim().toLowerCase();
    if (key !== '|' && masterSet.has(key)) {
      var row = i + 1; // 1-based sheet row
      input.getRange(row, 23).setValue('DUPLICATE');
      input.getRange(row, 1, 1, input.getLastColumn()).setBackground('#FFF3CD');
      dupCount++;
    } else {
      pendingCount++;
    }
  }

  Logger.log(dupCount + ' rows marked DUPLICATE, ' + pendingCount + ' rows still PENDING');
}


/**
 * Reverts PROCESSED INPUT_Hotels rows that have all 12 monthly prices empty/0.
 * Sets them back to ERROR so the pipeline re-evaluates or team fixes them.
 * Also removes the bad rows from Hotels master (matched by hotel name + city).
 */
function revertEmptyPriceHotels() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var input = ss.getSheetByName('INPUT_Hotels');
  var master = ss.getSheetByName('Hotels');

  var inputData = input.getDataRange().getValues();
  var revertCount = 0;
  var badKeys = new Set();

  // Pass 1: find PROCESSED rows with no prices in INPUT_Hotels
  for (var i = 1; i < inputData.length; i++) {
    var status = (inputData[i][22] || '').toString().trim().toUpperCase();
    if (status !== 'PROCESSED') continue;

    var hasPrice = false;
    for (var m = 6; m <= 17; m++) { // cols 7-18 (0-based 6-17) = Jan-Dec
      if (Number(inputData[i][m]) > 0) { hasPrice = true; break; }
    }
    if (hasPrice) continue;

    var row = i + 1;
    input.getRange(row, 23).setValue('ERROR');
    input.getRange(row, 24).setValue('All 12 monthly prices were 0 — wrongly PROCESSED');
    input.getRange(row, 1, 1, input.getLastColumn()).setBackground('#f8d7da'); // red
    revertCount++;

    var key = (inputData[i][1] || '').toString().trim().toLowerCase() + '|' +
              (inputData[i][0] || '').toString().trim().toLowerCase();
    if (key !== '|') badKeys.add(key);
  }

  // Pass 2: delete matching rows from Hotels master (bottom-up to preserve indices)
  var masterData = master.getDataRange().getValues();
  var deletedMaster = 0;
  for (var j = masterData.length - 1; j >= 1; j--) {
    var mKey = (masterData[j][1] || '').toString().trim().toLowerCase() + '|' +
               (masterData[j][0] || '').toString().trim().toLowerCase();
    if (badKeys.has(mKey)) {
      master.deleteRow(j + 1);
      deletedMaster++;
    }
  }

  Logger.log(revertCount + ' INPUT rows reverted to ERROR, ' + deletedMaster + ' bad rows deleted from Hotels master');
}
