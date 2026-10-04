const express = require('express');
const router = express.Router();
const googleSheetsService = require('../services/googleSheetsService');
const telegramService = require('../services/telegramService');

router.post('/', async (req, res) => {
  res.status(200).send('OK');

  try {
    const body = req.body;
    if (!body || (!body.message && !body.callback_query)) return;

    if (body.callback_query) {
      const callback = body.callback_query;
      const data = callback.data || '';
      const user = callback.from?.first_name || 'Admin';

      if (data.startsWith('mute_')) {
        const meetingId = data.replace('mute_', '');
        const zoomWebhook = require('./zoomWebhook');
        zoomWebhook.muteMeeting(meetingId);

        await telegramService.answerCallbackQuery(callback.id, 'Alerts muted for this meeting.');
        await telegramService.editMessageText(
          callback.message.chat.id,
          callback.message.message_id,
          `${callback.message.text}\n\n🔕 *Alerts muted by ${user}. No further warnings will be sent.*`
        );
      }
      return;
    }

    const message = body.message;
    if (!message || !message.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (!text.startsWith('/')) return;

    const firstSpace = text.indexOf(' ');
    const command = (firstSpace === -1 ? text : text.substring(0, firstSpace)).toLowerCase();
    const argsStr = firstSpace === -1 ? '' : text.substring(firstSpace + 1).trim();

    if (command === '/start' || command === '/help') {
      const helpMsg = `🤖 *TCR Class Scheduler Bot*\n\n` +
        `Available Commands:\n\n` +
        `📌 */check*\nCheck system status and pending class count.\n\n` +
        `📌 */list* _[filter]_\nList scheduled classes. Optional filter.\nExample: \`/list 06 Sept\` or \`/list Laxmi Nagar\`\n\n` +
        `📌 */create* _Date | Time | Center | Course | Subject | Faculty_\nCreate class row. Example:\n` +
        `• \`/create 06 Sept 2026 | 4:00 - 6:00PM | Laxmi Nagar | CLAT | Legal | Shivam Sir\`\n\n` +
        `📌 */update* _RowNumber Field NewValue_\nUpdate class row. Examples:\n` +
        `• \`/update 15 Time 5:00 - 7:00PM\`\n` +
        `• \`/update 15 Faculty Anand Sir\`\n\n` +
        `📌 */delete* _RowNumber_\nDelete class row. Example: \`/delete 15\``;

      await telegramService.sendMessage(chatId, helpMsg);
      return;
    }

    if (command === '/check') {
      const { pendingCount, sheetTitle } = await googleSheetsService.getPendingCount();
      const msg = `📊 *TCR Class Scheduler Bot*\n\n*System is online.* There are *${pendingCount}* pending classes in tab \`${sheetTitle}\` waiting for dispatch.`;
      await telegramService.sendMessage(chatId, msg);
      return;
    }

    if (command === '/list') {
      const matchingRows = await googleSheetsService.listClasses(argsStr);
      if (matchingRows.length === 0) {
        await telegramService.sendMessage(chatId, `📅 No classes found matching filter: \`${argsStr}\``);
        return;
      }

      let messageText = argsStr ? `📅 *Classes matching "${argsStr}"* (${matchingRows.length}):\n\n` : `📅 *Master Class Schedule* (${matchingRows.length} classes):\n\n`;

      matchingRows.forEach(item => {
        const statusBadge = item.status === 'SENT' ? ' `[SENT]`' : '';
        messageText += `• *Row ${item.rowNum}*: ${item.date} | ${item.time} | ${item.center} | ${item.course} - ${item.subject} (${item.faculty})${statusBadge}\n`;
      });

      if (messageText.length > 4000) {
        messageText = messageText.substring(0, 3900) + `\n\n⚠️ _Output truncated due to length limits. Refine query with /list <date>._`;
      }

      await telegramService.sendMessage(chatId, messageText);
      return;
    }

    if (command === '/create' || command === '/add') {
      const parts = argsStr.split('|').map(s => s.trim());
      if (parts.length < 6) {
        await telegramService.sendMessage(chatId, `⚠️ Invalid format. Usage: \`/create Date | Time | Center | Course | Subject | Faculty\``);
        return;
      }

      const newRowIndex = await googleSheetsService.createClass(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
      await telegramService.sendMessage(chatId, `✅ *Class Created Successfully!*\n\n• *Row:* ${newRowIndex}\n• *Date:* ${parts[0]}\n• *Time:* ${parts[1]}\n• *Center:* ${parts[2]}\n• *Course:* ${parts[3]}\n• *Subject:* ${parts[4]}\n• *Faculty:* ${parts[5]}`);
      return;
    }

    if (command === '/update') {
      const spaceIndex = argsStr.indexOf(' ');
      if (spaceIndex === -1) {
        await telegramService.sendMessage(chatId, `⚠️ Usage: \`/update RowNumber Field NewValue\` or pipe separated values.`);
        return;
      }

      const rowNumStr = argsStr.substring(0, spaceIndex).trim();
      const rowNum = parseInt(rowNumStr, 10);
      const restStr = argsStr.substring(spaceIndex).trim();

      if (isNaN(rowNum) || rowNum <= 1) {
        await telegramService.sendMessage(chatId, `❌ Invalid Row Number \`${rowNumStr}\`. Must be row index 2 or higher.`);
        return;
      }

      const res = await googleSheetsService.updateClass(rowNum, restStr);
      if (res.full) {
        await telegramService.sendMessage(chatId, `✅ *Row ${rowNum} updated completely!*`);
      } else {
        await telegramService.sendMessage(chatId, `✅ *Row ${rowNum} updated!*\nField *${res.fieldName.toUpperCase()}* set to: \`${res.newValue}\``);
      }
      return;
    }

    if (command === '/delete') {
      const rowNum = parseInt(argsStr.trim(), 10);
      if (isNaN(rowNum) || rowNum <= 1) {
        await telegramService.sendMessage(chatId, `❌ Invalid Row Number \`${argsStr}\`. Must be row index 2 or higher.`);
        return;
      }

      await googleSheetsService.deleteClass(rowNum);
      await telegramService.sendMessage(chatId, `🗑️ *Class Row ${rowNum} Deleted Successfully!*`);
      return;
    }

    await telegramService.sendMessage(chatId, `⚠️ Unknown command. Type /help to see available commands.`);
  } catch (err) {
    console.error('Telegram Webhook Error:', err);
    if (req.body?.message?.chat?.id) {
      await telegramService.sendMessage(req.body.message.chat.id, `⚠️ *Execution Error:* \`${err.message}\``);
    }
  }
});

module.exports = router;
