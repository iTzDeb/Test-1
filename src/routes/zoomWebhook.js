const express = require('express');
const router = express.Router();
const config = require('../config');
const telegramService = require('../services/telegramService');

const activeMeetings = new Map();

function muteMeeting(meetingId) {
  if (activeMeetings.has(meetingId)) {
    const meeting = activeMeetings.get(meetingId);
    if (meeting.timer) clearTimeout(meeting.timer);
    activeMeetings.delete(meetingId);
    console.log(`[Zoom Monitor] Meeting ${meetingId} muted by user callback.`);
  }
}

function scheduleRecordingCheck(meetingId, delayMs) {
  if (!activeMeetings.has(meetingId)) return;

  const meeting = activeMeetings.get(meetingId);
  if (meeting.timer) clearTimeout(meeting.timer);

  meeting.timer = setTimeout(async () => {
    await checkRecordingStatus(meetingId);
  }, delayMs);
}

async function checkRecordingStatus(meetingId) {
  if (!activeMeetings.has(meetingId)) return;

  const meeting = activeMeetings.get(meetingId);
  const now = Date.now();
  const liveMinutes = Math.floor((now - meeting.startTime) / (1000 * 60));
  meeting.warningCount += 1;

  if (liveMinutes >= config.zoom.maxLiveMinutes || meeting.warningCount > config.zoom.maxWarnings) {
    console.log(`[Zoom Monitor] Max boundary reached for meeting ${meetingId}.`);
    
    for (const chatId of config.telegram.alertChatIds) {
      await telegramService.sendMessage(
        chatId,
        `🛑 *RECORDING WARNINGS TERMINATED*\n\n📌 **Topic:** \`${meeting.topic}\`\n\nClass exceeded **${liveMinutes} minutes** without cloud recording. Escalation stopped automatically.`
      );
    }

    activeMeetings.delete(meetingId);
    return;
  }

  let alertMessage = "";
  if (meeting.warningCount === 1) {
    alertMessage = `🚨 *ZOOM RECORDING WARNING!*\n\n📌 **Topic:** \`${meeting.topic}\`\n\nClass has been live for **${liveMinutes} minutes** but *Cloud Recording* has NOT been started! Please start recording immediately.`;
  } else {
    alertMessage = `🔥 *URGENT RECORDING ESCALATION (${meeting.warningCount}/${config.zoom.maxWarnings})*\n\n📌 **Topic:** \`${meeting.topic}\`\n\nClass has been live for **${liveMinutes} minutes** and is STILL NOT RECORDING!`;
  }

  for (const chatId of config.telegram.alertChatIds) {
    await telegramService.sendZoomWarningWithButton(chatId, alertMessage, meetingId);
  }

  scheduleRecordingCheck(meetingId, 2 * 60 * 1000);
}

router.post('/', (req, res) => {
  res.status(200).send('OK');

  try {
    const body = req.body;
    if (!body || !body.event) return;

    const eventType = body.event;
    const meetingObj = body.payload?.object || {};
    const meetingId = String(meetingObj.id || meetingObj.uuid || '');
    const topic = meetingObj.topic || 'Zoom Meeting';
    const scheduledStartTimeStr = meetingObj.start_time;

    if (eventType === "meeting.started") {
      const now = Date.now();

      if (scheduledStartTimeStr) {
        const scheduledTime = new Date(scheduledStartTimeStr).getTime();
        const minutesUntilScheduled = (scheduledTime - now) / (1000 * 60);

        if (minutesUntilScheduled > 5) {
          console.log(`[Zoom Monitor] Early join detected for "${topic}". Skipping timer.`);
          return;
        }
      }

      console.log(`[Zoom Monitor] Meeting started: ${topic} (${meetingId}).`);
      activeMeetings.set(meetingId, {
        topic,
        meetingId,
        startTime: now,
        warningCount: 0,
        timer: null
      });

      scheduleRecordingCheck(meetingId, 3 * 60 * 1000);
    }

    if (eventType === "recording.started" || eventType === "meeting.ended") {
      console.log(`[Zoom Monitor] Event ${eventType} received for ${meetingId}. Clearing timer.`);
      if (activeMeetings.has(meetingId)) {
        const meeting = activeMeetings.get(meetingId);
        if (meeting.timer) clearTimeout(meeting.timer);
        activeMeetings.delete(meetingId);
      }
    }
  } catch (err) {
    console.error('Zoom Webhook Error:', err);
  }
});

module.exports = router;
module.exports.muteMeeting = muteMeeting;
