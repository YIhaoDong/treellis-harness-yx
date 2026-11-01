import { STATIC_DEMO } from '../staticDemo/mode.mjs';

export function generationBaseURL() {
  // A deployed frontend is built with VITE_API_BASE (e.g. https://api.treellis.art).
  const configured = import.meta.env?.VITE_API_BASE;
  if (configured) return configured.replace(/\/+$/, '');
  const hostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
  return `http://${hostname === '::1' ? '[::1]' : hostname}:3001`;
}
export async function getGenerationConfig(signal) {
  if (STATIC_DEMO) return { ready: true, localKeyAvailable: true };
  const response = await fetch(`${generationBaseURL()}/api/generation/config`, { cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok || !data.ready) throw new Error(data.error || 'The generation service is unavailable. Start npm run server and retry.');
  return data;
}
const cancelled = () => new DOMException('Cancelled', 'AbortError');
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const abort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function sessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID().replace(/-/g, '');
  // randomUUID requires a secure context; getRandomValues also works for a
  // user opening their local workspace over an ordinary LAN HTTP address.
  return [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function requestGeneration(input, { apiKey = '', signal, onProgress = () => {}, onCheckpoint = () => {},
  fetchImpl = (...args) => fetch(...args), reconnectDelayMs = 1000, maxReconnects = 8, idleMs = 45000 } = {}) {
  if (STATIC_DEMO) return;
  const id = sessionId(), token = sessionId(), base = generationBaseURL();
  const headers = { 'Content-Type': 'application/json', 'X-Generation-Id': id, 'X-Generation-Token': token };
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  let acknowledged = false, cursor = 0, result = null, checkpoints = 0, connection, reconnects = 0, cancelSent = false;
  const cancelJob = () => {
    if (cancelSent) return;
    cancelSent = true;
    // Do not pass the already-aborted generation signal to this separate Stop.
    const cancelController = new AbortController();
    const timer = setTimeout(() => cancelController.abort(), 5000);
    void fetchImpl(`${base}/api/generation/jobs/${id}/cancel`, { method: 'POST',
      headers: { 'X-Generation-Token': token }, signal: cancelController.signal, keepalive: true })
      .catch(() => {}).finally(() => clearTimeout(timer));
  };
  const abort = () => { connection?.abort(); cancelJob(); };
  signal?.addEventListener('abort', abort, { once: true });
  const consume = line => {
    if (!line.trim()) return;
    if (signal?.aborted) throw cancelled();
    const event = JSON.parse(line);
    // Never apply edits after final confirmation, but reject a contradictory
    // error already present in this same buffered transport chunk.
    if (result && event.type !== 'error') return;
    if (event.type === 'job') { acknowledged = event.id === id; return; }
    if (Number.isSafeInteger(event.seq)) {
      if (event.seq <= cursor) return;
      cursor = event.seq;
    }
    try {
      if (event.type === 'progress') onProgress(event);
      if (event.type === 'checkpoint') { onCheckpoint(event); checkpoints++; }
    } catch (error) { error.deliveryError = true; throw error; }
    if (event.type === 'error') {
      const error = new Error(event.message);
      for (const key of ['code', 'resume', 'completedSteps', 'totalSteps', 'suggestions', 'status', 'causeCode', 'providerCode', 'requestId', 'responseId', 'attempts', 'usage', 'durationMs'])
        if (event[key] !== undefined) error[key] = event[key];
      error.terminal = true;
      throw error;
    }
    if (event.type === 'cancelled') { const error = cancelled(); error.terminal = true; throw error; }
    if (event.type === 'result') result = event;
  };
  try {
    while (!result) {
      if (signal?.aborted) throw cancelled();
      connection = new AbortController();
      let reader, watchdog, opened = false, ended = false;
      const resetIdle = () => { clearTimeout(watchdog); watchdog = setTimeout(() => {
        connection.abort(); try { void reader?.cancel().catch(() => {}); } catch {}
      }, idleMs); };
      try {
        resetIdle();
        const response = await fetchImpl(acknowledged ? `${base}/api/generation/jobs/${id}?after=${cursor}` : `${base}/api/generate`,
          acknowledged ? { headers: { 'X-Generation-Token': token }, cache: 'no-store', signal: connection.signal }
            : { method: 'POST', headers, body: JSON.stringify(input), signal: connection.signal });
        opened = true;
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const error = new Error(data.error || `Generation request failed (${response.status}).`);
          // A missing retained job cannot be reconstructed after a server restart.
          error.terminal = response.status < 500;
          throw error;
        }
        if (!response.body) throw new Error('The generation service did not open a progress stream.');
        reader = response.body.getReader();
        const decoder = new TextDecoder(); let pending = '';
        while (!result) {
          const { value, done } = await reader.read();
          resetIdle();
          if (signal?.aborted) throw cancelled();
          pending += decoder.decode(value, { stream: !done });
          const lines = pending.split('\n'); pending = lines.pop();
          for (const line of lines) consume(line);
          if (done) { consume(pending); ended = true; break; }
        }
        if (result) break;
        const error = new Error(checkpoints ? 'The connection ended before all parts finished. Completed parts were kept; continue the remaining steps.'
          : 'The generation connection ended before a result arrived. Your scene is unchanged.');
        error.terminal = opened && !acknowledged;
        throw error;
      } catch (error) {
        if (signal?.aborted) throw cancelled();
        if (error.terminal || error.deliveryError) throw error;
        if (reconnects >= maxReconnects) {
          const unavailable = new Error('The generation service is still unreachable. Checked results were kept. Restore the connection, then continue or retry.');
          unavailable.code = 'CONNECTION_LOST'; throw unavailable;
        }
        reconnects++;
        onProgress({ stage: 'recovering', message: `Reconnecting to the same generation (${reconnects}/${maxReconnects})… Checked parts are kept.` });
      } finally {
        clearTimeout(watchdog); connection.abort();
        if (!ended) { try { await reader?.cancel(); } catch {} }
        try { reader?.releaseLock(); } catch {}
      }
      await pause(Math.min(8000, reconnectDelayMs * 2 ** Math.min(reconnects - 1, 3)), signal);
    }
    if (signal?.aborted) throw cancelled();
    return result;
  } catch (error) {
    if (error.deliveryError || signal?.aborted || error.code === 'CONNECTION_LOST') cancelJob();
    throw error;
  } finally { signal?.removeEventListener('abort', abort); }
}
