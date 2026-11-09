/**
 * YouTube Focus Board – popup.js
 * Controls the extension popup UI.
 */

'use strict';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function formatSeconds(seconds) {
  const s = Math.round(seconds || 0);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTimestamp(seconds) {
  const s = Math.floor(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function extractVideoId(url) {
  if (!url) return null;
  // Standard: youtube.com/watch?v=ID
  let match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  // Shortened: youtu.be/ID
  match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  // Embed: youtube.com/embed/ID
  match = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  // Shorts: youtube.com/shorts/ID
  match = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  return null;
}

function thumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ─── State ────────────────────────────────────────────────────────────────────

let currentSession = null;
let settings = { hideShorts: true, hideRecommendations: false, hideComments: false, dailyGoalMinutes: 120 };
let studyList = [];
let notes = [];
let currentTabInfo = { tabId: null, videoId: null, title: '', url: '' };
let sessionTimerInterval = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadAll();
  bindEvents();
  updateDateDisplay();
  startSessionTimer();

  // Listen for background messages
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'WATCHTIME_UPDATED') {
      renderWatchTime(msg.data);
    }
    if (msg.type === 'DAY_CHANGED') {
      renderWatchTime({ total: 0, study: 0, entertainment: 0 });
    }
  });
}

async function loadAll() {
  const data = await getStorage(['settings', 'focusSession', 'studyList', 'notes', 'watchTimeData']);

  if (data.settings) settings = { ...settings, ...data.settings };
  if (data.studyList) studyList = data.studyList;
  if (data.notes) notes = data.notes;

  currentSession = data.focusSession || null;

  // Check expiry
  if (currentSession && currentSession.expiresAt && Date.now() > currentSession.expiresAt) {
    currentSession = { active: false };
    await chrome.runtime.sendMessage({ type: 'END_SESSION' });
  }

  // Get current tab video info
  await loadCurrentTabInfo();

  // Render everything
  renderSession();
  renderToggles();
  renderStudyList();
  renderNotes();
  renderWatchTimeFromStorage(data.watchTimeData);
  updateNoteHint();
}

async function loadCurrentTabInfo() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_VIDEO' }, (res) => {
      if (res) {
        currentTabInfo = {
          tabId: res.tabId,
          videoId: res.videoId,
          title: (res.title || '').replace(' - YouTube', '').trim(),
          url: res.url || '',
        };
      }
      resolve();
    });
  });
}

// ─── Session ──────────────────────────────────────────────────────────────────

function renderSession() {
  const active = currentSession && currentSession.active;

  $('session-no-active').classList.toggle('hidden', active || false);
  $('session-active').classList.toggle('hidden', !active);
  $('inline-gate').classList.toggle('hidden', active !== false || (currentSession && currentSession.active));

  if (active) {
    const badge = $('session-badge');
    badge.textContent = currentSession.type === 'study' ? '📚 Study' : '🎬 Entertainment';
    badge.className = 'session-badge' + (currentSession.type === 'entertainment' ? ' entertainment' : '');
    $('session-reason').textContent = currentSession.reason || '';

    if (currentSession.type === 'entertainment' && currentSession.expiresAt) {
      $('session-timer').classList.remove('hidden');
      updateTimerDisplay();
    } else {
      $('session-timer').classList.add('hidden');
    }
  } else {
    // Show inline gate
    $('session-no-active').classList.add('hidden');
    $('inline-gate').classList.remove('hidden');
  }
}

function updateTimerDisplay() {
  if (!currentSession?.expiresAt) return;
  const remaining = Math.max(0, currentSession.expiresAt - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  $('timer-value').textContent = `${mins}:${String(secs).padStart(2, '0')}`;

  if (remaining === 0) {
    stopSessionTimer();
    renderSession();
  }
}

function startSessionTimer() {
  stopSessionTimer();
  sessionTimerInterval = setInterval(() => {
    if (currentSession?.expiresAt) updateTimerDisplay();
  }, 1000);
}

function stopSessionTimer() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
}

async function startSession(type) {
  const input = $('gate-input');
  const reason = input.value.trim();
  const errorEl = $('gate-error');

  if (!reason) {
    errorEl.classList.remove('hidden');
    input.focus();
    setTimeout(() => errorEl.classList.add('hidden'), 3000);
    return;
  }

  errorEl.classList.add('hidden');

  const response = await chrome.runtime.sendMessage({ type: 'START_SESSION', sessionType: type, reason });
  if (response?.ok) {
    currentSession = response.session;
    input.value = '';
    renderSession();
    startSessionTimer();

    // Notify all YouTube tabs
    const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'SESSION_STARTED', session: currentSession }).catch(() => {});
    }
  }
}

async function endSession() {
  const response = await chrome.runtime.sendMessage({ type: 'END_SESSION' });
  if (response?.ok) {
    currentSession = { active: false };
    stopSessionTimer();
    renderSession();

    const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'SESSION_ENDED' }).catch(() => {});
    }
  }
}

// ─── Watch Time ───────────────────────────────────────────────────────────────

function updateDateDisplay() {
  const now = new Date();
  $('today-date').textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderWatchTimeFromStorage(watchTimeData) {
  const today = getTodayKey();
  const data = (watchTimeData || {})[today] || { total: 0, study: 0, entertainment: 0 };
  renderWatchTime(data);
}

function renderWatchTime(data) {
  $('wt-total').textContent = formatSeconds(data.total || 0);
  $('wt-study').textContent  = formatSeconds(data.study || 0);
  $('wt-ent').textContent    = formatSeconds(data.entertainment || 0);

  const goalSecs = (settings.dailyGoalMinutes || 120) * 60;
  const pct = Math.min(100, Math.round(((data.study || 0) / goalSecs) * 100));
  $('goal-progress').style.width = pct + '%';
  $('goal-value').textContent = `${formatSeconds(data.study || 0)} / ${settings.dailyGoalMinutes || 120}m`;
}

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ─── Toggles ──────────────────────────────────────────────────────────────────

function renderToggles() {
  $('toggle-shorts').checked          = !!settings.hideShorts;
  $('toggle-recommendations').checked = !!settings.hideRecommendations;
  $('toggle-comments').checked        = !!settings.hideComments;
}

async function saveSetting(key, value) {
  settings[key] = value;
  await setStorage({ settings });

  // Tell all YouTube tabs to update
  const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings }).catch(() => {});
  }
}

// ─── Study List ───────────────────────────────────────────────────────────────

function renderStudyList() {
  const container = $('study-list');
  $('study-list-count').textContent = studyList.length;

  if (studyList.length === 0) {
    container.innerHTML = '<p class="empty-state">No videos yet. Add videos to start your study list.</p>';
    return;
  }

  container.innerHTML = studyList.map((item, i) => `
    <div class="study-item ${item.completed ? 'completed' : ''}" data-index="${i}">
      ${item.videoId
        ? `<img class="study-thumb" src="${thumbnailUrl(item.videoId)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="study-thumb-placeholder" style="display:none">▶️</div>`
        : `<div class="study-thumb-placeholder">▶️</div>`
      }
      <div class="study-info">
        <span class="study-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title || 'Untitled Video')}</span>
        <span class="study-url">${escapeHtml(item.videoId || '')}</span>
        ${item.notes ? `<span class="study-notes">${escapeHtml(item.notes)}</span>` : ''}
      </div>
      <div class="study-actions">
        <button class="action-btn done" data-index="${i}" title="${item.completed ? 'Mark incomplete' : 'Mark complete'}">
          ${item.completed ? '↩' : '✓'}
        </button>
        <button class="action-btn remove" data-index="${i}" title="Remove">✕</button>
      </div>
    </div>
  `).join('');

  // Click on item = open video
  container.querySelectorAll('.study-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.study-actions')) return;
      const idx = parseInt(el.dataset.index);
      const item = studyList[idx];
      if (item?.videoId) {
        chrome.runtime.sendMessage({ type: 'OPEN_VIDEO', videoId: item.videoId });
      }
    });
  });

  // Toggle complete
  container.querySelectorAll('.action-btn.done').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      studyList[idx].completed = !studyList[idx].completed;
      await setStorage({ studyList });
      renderStudyList();
    });
  });

  // Remove
  container.querySelectorAll('.action-btn.remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      studyList.splice(idx, 1);
      await setStorage({ studyList });
      renderStudyList();
    });
  });
}

async function addCurrentVideo() {
  if (!currentTabInfo.videoId) {
    alert('No YouTube video detected on the current tab.\nNavigate to a YouTube video first.');
    return;
  }

  const exists = studyList.find(v => v.videoId === currentTabInfo.videoId);
  if (exists) {
    alert('This video is already in your study list.');
    return;
  }

  const item = {
    id: Date.now().toString(),
    videoId: currentTabInfo.videoId,
    title: currentTabInfo.title || 'YouTube Video',
    url: currentTabInfo.url,
    thumbnail: thumbnailUrl(currentTabInfo.videoId),
    completed: false,
    notes: '',
    addedAt: Date.now(),
  };

  studyList.unshift(item);
  await setStorage({ studyList });
  renderStudyList();
}

async function addVideoByUrl(url) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    alert('Could not extract a video ID from that URL.\nTry a standard youtube.com/watch?v=... URL.');
    return false;
  }

  const exists = studyList.find(v => v.videoId === videoId);
  if (exists) {
    alert('This video is already in your study list.');
    return false;
  }

  const item = {
    id: Date.now().toString(),
    videoId,
    title: `YouTube Video (${videoId})`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: thumbnailUrl(videoId),
    completed: false,
    notes: '',
    addedAt: Date.now(),
  };

  studyList.unshift(item);
  await setStorage({ studyList });
  renderStudyList();
  return true;
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function updateNoteHint() {
  const hint = $('note-hint');
  const input = $('note-input');
  const saveBtn = $('btn-save-note');

  if (currentTabInfo.videoId) {
    hint.classList.add('hidden');
    input.placeholder = `Note for ${currentTabInfo.title || 'this video'}…`;
    input.disabled = false;
    saveBtn.disabled = false;
  } else {
    hint.classList.remove('hidden');
    input.placeholder = 'Add a note for this moment…';
    input.disabled = true;
    saveBtn.disabled = true;
  }
}

function renderNotes() {
  const container = $('notes-list');
  $('notes-count').textContent = notes.length;

  if (notes.length === 0) {
    container.innerHTML = '<p class="empty-state">No notes yet.</p>';
    return;
  }

  // Show newest first
  const sorted = [...notes].reverse();

  container.innerHTML = sorted.map((note, i) => `
    <div class="note-item" data-noteid="${note.id}" title="Click to jump to ${note.formattedTimestamp}">
      <span class="note-timestamp">${escapeHtml(note.formattedTimestamp || '00:00')}</span>
      <div class="note-body">
        <span class="note-video-title">${escapeHtml(note.videoTitle || 'Unknown video')}</span>
        <span class="note-text">${escapeHtml(note.text)}</span>
      </div>
      <button class="note-remove" data-noteid="${note.id}" title="Delete note">✕</button>
    </div>
  `).join('');

  // Click note = seek to timestamp
  container.querySelectorAll('.note-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('note-remove')) return;
      const noteId = el.dataset.noteid;
      const note = notes.find(n => n.id === noteId);
      if (!note) return;

      chrome.runtime.sendMessage({
        type: 'SEEK_VIDEO',
        tabId: currentTabInfo.tabId,
        videoId: note.videoId,
        timestamp: note.timestamp,
      });
    });
  });

  // Remove note
  container.querySelectorAll('.note-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const noteId = btn.dataset.noteid;
      notes = notes.filter(n => n.id !== noteId);
      await setStorage({ notes });
      renderNotes();
    });
  });
}

async function saveNote() {
  const input = $('note-input');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }

  if (!currentTabInfo.videoId) {
    alert('Navigate to a YouTube video first.');
    return;
  }

  // Get current timestamp from the active YouTube tab
  let timestamp = 0;
  try {
    const res = await new Promise(resolve => {
      chrome.tabs.sendMessage(currentTabInfo.tabId, { type: 'GET_CURRENT_VIDEO_INFO' }, resolve);
    });
    if (res) timestamp = res.timestamp || 0;
  } catch (e) {}

  const note = {
    id: Date.now().toString(),
    videoId: currentTabInfo.videoId,
    videoTitle: currentTabInfo.title || 'YouTube Video',
    timestamp,
    formattedTimestamp: formatTimestamp(timestamp),
    text,
    createdAt: Date.now(),
  };

  notes.push(note);
  await setStorage({ notes });
  input.value = '';
  renderNotes();
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Options / dashboard
  $('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  $('btn-open-dashboard').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Session gate (inline)
  $('gate-study-btn').addEventListener('click', () => startSession('study'));
  $('gate-fun-btn').addEventListener('click', () => startSession('entertainment'));
  $('gate-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startSession('study');
  });

  // Session: no active – start session button
  $('btn-start-session').addEventListener('click', () => {
    $('session-no-active').classList.add('hidden');
    $('inline-gate').classList.remove('hidden');
    $('gate-input').focus();
  });

  $('btn-end-session').addEventListener('click', endSession);

  // Toggles
  $('toggle-shorts').addEventListener('change', (e) => saveSetting('hideShorts', e.target.checked));
  $('toggle-recommendations').addEventListener('change', (e) => saveSetting('hideRecommendations', e.target.checked));
  $('toggle-comments').addEventListener('change', (e) => saveSetting('hideComments', e.target.checked));

  // Study list
  $('btn-add-current').addEventListener('click', addCurrentVideo);

  $('btn-add-url').addEventListener('click', () => {
    $('add-url-row').classList.toggle('hidden');
    if (!$('add-url-row').classList.contains('hidden')) {
      $('url-input').focus();
    }
  });

  $('btn-url-cancel').addEventListener('click', () => {
    $('add-url-row').classList.add('hidden');
    $('url-input').value = '';
  });

  $('btn-url-submit').addEventListener('click', async () => {
    const url = $('url-input').value.trim();
    if (!url) return;
    const ok = await addVideoByUrl(url);
    if (ok) {
      $('add-url-row').classList.add('hidden');
      $('url-input').value = '';
    }
  });

  $('url-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const url = $('url-input').value.trim();
      if (!url) return;
      const ok = await addVideoByUrl(url);
      if (ok) {
        $('add-url-row').classList.add('hidden');
        $('url-input').value = '';
      }
    }
  });

  // Notes
  $('btn-save-note').addEventListener('click', saveNote);
  $('note-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveNote();
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
