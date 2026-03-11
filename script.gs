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

  if (e.parameter.action === 'getShopData') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const attendSheet = ss.getActiveSheet();

    // Count unique dates per attendee to compute tokens earned
    const attendData = attendSheet.getDataRange().getValues().slice(1); // skip header
    const datesByName = {}; // origName -> Set of date strings
    attendData.forEach(row => {
      const dateVal = row[0];
      const dateStr = dateVal ? String(dateVal).split('T')[0] : '';
      if (!dateStr) return;
      const names = String(row[2]).split(',').map(s => s.trim()).filter(Boolean);
      names.forEach(name => {
        if (!datesByName[name]) datesByName[name] = new Set();
        datesByName[name].add(dateStr);
      });
    });

    // tokens earned = unique dates × 5
    const tokensEarned = {};
    Object.entries(datesByName).forEach(([name, dates]) => {
      tokensEarned[name] = dates.size * 5;
    });

    // Read Cosmetics sheet
    let cosmeticsSheet = ss.getSheetByName('Cosmetics');
    const tokensSpent = {};
    const cosmetics = {};

    if (cosmeticsSheet && cosmeticsSheet.getLastRow() >= 2) {
      const cosRows = cosmeticsSheet.getRange(2, 1, cosmeticsSheet.getLastRow() - 1, 6).getValues();
      // Columns: original_name | color | font | bold | italic | tokens_spent
      cosRows.forEach(row => {
        const [origName, color, font, bold, italic, spent] = row;
        if (!origName) return;
        tokensSpent[origName] = spent || 0;
        cosmetics[origName] = {
          color: color || null,
          font: font || null,
          bold: bold === true || bold === 'TRUE',
          italic: italic === true || italic === 'TRUE',
        };
        // Clean up nulls
        if (!cosmetics[origName].color) delete cosmetics[origName].color;
        if (!cosmetics[origName].font) delete cosmetics[origName].font;
        if (!cosmetics[origName].bold) delete cosmetics[origName].bold;
        if (!cosmetics[origName].italic) delete cosmetics[origName].italic;
      });
    }

    // Compute balance = earned - spent
    const tokens = {};
    Object.keys(tokensEarned).forEach(name => {
      tokens[name] = tokensEarned[name] - (tokensSpent[name] || 0);
    });

    const result = { tokens, cosmetics };
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
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

  if (data.action === 'buyItem') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const attendSheet = ss.getActiveSheet();
    const origName = data.original;
    const cost = Number(data.cost) || 0;

    // Verify balance server-side
    const attendData = attendSheet.getDataRange().getValues().slice(1);
    const dates = new Set();
    attendData.forEach(row => {
      const dateStr = row[0] ? String(row[0]).split('T')[0] : '';
      if (!dateStr) return;
      const names = String(row[2]).split(',').map(s => s.trim());
      if (names.includes(origName)) dates.add(dateStr);
    });
    const earned = dates.size * 5;

    // Get/create Cosmetics sheet
    let cosSheet = ss.getSheetByName('Cosmetics');
    if (!cosSheet) {
      cosSheet = ss.insertSheet('Cosmetics');
      cosSheet.appendRow(['original_name', 'color', 'font', 'bold', 'italic', 'tokens_spent']);
    }

    // Find existing row for this user
    const lastRow = cosSheet.getLastRow();
    let userRow = -1;
    let currentSpent = 0;
    if (lastRow >= 2) {
      const nameCol = cosSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < nameCol.length; i++) {
        if (nameCol[i][0] === origName) {
          userRow = i + 2;
          currentSpent = cosSheet.getRange(userRow, 6).getValue() || 0;
          break;
        }
      }
    }

    // Verify sufficient balance
    if (earned - currentSpent < cost) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Insufficient tokens' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const newSpent = currentSpent + cost;

    if (userRow === -1) {
      // Create new row
      const newRow = [origName, '', '', false, false, newSpent];
      if (data.type === 'color') newRow[1] = data.value;
      if (data.type === 'font') newRow[2] = data.value;
      if (data.type === 'style' && data.value === 'bold') newRow[3] = true;
      if (data.type === 'style' && data.value === 'italic') newRow[4] = true;
      cosSheet.appendRow(newRow);
    } else {
      // Update existing row
      if (data.type === 'color') cosSheet.getRange(userRow, 2).setValue(data.value);
      if (data.type === 'font') cosSheet.getRange(userRow, 3).setValue(data.value);
      if (data.type === 'style' && data.value === 'bold') cosSheet.getRange(userRow, 4).setValue(true);
      if (data.type === 'style' && data.value === 'italic') cosSheet.getRange(userRow, 5).setValue(true);
      cosSheet.getRange(userRow, 6).setValue(newSpent);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, newBalance: earned - newSpent }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput('OK');
}
