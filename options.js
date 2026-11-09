/**
 * YouTube Focus Board – options.js
 * Full dashboard: overview, study list, notes, session history, settings.
 */

'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  return formatSeconds(Math.round(ms / 1000));
}

function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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

let studyList = [];
let notes = [];
let sessionHistory = [];
let settings = { hideShorts: true, hideRecommendations: false, hideComments: false, dailyGoalMinutes: 120 };
let currentSession = null;
let watchTimeData = {};
let sessionTimerInterval = null;

// ─── Tab Navigation ───────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
    });
  });
}

// ─── Load All Data ────────────────────────────────────────────────────────────

async function loadAll() {
  const data = await getStorage(['settings', 'focusSession', 'studyList', 'notes', 'sessionHistory', 'watchTimeData']);

  if (data.settings) settings = { ...settings, ...data.settings };
  studyList = data.studyList || [];
  notes = data.notes || [];
  sessionHistory = data.sessionHistory || [];
  currentSession = data.focusSession || null;
  watchTimeData = data.watchTimeData || {};

  // Check session expiry
  if (currentSession?.expiresAt && Date.now() > currentSession.expiresAt) {
    await chrome.runtime.sendMessage({ type: 'END_SESSION' });
    currentSession = { active: false };
  }

  renderOverview();
  renderStudyList('');
  renderNotes('');
  renderHistory();
  renderSettings();
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function renderOverview() {
  renderSessionOverview();
  renderWatchTimeOverview();
  renderWeeklyChart();
}

function renderSessionOverview() {
  const active = currentSession?.active;
  $('ov-no-session').classList.toggle('hidden', !!active);
  $('ov-active-session').classList.toggle('hidden', !active);

  if (active) {
    const badge = $('ov-session-badge');
    badge.textContent = currentSession.type === 'study' ? '📚 Study Session' : '🎬 Entertainment';
    badge.className = 'ov-session-badge' + (currentSession.type === 'entertainment' ? ' entertainment' : '');
    $('ov-session-reason').textContent = currentSession.reason || '';
    $('ov-session-started').textContent = `Started ${formatDateTime(currentSession.startedAt)}`;

    if (currentSession.type === 'entertainment' && currentSession.expiresAt) {
      $('ov-session-timer').classList.remove('hidden');
      updateOverviewTimer();
      if (sessionTimerInterval) clearInterval(sessionTimerInterval);
      sessionTimerInterval = setInterval(updateOverviewTimer, 1000);
    }
  }
}

function updateOverviewTimer() {
  if (!currentSession?.expiresAt) return;
  const remaining = Math.max(0, currentSession.expiresAt - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  $('ov-timer-value').textContent = `${mins}:${String(secs).padStart(2, '0')}`;
  if (remaining === 0) {
    clearInterval(sessionTimerInterval);
    renderSessionOverview();
  }
}

function renderWatchTimeOverview() {
  const today = getTodayKey();
  const td = watchTimeData[today] || { total: 0, study: 0, entertainment: 0 };

  $('ov-wt-total').textContent = formatSeconds(td.total);
  $('ov-wt-study').textContent  = formatSeconds(td.study);
  $('ov-wt-ent').textContent    = formatSeconds(td.entertainment);

  const goalSecs = (settings.dailyGoalMinutes || 120) * 60;
  const pct = Math.min(100, Math.round(((td.study || 0) / goalSecs) * 100));
  $('ov-goal-bar').style.width = pct + '%';
  $('ov-goal-label').textContent = `${formatSeconds(td.study)} / ${settings.dailyGoalMinutes || 120} min`;
}

function renderWeeklyChart() {
  const container = $('weekly-chart');
  const days = [];
  const now = new Date();

  // Build last 7 days
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = d.toLocaleDateString(undefined, { weekday: 'short' });
    const data = watchTimeData[key] || { study: 0, entertainment: 0 };
    days.push({ label, key, study: data.study, entertainment: data.entertainment });
  }

  // Find max value for scaling
  const maxVal = Math.max(...days.map(d => d.study + d.entertainment), 1);

  const bars = days.map(d => {
    const studyH = Math.round((d.study / maxVal) * 100);
    const entH = Math.round((d.entertainment / maxVal) * 100);
    const isToday = d.key === getTodayKey();
    return `
      <div class="chart-bar-group">
        <div class="chart-bar-wrap">
          ${entH > 0 ? `<div class="chart-bar entertainment" style="height:${entH}%" title="Entertainment: ${formatSeconds(d.entertainment)}"></div>` : ''}
          ${studyH > 0 ? `<div class="chart-bar study" style="height:${studyH}%" title="Study: ${formatSeconds(d.study)}"></div>` : '<div style="height:3px;background:transparent"></div>'}
        </div>
        <div class="chart-day" style="${isToday ? 'color:var(--accent2);font-weight:700' : ''}">${d.label}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex:1;width:100%">${bars}</div>
  `;

  // Legend
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  legend.innerHTML = `
    <span><span class="legend-dot" style="background:var(--accent)"></span>Study</span>
    <span><span class="legend-dot" style="background:var(--orange)"></span>Entertainment</span>
  `;
  container.after(legend);
}

// ─── Study List ───────────────────────────────────────────────────────────────

function renderStudyList(filter) {
  const container = $('sl-container');
  let list = studyList;

  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter(v => (v.title || '').toLowerCase().includes(q));
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="empty-state">No videos in your study list.</p>';
    return;
  }

  const html = list.map((item, i) => `
    <div class="sl-item ${item.completed ? 'completed' : ''}" data-videoid="${escapeHtml(item.videoId || '')}">
      ${item.videoId
        ? `<img class="sl-thumb" src="${thumbnailUrl(item.videoId)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
        : `<div class="sl-thumb-placeholder">▶️</div>`}
      <div class="sl-info">
        <span class="sl-title">${escapeHtml(item.title || 'Untitled Video')}</span>
        <span class="sl-meta">Added ${formatDateShort(item.addedAt)} · ${item.videoId || ''}</span>
        ${item.notes ? `<span class="sl-notes-text">${escapeHtml(item.notes)}</span>` : ''}
      </div>
      <div class="sl-actions">
        <button class="btn btn-ghost btn-sm sl-btn-open" data-videoid="${escapeHtml(item.videoId || '')}">▶ Open</button>
        <button class="btn btn-ghost btn-sm sl-btn-toggle" data-idx="${i}">${item.completed ? '↩ Undo' : '✓ Done'}</button>
        <button class="btn btn-danger btn-sm sl-btn-del" data-idx="${i}">✕</button>
      </div>
    </div>
  `).join('');

  container.innerHTML = `<div class="sl-list">${html}</div>`;

  container.querySelectorAll('.sl-btn-open').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const videoId = btn.dataset.videoid;
      if (videoId) chrome.runtime.sendMessage({ type: 'OPEN_VIDEO', videoId });
    });
  });

  container.querySelectorAll('.sl-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.sl-actions')) return;
      const videoId = el.dataset.videoid;
      if (videoId) chrome.runtime.sendMessage({ type: 'OPEN_VIDEO', videoId });
    });
  });

  container.querySelectorAll('.sl-btn-toggle').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      studyList[idx].completed = !studyList[idx].completed;
      await setStorage({ studyList });
      renderStudyList($('sl-search').value || '');
    });
  });

  container.querySelectorAll('.sl-btn-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      studyList.splice(idx, 1);
      await setStorage({ studyList });
      renderStudyList($('sl-search').value || '');
    });
  });
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function renderNotes(filter) {
  const container = $('notes-container');
  let list = [...notes].reverse();

  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter(n => (n.text || '').toLowerCase().includes(q) || (n.videoTitle || '').toLowerCase().includes(q));
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="empty-state">No timestamp notes saved yet.</p>';
    return;
  }

  const html = list.map(note => `
    <div class="note-card" data-noteid="${note.id}">
      <span class="note-ts-badge">${escapeHtml(note.formattedTimestamp || '00:00')}</span>
      <div class="note-card-body">
        <span class="note-card-video">${escapeHtml(note.videoTitle || 'Unknown video')}</span>
        <span class="note-card-text">${escapeHtml(note.text)}</span>
        <span class="note-card-date">${formatDateTime(note.createdAt)}</span>
      </div>
      <button class="btn btn-danger btn-sm note-del-btn" data-noteid="${note.id}">✕</button>
    </div>
  `).join('');

  container.innerHTML = `<div class="notes-grid">${html}</div>`;

  container.querySelectorAll('.note-card').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('note-del-btn')) return;
      const noteId = el.dataset.noteid;
      const note = notes.find(n => n.id === noteId);
      if (!note) return;
      chrome.runtime.sendMessage({
        type: 'SEEK_VIDEO',
        tabId: null,
        videoId: note.videoId,
        timestamp: note.timestamp,
      });
    });
  });

  container.querySelectorAll('.note-del-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const noteId = btn.dataset.noteid;
      notes = notes.filter(n => n.id !== noteId);
      await setStorage({ notes });
      renderNotes($('notes-search').value || '');
    });
  });
}

// ─── History ──────────────────────────────────────────────────────────────────

function renderHistory() {
  const container = $('history-container');
  const list = [...sessionHistory].reverse();

  if (list.length === 0) {
    container.innerHTML = '<p class="empty-state">No session history yet.</p>';
    return;
  }

  const html = list.map(item => {
    const duration = item.endedAt ? item.endedAt - item.startedAt : null;
    return `
      <div class="history-item">
        <span class="history-type-badge ${item.type === 'study' ? 'study' : 'entertainment'}">
          ${item.type === 'study' ? '📚 Study' : '🎬 Entertainment'}
        </span>
        <span class="history-reason">${escapeHtml(item.reason || '')}</span>
        <span class="history-duration">${duration ? formatDuration(duration) : 'Active'}</span>
        <span class="history-date">${formatDateShort(item.startedAt)}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="history-list">${html}</div>`;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function renderSettings() {
  $('s-hide-shorts').checked   = !!settings.hideShorts;
  $('s-hide-recs').checked     = !!settings.hideRecommendations;
  $('s-hide-comments').checked = !!settings.hideComments;
  $('s-daily-goal').value      = settings.dailyGoalMinutes || 120;
}

async function saveSettings() {
  await setStorage({ settings });
  const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings }).catch(() => {});
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

async function exportData() {
  const data = await getStorage(['settings', 'focusSession', 'studyList', 'notes', 'sessionHistory', 'watchTimeData']);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `youtube-focus-board-export-${getTodayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Study list search
  $('sl-search').addEventListener('input', (e) => renderStudyList(e.target.value));
  $('sl-clear-completed').addEventListener('click', async () => {
    studyList = studyList.filter(v => !v.completed);
    await setStorage({ studyList });
    renderStudyList('');
  });

  // Notes search + clear
  $('notes-search').addEventListener('input', (e) => renderNotes(e.target.value));
  $('notes-clear-all').addEventListener('click', async () => {
    if (confirm('Delete all notes? This cannot be undone.')) {
      notes = [];
      await setStorage({ notes });
      renderNotes('');
    }
  });

  // Settings
  $('s-hide-shorts').addEventListener('change', async (e) => {
    settings.hideShorts = e.target.checked;
    await saveSettings();
  });
  $('s-hide-recs').addEventListener('change', async (e) => {
    settings.hideRecommendations = e.target.checked;
    await saveSettings();
  });
  $('s-hide-comments').addEventListener('change', async (e) => {
    settings.hideComments = e.target.checked;
    await saveSettings();
  });
  $('s-daily-goal').addEventListener('change', async (e) => {
    const val = parseInt(e.target.value);
    if (val > 0 && val <= 480) {
      settings.dailyGoalMinutes = val;
      await saveSettings();
      renderWatchTimeOverview();
    }
  });

  // Export / Clear
  $('s-export').addEventListener('click', exportData);
  $('s-clear-wt').addEventListener('click', async () => {
    if (confirm('Clear all watch time history? This cannot be undone.')) {
      await setStorage({ watchTimeData: {} });
      watchTimeData = {};
      renderWatchTimeOverview();
    }
  });
  $('s-reset-all').addEventListener('click', async () => {
    if (confirm('Reset ALL data (study list, notes, history)? This cannot be undone.')) {
      studyList = []; notes = []; sessionHistory = [];
      await setStorage({ studyList: [], notes: [], sessionHistory: [], watchTimeData: {} });
      renderStudyList('');
      renderNotes('');
      renderHistory();
    }
  });
}

// ─── Storage Change Listener ──────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.watchTimeData) {
    watchTimeData = changes.watchTimeData.newValue || {};
    renderWatchTimeOverview();
    // Rebuild chart if on overview
    const existing = document.querySelector('.chart-legend');
    if (existing) existing.remove();
    renderWeeklyChart();
  }
  if (changes.focusSession) {
    currentSession = changes.focusSession.newValue || null;
    renderSessionOverview();
  }
  if (changes.studyList) {
    studyList = changes.studyList.newValue || [];
    renderStudyList($('sl-search').value || '');
  }
  if (changes.notes) {
    notes = changes.notes.newValue || [];
    renderNotes($('notes-search').value || '');
  }
  if (changes.sessionHistory) {
    sessionHistory = changes.sessionHistory.newValue || [];
    renderHistory();
  }
  if (changes.settings) {
    settings = { ...settings, ...changes.settings.newValue };
    renderSettings();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  initTabs();
  await loadAll();
  bindEvents();
}

document.addEventListener('DOMContentLoaded', init);
