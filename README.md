# 🎯 YouTube Focus Board

A fully local Chrome Extension that transforms YouTube into a distraction-free learning environment.

No API keys · No backend · No frameworks · All data stored locally

---

## Features

| Feature | Description |
|---|---|
| 🛡️ Distraction Filters | Hide Shorts, Recommendations, and Comments with toggles |
| 📚 Study List | Save and organise videos for focused learning |
| 📝 Timestamp Notes | Link notes to exact moments in any video |
| ⏳ Watch-Time Tracking | Separate study vs entertainment time with a daily goal |
| 🎯 Focus Gate | Intent check before accessing YouTube |

---

## Installation

### Step 1 – Download the Extension

Place the `youtube-focus-board/` folder somewhere accessible on your computer (e.g. Desktop).

### Step 2 – Generate Icons (first time only)

If the icons folder is empty or missing, open a terminal in the project folder and run:

```bash
node generate-icons.js
```

This creates `icons/icon16.png`, `icon32.png`, `icon48.png`, and `icon128.png`.

### Step 3 – Load in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `youtube-focus-board/` folder
5. The extension icon (🎯) will appear in your toolbar

> Tip: Pin the extension by clicking the puzzle piece icon in the toolbar and pinning YouTube Focus Board.

---

## How to Use

### Focus Gate

Every time you open YouTube without an active session, a full-screen gate appears asking:

> **"Why are you here?"**

**Study Session** – Enter your study topic (e.g. "Revising thermodynamics") and click **Start Study Session**. YouTube unlocks immediately. Your session stays active until you end it.

**Entertainment** – Enter a reason and click **Continue for Fun**. You get 60 minutes of access. A countdown banner appears at the top of YouTube. When time expires, the gate reappears.

The gate never interrupts navigation *within* an active session.

---

### Extension Popup

Click the 🎯 icon in the Chrome toolbar to open the popup.

**Session Panel** – Shows your current session type, reason, and entertainment countdown. End the session with the red button.

**Watch Time** – Today's total, study, and entertainment minutes. The progress bar tracks against your daily goal.

**Distraction Filters** – Three toggles to instantly hide/show Shorts, Recommendations, and Comments.

**Study List** – Click **+ Add Current Video** to save the YouTube video you're currently watching. Click **+ Add by URL** to paste any YouTube URL. Click any saved video to open it.

**Timestamp Notes** – While watching a video, type a note and click **Save Note**. The current playback timestamp is captured automatically. Click any saved note to jump back to that exact moment.

---

### Dashboard

Click **Open Full Dashboard →** at the bottom of the popup (or the ⚙️ icon) to open the full dashboard.

#### Overview
- Current session status and entertainment countdown
- Today's watch time (Total, Study, Entertainment)
- Daily goal progress bar
- 7-day bar chart (Study vs Entertainment)

#### Study List
- Full list of saved videos with thumbnails
- Search videos by title
- Mark as complete / undo
- Remove individual videos
- Clear all completed videos

#### Notes
- All timestamp notes sorted by newest first
- Search across all notes
- Click any note to open the video at that timestamp
- Delete individual notes or clear all

#### Session History
- Every past study and entertainment session
- Duration and reason recorded

#### Settings
- Toggle Shorts / Recommendations / Comments
- Set daily study goal in minutes
- Export all data as JSON
- Clear watch time history
- Reset all data

---

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `storage` | Persists all user data (study list, notes, sessions, settings) locally |
| `activeTab` | Reads the current tab URL to identify the active YouTube video |
| `scripting` | Injects the content script into YouTube pages |
| `tabs` | Detects tab switching to pause watch-time tracking |
| `alarms` | Ticks watch time every 5 seconds and checks session expiry every minute |
| `*://www.youtube.com/*` | Host permission to inject the content script and communicate with YouTube tabs |

---

## Project Structure

```
youtube-focus-board/
├── manifest.json        Chrome Extension Manifest V3 configuration
├── background.js        Service worker: session management, watch-time ticks, alarms
├── content.js           Injected into YouTube: focus gate, distraction hiding, tracking
├── popup.html/css/js    Extension popup UI
├── options.html/css/js  Full dashboard page
├── generate-icons.js    Script to generate PNG icons (run once with Node.js)
├── README.md            This file
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## SPA Navigation Support

YouTube is a Single Page Application — it changes content without full page reloads. The extension handles this using:

- **`yt-navigate-finish` event** – fired by YouTube on every internal navigation
- **`yt-page-data-updated` event** – fired when new page data loads
- **`MutationObserver`** – watches DOM changes and reapplies distraction filters
- **URL polling** – fallback 1-second interval to catch any missed navigations
- **Debounced reapply** – all reapplications are debounced 300ms to prevent excessive CPU usage

---

## Troubleshooting

**The focus gate doesn't appear**
- Make sure the extension is enabled in `chrome://extensions`
- Reload the YouTube tab after installing the extension

**Shorts / Recommendations still visible**
- Toggle the setting off and on again in the popup
- YouTube occasionally updates its CSS selectors — open an issue if this persists

**Watch time not tracking**
- Ensure a session is active (shown in the popup)
- The tab must be the active tab in a focused Chrome window
- The video must be playing (not paused)

**Notes don't seek correctly**
- The note was created on a different video — clicking will open that video at the saved timestamp
- If the video is already open in another tab, it will navigate that tab to the correct time

---

## Data & Privacy

All data is stored exclusively in `chrome.storage.local` on your own device. Nothing is sent to any server. No analytics, no tracking, no external requests.

---

## License

MIT — free to use and modify.
