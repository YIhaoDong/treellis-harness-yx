import test from 'node:test';
import assert from 'node:assert/strict';
import { requestGeneration } from '../src/generation/client.mjs';

const encoder = new TextEncoder();

test('clarification preserves executable choices across the stream without applying a result', async () => {
  const suggestions = [{ label: 'Reduce to 10 treads', instruction: 'Set the tread repeat count to 10.', path: '0.1' }];
  await withFetch(async () => streamResponse([encoder.encode(JSON.stringify({
    type: 'error', code: 'CLARIFICATION', message: 'Which change should I apply?', suggestions,
  }) + '\n')]), async () => {
    await assert.rejects(requestGeneration({ mode: 'node' }), error => {
      assert.equal(error.code, 'CLARIFICATION');
      assert.deepEqual(error.suggestions, suggestions);
      return true;
    });
  });
});
function streamResponse(chunks, cancel) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  }, cancel }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}
async function withFetch(fetcher, task) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await task(); } finally { globalThis.fetch = previous; }
}

test('progress and complete subtree checkpoints survive arbitrary UTF-8 chunks before final confirmation', async () => {
  const events = [
    { type: 'progress', stage: 'part', step: 1, totalSteps: 2, title: '机翼', summary: '细化机翼' },
    { type: 'checkpoint', step: 1, result: { name: '机翼' }, resume: { completedSteps: 1 } },
    { type: 'result', result: { name: '飞机' } },
  ];
  const bytes = encoder.encode(events.map(JSON.stringify).join('\n'));
  const progress = [], checkpoints = [];
  await withFetch(async (_url, request) => {
    assert.equal(JSON.parse(request.body).strategy, 'staged');
    assert.equal(request.headers.Authorization, undefined);
    return streamResponse(Array.from(bytes, byte => new Uint8Array([byte])));
  }, async () => {
    const result = await requestGeneration({ strategy: 'staged' }, { onProgress: event => progress.push(event), onCheckpoint: event => checkpoints.push(event) });
    assert.equal(result.result.name, '飞机');
    assert.deepEqual(progress, [events[0]]);
    assert.deepEqual(checkpoints, [events[1]]);
  });
});

test('a partial failure preserves resume details and does not erase already delivered parts', async () => {
  const resume = { version: 1, completedSteps: 1, totalSteps: 3 };
  const events = [{ type: 'checkpoint', result: { name: 'wing' }, resume },
    { type: 'error', code: 'OUTPUT_INCOMPLETE', message: 'This part needs another attempt.', completedSteps: 1, totalSteps: 3, resume }];
  let applied = 0;
  await withFetch(async () => streamResponse([encoder.encode(events.map(JSON.stringify).join('\n'))]), async () => {
    await assert.rejects(requestGeneration({}, { onCheckpoint: () => applied++ }), error => {
      assert.equal(error.code, 'OUTPUT_INCOMPLETE');
      assert.deepEqual(error.resume, resume);
      assert.equal(error.completedSteps, 1);
      return true;
    });
  });
  assert.equal(applied, 1);
});

test('a connection lost after a checked part reports that part was kept', async () => {
  await withFetch(async () => streamResponse([encoder.encode(JSON.stringify({ type: 'checkpoint', result: { name: 'wing' } }) + '\n')]), async () => {
    await assert.rejects(requestGeneration({}), /Completed parts were kept/);
  });
});

test('Stop cancels a stalled response and ignores the next queued checkpoint', async () => {
  const controller = new AbortController();
  let cancelled = false, applied = 0;
  await withFetch(async () => new Response(new ReadableStream({ start(stream) {
    stream.enqueue(encoder.encode(JSON.stringify({ type: 'progress', stage: 'thinking' }) + '\n' +
      JSON.stringify({ type: 'checkpoint', result: { name: 'late' } }) + '\n'));
  }, cancel() { cancelled = true; } })), async () => {
    await assert.rejects(requestGeneration({}, { signal: controller.signal,
      onProgress: () => controller.abort(), onCheckpoint: () => applied++ }), { name: 'AbortError' });
  });
  assert.equal(applied, 0);
  assert.equal(cancelled, true);
});

test('rejecting a stale checkpoint closes the provider stream instead of applying following events', async () => {
  let cancelled = false;
  await withFetch(async () => new Response(new ReadableStream({ start(stream) {
    stream.enqueue(encoder.encode(JSON.stringify({ type: 'checkpoint', result: { name: 'stale' } }) + '\n'));
  }, cancel() { cancelled = true; } })), async () => {
    await assert.rejects(requestGeneration({}, { onCheckpoint() { throw new Error('Scene changed'); } }), /Scene changed/);
  });
  assert.equal(cancelled, true);
});
