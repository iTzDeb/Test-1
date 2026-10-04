const CALENDAR_ID = '57288fdf0006ed85305da2672c02d378181465c19cef00492e69e1b1aab87a73@group.calendar.google.com';
const RENDER_APP_URL = 'https://your-render-app.onrender.com';

function keepBotAlive() {
  try {
    UrlFetchApp.fetch(`${RENDER_APP_URL}/ping`, { muteHttpExceptions: true });
  } catch (e) {
    console.error('Keep-alive ping failed: ' + e.message);
  }
}

function triggerBotExactlyOnTime() {
  try {
    UrlFetchApp.fetch(`${RENDER_APP_URL}/dispatch`, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true
    });
  } catch (e) {
    console.error('Error triggering dispatch: ' + e.message);
  }
}
