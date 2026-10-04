const express = require('express');
const router = express.Router();
const whatsAppService = require('../services/whatsAppService');
const telegramService = require('../services/telegramService');

router.all('/', async (req, res) => {
  if (!whatsAppService.sock || !whatsAppService.isConnected) {
    return res.status(503).json({ success: false, message: 'WhatsApp socket is not connected yet.' });
  }

  if (whatsAppService.isProcessing) {
    return res.status(429).json({ success: false, message: 'Schedule processing is already in progress.' });
  }

  whatsAppService.isProcessing = true;
  res.json({ success: true, message: 'Schedule dispatch triggered successfully.' });

  try {
    console.log('Triggering daily schedule dispatch...');
    const result = await whatsAppService.processDailySchedules();
    console.log('Daily schedule dispatch completed:', result);
  } catch (err) {
    console.error('Error during schedule dispatch:', err.message);
    await telegramService.sendAlert(`🚨 *Dispatch Execution Error*\n${err.message}`);
  } finally {
    whatsAppService.isProcessing = false;
  }
});

module.exports = router;
