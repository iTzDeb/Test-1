
require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,
  
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    alertChatIds: (process.env.TELEGRAM_ALERT_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
  },

  google: {
    spreadsheetId: process.env.SPREADSHEET_ID || '',
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: process.env.GOOGLE_PRIVATE_KEY
      ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : ''
  },

  zoom: {
    accountId: process.env.ZOOM_ACCOUNT_ID || '',
    clientId: process.env.ZOOM_CLIENT_ID || '',
    clientSecret: process.env.ZOOM_CLIENT_SECRET || '',
    centersRequiringZoom: ['laxmi nagar', 'online', 'mukherjee nagar', 'hybrid'],
    defaultDurationMins: 120,
    maxWarnings: parseInt(process.env.MAX_RECORDING_WARNINGS || '5', 10),
    maxLiveMinutes: parseInt(process.env.MAX_LIVE_MEETING_MINUTES || '60', 10)
  },

  timings: {
    apiBreatherMs: 1500,
    zoomRetryMs: 2000,
    messageDelayMs: 3000
  }
};

module.exports = config;
2. src/services/googleSheetsService.js
Create directory src/services/ and file googleSheetsService.js:

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
3. src/services/telegramService.js
File src/services/telegramService.js:

const axios = require('axios');
const config = require('../config');

class TelegramService {
  async sendMessage(chatId, text, extraOptions = {}) {
    if (!config.telegram.botToken) {
      console.warn('Telegram Bot Token not configured.');
      return null;
    }

    try {
      const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
      const response = await axios.post(url, {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        ...extraOptions
      });
      return response.data;
    } catch (e) {
      console.error(`Telegram sendMessage failed for chat ${chatId}:`, e?.response?.data || e.message);
      return null;
    }
  }

  async sendAlert(message) {
    const alertChatIds = config.telegram.alertChatIds;
    if (alertChatIds.length === 0) return;

    for (const chatId of alertChatIds) {
      await this.sendMessage(chatId, `🚨 *TCR Alert*\n\n${message}`);
    }
  }

  async sendZoomWarningWithButton(chatId, text, meetingId) {
    return this.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔕 Mute Warnings for this Class", callback_data: `mute_${meetingId}` }
        ]]
      }
    });
  }

  async answerCallbackQuery(callbackQueryId, text) {
    if (!config.telegram.botToken) return;

    try {
      const url = `https://api.telegram.org/bot${config.telegram.botToken}/answerCallbackQuery`;
      await axios.post(url, {
        callback_query_id: callbackQueryId,
        text: text
      });
    } catch (e) {
      console.error('Failed to answer callback query:', e.message);
    }
  }

  async editMessageText(chatId, messageId, text) {
    if (!config.telegram.botToken) return;

    try {
      const url = `https://api.telegram.org/bot${config.telegram.botToken}/editMessageText`;
      await axios.post(url, {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      console.error('Failed to edit message text:', e.message);
    }
  }
}

module.exports = new TelegramService();
4. src/services/zoomService.js
File src/services/zoomService.js:

const axios = require('axios');
const config = require('../config');
const telegramService = require('./telegramService');

class ZoomService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const { accountId, clientId, clientSecret } = config.zoom;
    if (!accountId || !clientId || !clientSecret) {
      console.warn('Zoom credentials not fully set.');
      return null;
    }

    try {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const response = await axios.post(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
        {},
        {
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = Date.now() + (response.data.expires_in - 300) * 1000;
      return this.accessToken;
    } catch (e) {
      console.error('Failed to fetch Zoom OAuth token:', e?.response?.data || e.message);
      await telegramService.sendAlert(`⚠️ *Zoom API Alert*\nFailed to fetch access token: ${e.message}`);
      return null;
    }
  }

  async createMeeting(topic, startTime, durationMins = config.zoom.defaultDurationMins) {
    const token = await this.getAccessToken();
    if (!token) return null;

    try {
      const payload = {
        topic: topic,
        type: 2,
        start_time: startTime,
        duration: durationMins,
        timezone: 'Asia/Kolkata',
        settings: {
          host_video: true,
          participant_video: false,
          join_before_host: false,
          mute_upon_entry: true,
          waiting_room: true
        }
      };

      const response = await axios.post(
        'https://api.zoom.us/v2/users/me/meetings',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.join_url;
    } catch (e) {
      console.error(`Failed to create Zoom meeting for ${topic}:`, e?.response?.data || e.message);
      return null;
    }
  }
}

module.exports = new ZoomService();
5. src/services/whatsAppService.js
File src/services/whatsAppService.js:

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const config = require('../config');
const telegramService = require('./telegramService');
const googleSheetsService = require('./googleSheetsService');
const zoomService = require('./zoomService');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.isConnected = false;
    this.isProcessing = false;
  }

  async startBot() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('auth_info');
      const { version, isLatest } = await fetchLatestWaWebVersion();
      console.log(`Using Baileys WA v${version.join('.')}, isLatest: ${isLatest}`);

      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        browser: ["TCR Dispatcher", "Chrome", "120.0.0"]
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('\nQR Code generated! Scan with WhatsApp:\n');
          qrcode.generate(qr, { small: true });

          await telegramService.sendAlert(
            `📱 *WhatsApp Scan Required*\n\nPlease scan the QR code in terminal or use code below:\n\`\`\`\n${qr}\n\`\`\``
          );
        }

        if (connection === 'close') {
          this.isConnected = false;
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log('WhatsApp Connection closed. Reconnecting:', shouldReconnect);

          if (shouldReconnect) {
            setTimeout(() => this.startBot(), 3000);
          } else {
            await telegramService.sendAlert('⚠️ *WhatsApp Disconnected*\nSession logged out. QR scan required.');
          }
        } else if (connection === 'open') {
          this.isConnected = true;
          console.log('✅ Connected to WhatsApp Web Daemon!');
        }
      });
    } catch (err) {
      console.error('Error starting WhatsApp socket:', err);
      await telegramService.sendAlert(`🚨 *WhatsApp Initialization Error*\n${err.message}`);
    }
  }

  formatZoomStartTime(dateVal, timeStr) {
    try {
      const rawDate = new Date(dateVal);
      if (isNaN(rawDate.getTime())) return null;

      const parts = timeStr.toUpperCase().split('-');
      let startStr = parts[0].trim();
      let match = startStr.match(/(\d+)(?::(\d+))?/);
      if (!match) return null;

      let hours = parseInt(match[1], 10);
      let mins = match[2] ? parseInt(match[2], 10) : 0;

      let ampm = startStr.includes('PM') ? 'PM' : (startStr.includes('AM') ? 'AM' : null);
      if (!ampm) {
        ampm = (hours >= 7 && hours <= 11) ? 'AM' : 'PM';
      }

      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      const year = rawDate.getFullYear();
      const month = String(rawDate.getMonth() + 1).padStart(2, '0');
      const day = String(rawDate.getDate()).padStart(2, '0');
      const formattedHours = String(hours).padStart(2, '0');
      const formattedMins = String(mins).padStart(2, '0');

      return `${year}-${month}-${day}T${formattedHours}:${formattedMins}:00Z`;
    } catch (e) {
      return null;
    }
  }

  getOrdinalSuffix(d) {
    if (d > 3 && d < 21) return 'th';
    switch (d % 10) {
      case 1: return "st";
      case 2: return "nd";
      case 3: return "rd";
      default: return "th";
    }
  }

  async processDailySchedules() {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp socket is not connected.');
    }

    const { classes: allClasses, settings: groupDirectory } = await googleSheetsService.getClassesAndSettings();

    if (!allClasses || allClasses.length === 0) {
      console.log('No pending classes found in Google Sheet.');
      return { count: 0, message: 'No pending classes found.' };
    }

    const istFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowISTStr = istFormatter.format(tomorrow);

    const tomorrowsClasses = allClasses.filter(item => {
      const rowDate = new Date(item.date);
      if (isNaN(rowDate)) return false;
      return istFormatter.format(rowDate) === tomorrowISTStr;
    });

    if (tomorrowsClasses.length === 0) {
      console.log('No classes scheduled for tomorrow.');
      return { count: 0, message: 'No classes scheduled for tomorrow.' };
    }

    const normalizedDirectory = {};
    if (groupDirectory) {
      for (const rawKey in groupDirectory) {
        normalizedDirectory[rawKey.trim().toLowerCase()] = groupDirectory[rawKey];
      }
    }

    const groupedClasses = {};
    for (const item of tomorrowsClasses) {
      const centerClean = String(item.center || '').trim().toLowerCase();
      const courseClean = String(item.course || '').trim().toLowerCase();
      const key = `${centerClean}_${courseClean}`;

      if (!groupedClasses[key]) {
        groupedClasses[key] = { date: item.date, course: item.course, center: item.center, sessions: [] };
      }
      groupedClasses[key].sessions.push(item);
    }

    let dispatchedCount = 0;
    let zoomCollisionOffset = 1;

    for (const key in groupedClasses) {
      const group = groupedClasses[key];
      const rawGroupIds = normalizedDirectory[key] || groupDirectory[key];

      if (!rawGroupIds) {
        const warnMsg = `⚠️ *Routing Warning*\nNo group ID found in Settings tab for key: \`${key}\``;
        console.warn(warnMsg);
        await telegramService.sendAlert(warnMsg);
        continue;
      }

      const targetGroups = rawGroupIds.split(',').map(id => id.trim()).filter(Boolean);

      const rawDate = new Date(group.date);
      const istDate = new Date(rawDate.getTime() + (5.5 * 60 * 60 * 1000));
      const day = istDate.getDate();
      const month = istDate.toLocaleString('en-US', { month: 'long' });
      const formattedDate = `${day}${this.getOrdinalSuffix(day)} ${month}`;

      let message = `*TCR – ${group.course.toUpperCase()} CLASS FLOW*\n\n` +
                    `*Class Schedule*\n` +
                    `📌 ${formattedDate}\n\n`;

      const centerNormalized = String(group.center || '').toLowerCase().trim();
      const centerRequiresZoom = config.zoom.centersRequiringZoom.includes(centerNormalized);

      for (const session of group.sessions) {
        message += `*${session.time}*\n` +
                   `Subject: *${session.subject}*\n` +
                   `Faculty: *${session.faculty.toUpperCase()}*\n`;

        const subjectLower = String(session.subject || '').toLowerCase();
        const isOfflineEvent = subjectLower.includes('mock') || subjectLower.includes('test');

        if (centerRequiresZoom && !isOfflineEvent) {
          let exactZoomStartTime = this.formatZoomStartTime(group.date, session.time);
          if (exactZoomStartTime) {
            const meetingTitle = `TCR ${group.center} ${session.course} - ${session.subject} (${session.faculty})`;
            const secondOffset = String(zoomCollisionOffset % 60).padStart(2, '0');
            exactZoomStartTime = exactZoomStartTime.substring(0, 17) + secondOffset;
            zoomCollisionOffset++;

            await new Promise(res => setTimeout(res, config.timings.apiBreatherMs));
            let joinUrl = await zoomService.createMeeting(meetingTitle, exactZoomStartTime);

            if (!joinUrl) {
              await new Promise(res => setTimeout(res, config.timings.zoomRetryMs));
              joinUrl = await zoomService.createMeeting(meetingTitle, exactZoomStartTime);
            }

            if (joinUrl) {
              message += `🔗 *Zoom:* ${joinUrl}\n`;
            } else {
              message += `🔗 *Zoom:* Link pending (Will be shared shortly)\n`;
              await telegramService.sendAlert(`⚠️ *Zoom Meeting Failed*\nCould not create link for: ${meetingTitle}`);
            }
          }
        }
        message += `\n`;
      }

      message += `Regards,\n*TEAM TCR*`;

      let atLeastOneSuccess = false;
      for (const jid of targetGroups) {
        try {
          await this.sock.sendMessage(jid, { text: message.trim() });
          console.log(`Sent schedule for ${key} to ${jid}`);
          atLeastOneSuccess = true;
          await new Promise(res => setTimeout(res, config.timings.messageDelayMs));
        } catch (sendErr) {
          const sendErrMsg = `❌ *WhatsApp Dispatch Error*\nFailed to send to group \`${jid}\`: ${sendErr.message}`;
          console.error(sendErrMsg);
          await telegramService.sendAlert(sendErrMsg);
        }
      }

      if (atLeastOneSuccess) {
        for (const session of group.sessions) {
          await googleSheetsService.markRowAsSent(session.rowIndex);
          dispatchedCount++;
        }
      }
    }

    return { count: dispatchedCount, message: `Successfully dispatched ${dispatchedCount} classes.` };
  }
}

module.exports = new WhatsAppService();
