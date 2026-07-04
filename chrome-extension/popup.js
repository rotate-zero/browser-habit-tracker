// =============================================================================
//  BROWSER HABIT TRACKER — Popup Script
//  Reads state from chrome.storage.local (no direct background calls needed).
//  Manual sync sends a message to the background service worker.
// =============================================================================

// Must match keys in background.js
const K = {
  PENDING:   'pendingSessions',
  CURRENT:   'currentSession',
  LAST_ID:   'lastSessionId',
  LAST_SYNC: 'lastSync',
  LAST_CNT:  'lastSyncCount',
};

let timerInterval = null;

// ── Load and render all state ────────────────────────────────────────────────

async function render() {
  const data = await chrome.storage.local.get([
    K.PENDING, K.CURRENT, K.LAST_SYNC, K.LAST_CNT,
  ]);

  const pending   = data[K.PENDING]   || [];
  const current   = data[K.CURRENT]   || null;
  const lastSync  = data[K.LAST_SYNC] || null;

  renderHeader(current);
  renderCurrentSession(current);
  renderStats(pending, lastSync);
}

function renderHeader(current) {
  const dot = document.getElementById('dot');
  const sub = document.getElementById('status-sub');

  if (current) {
    dot.className = 'dot active';
    sub.textContent = 'Tracking · ' + detectBrowserName();
  } else {
    dot.className = 'dot idle';
    sub.textContent = 'Idle — no active session';
  }
}

function renderCurrentSession(session) {
  const block = document.getElementById('current-block');

  // Clear previous timer
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (!session) {
    block.innerHTML = '<div class="no-session">—</div>';
    return;
  }

  function update() {
    const elapsed = Math.floor((Date.now() - new Date(session.start_time).getTime()) / 1000);
    block.innerHTML = `
      <div class="domain">${escHtml(session.domain || 'unknown')}</div>
      <div class="url-text">${escHtml(truncate(session.url, 44))}</div>
      <div class="timer">⏱ ${fmtDuration(elapsed)}</div>
    `;
  }

  update();
  timerInterval = setInterval(update, 1000);
}

function renderStats(pending, lastSync) {
  // Queue
  const qEl = document.getElementById('queue-val');
  qEl.textContent = pending.length === 0
    ? '0 sessions'
    : `${pending.length} session${pending.length !== 1 ? 's' : ''}`;
  qEl.className = 'row-val ' + (pending.length > 0 ? 'warn' : '');

  // Last sync
  document.getElementById('sync-val').textContent = lastSync
    ? fmtRelTime(new Date(lastSync))
    : 'Never';
}

// ── Bridge API health check ──────────────────────────────────────────────────

async function checkBridge() {
  const el = document.getElementById('bridge-val');
  try {
    const res = await fetch('http://localhost:3737/health', {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      el.textContent = '● online';
      el.className = 'row-val ok';
    } else {
      el.textContent = '● error ' + res.status;
      el.className = 'row-val bad';
    }
  } catch {
    el.textContent = '● offline';
    el.className = 'row-val bad';
  }
}

// ── Sync Now button ──────────────────────────────────────────────────────────

document.getElementById('btn-sync').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sync');
  const msg = document.getElementById('sync-msg');

  btn.disabled = true;
  btn.textContent = 'Syncing…';
  msg.textContent = '';
  msg.style.color = '#73726c';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'flush' });

    if (response?.ok) {
      const n = response.count || 0;
      msg.textContent = n > 0 ? `✓ Synced ${n} session${n !== 1 ? 's' : ''}` : '✓ Queue was empty';
      msg.style.color = '#9FE1CB';
    } else {
      msg.textContent = '✗ Bridge API unreachable';
      msg.style.color = '#F09595';
    }
  } catch (e) {
    msg.textContent = '✗ ' + (e.message || 'Unknown error');
    msg.style.color = '#F09595';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync Now';
    // Refresh stats after sync attempt
    await render();
  }
});

// ── Dashboard button ─────────────────────────────────────────────────────────

document.getElementById('btn-dash').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:3000' });
});

// ── Utilities ────────────────────────────────────────────────────────────────

function fmtDuration(seconds) {
  if (seconds < 60)   return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function fmtRelTime(date) {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60)     return 'just now';
  if (diffSec < 3600)   return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400)  return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString();
}

function truncate(str, len) {
  if (!str || str.length <= len) return str || '';
  return str.slice(0, len) + '…';
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function detectBrowserName() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/'))    return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  return 'Chromium';
}

// ── Init ─────────────────────────────────────────────────────────────────────

render();
checkBridge();

// Keep stats live while popup is open
setInterval(render, 5000);
