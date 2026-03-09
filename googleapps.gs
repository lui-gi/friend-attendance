function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (e.parameter.action === 'get') {
    const data = sheet.getDataRange().getValues();
    return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  }

  if (e.parameter.action === 'getNameMap') {
    const nmSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NameMap');
    if (!nmSheet || nmSheet.getLastRow() < 2) return ContentService.createTextOutput('{}').setMimeType(ContentService.MimeType.JSON);
    const rows = nmSheet.getRange(2, 1, nmSheet.getLastRow() - 1, 2).getValues();
    const map = {};
    rows.forEach(([orig, display]) => { if (orig) map[orig] = display; });
    return ContentService.createTextOutput(JSON.stringify(map)).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput('OK');
}

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

  if (data.action === 'add') {
    sheet.appendRow([data.date, data.day, data.friends]);
  }

  if (data.action === 'setName') {
    let nmSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NameMap');
    if (!nmSheet) {
      nmSheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('NameMap');
      nmSheet.appendRow(['original', 'display']);
    }
    // Upsert: find existing row for this original name, or append
    const lastRow = nmSheet.getLastRow();
    if (lastRow >= 2) {
      const origCol = nmSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < origCol.length; i++) {
        if (origCol[i][0] === data.original) {
          nmSheet.getRange(i + 2, 2).setValue(data.display);
          return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
        }
      }
    }
    nmSheet.appendRow([data.original, data.display]);
    return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
  }

  return ContentService.createTextOutput('OK');
}
