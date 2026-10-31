import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the real hook's request/checkpoint lifecycle with controlled React commits.
// Browser checks cover DOM rendering; this harness deliberately delays parent commits.
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const reactURL = asModule(`export const useState=(...a)=>globalThis.__generationHarness.state(...a);
export const useRef=(...a)=>globalThis.__generationHarness.ref(...a);
export const useEffect=(...a)=>globalThis.__generationHarness.effect('passive',...a);
export const useLayoutEffect=(...a)=>globalThis.__generationHarness.effect('layout',...a);`);
const clientURL = asModule('export const requestGeneration=(...a)=>globalThis.__generationHarness.request(...a);');
const progressURL = new URL('../src/generation/progressState.mjs', import.meta.url).href;
const source = (await readFile(new URL('../src/hooks/useGenerationRun.jsx', import.meta.url), 'utf8'))
  .replace("'react'", JSON.stringify(reactURL))
  .replace("'../staticDemo/mode.mjs'", JSON.stringify(new URL('../src/staticDemo/mode.mjs', import.meta.url).href))
  .replace("'../generation/client.mjs'", JSON.stringify(clientURL))
  .replace("'../generation/progressState.mjs'", JSON.stringify(progressURL));
const { default: useGenerationRun } = await import(asModule(source));

function harness(initial) {
  const slots = [], pending = { layout: [], passive: [] };
  let index = 0, dirty = true, props = initial, value;
  const h = {
    state(initialValue) {
      const i = index++;
      if (!slots[i]) slots[i] = { value: initialValue };
      return [slots[i].value, update => {
        const next = typeof update === 'function' ? update(slots[i].value) : update;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    ref(initialValue) { const i = index++; if (!slots[i]) slots[i] = { current: initialValue }; return slots[i]; },
    effect(type, fn, dependencies) {
      const i = index++, previous = slots[i];
      if (!previous || dependencies.some((item, n) => !Object.is(item, previous.dependencies[n]))) {
        slots[i] = { dependencies, cleanup: previous?.cleanup };
        pending[type].push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
    request(input, options) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      h.requests.push({ input, ...options, resolve, reject });
      return promise;
    },
    requests: [],
    flush(nextProps) {
      if (nextProps) { props = { ...props, ...nextProps }; dirty = true; }
      globalThis.__generationHarness = h;
      let loops = 0;
      while (dirty) {
        assert.ok(++loops < 20, 'Hook should settle');
        dirty = false; index = 0; value = useGenerationRun(props);
        for (const kind of ['layout', 'passive']) while (pending[kind].length) pending[kind].shift()();
      }
      return value;
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
  h.flush();
  return h;
}
const original = { name: 'Plane', children: [{ name: 'Wing', children: [{ name: 'Tip' }] }, { name: 'Engine' }] };
const input = { mode: 'edit', prompt: 'Detail the plane', effort: 'max', strategy: 'staged', scene: original };
const checkpoint = result => ({ type: 'checkpoint', result, meta: {}, step: 1, totalSteps: 2, title: 'Wing', resume: { version: 1, completedSteps: 1 } });

test('changing reference images invalidates a previous node answer while text replies retain it', async () => {
  const h = harness({ scene: original, path: '0.0', identity: 'question', imageRevision: 'image-a', open: true });
  const running = h.flush().run({ ...input, mode: 'node', path: '0.0' });
  h.requests[0].reject(Object.assign(new Error('Choose a wing size.'), { code: 'CLARIFICATION' }));
  await running;
  assert.equal(h.flush().clarificationIsCurrent, true);
  assert.equal(h.flush({ identity: 'custom text reply' }).clarificationIsCurrent, true);
  assert.equal(h.flush({ imageRevision: 'image-b' }).clarificationIsCurrent, false);
  assert.equal(h.flush().clarification.imageRevision, 'image-a');
  h.unmount();
});

test('a clarification keeps the modal open, carries full answer context and never applies geometry', async () => {
  let applied = 0, completed = 0;
  const h = harness({ scene: original, path: '0.0', identity: 'question',
    onApply: () => applied++, onComplete: () => completed++, open: true });
  const question = { ...input, mode: 'node', path: '0.0', node: original.children[0], prompt: 'What is this part?' };
  const running = h.flush().run(question);
  const suggestions = [{ label: 'Make it smaller', instruction: 'Reduce the wing width to 5.', path: '0.0' }];
  h.requests[0].reject(Object.assign(new Error('This is the wing.'), { code: 'CLARIFICATION', suggestions }));
  await running;
  const state = h.flush();
  assert.equal(state.busy, false);
  assert.equal(state.progress.stage, 'clarification');
  assert.equal(state.clarificationIsCurrent, true);
  assert.equal(state.clarification.path, '0.0');
  assert.deepEqual(state.clarification.suggestions, suggestions);
  assert.deepEqual(state.clarification.conversation, [
    { role: 'user', content: 'What is this part?' }, { role: 'assistant', content: 'This is the wing.' },
  ]);
  assert.equal(applied, 0);
  assert.equal(completed, 0);
  const history = state.clarification.conversation;
  const followup = state.run({ ...question, prompt: 'Make it smaller.', conversation: history });
  assert.equal(h.flush().clarification, null);
  assert.deepEqual(h.requests[1].input.conversation, history);
  h.requests[1].resolve({ result: original.children[0], meta: {} });
  await followup;
  assert.equal(completed, 1);
  h.unmount();
});

test('scene and selection changes invalidate old choices; reset discards the answer', async () => {
  const h = harness({ scene: original, path: '0.0', identity: 'question', open: true });
  const running = h.flush().run({ ...input, mode: 'node', path: '0.0' });
  h.requests[0].reject(Object.assign(new Error('Choose a wing size.'), { code: 'CLARIFICATION' }));
  await running;
  assert.equal(h.flush().clarificationIsCurrent, true);
  assert.deepEqual(h.flush().clarification.suggestions, []);
  assert.equal(h.flush({ scene: { ...original, name: 'Manual edit' } }).clarificationIsCurrent, false);
  assert.equal(h.flush({ scene: original, path: '0.1' }).clarificationIsCurrent, false);
  h.flush().reset();
  assert.equal(h.flush().clarification, null);
  h.unmount();
});

test('repeated questions retain bounded public dialogue without leaking model summaries', async () => {
  const h = harness({ scene: original, path: '0.0', identity: 'question', open: true });
  const conversation = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'x'.repeat(4000) }));
  const running = h.flush().run({ ...input, mode: 'node', path: '0.0', prompt: 'Which one?', conversation });
  h.requests[0].onProgress({ stage: 'thinking', summary: 'Private-internal-summary-placeholder' });
  h.requests[0].reject(Object.assign(new Error('Choose the left or right wing.'), { code: 'CLARIFICATION' }));
  await running;
  const history = h.flush().clarification.conversation;
  assert.ok(history.length <= 6);
  assert.ok(history.reduce((sum, turn) => sum + turn.content.length, 0) <= 12000);
  assert.ok(history.every(turn => turn.content.length <= 4000));
  assert.equal(history.at(-1).content, 'Choose the left or right wing.');
  assert.ok(!JSON.stringify(history).includes('Private-internal-summary-placeholder'));
  h.unmount();
});

test('sequential checkpoints before a parent commit use the latest expected scene; final confirmation applies once', async () => {
  const applied = [];
  const h = harness({ scene: original, identity: 'request', onApply: result => applied.push(result) });
  const running = h.flush().run(input);
  const request = h.requests[0];
  const first = { ...original, name: 'Detailed plane' };
  const second = { ...first, children: [...first.children, { name: 'Rivets' }] };
  request.onCheckpoint(checkpoint(first));
  request.onCheckpoint({ ...checkpoint(second), step: 2, resume: null });
  request.resolve({ result: second, meta: {} });
  await running;
  assert.equal(applied.length, 2);
  assert.equal(applied[1], second);
  assert.equal(h.flush({ scene: second }).progress.stage, 'complete');
  h.unmount();
});

test('Stop keeps the completed scene and allows continuation using that scene and original mode', async () => {
  const h = harness({ scene: original, identity: 'same' });
  const running = h.flush().run(input);
  const first = { ...original, name: 'Wing completed' };
  h.requests[0].onCheckpoint(checkpoint(first));
  let state = h.flush({ scene: first });
  state.cancel();
  state = h.flush();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(state.canResume, true);
  h.requests[0].resolve({ result: first });
  await running;
  const continuing = h.flush().run(input, { resume: true });
  assert.equal(h.requests[1].input.mode, 'edit');
  assert.deepEqual(h.requests[1].input.scene, first);
  assert.equal(h.requests[1].input.resume.completedSteps, 1);
  h.requests[1].resolve({ result: first });
  await continuing;
  h.unmount();
});

test('a user scene edit aborts pending work and prevents a late subtree from overwriting it', async () => {
  const applied = [];
  const h = harness({ scene: original, identity: 'same', onApply: result => applied.push(result) });
  const running = h.flush().run(input);
  const request = h.requests[0];
  const userScene = { ...original, name: 'Manual edit' };
  const state = h.flush({ scene: userScene });
  assert.equal(request.signal.aborted, true);
  assert.match(state.error, /latest edits/);
  assert.throws(() => request.onCheckpoint(checkpoint({ name: 'Late result' })), { name: 'AbortError' });
  request.resolve({ result: { name: 'Late result' } });
  await running;
  assert.equal(applied.length, 0);
  h.unmount();
});

test('editing the next prompt keeps active work but invalidates a stopped continuation', async () => {
  const h = harness({ scene: original, identity: 'first prompt' });
  const running = h.flush().run(input);
  const request = h.requests[0];
  h.flush({ identity: 'next prompt' });
  assert.equal(request.signal.aborted, false);
  const first = { ...original, name: 'Completed first part' };
  request.onCheckpoint(checkpoint(first));
  h.flush({ scene: first }).cancel();
  assert.equal(h.flush().canResume, false);
  request.resolve({ result: first });
  await running;
  h.unmount();
});

test('node checkpoints replace the original selection and finish only after the final result', async () => {
  let finished = 0;
  const applied = [];
  const h = harness({ scene: original, path: '0.0', open: true, identity: 'wing', onApply: result => applied.push(result), onComplete: () => finished++ });
  const running = h.flush().run({ ...input, mode: 'node', path: '0.0', node: original.children[0] });
  const updatedWing = { name: 'Wing', children: [{ name: 'Detailed tip' }] };
  h.requests[0].onCheckpoint(checkpoint(updatedWing));
  assert.equal(finished, 0);
  h.requests[0].resolve({ result: updatedWing });
  await running;
  assert.equal(applied.length, 1);
  assert.equal(finished, 1);
  h.unmount();
});

test('continuation accumulates previous active elapsed time while excluding the stopped interval', async () => {
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    const h = harness({ scene: original, identity: 'same' });
    const running = h.flush().run(input);
    const first = { ...original, name: 'First part finished' };
    now = 8000;
    h.requests[0].onCheckpoint(checkpoint(first));
    now = 9500;
    h.flush({ scene: first }).cancel();
    h.requests[0].resolve({ result: first });
    await running;
    now = 20000;
    const continuing = h.flush().run(input, { resume: true });
    assert.equal(h.flush().progress.elapsedBefore, 8500);
    assert.equal(h.flush().progress.startedAt, 20000);
    h.requests[1].resolve({ result: first });
    await continuing;
    h.unmount();
  } finally { Date.now = realNow; }
});
