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
      const dateStr = dateVal instanceof Date
        ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(dateVal).split('T')[0];
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
      const numCols = cosmeticsSheet.getLastColumn();
      const cosRows = cosmeticsSheet.getRange(2, 1, cosmeticsSheet.getLastRow() - 1, Math.max(numCols, 11)).getValues();
      // Columns: original_name | color | font | bold | italic | tokens_spent | owned_items | text_decoration | text_transform | text_effect | prefix
      cosRows.forEach(row => {
        const [origName, color, font, bold, italic, spent, ownedRaw, textDecoration, textTransform, textEffect, prefix] = row;
        if (!origName) return;
        tokensSpent[origName] = spent || 0;
        cosmetics[origName] = {
          color: color || null,
          font: font || null,
          bold: bold === true || bold === 'TRUE',
          italic: italic === true || italic === 'TRUE',
          textDecoration: textDecoration || null,
          textTransform: textTransform === true || textTransform === 'TRUE',
          textEffect: textEffect || null,
          prefix: prefix || null,
        };
        // Clean up nulls/falsy
        if (!cosmetics[origName].color) delete cosmetics[origName].color;
        if (!cosmetics[origName].font) delete cosmetics[origName].font;
        if (!cosmetics[origName].bold) delete cosmetics[origName].bold;
        if (!cosmetics[origName].italic) delete cosmetics[origName].italic;
        if (!cosmetics[origName].textDecoration) delete cosmetics[origName].textDecoration;
        if (!cosmetics[origName].textTransform) delete cosmetics[origName].textTransform;
        if (!cosmetics[origName].textEffect) delete cosmetics[origName].textEffect;
        if (!cosmetics[origName].prefix) delete cosmetics[origName].prefix;

        // Parse owned items (column 7), with backward-compat inference
        let ownedItems = ownedRaw ? String(ownedRaw).split(',').map(s => s.trim()).filter(Boolean) : [];
        if (ownedItems.length === 0) {
          // Infer from active equipped values
          const colorMap = { '#ffd700': 'color_gold', '#cc2200': 'color_red', '#00aa44': 'color_green', '#8800cc': 'color_purple', '#ff69b4': 'color_pink' };
          const fontMap = { 'Comic Sans MS': 'font_comic', 'Georgia': 'font_georgia', 'Courier New': 'font_courier', 'Impact': 'font_impact' };
          if (color && colorMap[color]) ownedItems.push(colorMap[color]);
          if (font && fontMap[font]) ownedItems.push(fontMap[font]);
          if (bold === true || bold === 'TRUE') ownedItems.push('style_bold');
          if (italic === true || italic === 'TRUE') ownedItems.push('style_italic');
        }
        cosmetics[origName].ownedItems = ownedItems;
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
      const dateVal = row[0];
      const dateStr = dateVal instanceof Date
        ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(dateVal).split('T')[0];
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

    const itemId = data.itemId || '';

    if (userRow === -1) {
      // Create new row (11 cols)
      const newRow = [origName, '', '', false, false, newSpent, itemId, '', false, '', ''];
      if (data.type === 'color') newRow[1] = data.value;
      if (data.type === 'font') newRow[2] = data.value;
      if (data.type === 'style' && data.value === 'bold') newRow[3] = true;
      if (data.type === 'style' && data.value === 'italic') newRow[4] = true;
      if (data.type === 'decoration') newRow[7] = data.value;
      if (data.type === 'transform') newRow[8] = true;
      if (data.type === 'effect') newRow[9] = data.value;
      if (data.type === 'prefix') newRow[10] = data.value;
      cosSheet.appendRow(newRow);
    } else {
      // Update existing row
      if (data.type === 'color') cosSheet.getRange(userRow, 2).setValue(data.value);
      if (data.type === 'font') cosSheet.getRange(userRow, 3).setValue(data.value);
      if (data.type === 'style' && data.value === 'bold') cosSheet.getRange(userRow, 4).setValue(true);
      if (data.type === 'style' && data.value === 'italic') cosSheet.getRange(userRow, 5).setValue(true);
      if (data.type === 'decoration') {
        const cur = cosSheet.getRange(userRow, 8).getValue() || '';
        const parts = cur ? String(cur).split(' ').filter(Boolean) : [];
        if (!parts.includes(data.value)) parts.push(data.value);
        cosSheet.getRange(userRow, 8).setValue(parts.join(' '));
      }
      if (data.type === 'transform') cosSheet.getRange(userRow, 9).setValue(true);
      if (data.type === 'effect') cosSheet.getRange(userRow, 10).setValue(data.value);
      if (data.type === 'prefix') cosSheet.getRange(userRow, 11).setValue(data.value);
      cosSheet.getRange(userRow, 6).setValue(newSpent);
      // Update owned items column 7
      if (itemId) {
        const currentOwned = cosSheet.getRange(userRow, 7).getValue() || '';
        const ownedList = currentOwned ? String(currentOwned).split(',').map(s => s.trim()).filter(Boolean) : [];
        if (!ownedList.includes(itemId)) {
          ownedList.push(itemId);
          cosSheet.getRange(userRow, 7).setValue(ownedList.join(','));
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, newBalance: earned - newSpent }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (data.action === 'unequipItem') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let cosSheet = ss.getSheetByName('Cosmetics');
    if (!cosSheet) return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);

    const lastRow = cosSheet.getLastRow();
    if (lastRow < 2) return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);

    const nameCol = cosSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < nameCol.length; i++) {
      if (nameCol[i][0] === data.original) {
        const row = i + 2;
        if (data.type === 'color') cosSheet.getRange(row, 2).setValue('');
        if (data.type === 'font') cosSheet.getRange(row, 3).setValue('');
        if (data.type === 'style' && data.value === 'bold') cosSheet.getRange(row, 4).setValue(false);
        if (data.type === 'style' && data.value === 'italic') cosSheet.getRange(row, 5).setValue(false);
        if (data.type === 'decoration') {
          const cur = cosSheet.getRange(row, 8).getValue() || '';
          const parts = cur ? String(cur).split(' ').filter(p => p !== data.value) : [];
          cosSheet.getRange(row, 8).setValue(parts.join(' '));
        }
        if (data.type === 'transform') cosSheet.getRange(row, 9).setValue(false);
        if (data.type === 'effect') cosSheet.getRange(row, 10).setValue('');
        if (data.type === 'prefix') cosSheet.getRange(row, 11).setValue('');
        break;
      }
    }
    return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
  }

  if (data.action === 'equipItem') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let cosSheet = ss.getSheetByName('Cosmetics');
    if (!cosSheet) return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);

    const lastRow = cosSheet.getLastRow();
    if (lastRow < 2) return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);

    const nameCol = cosSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < nameCol.length; i++) {
      if (nameCol[i][0] === data.original) {
        const row = i + 2;
        if (data.type === 'color') cosSheet.getRange(row, 2).setValue(data.value);
        if (data.type === 'font') cosSheet.getRange(row, 3).setValue(data.value);
        if (data.type === 'style' && data.value === 'bold') cosSheet.getRange(row, 4).setValue(true);
        if (data.type === 'style' && data.value === 'italic') cosSheet.getRange(row, 5).setValue(true);
        if (data.type === 'decoration') {
          const cur = cosSheet.getRange(row, 8).getValue() || '';
          const parts = cur ? String(cur).split(' ').filter(Boolean) : [];
          if (!parts.includes(data.value)) parts.push(data.value);
          cosSheet.getRange(row, 8).setValue(parts.join(' '));
        }
        if (data.type === 'transform') cosSheet.getRange(row, 9).setValue(true);
        if (data.type === 'effect') cosSheet.getRange(row, 10).setValue(data.value);
        if (data.type === 'prefix') cosSheet.getRange(row, 11).setValue(data.value);
        // No token charge — tokens_spent (col 6) is not modified
        break;
      }
    }
    return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
  }

  return ContentService.createTextOutput('OK');
}
