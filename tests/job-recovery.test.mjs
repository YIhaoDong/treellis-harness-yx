import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { requestGeneration } from '../src/generation/client.mjs';
const { createGenerationJobs, publicError } = createRequire(import.meta.url)('../src/generation/jobs.cjs');
const id = 'a'.repeat(32), token = 'b'.repeat(32);
const tick = () => new Promise(resolve => setImmediate(resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const encoded = events => new TextEncoder().encode(events.map(JSON.stringify).join('\n') + '\n');
const stream = events => new Response(new ReadableStream({ start(controller) { controller.enqueue(encoded(events)); controller.close(); } }));

test('exhausted transient recovery gives a usable next action while retaining support and resume details', () => {
  const resume = { completedSteps: 1, totalSteps: 3 };
  const output = publicError({ code: 'PROVIDER_ERROR', status: 500, message: 'Raw upstream failure sk-never-expose',
    requestId: 'req_support', responseId: 'resp_original', completedSteps: 1, totalSteps: 3, resume });
  assert.match(output.message, /checked parts were kept.*Retry the unfinished task/);
  assert.doesNotMatch(output.message, /Raw upstream|sk-never/);
  assert.equal(output.requestId, 'req_support'); assert.equal(output.responseId, 'resp_original');
  assert.equal(output.resume, resume); assert.equal(output.completedSteps, 1);
  assert.equal(publicError({ code: 'PROVIDER_ERROR', status: 401, message: 'Check the Key setting.' }).message, 'Check the Key setting.');
});

test('a detached client replays checked parts and the completed result without rerunning', async () => {
  const gate = deferred(); let runs = 0;
  const jobs = createGenerationJobs({ run: async (_, { onCheckpoint }) => {
    runs++; onCheckpoint({ result: { name: 'wing' }, step: 1 }); await gate.promise;
    return { result: { name: 'plane' } };
  } });
  try {
    jobs.start({ id, token, input: {} });
    const first = [], detach = jobs.subscribe(id, token, 0, event => first.push(event));
    await tick(); detach(); gate.resolve(); await tick();
    const replay = []; jobs.subscribe(id, token, 0, event => replay.push(event));
    assert.equal(runs, 1);
    assert.deepEqual(replay.filter(Boolean).map(event => event.type), ['checkpoint', 'result']);
    assert.equal(replay.at(-1), null);
    const afterCheckpoint = []; jobs.subscribe(id, token, first[0].seq, event => afterCheckpoint.push(event));
    assert.deepEqual(afterCheckpoint.filter(Boolean).map(event => event.type), ['result']);
  } finally { jobs.close(); }
});

test('lost POST acknowledgements are idempotent and sessions cannot change input, owner or capability', async () => {
  let runs = 0; const gate = deferred();
  const jobs = createGenerationJobs({ run: async () => { runs++; await gate.promise; return { result: {} }; } });
  try {
    const request = { id, token, owner: 'private-key', input: { prompt: 'cube' } };
    const first = jobs.start(request), second = jobs.start(request);
    assert.equal(first, second); await tick(); assert.equal(runs, 1);
    assert.equal(jobs.get(id, 'c'.repeat(32)), null);
    assert.throws(() => jobs.start({ ...request, owner: 'different' }), { status: 409 });
    assert.throws(() => jobs.start({ ...request, input: { prompt: 'sphere' } }), { status: 409 });
    assert.throws(() => jobs.start({ ...request, token: 'invalid' }), { status: 400 });
    assert.equal(Object.values(first).some(value => typeof value === 'string' && value.includes('private-key')), false);
    gate.resolve(); await tick();
  } finally { jobs.close(); }
});

test('Stop cancels the same running job and preserves its previously checked part', async () => {
  const jobs = createGenerationJobs({ run: async (_, { signal, onCheckpoint }) => {
    onCheckpoint({ result: { name: 'wing' }, step: 1 });
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    return { result: { name: 'late' } };
  } });
  try {
    jobs.start({ id, token, input: {} }); await tick();
    assert.equal(jobs.cancel(id, token), true); await tick();
    const replay = []; jobs.subscribe(id, token, 0, event => replay.push(event));
    assert.deepEqual(replay.filter(Boolean).map(event => event.type), ['checkpoint', 'cancelled']);
    assert.equal(jobs.active, 0);
  } finally { jobs.close(); }
});

test('a long live connection has no execution deadline; only orphaned jobs expire', async () => {
  let aborted = false;
  const jobs = createGenerationJobs({ orphanMs: 15, run: async (_, { signal }) => {
    await new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Cancelled', 'AbortError')); }));
  } });
  try {
    jobs.start({ id, token, input: {} }); const detach = jobs.subscribe(id, token, 0, () => {});
    await sleep(35); assert.equal(aborted, false);
    detach(); await sleep(35); assert.equal(aborted, true); assert.equal(jobs.active, 0);
  } finally { jobs.close(); }
});

test('progress history is bounded while checked geometry and diagnostics remain replayable', async () => {
  const jobs = createGenerationJobs({ run: async (_, { onCheckpoint, onProgress }) => {
    onCheckpoint({ result: { name: 'wing' } });
    for (let i = 0; i < 300; i++) onProgress({ stage: 'thinking', summary: `public ${i}` });
    throw Object.assign(new Error('temporary failure sk-never-expose'), { code: 'NETWORK_ERROR', causeCode: 'ECONNRESET', responseId: 'resp_safe' });
  } });
  try {
    const job = jobs.start({ id, token, input: {} }); await tick();
    assert.ok(job.events.length <= 72);
    assert.equal(job.events[0].type, 'checkpoint');
    assert.equal(job.events.at(-1).responseId, 'resp_safe');
    assert.equal(JSON.stringify(job.events).includes('sk-never-expose'), false);
  } finally { jobs.close(); }
});

test('local reconnect continues the original job by cursor and never reapplies a replayed checkpoint', async () => {
  let calls = 0, applied = 0; const stages = [];
  const result = await requestGeneration({}, { reconnectDelayMs: 1, fetchImpl: async (url, init) => {
    calls++;
    if (calls === 1) return stream([{ type: 'job', id: init.headers['X-Generation-Id'] },
      { type: 'checkpoint', seq: 1, result: { name: 'wing' } }]);
    assert.match(url, /\/api\/generation\/jobs\/[a-z0-9]+\?after=1$/);
    assert.equal(init.method, undefined);
    return stream([{ type: 'checkpoint', seq: 1, result: { name: 'wing' } }, { type: 'result', seq: 2, result: { name: 'plane' } }]);
  }, onCheckpoint: () => applied++, onProgress: event => stages.push(event.stage) });
  assert.equal(result.result.name, 'plane'); assert.equal(applied, 1); assert.equal(calls, 2);
  assert.deepEqual(stages, ['recovering']);
});

test('a lost initial acknowledgement retries the identical session id instead of creating another generation', async () => {
  let firstId, firstToken, calls = 0;
  await requestGeneration({}, { reconnectDelayMs: 1, fetchImpl: async (url, init) => {
    assert.match(url, /\/api\/generate$/); calls++;
    if (calls === 1) { firstId = init.headers['X-Generation-Id']; firstToken = init.headers['X-Generation-Token']; throw new TypeError('fetch failed'); }
    assert.equal(init.headers['X-Generation-Id'], firstId); assert.equal(init.headers['X-Generation-Token'], firstToken);
    return stream([{ type: 'job', id: firstId }, { type: 'result', seq: 1, result: {} }]);
  } });
  assert.equal(calls, 2);
});

test('LAN HTTP browsers without randomUUID still create cryptographic generation capabilities', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const nativeCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: value => nativeCrypto.getRandomValues(value) } });
  try {
    await requestGeneration({}, { fetchImpl: async (_, init) => {
      assert.match(init.headers['X-Generation-Id'], /^[a-f0-9]{32}$/);
      assert.match(init.headers['X-Generation-Token'], /^[a-f0-9]{32}$/);
      assert.notEqual(init.headers['X-Generation-Id'], init.headers['X-Generation-Token']);
      return stream([{ type: 'result', result: {} }]);
    } });
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});

test('a silent broken local stream reconnects without timing out the running generation', async () => {
  let calls = 0;
  const result = await requestGeneration({}, { idleMs: 10, reconnectDelayMs: 1, fetchImpl: async (_, init) => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoded([{ type: 'job', id: init.headers['X-Generation-Id'] }]));
    } }));
    return stream([{ type: 'result', seq: 1, result: { name: 'recovered' } }]);
  } });
  assert.equal(result.result.name, 'recovered'); assert.equal(calls, 2);
});

test('Stop during reconnect backoff cancels upstream and prevents another attempt', async () => {
  const controller = new AbortController(); let posts = 0, stops = 0;
  await assert.rejects(requestGeneration({}, { signal: controller.signal, reconnectDelayMs: 1000,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/cancel')) { stops++; return new Response('{}'); }
      posts++; return stream([{ type: 'job', id: init.headers['X-Generation-Id'] }]);
    }, onProgress: event => { if (event.stage === 'recovering') controller.abort(); },
  }), { name: 'AbortError' });
  assert.equal(posts, 1); assert.ok(stops >= 1);
});

test('permanent server errors and stale scene callbacks never auto-replay edits', async () => {
  let calls = 0;
  await assert.rejects(requestGeneration({}, { fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: 'key required' }), { status: 401 }); } }), /key required/);
  assert.equal(calls, 1);
  let stops = 0, applied = 0;
  await assert.rejects(requestGeneration({}, { fetchImpl: async (url, init) => {
    if (url.endsWith('/cancel')) { stops++; return new Response('{}'); }
    return stream([{ type: 'job', id: init.headers['X-Generation-Id'] }, { type: 'checkpoint', seq: 1, result: {} }, { type: 'checkpoint', seq: 2, result: {} }]);
  }, onCheckpoint: () => { applied++; throw new Error('Scene changed'); } }), /Scene changed/);
  assert.equal(applied, 1); assert.equal(stops, 1);
});
