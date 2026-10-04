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
