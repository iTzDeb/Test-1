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
