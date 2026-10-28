const { createHash, timingSafeEqual } = require('node:crypto');

const digest = value => createHash('sha256').update(value).digest();
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{32,80}$/.test(value);
const clean = value => String(value || '').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');

function publicUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = ['input_tokens', 'output_tokens', 'total_tokens']
    .filter(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0)
    .map(key => [key, value[key]]);
  return entries.length ? Object.fromEntries(entries) : null;
}
function publicAttempts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).filter(item => item && typeof item === 'object' &&
    Number.isInteger(item.attempt) && item.attempt >= 1 && item.attempt <= 3).map(item => ({
      attempt: item.attempt, passed: item.passed === true,
      ...(item.outcome === 'clarification' ? { outcome: item.outcome } : {}),
      errors: Array.isArray(item.errors) ? item.errors.filter(value => typeof value === 'string')
        .slice(0, 12).map(value => clean(value).slice(0, 400)) : [],
      ...(typeof item.responseId === 'string' ? { responseId: clean(item.responseId).slice(0, 160) } : {}),
      ...(publicUsage(item.usage) ? { usage: publicUsage(item.usage) } : {}),
    }));
}

function publicError(error) {
  const interrupted = ['NETWORK_ERROR', 'PROVIDER_STREAM_ERROR'].includes(error.code) ||
    (error.code === 'PROVIDER_ERROR' && (error.status >= 500 || /^(server_error|internal_error|server_is_overloaded|service_unavailable_error)$/.test(error.providerCode || '')));
  const message = interrupted
    ? 'This task could not finish after connection recovery. Your scene and checked parts were kept. Retry the unfinished task when the service is available.'
    : error.message || 'Generation could not finish. Your checked results were kept.';
  return { type: 'error', code: error.code || 'GENERATION_ERROR',
    ...(Array.isArray(error.attempts) ? { attempts: publicAttempts(error.attempts) } : {}),
    ...(publicUsage(error.usage) ? { usage: publicUsage(error.usage) } : {}),
    ...(typeof error.durationMs === 'number' && Number.isFinite(error.durationMs) && error.durationMs >= 0
      ? { durationMs: error.durationMs } : {}),
    ...Object.fromEntries(['causeCode', 'providerCode', 'status', 'requestId', 'responseId'].filter(key => error[key] != null)
      .map(key => [key, typeof error[key] === 'string' ? clean(error[key]).slice(0, 160) : error[key]])),
    completedSteps: error.completedSteps || 0, totalSteps: error.totalSteps || 0, resume: error.resume || null,
    ...(error.code === 'CLARIFICATION' ? { suggestions: error.suggestions || [] } : {}),
    message: clean(message).slice(0, error.code === 'CLARIFICATION' ? 4000 : 1400) };
}

// A page connection can disappear without losing an expensive generation. Jobs
// are private capabilities, retained in memory only, and never auto-commit scenes.
function createGenerationJobs({ run, maxActive = 2, retentionMs = 30 * 60 * 1000,
  orphanMs = 10 * 60 * 1000, maxRetained = 8 } = {}) {
  const jobs = new Map();
  let active = 0;
  const authorize = (id, token) => {
    const job = jobs.get(id);
    return job && validId(token) && timingSafeEqual(job.tokenHash, digest(token)) ? job : null;
  };
  const emit = (job, event) => {
    const item = { ...event, seq: ++job.sequence };
    job.events.push(item);
    // Preserve all checked parts (at most six), plus the latest progress events.
    while (job.events.length > 72) {
      const removable = job.events.findIndex(value => value.type === 'progress');
      if (removable < 0) break;
      job.events.splice(removable, 1);
    }
    for (const listener of job.listeners) { try { listener(item); } catch {} }
  };
  const orphan = job => {
    clearTimeout(job.orphanTimer);
    if (job.state !== 'running' || job.listeners.size) return;
    job.orphanTimer = setTimeout(() => {
      if (!job.listeners.size && job.state === 'running') job.controller.abort();
    }, orphanMs);
    job.orphanTimer.unref?.();
  };
  const trim = () => {
    const completed = [...jobs.values()].filter(job => job.state !== 'running');
    while (completed.length > maxRetained) {
      const job = completed.shift(); clearTimeout(job.retentionTimer); jobs.delete(job.id);
    }
  };
  return {
    start({ id, token, owner = '', input }) {
      if (!validId(id) || !validId(token)) throw Object.assign(new Error('Invalid generation session.'), { status: 400 });
      const inputHash = digest(JSON.stringify(input));
      const ownerHash = digest(owner);
      const existing = jobs.get(id);
      if (existing) {
        if (!authorize(id, token) || !timingSafeEqual(existing.inputHash, inputHash) || !timingSafeEqual(existing.ownerHash, ownerHash))
          throw Object.assign(new Error('The generation session does not match this request.'), { status: 409 });
        return existing;
      }
      if (active >= maxActive) throw Object.assign(new Error('Two generations are already running. Please wait or cancel one.'), { status: 429 });
      const job = { id, tokenHash: digest(token), inputHash, ownerHash, state: 'running', sequence: 0,
        events: [], listeners: new Set(), controller: new AbortController(), startedAt: Date.now() };
      jobs.set(id, job); active++;
      orphan(job);
      // Defer execution so the caller can attach its first event subscriber.
      queueMicrotask(async () => {
        try {
          const output = await run(input, { apiKey: owner, signal: job.controller.signal,
            onProgress: progress => { if (!job.controller.signal.aborted) emit(job, { type: 'progress', ...progress }); },
            onCheckpoint: checkpoint => { if (!job.controller.signal.aborted) emit(job, { type: 'checkpoint', ...checkpoint }); } });
          if (!job.controller.signal.aborted) emit(job, { type: 'result', ...output });
        } catch (error) {
          if (error.name !== 'AbortError' && !job.controller.signal.aborted) emit(job, publicError(error));
        } finally {
          job.state = job.controller.signal.aborted ? 'cancelled' : 'finished';
          if (job.state === 'cancelled') emit(job, { type: 'cancelled' });
          active--; clearTimeout(job.orphanTimer);
          for (const listener of job.listeners) { try { listener(null); } catch {} }
          job.listeners.clear();
          job.retentionTimer = setTimeout(() => jobs.delete(id), retentionMs);
          job.retentionTimer.unref?.(); trim();
        }
      });
      return job;
    },
    get: authorize,
    subscribe(id, token, after, listener) {
      const job = authorize(id, token);
      if (!job) return null;
      clearTimeout(job.orphanTimer);
      for (const event of job.events) if (event.seq > after) listener(event);
      if (job.state !== 'running') { listener(null); return () => {}; }
      job.listeners.add(listener);
      return () => { job.listeners.delete(listener); orphan(job); };
    },
    cancel(id, token) {
      const job = authorize(id, token);
      if (!job) return false;
      if (job.state === 'running') job.controller.abort();
      return true;
    },
    get active() { return active; },
    close() {
      for (const job of jobs.values()) {
        clearTimeout(job.orphanTimer); clearTimeout(job.retentionTimer); job.controller.abort();
      }
      jobs.clear();
    },
  };
}

module.exports = { createGenerationJobs, publicError };
