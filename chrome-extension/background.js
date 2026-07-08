// =============================================================================
//  BROWSER HABIT TRACKER — Background Service Worker (MV3)
//
//  Architecture:
//    Tab events → endSession / startSession → chrome.storage.local (queue)
//    chrome.alarms (every 15 min) → flush() → POST Bridge API → PostgreSQL
//
//  Service workers are ephemeral. ALL state lives in chrome.storage.local.
// =============================================================================
console.log("BACKGROUND SCRIPT LOADED");
const CFG = {
  BRIDGE:    'http://localhost:3737/sessions',
  INTERVAL:  15,    // minutes between automatic flushes
  IDLE_SEC:  1800,   // 30 min of no mouse/keyboard = end session
  MIN_SEC:   10,     // discard sessions shorter than this (tab-switch noise)
  MAX_AGE_H: 8,     // stale open sessions older than this are discarded on startup
};

// Storage keys — must match popup.js
const K = {
  PENDING:   'pendingSessions',
  CURRENT:   'currentSession',
  LAST_SYNC: 'lastSync',
  LAST_CNT:  'lastSyncCount',
};

// ── Prevent concurrent flushes ──────────────────────────────────────────────
let flushing = false;

// ── Storage helpers ──────────────────────────────────────────────────────────

function load(keys) {
  return chrome.storage.local.get(Array.isArray(keys) ? keys : [keys]);
}

function save(obj) {
  return chrome.storage.local.set(obj);
}

// ── Utilities ────────────────────────────────────────────────────────────────

const uid   = () => crypto.randomUUID();
const now   = () => new Date().toISOString();
const nowMs = () => Date.now();

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isTrackable(url) {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/'))    return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  return 'Chromium';
}

const BROWSER = detectBrowser();

// ── Session lifecycle ────────────────────────────────────────────────────────

async function startSession(tabId, windowId, url, title) {
  if (!isTrackable(url)) return;

  const ts = now();

  await save({
    [K.CURRENT]: {
      id:               uid(),
      start_time:       ts,
      end_time:         null,
      duration_seconds: null,
      url,
      domain:           extractDomain(url),
      title:            title || '',
      tab_id:           tabId,
      window_id:        windowId,
      browser:          BROWSER,
      created_at:       ts,
    },
  });
}

async function endSession() {
  const data = await load([K.CURRENT, K.PENDING]);
  const session  = data[K.CURRENT];
  const pending  = data[K.PENDING] || [];

  if (!session) return;

  const durationSec = Math.floor((nowMs() - new Date(session.start_time).getTime()) / 1000);

  if (durationSec < CFG.MIN_SEC) {
    // Too short — discard without queuing
    await save({ [K.CURRENT]: null });
    return;
  }

  const completed = {
    ...session,
    end_time:         now(),
    duration_seconds: durationSec,
  };

  await save({
    [K.CURRENT]: null,
    [K.PENDING]: [...pending, completed],
  });
}

// ── Chrome event listeners ───────────────────────────────────────────────────

// User switched to a different tab
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await endSession();
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.incognito) {
      await startSession(tab.id, tab.windowId, tab.url, tab.title);
    }
  } catch { /* tab may have been closed already */ }
});

// URL changed in a tab (full navigation or SPA-style history push that triggers load)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || tab.incognito) return;

  const { [K.CURRENT]: current } = await load(K.CURRENT);
  if (current?.tab_id === tabId) {
    // URL changed in the tab we're actively tracking
    await endSession();
    await startSession(tab.id, tab.windowId, tab.url, tab.title);
  }
});

// User switched to a different app (Chrome lost focus) or back to Chrome
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await endSession();

  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // Chrome unfocused

  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab && !tab.incognito) {
      await startSession(tab.id, tab.windowId, tab.url, tab.title);
    }
  } catch {}
});

// Tab closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { [K.CURRENT]: current } = await load(K.CURRENT);
  if (current?.tab_id === tabId) await endSession();
});

// User went idle (no mouse/keyboard for IDLE_SEC seconds) or locked screen
chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'idle' || state === 'locked') {
    await endSession();
    return;
  }

  if (state === 'active') {
    // User is back — resume tracking whatever tab is active
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && !tab.incognito && isTrackable(tab.url)) {
        await startSession(tab.id, tab.windowId, tab.url, tab.title);
      }
    } catch {}
  }
});

// ── Flush to Bridge API ──────────────────────────────────────────────────────

async function flush() {
  if (flushing) return 0;
  flushing = true;

  try {
    const { [K.PENDING]: pending = [] } = await load(K.PENDING);
    if (!pending.length) {
      badge('idle');
      return 0;
    }

    badge('sync');

    const res = await fetch(CFG.BRIDGE, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessions: pending }),
    });

    if (res.ok) {
      const count = pending.length;
      await save({ [K.PENDING]: [], [K.LAST_SYNC]: now(), [K.LAST_CNT]: count });
      badge('ok');
      return count;
    }

    console.error('[tracker] Bridge returned', res.status);
    badge('err');
    return 0;

  } catch (err) {
    // Bridge API unreachable — sessions stay in queue, retry next alarm
    console.warn('[tracker] Bridge unreachable, sessions queued:', err.message);
    badge('err');
    return 0;
  } finally {
    flushing = false;
  }
}

// ── Badge (popup icon indicator) ────────────────────────────────────────────

const BADGES = {
  idle: { text: '',  color: [128, 128, 128, 255] },
  sync: { text: '↑', color: [55,  138, 221, 255] },
  ok:   { text: '✓', color: [29,  158, 117, 255] },
  err:  { text: '!', color: [216, 90,  48,  255] },
};

function badge(state) {
  const b = BADGES[state] || BADGES.idle;
  chrome.action.setBadgeText({ text: b.text });
  chrome.action.setBadgeBackgroundColor({ color: b.color });
}

// ── Alarms ───────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === 'flush') flush();
});

// ── Message handler (popup → background) ────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.action === 'flush') {
    flush().then(count => reply({ ok: true, count }));
    return true; // keep message channel open for async reply
  }
});

// ── Initialization ───────────────────────────────────────────────────────────

async function init() {
  chrome.idle.setDetectionInterval(CFG.IDLE_SEC);

  // Handle session left open by a previous (killed) service worker instance
  const { [K.CURRENT]: stale } = await load(K.CURRENT);
  if (stale) {
    const ageHours = (nowMs() - new Date(stale.start_time).getTime()) / 3_600_000;
    if (ageHours > CFG.MAX_AGE_H) {
      await save({ [K.CURRENT]: null }); // too old to be valid, discard
    } else {
      await endSession(); // recent enough — close it properly
    }
  }

  // Start tracking the currently active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && !tab.incognito && isTrackable(tab.url)) {
      await startSession(tab.id, tab.windowId, tab.url, tab.title);
    }
  } catch {}
}

chrome.runtime.onInstalled.addListener(async () => {
  // Clear and recreate the alarm (covers extension updates too)
  await chrome.alarms.clearAll();
  chrome.alarms.create('flush', { periodInMinutes: CFG.INTERVAL });

  await save({ [K.PENDING]: [], [K.CURRENT]: null });
  await init();
});

chrome.runtime.onStartup.addListener(async () => {
  // Ensure alarm survived (it should, but safety check)
  const existing = await chrome.alarms.get('flush');
  if (!existing) {
    chrome.alarms.create('flush', { periodInMinutes: CFG.INTERVAL });
  }
  await init();
});

console.log("Registering listeners");

chrome.tabs.onActivated.addListener((activeInfo) => {
    console.log("TAB ACTIVATED", activeInfo);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    console.log("TAB UPDATED", tabId, changeInfo.status, tab.url);
});
