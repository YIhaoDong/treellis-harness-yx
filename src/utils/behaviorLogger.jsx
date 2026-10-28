// src/utils/behaviorLogger.jsx
// Lightweight front-end behavior logger with batching, retry, and offline queue.

const API_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) ||
  (typeof window !== 'undefined' && window.__API_BASE__) ||
  'http://localhost:3001';

const ENDPOINT = `${API_BASE}/api/behavior`;
const STORAGE_KEYS = {
  session: 'ttcs.behavior.session_id',
  queue: 'ttcs.behavior.queue.v1',
};

const STATE = {
  sessionId: null,
  queue: [],
  timer: null,
  started: false,
  batchSize: 20,
  flushInterval: 2000,
  maxQueue: 2000,
  backoff: 0,
};

function uuid() {
  // RFC4122-ish simple uuid
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 0xf) >> 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.queue);
    if (raw) STATE.queue = JSON.parse(raw) || [];
  } catch {}
}

function saveQueue() {
  try {
    localStorage.setItem(STORAGE_KEYS.queue, JSON.stringify(STATE.queue.slice(0, STATE.maxQueue)));
  } catch {}
}

function getSessionId() {
  try {
    let sid = localStorage.getItem(STORAGE_KEYS.session);
    if (!sid) {
      sid = uuid();
      localStorage.setItem(STORAGE_KEYS.session, sid);
    }
    return sid;
  } catch {
    // fallback (non-persistent)
    return STATE.sessionId || uuid();
  }
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return '';
  }
}

async function postJSON(url, body, { useBeacon = false } = {}) {
  const payload = JSON.stringify(body);
  if (useBeacon && navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' });
    return navigator.sendBeacon(url, blob);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: payload,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return true;
}

function schedule() {
  if (STATE.timer || !STATE.started) return;
  STATE.timer = setTimeout(flush, STATE.flushInterval);
}

function unschedule() {
  if (STATE.timer) {
    clearTimeout(STATE.timer);
    STATE.timer = null;
  }
}

function applyBackoff(ok) {
  if (ok) {
    STATE.backoff = 0;
  } else {
    STATE.backoff = Math.min(STATE.backoff ? STATE.backoff * 2 : 1000, 30000); // up to 30s
  }
}

async function flush({ force = false, useBeacon = false } = {}) {
  if (!STATE.queue.length) {
    applyBackoff(true);
    unschedule();
    return;
  }

  // If backoff is active and not forced, skip once.
  if (!force && STATE.backoff) {
    unschedule();
    STATE.timer = setTimeout(flush, STATE.backoff);
    return;
  }

  // Drain up to batchSize
  const batch = STATE.queue.splice(0, STATE.batchSize);
  saveQueue();

  try {
    await postJSON(ENDPOINT, { events: batch }, { useBeacon });
    applyBackoff(true);
  } catch (e) {
    // Push back to head, then backoff
    STATE.queue = batch.concat(STATE.queue).slice(0, STATE.maxQueue);
    saveQueue();
    applyBackoff(false);
  } finally {
    unschedule();
    if (STATE.queue.length) schedule();
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    flush({ force: true, useBeacon: true });
  }
}

function onPageHide() {
  flush({ force: true, useBeacon: true });
}

function globalErrorHandlers() {
  window.addEventListener('error', (e) => {
    try {
      log('window_error', {
        message: String(e?.message || ''),
        filename: e?.filename || '',
        lineno: e?.lineno || 0,
        colno: e?.colno || 0,
      }, 'global');
    } catch {}
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      log('unhandled_rejection', {
        reason: String(e?.reason || ''),
      }, 'global');
    } catch {}
  });
}

function baseEvent(event, payload = {}, source = 'app') {
  return {
    ts: Date.now(),
    ts_iso: nowIso(),
    session_id: STATE.sessionId,
    event,
    source,
    page: (typeof location !== 'undefined' && (location.pathname + location.search)) || '',
    payload,
  };
}

function log(event, payload = {}, source = 'app') {
  if (!STATE.started) return;
  const ev = baseEvent(event, payload, source);
  STATE.queue.push(ev);
  if (STATE.queue.length > STATE.maxQueue) {
    STATE.queue.splice(0, STATE.queue.length - STATE.maxQueue);
  }
  saveQueue();
  schedule();
}

const logger = {
  init(opts = {}) {
    if (STATE.started) return;
    STATE.started = true;
    STATE.sessionId = getSessionId();
    loadQueue();

    const viewport = (() => {
      try { return { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 }; }
      catch { return {}; }
    })();

    // session start
    log('session_start', {
      ua: navigator.userAgent,
      lang: navigator.language,
      viewport,
    }, 'app');

    // listeners
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    globalErrorHandlers();

    // optional immediate flush
    schedule();
  },

  log,         // logger.log(event, payload, source?)
  flushNow() { flush({ force: true }); },
  sessionId() { return STATE.sessionId; },
};

export default logger;
