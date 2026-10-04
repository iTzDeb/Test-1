const express = require('express');
const config = require('./config');
const whatsAppService = require('./services/whatsAppService');

const dispatchRouter = require('./routes/dispatch');
const telegramWebhookRouter = require('./routes/telegramWebhook');
const zoomWebhookRouter = require('./routes/zoomWebhook');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send(`TCR Unified Automation Daemon Online. WhatsApp Connected: ${whatsAppService.isConnected}`);
});

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    whatsappConnected: whatsAppService.isConnected,
    isProcessing: whatsAppService.isProcessing,
    timestamp: new Date().toISOString()
  });
});

app.use('/dispatch', dispatchRouter);
app.use('/telegram-webhook', telegramWebhookRouter);
app.use('/zoom-webhook', zoomWebhookRouter);

app.listen(config.port, () => {
  console.log(`🚀 TCR Unified Automation Server running on port ${config.port}`);
  whatsAppService.startBot();
});
