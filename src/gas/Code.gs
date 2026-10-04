```javascript
// =========================================================================
// TCR MINIMAL GOOGLE APPS SCRIPT (CALENDAR AUTO-SYNC & RENDER KEEP-ALIVE)
// =========================================================================

const CALENDAR_ID = '57288fdf0006ed85305da2672c02d378181465c19cef00492e69e1b1aab87a73@group.calendar.google.com';
const RENDER_APP_URL = 'https://your-render-app.onrender.com'; // Replace with your actual Render URL

// =========================================================================
// 1. KEEP-ALIVE PING & DAILY DISPATCH TRIGGER
// =========================================================================
function keepBotAlive() {
  try {
    const response = UrlFetchApp.fetch(`${RENDER_APP_URL}/ping`, { muteHttpExceptions: true });
    console.log('Keep-alive ping sent to Render: ' + response.getContentText());
  } catch (e) {
    console.error('Keep-alive ping failed: ' + e.message);
  }
}

function triggerBotExactlyOnTime() {
  const url = `${RENDER_APP_URL}/dispatch`;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true
    });
    console.log('Successfully triggered Render bot: ' + response.getContentText());
  } catch (e) {
    console.error('Error triggering Render dispatch: ' + e.message);
  }
}

function armDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'triggerBotExactlyOnTime') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  const runTime = new Date();
  runTime.setHours(16, 26, 0, 0); // 4:26 PM IST

  if (runTime.getTime() <= Date.now()) {
    runTime.setDate(runTime.getDate() + 1);
  }

  ScriptApp.newTrigger('triggerBotExactlyOnTime')
    .timeBased()
    .at(runTime)
    .create();

  console.log(`Armed dispatch trigger for: ${runTime.toLocaleString()}`);
}

// =========================================================================
// 2. GOOGLE CALENDAR ON-EDIT SYNC
// =========================================================================
function autoTriggerCalendarSync(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const editedRow = e.range.getRow();

  if (sheet.getName() !== 'Schedule' || editedRow < 2) return;

  const rowValues = sheet.getRange(editedRow, 1, 1, 8).getValues()[0];
  const dateObj = rowValues[0];
  const isRowComplete = rowValues.slice(0, 6).every(cell => cell !== "" && cell !== null && cell !== undefined);
  const eventId = String(rowValues[7] || '').trim();

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) return;

  if ((!isRowComplete || !dateObj) && eventId && eventId !== 'undefined') {
    try {
      const event = calendar.getEventById(eventId);
      if (event) event.deleteEvent();
      sheet.getRange(editedRow, 8).clearContent();
    } catch (err) {
      console.error(`Error deleting event for row ${editedRow}: ${err.message}`);
    }
    return;
  }

  if (isRowComplete) {
    const timeStr = String(rowValues[1]);
    const center = String(rowValues[2]);
    const course = String(rowValues[3]);
    const subject = String(rowValues[4]);
    const faculty = String(rowValues[5]);

    const eventTitle = `${course} - ${subject} (${faculty})`;
    const eventDesc = `Center: ${center}\nCourse: ${course}\nSubject: ${subject}\nFaculty: ${faculty}`;
    const parsedTimes = parseStartEndTimes(dateObj, timeStr);

    if (!parsedTimes) return;

    try {
      if (eventId && eventId !== 'undefined') {
        const event = calendar.getEventById(eventId);
        if (event) {
          event.setTitle(eventTitle);
          event.setDescription(eventDesc);
          event.setTime(parsedTimes.start, parsedTimes.end);
          event.setLocation(center);
        }
      } else {
        const newEvent = calendar.createEvent(eventTitle, parsedTimes.start, parsedTimes.end, {
          description: eventDesc,
          location: center
        });
        sheet.getRange(editedRow, 8).setValue(newEvent.getId());
      }
    } catch (err) {
      console.error(`Error saving event for row ${editedRow}: ${err.message}`);
    }
  }
}

function parseStartEndTimes(dateObj, timeStr) {
  try {
    const parts = String(timeStr).toUpperCase().split('-');
    if (parts.length !== 2) return null;

    let startStr = parts[0].trim();
    let endStr = parts[1].trim();

    let startMatch = startStr.match(/(\d+)(?::(\d+))?/);
    let endMatch = endStr.match(/(\d+)(?::(\d+))?/);

    if (!startMatch || !endMatch) return null;

    let startHours = parseInt(startMatch[1], 10);
    let startMins = startMatch[2] ? parseInt(startMatch[2], 10) : 0;
    let endHours = parseInt(endMatch[1], 10);
    let endMins = endMatch[2] ? parseInt(endMatch[2], 10) : 0;

    let startAmPm = startStr.includes('PM') ? 'PM' : (startStr.includes('AM') ? 'AM' : null);
    let endAmPm = endStr.includes('PM') ? 'PM' : (endStr.includes('AM') ? 'AM' : null);

    if (!startAmPm) {
      if (endAmPm === 'PM') {
        startAmPm = (startHours >= 7 && startHours <= 11) ? 'AM' : 'PM';
      } else {
        startAmPm = 'AM';
      }
    }
    if (!endAmPm) endAmPm = 'PM';

    if (startAmPm === 'PM' && startHours !== 12) startHours += 12;
    if (startAmPm === 'AM' && startHours === 12) startHours = 0;

    if (endAmPm === 'PM' && endHours !== 12) endHours += 12;
    if (endAmPm === 'AM' && endHours === 12) endHours = 0;

    let startTime = new Date(dateObj);
    let endTime = new Date(dateObj);

    if (isNaN(startTime.getTime())) return null;

    startTime.setHours(startHours, startMins, 0, 0);
    endTime.setHours(endHours, endMins, 0, 0);

    return { start: startTime, end: endTime };
  } catch (e) {
    return null;
  }
}
