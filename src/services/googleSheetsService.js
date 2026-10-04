const { google } = require('googleapis');
const config = require('../config');

class GoogleSheetsService {
  constructor() {
    this.sheetsClient = null;
  }

  getSheetsClient() {
    if (this.sheetsClient) return this.sheetsClient;

    if (!config.google.serviceAccountEmail || !config.google.privateKey) {
      throw new Error('Google Service Account credentials missing in environment variables.');
    }

    const auth = new google.auth.JWT(
      config.google.serviceAccountEmail,
      null,
      config.google.privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    this.sheetsClient = google.sheets({ version: 'v4', auth });
    return this.sheetsClient;
  }

  async resolveSheetDetails() {
    const sheets = this.getSheetsClient();
    const res = await sheets.spreadsheets.get({ spreadsheetId: config.google.spreadsheetId });
    const sheetList = res.data.sheets || [];

    const scheduleSheet = sheetList.find(s => s.properties.title.toLowerCase() === 'schedule') || sheetList[0];

    if (!scheduleSheet) {
      throw new Error('No valid sheet tab found in spreadsheet.');
    }

    return {
      title: scheduleSheet.properties.title,
      sheetId: scheduleSheet.properties.sheetId
    };
  }

  async getClassesAndSettings() {
    const sheets = this.getSheetsClient();
    const sheetDetails = await this.resolveSheetDetails();

    const scheduleRes = await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.spreadsheetId,
      range: `'${sheetDetails.title}'!A1:G`
    });

    const rows = scheduleRes.data.values || [];
    const classes = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const status = String(row[6] || '').trim();

      if (!row[0] || status === 'SENT') continue;

      classes.push({
        rowIndex: i + 1,
        date: row[0],
        time: String(row[1] || ''),
        center: String(row[2] || ''),
        course: String(row[3] || ''),
        subject: String(row[4] || ''),
        faculty: String(row[5] || '')
      });
    }

    const settings = {};
    try {
      const settingsRes = await sheets.spreadsheets.values.get({
        spreadsheetId: config.google.spreadsheetId,
        range: `'Settings'!A1:C`
      });

      const settingsRows = settingsRes.data.values || [];
      for (let i = 1; i < settingsRows.length; i++) {
        const center = String(settingsRows[i][0] || '').trim().toLowerCase();
        const course = String(settingsRows[i][1] || '').trim().toLowerCase();
        const groupId = String(settingsRows[i][2] || '').trim();

        if (center && course && groupId) {
          settings[`${center}_${course}`] = groupId;
        }
      }
    } catch (err) {
      console.warn('Settings tab read warning:', err.message);
    }

    return { classes, settings };
  }

  async markRowAsSent(rowIndex) {
    const sheets = this.getSheetsClient();
    const sheetDetails = await this.resolveSheetDetails();

    await sheets.spreadsheets.values.update({
      spreadsheetId: config.google.spreadsheetId,
      range: `'${sheetDetails.title}'!G${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['SENT']]
      }
    });
  }

  async getPendingCount() {
    const sheets = this.getSheetsClient();
    const sheetDetails = await this.resolveSheetDetails();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.spreadsheetId,
      range: `'${sheetDetails.title}'!A1:G`
    });

    const rows = res.data.values || [];
    let pendingCount = 0;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] && String(rows[i][6] || '').trim() !== 'SENT') {
        pendingCount++;
      }
    }

    return { pendingCount, sheetTitle: sheetDetails.title };
  }

  async listClasses(filterText) {
    const sheets = this.getSheetsClient();
    const sheetDetails = await this.resolveSheetDetails();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.spreadsheetId,
      range: `'${sheetDetails.title}'!A1:G`
    });

    const rows = res.data.values || [];
    const matchingRows = [];

    const matchesFilter = (rowText, filter) => {
      const normText = rowText.toLowerCase();
      const tokens = filter.toLowerCase().trim().split(/\s+/).filter(Boolean);
      return tokens.every(token => normText.includes(token));
    };

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dateStr = String(row[0] || '').trim();
      if (!dateStr) continue;

      const timeStr = String(row[1] || '').trim();
      const centerStr = String(row[2] || '').trim();
      const courseStr = String(row[3] || '').trim();
      const subjectStr = String(row[4] || '').trim();
      const facultyStr = String(row[5] || '').trim();
      const statusStr = String(row[6] || '').trim();

      const fullRowText = `${dateStr} ${timeStr} ${centerStr} ${courseStr} ${subjectStr} ${facultyStr} ${statusStr}`;

      if (!filterText || matchesFilter(fullRowText, filterText)) {
        matchingRows.push({
          rowNum: i + 1,
          date: dateStr,
          time: timeStr,
          center: centerStr,
          course: courseStr,
          subject: subjectStr,
          faculty: facultyStr,
          status: statusStr
        });
      }
    }

    return matchingRows;
  }

  async createClass(dateVal, timeVal, centerVal, courseVal, subjectVal, facultyVal) {
    const sheets = this.getSheetsClient();
    const sheetDetails = await this.resolveSheetDetails();

    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId: config.google.spreadsheetId,
      range: `'${sheetDetails.title}'!A:G`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[dateVal, timeVal, centerVal, courseVal, subjectVal, facultyVal, '']]
      }
    });

    const updatedRange = appendRes.data.updates.updatedRange;
    const rowMatch = updatedRange ? updatedRange.match(/(\d+)$/) : null;
    return rowMatch ? rowMatch[1] : 'New';
  }

  async updateClass(rowNum, restStr) {
    const sheets = this.getSheetsClient();
    const sheetDetails = await this.resolveSheetDetails();

    if (restStr.includes('|')) {
      const parts = restStr.split('|').map(s => s.trim());
      if (parts.length >= 6) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: config.google.spreadsheetId,
          range: `'${sheetDetails.title}'!A${rowNum}:G${rowNum}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], '']]
          }
        });
        return { full: true };
      }
    }

    const fieldSpaceIndex = restStr.indexOf(' ');
    if (fieldSpaceIndex === -1) {
      throw new Error('Please specify field to update and new value.');
    }

    const fieldName = restStr.substring(0, fieldSpaceIndex).trim().toLowerCase();
    const newValue = restStr.substring(fieldSpaceIndex).trim();

    const fieldColMap = {
      'date': 'A',
      'time': 'B',
      'center': 'C',
      'course': 'D',
      'subject': 'E',
      'faculty': 'F',
      'status': 'G'
    };

    const colLetter = fieldColMap[fieldName];
    if (!colLetter) {
      throw new Error(`Unknown field \`${fieldName}\`.`);
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: config.google.spreadsheetId,
      range: `'${sheetDetails.title}'!${colLetter}${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[newValue]]
      }
    });

    if (fieldName !== 'status') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.google.spreadsheetId,
        range: `'${sheetDetails.title}'!G${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['']]
        }
      });
    }

    return { fieldName, newValue };
  }

  async deleteClass(rowNum) {
    const sheets = this.getSheetsClient();
    const sheetDetails = await this.resolveSheetDetails();

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.google.spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetDetails.sheetId,
              dimension: 'ROWS',
              startIndex: rowNum - 1,
              endIndex: rowNum
            }
          }
        }]
      }
    });
  }
}

module.exports = new GoogleSheetsService();
