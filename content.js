/**
 * YouTube Focus Board – content.js
 * Injected into every youtube.com page.
 * Responsibilities:
 *  1. Focus Gate overlay
 *  2. Distraction hiding (Shorts, Recommendations, Comments)
 *  3. Watch-time tracking (play/pause/visibility detection)
 *  4. SPA navigation support via MutationObserver + URL polling
 *  5. Seek-to-timestamp on demand
 */

(function () {
  'use strict';

  // ─── Guard: run once per page context ──────────────────────────────────────
  if (window.__yfbInjected) return;
  window.__yfbInjected = true;

  // ─── State ─────────────────────────────────────────────────────────────────
  let settings = { hideShorts: true, hideRecommendations: false, hideComments: false };
  let currentSession = null;
  let lastUrl = location.href;
  let gateVisible = false;
  let isVideoPlaying = false;
  let isWindowFocused = true;
  let isTabActive = true;
  let trackingActive = false;
  let mutationObserver = null;
  let debounceTimer = null;
  let styleEl = null;
  let gateEl = null;

  // ─── CSS Selectors ─────────────────────────────────────────────────────────

  const SELECTORS = {
    shorts: [
      // Homepage shelf
      'ytd-rich-shelf-renderer[is-shorts]',
      'ytd-reel-shelf-renderer',
      // Sidebar nav
      'ytd-guide-entry-renderer a[title="Shorts"]',
      'ytd-mini-guide-entry-renderer a[title="Shorts"]',
      '#sections ytd-guide-section-renderer ytd-guide-entry-renderer:has(a[title="Shorts"])',
      // Search results
      'ytd-reel-item-renderer',
      'ytd-shorts-lockup-view-model',
      // Shelf titles containing "Shorts"
      'ytd-rich-shelf-renderer:has(span.yt-formatted-string:contains("Shorts"))',
    ],
    recommendations: [
      // Homepage feed (non-subscriptions)
      '#contents ytd-rich-item-renderer',
      // Watch-page sidebar
      '#secondary ytd-compact-video-renderer',
      '#secondary ytd-watch-next-secondary-results-renderer',
      // End screen items
      '.ytp-endscreen-element',
      // Related shelf
      'ytd-shelf-renderer',
    ],
    comments: [
      '#comments',
      'ytd-comments',
    ],
  };

  // Selectors as a flat CSS string per category
  function buildCSSRules(category) {
    switch (category) {
      case 'shorts':
        return `
          ytd-rich-shelf-renderer[is-shorts],
          ytd-reel-shelf-renderer,
          ytd-reel-item-renderer,
          ytd-shorts-lockup-view-model,
          ytd-guide-entry-renderer:has(a[title="Shorts"]),
          ytd-mini-guide-entry-renderer:has(a[title="Shorts"]),
          a[title="Shorts"],
          a[href="/shorts"],
          ytd-rich-grid-row + ytd-rich-grid-row ytd-rich-shelf-renderer[is-shorts]
          { display: none !important; }
        `;
      case 'recommendations':
        return `
          #secondary ytd-compact-video-renderer,
          #secondary #related,
          #secondary ytd-watch-next-secondary-results-renderer,
          ytd-browse[page-subtype="home"] #contents ytd-rich-item-renderer,
          ytd-browse[page-subtype="home"] #contents ytd-rich-section-renderer,
          .ytp-endscreen-element,
          .ytp-endscreen-content,
          ytd-shelf-renderer
          { display: none !important; }
        `;
      case 'comments':
        return `
          #comments,
          ytd-comments,
          ytd-comment-thread-renderer
          { display: none !important; }
        `;
      default:
        return '';
    }
  }

  // ─── Style Injection ────────────────────────────────────────────────────────

  function injectStyles() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'yfb-distraction-styles';
      document.head.appendChild(styleEl);
    }

    let css = `
      /* Base YouTube Focus Board styles */
      #yfb-gate {
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 50%, #16213e 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #yfb-gate-card {
        background: #1e1e2e;
        border: 1px solid #2d2d44;
        border-radius: 24px;
        padding: 48px 40px;
        max-width: 480px;
        width: 90%;
        text-align: center;
        box-shadow: 0 24px 64px rgba(0,0,0,0.5);
        animation: yfbSlideUp 0.4s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes yfbSlideUp {
        from { opacity: 0; transform: translateY(32px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0)    scale(1); }
      }
      #yfb-gate-logo {
        width: 56px;
        height: 56px;
        background: linear-gradient(135deg, #6c63ff, #a78bfa);
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 24px;
        font-size: 28px;
      }
      #yfb-gate-title {
        font-size: 28px;
        font-weight: 700;
        color: #e8e8f0;
        margin: 0 0 8px;
        letter-spacing: -0.5px;
      }
      #yfb-gate-subtitle {
        font-size: 15px;
        color: #8888aa;
        margin: 0 0 32px;
      }
      #yfb-gate-input {
        width: 100%;
        box-sizing: border-box;
        background: #13131f;
        border: 2px solid #2d2d44;
        border-radius: 12px;
        color: #e8e8f0;
        font-size: 16px;
        padding: 14px 18px;
        outline: none;
        transition: border-color 0.2s;
        margin-bottom: 16px;
      }
      #yfb-gate-input:focus { border-color: #6c63ff; }
      #yfb-gate-input::placeholder { color: #55556a; }
      #yfb-gate-buttons { display: flex; flex-direction: column; gap: 12px; }
      .yfb-btn {
        width: 100%;
        padding: 14px;
        border: none;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.1s;
        letter-spacing: 0.2px;
      }
      .yfb-btn:active { transform: scale(0.98); }
      .yfb-btn-primary {
        background: linear-gradient(135deg, #6c63ff, #a78bfa);
        color: white;
      }
      .yfb-btn-secondary {
        background: #2a2a3e;
        color: #a0a0c0;
        border: 1px solid #3a3a54;
      }
      .yfb-btn:hover { opacity: 0.9; }
      #yfb-gate-timer {
        margin-top: 20px;
        font-size: 13px;
        color: #6c63ff;
        font-weight: 600;
        display: none;
      }
      #yfb-gate-error {
        color: #ff6b6b;
        font-size: 13px;
        margin-top: 8px;
        display: none;
        text-align: left;
      }
      #yfb-session-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 99998;
        background: linear-gradient(90deg, #1a1a2e, #2d2d44);
        border-bottom: 1px solid #3d3d58;
        padding: 8px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        color: #a0a0c0;
        pointer-events: none;
      }
      #yfb-session-banner span { font-weight: 600; color: #a78bfa; }
      #yfb-session-banner .yfb-timer { color: #ff9f43; }
    `;

    if (settings.hideShorts) css += buildCSSRules('shorts');
    if (settings.hideRecommendations) css += buildCSSRules('recommendations');
    if (settings.hideComments) css += buildCSSRules('comments');

    styleEl.textContent = css;
  }

  // ─── Focus Gate ─────────────────────────────────────────────────────────────

  function showGate() {
    if (gateVisible) return;
    if (gateEl) gateEl.remove();
    gateVisible = true;

    gateEl = document.createElement('div');
    gateEl.id = 'yfb-gate';
    gateEl.innerHTML = `
      <div id="yfb-gate-card">
        <div id="yfb-gate-logo">🎯</div>
        <h1 id="yfb-gate-title">Why are you here?</h1>
        <p id="yfb-gate-subtitle">Be intentional about your YouTube time.</p>
        <input id="yfb-gate-input" type="text" placeholder="e.g. Revising thermodynamics…" maxlength="120" autocomplete="off" />
        <div id="yfb-gate-error">Please enter a reason before continuing.</div>
        <div id="yfb-gate-buttons">
          <button class="yfb-btn yfb-btn-primary" id="yfb-btn-study">📚 Start Study Session</button>
          <button class="yfb-btn yfb-btn-secondary" id="yfb-btn-fun">🎬 Continue for Fun (60 min)</button>
        </div>
        <div id="yfb-gate-timer"></div>
      </div>
    `;

    document.body.appendChild(gateEl);
    document.getElementById('yfb-gate-input').focus();

    document.getElementById('yfb-btn-study').addEventListener('click', () => handleGateSubmit('study'));
    document.getElementById('yfb-btn-fun').addEventListener('click', () => handleGateSubmit('entertainment'));
    document.getElementById('yfb-gate-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleGateSubmit('study');
    });
  }

  function hideGate() {
    gateVisible = false;
    if (gateEl) {
      gateEl.remove();
      gateEl = null;
    }
  }

  function handleGateSubmit(type) {
    const input = document.getElementById('yfb-gate-input');
    const reason = input ? input.value.trim() : '';
    const errorEl = document.getElementById('yfb-gate-error');

    if (!reason) {
      if (errorEl) {
        errorEl.style.display = 'block';
        errorEl.textContent = 'Please enter a reason before continuing.';
      }
      if (input) {
        input.style.borderColor = '#ff6b6b';
        input.focus();
        setTimeout(() => { input.style.borderColor = ''; }, 2000);
      }
      return;
    }

    chrome.runtime.sendMessage({ type: 'START_SESSION', sessionType: type, reason: reason }, (response) => {
      if (response && response.ok) {
        currentSession = response.session;
        hideGate();
        showSessionBanner();
      }
    });
  }

  // ─── Session Banner ─────────────────────────────────────────────────────────

  let bannerEl = null;
  let bannerTimerInterval = null;

  function showSessionBanner() {
    if (bannerEl) bannerEl.remove();
    if (!currentSession || !currentSession.active) return;

    bannerEl = document.createElement('div');
    bannerEl.id = 'yfb-session-banner';
    document.body.prepend(bannerEl);
    updateBanner();

    if (bannerTimerInterval) clearInterval(bannerTimerInterval);
    bannerTimerInterval = setInterval(updateBanner, 1000);
  }

  function updateBanner() {
    if (!bannerEl || !currentSession) return;

    const icon = currentSession.type === 'study' ? '📚' : '🎬';
    const label = currentSession.type === 'study' ? 'Study Session' : 'Entertainment';
    let timerHtml = '';

    if (currentSession.type === 'entertainment' && currentSession.expiresAt) {
      const remaining = Math.max(0, currentSession.expiresAt - Date.now());
      if (remaining === 0) {
        clearInterval(bannerTimerInterval);
        bannerEl.remove();
        bannerEl = null;
        showGate();
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      timerHtml = `<span class="yfb-timer">⏱ ${mins}:${String(secs).padStart(2, '0')} remaining</span>`;
    }

    bannerEl.innerHTML = `
      <div>${icon} <span>${label}</span> — ${escapeHtml(currentSession.reason || '')}</div>
      ${timerHtml}
    `;
  }

  function removeBanner() {
    if (bannerTimerInterval) clearInterval(bannerTimerInterval);
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  }

  // ─── Main Gate Check ────────────────────────────────────────────────────────

  async function checkGate() {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
      if (chrome.runtime.lastError) return;
      const session = response?.session;
      currentSession = session;

      if (session && session.active) {
        // Active session – check expiry
        if (session.expiresAt && Date.now() > session.expiresAt) {
          // Expired
          chrome.runtime.sendMessage({ type: 'END_SESSION' });
          currentSession = null;
          showGate();
        } else {
          hideGate();
          showSessionBanner();
        }
      } else {
        // No session – show gate
        showGate();
        removeBanner();
      }
    });
  }

  // ─── Watch-Time Tracking ────────────────────────────────────────────────────

  function getVideoPlayer() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function updateTracking() {
    const video = getVideoPlayer();
    const onWatchPage = location.pathname === '/watch';

    if (!onWatchPage || !video || !currentSession?.active) {
      if (trackingActive) {
        trackingActive = false;
        chrome.runtime.sendMessage({ type: 'STOP_TRACKING' }).catch(() => {});
      }
      return;
    }

    const shouldTrack = !video.paused && isWindowFocused && isTabActive;

    if (shouldTrack && !trackingActive) {
      trackingActive = true;
      chrome.runtime.sendMessage({ type: 'START_TRACKING' }).catch(() => {});
    } else if (!shouldTrack && trackingActive) {
      trackingActive = false;
      chrome.runtime.sendMessage({ type: 'STOP_TRACKING' }).catch(() => {});
    }
  }

  function attachVideoListeners() {
    const video = getVideoPlayer();
    if (!video || video.__yfbListened) return;
    video.__yfbListened = true;
    video.addEventListener('play', updateTracking);
    video.addEventListener('pause', updateTracking);
    video.addEventListener('ended', updateTracking);
  }

  // ─── URL Change Detection ───────────────────────────────────────────────────

  function onPageChange() {
    const url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;

    // Re-check gate and re-apply styles for new page
    debouncedApply();
    checkGate();
  }

  function debouncedApply() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyAll, 300);
  }

  function applyAll() {
    injectStyles();
    attachVideoListeners();
    updateTracking();
  }

  // ─── MutationObserver ───────────────────────────────────────────────────────

  function startObserver() {
    if (mutationObserver) return;

    mutationObserver = new MutationObserver((mutations) => {
      let significantChange = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0 || m.type === 'attributes') {
          significantChange = true;
          break;
        }
      }
      if (significantChange) {
        debouncedApply();
        onPageChange();
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  }

  // ─── YouTube SPA Navigation Events ─────────────────────────────────────────

  document.addEventListener('yt-navigate-start', () => {
    debouncedApply();
  });

  document.addEventListener('yt-navigate-finish', () => {
    onPageChange();
    checkGate();
  });

  document.addEventListener('yt-page-data-updated', () => {
    debouncedApply();
  });

  // Fallback: poll URL every second
  setInterval(onPageChange, 1000);

  // ─── Window / Visibility Focus ──────────────────────────────────────────────

  window.addEventListener('focus', () => {
    isWindowFocused = true;
    updateTracking();
  });

  window.addEventListener('blur', () => {
    isWindowFocused = false;
    updateTracking();
  });

  document.addEventListener('visibilitychange', () => {
    isTabActive = !document.hidden;
    updateTracking();
  });

  // ─── Message Listener (from background / popup) ─────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'SETTINGS_UPDATED':
        settings = { ...settings, ...msg.settings };
        injectStyles();
        sendResponse({ ok: true });
        break;

      case 'SESSION_EXPIRED':
        currentSession = null;
        removeBanner();
        showGate();
        sendResponse({ ok: true });
        break;

      case 'SESSION_STARTED':
        currentSession = msg.session;
        hideGate();
        showSessionBanner();
        sendResponse({ ok: true });
        break;

      case 'SESSION_ENDED':
        currentSession = null;
        removeBanner();
        showGate();
        sendResponse({ ok: true });
        break;

      case 'SEEK_TO': {
        const video = getVideoPlayer();
        if (video) {
          video.currentTime = msg.timestamp;
          video.play().catch(() => {});
        }
        sendResponse({ ok: true });
        break;
      }

      case 'GET_CURRENT_VIDEO_INFO': {
        const video = getVideoPlayer();
        const urlParams = new URLSearchParams(location.search);
        const videoId = urlParams.get('v');
        const timestamp = video ? Math.floor(video.currentTime) : 0;
        const title = document.title.replace(' - YouTube', '').trim();
        sendResponse({ videoId, timestamp, title, url: location.href });
        break;
      }
    }
  });

  // ─── Load Settings ──────────────────────────────────────────────────────────

  function loadSettings() {
    chrome.storage.local.get(['settings'], (data) => {
      if (data.settings) {
        settings = { ...settings, ...data.settings };
      }
      injectStyles();
    });
  }

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = { ...settings, ...changes.settings.newValue };
      injectStyles();
    }
    if (changes.focusSession) {
      const session = changes.focusSession.newValue;
      currentSession = session;
      if (session && session.active) {
        hideGate();
        showSessionBanner();
      } else if (!gateVisible) {
        removeBanner();
        // Small delay to avoid flickering during session transitions
        setTimeout(checkGate, 500);
      }
    }
  });

  // ─── Escape HTML helper ─────────────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Init ───────────────────────────────────────────────────────────────────

  function init() {
    loadSettings();
    checkGate();
    attachVideoListeners();
    startObserver();
    updateTracking();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
