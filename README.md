# TCR Automation Suite (Unified Monolith)

The **TCR Automation Suite** consolidates all TCR coaching institute automations (WhatsApp announcements, Telegram staff commands, Zoom meeting creation, Zoom cloud recording warnings, and Google Calendar sync) into a single, highly performant, 100% free Node.js service for deployment on **Render.com**.

## System Architecture

1. **WhatsApp Class Announcements Daemon (`@whiskeysockets/baileys`)**:
   - 24/7 WhatsApp Web connection daemon.
   - `/dispatch` endpoint bundles tomorrow's schedule, generates dynamic Zoom meeting links via Zoom Server-to-Server OAuth, dispatches messages to target group JIDs, and marks rows as `SENT` in Google Sheets.
   - Configured with `markOnlineOnConnect: false` to ensure primary phone (e.g. iPhone) push notifications are preserved.

2. **Telegram Staff Command Bot**:
   - Webhook handler (`POST /telegram-webhook`) executing staff commands directly on Google Sheets API v4:
     - `/check` - System status check & count of pending unsent classes.
     - `/list [filter]` - Search/list upcoming scheduled classes.
     - `/create Date | Time | Center | Course | Subject | Faculty` - Append new class.
     - `/update RowNumber [Field NewValue]` - Partial/full row update.
     - `/delete RowNumber` - Delete class row.

3. **Zoom Live Cloud Recording Alert Engine**:
   - Webhook handler (`POST /zoom-webhook`) for Zoom events (`meeting.started`, `recording.started`, `meeting.ended`).
   - Tracks unrecorded live meetings in-memory and alerts admins on Telegram with inline **"🔕 Mute Warnings for this Class"** buttons.

4. **100% Free Infrastructure**:
   - Deploys on **Render.com Free Tier** ($0/month, zero credit card needed).
   - Kept alive 24/7 via lightweight Google Apps Script (`src/gas/Code.gs`) pings every 5 minutes.

---

## Directory Structure

├── README.md # Architecture & deployment instructions ├── ARCHITECTURAL_BLUEPRINT.md # In-depth feasibility report ├── package.json # Dependencies & npm scripts ├── .env.example # Environment variables template ├── .gitignore # Ignored files (node_modules, auth_info) └── src ├── config.js # Environment variable loader ├── index.js # Main Express app entry point ├── gas │ └── Code.gs # Google Apps Script for Calendar sync & pings ├── routes │ ├── dispatch.js # POST /dispatch endpoint │ ├── telegramWebhook.js # POST /telegram-webhook endpoint │ └── zoomWebhook.js # POST /zoom-webhook endpoint └── services ├── googleSheetsService.js# Google Sheets API v4 CRUD service ├── telegramService.js # Telegram bot sender & callback handler ├── whatsAppService.js # Baileys WA daemon & dispatch engine └── zoomService.js # Zoom Server-to-Server OAuth service


---

## Environment Variables Configuration

Set these environment variables in your Render.com dashboard or local `.env`:

```env
PORT=3000

# Telegram Configuration
TELEGRAM_BOT_TOKEN=8093638286:AAHslkVd7Y3KBDiNseWM703Kyih2ycF1Yxs
TELEGRAM_CHAT_ID=-5528169479
TELEGRAM_ALERT_CHAT_IDS=-5528169479,7411651759

# Google Sheets Configuration
SPREADSHEET_ID=your_spreadsheet_id_here
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----"

# Zoom Server-to-Server OAuth Configuration
ZOOM_ACCOUNT_ID=your_zoom_account_id
ZOOM_CLIENT_ID=your_zoom_client_id
ZOOM_CLIENT_SECRET=your_zoom_client_secret
