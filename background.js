/**
 * YouTube Focus Board – background.js (Service Worker)
 * Handles watch-time tracking, session management, and alarm-based resets.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const TICK_INTERVAL_SECONDS = 5; // how often we tick watch-time (seconds)
const ENTERTAINMENT_SESSION_MINUTES = 60;
const ALARM_DAILY_RESET = 'dailyReset';
const ALARM_SESSION_CHECK = 'sessionCheck';
const ALARM_WATCHTIME_TICK = 'watchTimeTick';

// ─── State (in-memory, mirrors storage) ──────────────────────────────────────

let trackingState = {
  isTracking: false,
  sessionType: null, // 'study' | 'entertainment'
  youtubeTabId: null,
  lastTickTime: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ─── Watch Time ───────────────────────────────────────────────────────────────

async function tickWatchTime() {
  if (!trackingState.isTracking) return;

  const today = getTodayKey();
  const data = await getStorage(['watchTimeData', 'focusSession']);
  const focusSession = data.focusSession || {};
  const sessionType = focusSession.type || 'entertainment';

  let watchTimeData = data.watchTimeData || {};
  if (!watchTimeData[today]) {
    watchTimeData[today] = { total: 0, study: 0, entertainment: 0 };
  }

  watchTimeData[today].total += TICK_INTERVAL_SECONDS;
  if (sessionType === 'study') {
    watchTimeData[today].study += TICK_INTERVAL_SECONDS;
  } else {
    watchTimeData[today].entertainment += TICK_INTERVAL_SECONDS;
  }

  await setStorage({ watchTimeData });

  // Notify any open popup
  chrome.runtime.sendMessage({ type: 'WATCHTIME_UPDATED', today, data: watchTimeData[today] }).catch(() => {});
}

// ─── Session Check ────────────────────────────────────────────────────────────

async function checkSession() {
  const data = await getStorage(['focusSession']);
  const session = data.focusSession;

  if (!session || !session.active) return;

  if (session.expiresAt && Date.now() > session.expiresAt) {
    // Session expired – clear it and notify content scripts
    await setStorage({ focusSession: { active: false, type: null, reason: '', expiresAt: null, startedAt: null } });
    trackingState.isTracking = false;

    // Tell all YouTube tabs the session expired
    const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'SESSION_EXPIRED' }).catch(() => {});
    }
  }
}

// ─── Daily Reset ──────────────────────────────────────────────────────────────

async function scheduleDailyReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  await chrome.alarms.create(ALARM_DAILY_RESET, { when: tomorrow.getTime() });
}

// ─── Alarm Listener ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case ALARM_WATCHTIME_TICK:
      await tickWatchTime();
      break;
    case ALARM_SESSION_CHECK:
      await checkSession();
      break;
    case ALARM_DAILY_RESET:
      // The date key changes naturally – just reschedule
      await scheduleDailyReset();
      chrome.runtime.sendMessage({ type: 'DAY_CHANGED' }).catch(() => {});
      break;
  }
});

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'START_TRACKING': {
      trackingState.isTracking = true;
      trackingState.youtubeTabId = sender.tab?.id || null;
      sendResponse({ ok: true });
      break;
    }

    case 'STOP_TRACKING': {
      trackingState.isTracking = false;
      sendResponse({ ok: true });
      break;
    }

    case 'GET_TRACKING_STATE': {
      sendResponse({ isTracking: trackingState.isTracking });
      break;
    }

    case 'START_SESSION': {
      (async () => {
        const sessionType = msg.sessionType || 'study';
        const reason = msg.reason;
        const now = Date.now();
        const expiresAt = sessionType === 'entertainment'
          ? now + ENTERTAINMENT_SESSION_MINUTES * 60 * 1000
          : null;

        const session = { active: true, type: sessionType, reason, startedAt: now, expiresAt };
        await setStorage({ focusSession: session });

        // Log session history
        const histData = await getStorage(['sessionHistory']);
        const history = histData.sessionHistory || [];
        history.push({ type: sessionType, reason, startedAt: now, endedAt: null });
        await setStorage({ sessionHistory: history });

        sendResponse({ ok: true, session });
      })();
      return true; // async
    }

    case 'END_SESSION': {
      (async () => {
        const data = await getStorage(['focusSession', 'sessionHistory']);
        const history = data.sessionHistory || [];
        // Mark last open session as ended
        for (let i = history.length - 1; i >= 0; i--) {
          if (!history[i].endedAt) {
            history[i].endedAt = Date.now();
            break;
          }
        }
        await setStorage({
          focusSession: { active: false, type: null, reason: '', expiresAt: null, startedAt: null },
          sessionHistory: history,
        });
        trackingState.isTracking = false;
        sendResponse({ ok: true });
      })();
      return true;
    }

    case 'GET_SESSION': {
      (async () => {
        const data = await getStorage(['focusSession']);
        sendResponse({ session: data.focusSession || null });
      })();
      return true;
    }

    case 'GET_WATCHTIME': {
      (async () => {
        const today = getTodayKey();
        const data = await getStorage(['watchTimeData']);
        const watchTimeData = data.watchTimeData || {};
        sendResponse({ today, data: watchTimeData[today] || { total: 0, study: 0, entertainment: 0 }, all: watchTimeData });
      })();
      return true;
    }

    case 'GET_TODAY_KEY': {
      sendResponse({ today: getTodayKey() });
      break;
    }

    case 'SEEK_VIDEO': {
      // Sent from popup – seek in the active YouTube tab
      (async () => {
        const { tabId, videoId, timestamp } = msg;
        const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });

        // Try the specified tab first, then any YouTube tab
        let targetTab = tabs.find(t => t.id === tabId) || tabs[0];

        if (!targetTab) {
          // No YouTube tab open – open a new one
          const url = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(timestamp)}s`;
          await chrome.tabs.create({ url });
          sendResponse({ ok: true });
          return;
        }

        const currentUrl = targetTab.url || '';
        const isOnVideo = currentUrl.includes(`v=${videoId}`);

        if (isOnVideo) {
          // Already on this video – just seek
          chrome.tabs.sendMessage(targetTab.id, { type: 'SEEK_TO', timestamp }).catch(() => {});
          chrome.tabs.update(targetTab.id, { active: true });
          sendResponse({ ok: true });
        } else {
          // Navigate to the video with timestamp
          const url = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(timestamp)}s`;
          chrome.tabs.update(targetTab.id, { url, active: true });
          sendResponse({ ok: true });
        }
      })();
      return true;
    }

    case 'OPEN_VIDEO': {
      (async () => {
        const { videoId, timestamp } = msg;
        const url = timestamp
          ? `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(timestamp)}s`
          : `https://www.youtube.com/watch?v=${videoId}`;

        const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
        if (tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, { url, active: true });
        } else {
          chrome.tabs.create({ url });
        }
        sendResponse({ ok: true });
      })();
      return true;
    }

    case 'GET_CURRENT_VIDEO': {
      (async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
          const url = new URL(tab.url);
          const videoId = url.searchParams.get('v');
          sendResponse({ tabId: tab.id, videoId, url: tab.url, title: tab.title });
        } else {
          sendResponse({ tabId: null, videoId: null });
        }
      })();
      return true;
    }
  }
});

// ─── Tab / Window Focus Tracking ─────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (!tab) return;

  const isYouTube = tab.url && tab.url.includes('youtube.com');

  if (!isYouTube) {
    trackingState.isTracking = false;
  }
  // Content script will re-enable tracking when it detects video playing
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    trackingState.isTracking = false;
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function init() {
  // Set up repeating alarms
  await chrome.alarms.clearAll();

  chrome.alarms.create(ALARM_WATCHTIME_TICK, {
    periodInMinutes: TICK_INTERVAL_SECONDS / 60,
    delayInMinutes: TICK_INTERVAL_SECONDS / 60,
  });

  chrome.alarms.create(ALARM_SESSION_CHECK, {
    periodInMinutes: 1,
    delayInMinutes: 1,
  });

  await scheduleDailyReset();

  // Default storage if first run
  const data = await getStorage(['settings', 'focusSession', 'studyList', 'notes']);

  if (!data.settings) {
    await setStorage({
      settings: {
        hideShorts: true,
        hideRecommendations: false,
        hideComments: false,
        dailyGoalMinutes: 120,
      },
    });
  }

  if (!data.focusSession) {
    await setStorage({
      focusSession: { active: false, type: null, reason: '', expiresAt: null, startedAt: null },
    });
  }

  if (!data.studyList) await setStorage({ studyList: [] });
  if (!data.notes) await setStorage({ notes: [] });
}

init();
