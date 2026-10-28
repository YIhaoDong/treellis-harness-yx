import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runGeneration } from '../src/generation/pipeline.mjs';
import { inspectGeometry } from '../src/generation/geometry.mjs';
import { requestGeneration } from '../src/generation/client.mjs';

const ASSET_NAMES = [
  'role_global', 'task_global_create', 'task_global_edit', 'role_node', 'task_node_edit',
  'jsonFormat', 'jsonCase', 'constraints_global', 'constraints_node', 'nodeAdjustRules',
  'parameterRules', 'colorRules', 'runtime_rules',
];
const TEST_KEY = 'mock-local-test-key';
const clone = value => JSON.parse(JSON.stringify(value));
const cube = (name = 'Cube', w = 1) => ({ name, primitive: { type: 'cube', w, h: 1, d: 1, material: { color: '#d8ffd4' } } });
const wrappedCube = (name = 'Cube', w = 1) => ({
  name, transform: null, primitive: { type: 'cube', w, h: 1, d: 1, material: { color: '#d8ffd4' } },
  operation: null, repeat: null, children: null,
});
const replace = (replacement = wrappedCube()) => ({
  action: 'replace', replacement, patches: [], message: 'Created the requested object.', plan: ['One cube'], checks: [],
});
const patch = (path = '/primitive/w', value = 2) => ({
  action: 'patch', replacement: null, patches: [{ path, value }], message: 'Updated the requested dimension.', plan: [], checks: [],
});
const provider = (envelope, extra = {}) => ({
  id: 'resp_mock', status: 'completed', output_text: JSON.stringify(envelope),
  usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, ...extra,
});
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const goodGeometry = root => ({
  ok: true, errors: [], warnings: [], bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  stats: { nodes: 1, primitives: 1, instances: 1 },
  nodes: { '0': { primitiveCount: 1, bounds: { size: [root.primitive?.w ?? 1, 1, 1], center: [0, 0, 0] } } }, root,
});
const loadAssets = async () => Object.fromEntries(await Promise.all(ASSET_NAMES.map(async name => [
  name, await readFile(new URL(`../public/prompts/${name}.txt`, import.meta.url), 'utf8'),
])));

test('ordinary Chinese deletion and English duplication instructions permit scoped structural edits', async () => {
  for (const prompt of ['删掉尾翼', '去除尾翼', 'Duplicate the selected part', 'Mirror the selected part', 'Copy this part']) {
    const scene = {name:'Assembly',operation:'union',children:[cube('Body'),cube('Tail')]};
    const removing = prompt.includes('尾翼');
    const children = removing ? [wrappedCube('Body')] : [wrappedCube('Body'),wrappedCube('Tail'),wrappedCube('Copy')];
    const replacement = {name:'Assembly',operation:'union',children};
    const h = harness([provider(replace(replacement))]);
    const result = await h.run({mode:'edit',scene,prompt,effort:'low'});
    assert.equal(result.action,'replace');
    assert.equal(h.calls.length,1);
    assert.equal(result.result.children.length,removing ? 1 : 3);
  }
});

test('successive local refinements cannot exceed the whole scene node budget', async () => {
  const scene = {name:'Large assembly',operation:'union',children:[...Array.from({length:510},(_,i)=>cube(`Part ${i}`)),cube('Target')]};
  const replacement = {name:'Target',operation:'union',children:[wrappedCube('Detail A'),wrappedCube('Detail B')]};
  const h = harness([provider(replace(replacement))],{maxRepairs:0,buildEditContext:async()=>({})});
  await assert.rejects(h.run({mode:'node',scene,node:scene.children[510],path:'0.510',prompt:'Add details to this part.',effort:'low'}),
    error => error.code === 'VALIDATION_FAILED' && /node budget exceeded/.test(error.message));
  assert.equal(h.inspected.length,0);
  assert.equal(scene.children[510].primitive.type,'cube');
});

function harness(responses = [provider(replace())], options = {}) {
  const calls = [], progress = [], inspected = [];
  const fetchImpl = async (url, init) => {
    const call = { url: String(url), ...init, body: JSON.parse(init.body) };
    calls.push(call);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (typeof next === 'function') return next(call);
    if (next instanceof Response) return next;
    return jsonResponse(next);
  };
  const deps = {
    apiKey: TEST_KEY, loadAssets, fetchImpl, maxRepairs: 2,
    onProgress: event => progress.push(event),
    inspectGeometry: async root => { inspected.push(clone(root)); return goodGeometry(root); },
    ...options,
  };
  return { calls, progress, inspected, deps, run: input => runGeneration(input, deps) };
}

test('create uses GPT-6.1, the selected effort and strict output schema in one call', async () => {
  const h = harness();
  const output = await h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'high' });
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].url, /api\.openai\.com\/v1\/responses$/);
  assert.equal(h.calls[0].body.model, 'gpt-6.1-sol');
  assert.equal(h.calls[0].body.reasoning.effort, 'high');
  assert.equal(h.calls[0].body.text.format.type, 'json_schema');
  assert.equal(h.calls[0].body.text.format.strict, true);
  assert.equal(output.result.primitive.w, 1);
  assert.equal(output.action, 'replace');
  assert.ok(h.progress.length > 0);
  assert.equal(JSON.stringify(output).includes(TEST_KEY), false);
});

test('all authoritative numeric, palette and runtime rules reach the request', async () => {
  const h = harness();
  await h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' });
  const text = JSON.stringify(h.calls[0].body.input);
  const assets = await loadAssets();
  for (const name of ['parameterRules', 'colorRules', 'runtime_rules', 'constraints_global']) {
    assert.ok(text.includes(assets[name].trim().split(/\r?\n/)[0]), `${name} missing from prompt`);
  }
  assert.match(text, /#d8ffd4/);
  assert.match(text, /tessellation segment/);
});

test('global parameter editing preserves input, identity and unrelated metadata', async () => {
  const scene = { ...cube(), uid: 'original-root', custom: { annotation: 'keep me' } };
  const before = clone(scene);
  const h = harness([provider(patch())]);
  const output = await h.run({ mode: 'edit', prompt: 'Double only the width.', scene, effort: 'low' });
  assert.deepEqual(scene, before);
  assert.equal(output.result.primitive.w, 2);
  assert.equal(output.result.uid, before.uid);
  assert.deepEqual(output.result.custom, before.custom);
  assert.match(JSON.stringify(h.calls[0].body.input), /original-root/);
});

test('patch preserves every untouched branch exactly when the original scene has no UIDs', async () => {
  const scene = { name: 'Assembly', operation: 'union', children: [cube('Target'), cube('Untouched')] };
  const before = clone(scene);
  const h = harness([provider(patch('/children/0/primitive/w', 2))]);
  const output = await h.run({ mode: 'edit', prompt: 'Double only the first cube width.', scene, effort: 'low' });
  const expected = clone(before);
  expected.children[0].primitive.w = 2;
  assert.deepEqual(output.result, expected);
  assert.deepEqual(output.result.children[1], before.children[1]);
  assert.deepEqual(scene, before);
  assert.deepEqual(output.changes, ['/children/0/primitive/w']);
});

test('node editing includes spatial context and cannot mutate a sibling or source scene', async () => {
  const node = { ...cube('Target'), uid: 'target-id' };
  const scene = { name: 'Assembly', operation: 'union', children: [node, cube('Sibling')] };
  const before = clone(scene);
  let contextArgs;
  const h = harness([provider(patch())], {
    buildEditContext: async (...args) => {
      contextArgs = args;
      return { testMarker: 'SPATIAL_CONTEXT_SENTINEL', ancestors: ['Assembly'], related: ['Sibling'] };
    },
  });
  const output = await h.run({ mode: 'node', prompt: 'Double only the width.', scene, node, path: '0.0', effort: 'medium' });
  assert.equal(contextArgs[1], '0.0');
  assert.deepEqual(scene, before);
  assert.equal(output.result.primitive.w, 2);
  assert.equal(output.result.uid, 'target-id');
  assert.match(JSON.stringify(h.calls[0].body.input), /SPATIAL_CONTEXT_SENTINEL/);
});

test('invalid dimensions trigger one bounded repair with concrete feedback', async () => {
  const h = harness([provider(replace(wrappedCube('Bad', -2))), provider(replace())]);
  const output = await h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' });
  assert.equal(h.calls.length, 2);
  assert.equal(output.result.primitive.w, 1);
  assert.match(JSON.stringify(h.calls[1].body.input), /positive|dimension|invalid/i);
  assert.equal(h.calls[1].body.reasoning.effort, 'medium');
});

test('three invalid candidates fail atomically without a result or an endless retry', async () => {
  const h = harness([provider(replace(wrappedCube('Bad', -1)))]);
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' }));
  assert.equal(h.calls.length, 3);
});

test('maxRepairs=0 performs only the first attempt', async () => {
  const h = harness([provider(replace(wrappedCube('Bad', -1)))], { maxRepairs: 0 });
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' }));
  assert.equal(h.calls.length, 1);
});

test('geometry failure is repaired with renderer diagnostics', async () => {
  let inspections = 0;
  const h = harness([provider(replace()), provider(replace(wrappedCube('Repaired', 2)))], {
    inspectGeometry: async root => (++inspections === 1
      ? { ...goodGeometry(root), ok: false, errors: ['Boolean result is empty at 0.1'], warnings: [] }
      : goodGeometry(root)),
  });
  const output = await h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' });
  assert.equal(output.result.name, 'Repaired');
  assert.equal(h.calls.length, 2);
  assert.match(JSON.stringify(h.calls[1].body.input), /Boolean result is empty at 0\.1/);
});

test('geometry ok=false without diagnostics cannot pass and receives one repair', async () => {
  let inspections = 0;
  const h = harness([provider(replace()), provider(replace(wrappedCube('Repaired', 2)))], {
    inspectGeometry: async root => (++inspections === 1
      ? { ...goodGeometry(root), ok: false, errors: [] }
      : goodGeometry(root)),
  });
  const output = await h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' });
  assert.equal(output.result.name, 'Repaired');
  assert.equal(h.calls.length, 2);
  assert.equal(output.meta.framework.attempts[0].passed, false);
  assert.match(JSON.stringify(h.calls[1].body.input), /Geometry inspection failed without diagnostics/);
});

test('repeated geometry ok=false without diagnostics fails within the configured limit', async () => {
  const h = harness([provider(replace())], {
    maxRepairs: 1,
    inspectGeometry: async root => ({ ...goodGeometry(root), ok: false, errors: [] }),
  });
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' }),
    error => error.code === 'VALIDATION_FAILED' && error.attempts.every(attempt => !attempt.passed));
  assert.equal(h.calls.length, 2);
});

test('warnings do not force a new generation', async () => {
  const h = harness([provider(replace())], {
    inspectGeometry: async root => ({ ...goodGeometry(root), warnings: ['A possible disconnected part needs review.'] }),
  });
  const output = await h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' });
  assert.equal(h.calls.length, 1);
  assert.ok(output.result);
});

test('failed measurable constraints trigger a repair using the measured value', async () => {
  const envelope = replace();
  envelope.checks = [{ kind: 'extent', path: '0', otherPath: '', axis: 'x', comparison: 'eq', value: 2, tolerance: 0.001 }];
  const repaired = replace(wrappedCube('Width two', 2));
  repaired.checks = clone(envelope.checks);
  const h = harness([provider(envelope), provider(repaired)]);
  const output = await h.run({ mode: 'create', prompt: 'Make a cube with width two.', effort: 'medium' });
  assert.equal(h.calls.length, 2);
  assert.equal(output.result.primitive.w, 2);
  assert.match(JSON.stringify(h.calls[1].body.input), /measured 1|extent/i);
});

test('repair cannot erase the original measurable acceptance checks', async () => {
  const envelope = replace();
  envelope.checks = [{ kind: 'extent', path: '0', otherPath: '', axis: 'x', comparison: 'eq', value: 2, tolerance: 0.001 }];
  const h = harness([provider(envelope), provider(replace())], { maxRepairs: 1 });
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make a cube with width two.', effort: 'medium' }));
  assert.equal(h.calls.length, 2);
});

test('malformed acceptance-check syntax remains repairable', async () => {
  const malformed = replace();
  malformed.checks = [{ kind: 'extent', path: 'root', otherPath: '', axis: 'x', comparison: 'eq', value: 1, tolerance: 0.001 }];
  const corrected = replace();
  corrected.checks = [{ ...malformed.checks[0], path: '0' }];
  const h = harness([provider(malformed), provider(corrected)]);
  const output = await h.run({ mode: 'create', prompt: 'Make a cube with width one.', effort: 'medium' });
  assert.equal(h.calls.length, 2);
  assert.equal(output.result.primitive.w, 1);
});

test('real geometry inspection rejects an empty Boolean and accepts its repaired geometry', async () => {
  const empty = {
    name: 'Empty difference', transform: null, primitive: null, operation: 'subtract', repeat: null,
    children: [wrappedCube('Positive'), wrappedCube('Cutter')],
  };
  const h = harness([provider(replace(empty)), provider(replace())], { inspectGeometry });
  const output = await h.run({ mode: 'create', prompt: 'Make one visible cube.', effort: 'medium' });
  assert.equal(h.calls.length, 2);
  assert.equal(output.result.primitive.type, 'cube');
  assert.equal(output.meta.framework.repairs, 1);
});

for (const status of [401, 429, 500]) {
  test(`provider HTTP ${status} is reported after bounded transport retries without a geometry repair or silent model fallback`, async () => {
    const h = harness([() => jsonResponse({ error: { message: 'mock provider failure' } }, status)]);
    await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'high' }));
    assert.equal(h.calls.length, status === 401 ? 1 : 3);
    assert.equal(h.inspected.length, 0);
  });
}

test('unsupported effort is not silently downgraded', async () => {
  const h = harness([jsonResponse({ error: { message: "Unsupported value: 'max' for reasoning.effort." } }, 400)]);
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'max' }));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.reasoning.effort, 'max');
});

test('unknown local effort is rejected before an API request', async () => {
  const h = harness();
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'made-up-tier' }));
  assert.equal(h.calls.length, 0);
});

test('a pre-cancelled request performs no API request', async () => {
  const controller = new AbortController();
  controller.abort();
  const h = harness(undefined, { signal: controller.signal });
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' }));
  assert.equal(h.calls.length, 0);
});

test('cancellation after provider response prevents geometry checking or result acceptance', async () => {
  const controller = new AbortController();
  const h = harness([() => {
    controller.abort();
    return jsonResponse(provider(replace()));
  }], { signal: controller.signal });
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' }));
  assert.equal(h.calls.length, 1);
  assert.equal(h.inspected.length, 0);
});

test('cancellation during inspection prevents repair and result acceptance', async () => {
  const controller = new AbortController();
  const h = harness([provider(replace())], {
    signal: controller.signal,
    inspectGeometry: async root => { controller.abort(); return goodGeometry(root); },
  });
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' }));
  assert.equal(h.calls.length, 1);
});

test('incomplete provider responses are never accepted as a finished scene', async () => {
  const h = harness([provider(replace(), { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })]);
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' }));
  assert.equal(h.inspected.length, 0);
});

test('refusal is surfaced without a geometry repair', async () => {
  const h = harness([{
    status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Mock refusal.' }] }],
  }]);
  await assert.rejects(h.run({ mode: 'create', prompt: 'Make one cube.', effort: 'medium' }));
  assert.equal(h.calls.length, 1);
});

test('clarification returns no scene and consumes no repair', async () => {
  const h = harness([provider({ action: 'clarify', replacement: null, patches: [], message: 'Which part should move?', plan: [], checks: [] })]);
  await assert.rejects(h.run({ mode: 'create', prompt: 'Move that.', effort: 'medium' }), error => error.code === 'CLARIFICATION');
  assert.equal(h.calls.length, 1);
  assert.equal(h.inspected.length, 0);
});

for (const [label, overrides, input] of [
  ['missing key', { apiKey: '' }, { mode: 'create', prompt: 'Make one cube.', effort: 'medium' }],
  ['empty prompt', {}, { mode: 'create', prompt: '   ', effort: 'medium' }],
  ['missing authoritative rule', { loadAssets: async () => { const a = await loadAssets(); delete a.parameterRules; return a; } }, { mode: 'create', prompt: 'Make one cube.', effort: 'medium' }],
  ['missing node scope', {}, { mode: 'node', prompt: 'Move it.', path: '0.0', effort: 'medium' }],
]) {
  test(`${label} fails before an API request`, async () => {
    const h = harness(undefined, overrides);
    await assert.rejects(h.run(input));
    assert.equal(h.calls.length, 0);
  });
}

async function withMockFetch(response, action) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  try { return await action(); } finally { globalThis.fetch = original; }
}

test('client NDJSON parser handles split UTF-8 characters and a final line without newline', async () => {
  const text = JSON.stringify({ type: 'progress', stage: 'checking', message: '检查几何' }) + '\n' +
    JSON.stringify({ type: 'result', result: cube('飞机'), meta: { action: 'replace' } });
  const bytes = new TextEncoder().encode(text);
  const firstChineseByte = bytes.findIndex(byte => byte > 127);
  const cuts = [0, 5, firstChineseByte + 1, firstChineseByte + 2, bytes.length - 3, bytes.length];
  const stream = new ReadableStream({ start(controller) {
    for (let i = 1; i < cuts.length; i++) controller.enqueue(bytes.slice(cuts[i - 1], cuts[i]));
    controller.close();
  } });
  const progress = [];
  const reply = await withMockFetch(new Response(stream), () => requestGeneration(
    { mode: 'create', prompt: 'Make a plane.' }, { onProgress: event => progress.push(event) },
  ));
  assert.equal(progress[0].message, '检查几何');
  assert.equal(reply.result.name, '飞机');
});

test('client refuses a stream that closes before its result', async () => {
  await assert.rejects(withMockFetch(new Response('{"type":"progress","stage":"checking"}\n'), () => requestGeneration(
    { mode: 'create', prompt: 'Make one cube.' },
  )), /before a result/);
});

test('client preserves clarification codes without returning an earlier result', async () => {
  const stream = JSON.stringify({ type: 'result', result: cube() }) + '\n' +
    JSON.stringify({ type: 'error', code: 'CLARIFICATION', message: 'Which part should move?' }) + '\n';
  await assert.rejects(withMockFetch(new Response(stream), () => requestGeneration(
    { mode: 'create', prompt: 'Move it.' },
  )), error => error.code === 'CLARIFICATION' && /Which part/.test(error.message));
});

test('client does not return a buffered result after cancellation', async () => {
  const controller = new AbortController();
  const stream = JSON.stringify({ type: 'progress', stage: 'checking' }) + '\n' +
    JSON.stringify({ type: 'result', result: cube() }) + '\n';
  await assert.rejects(withMockFetch(new Response(stream), () => requestGeneration(
    { mode: 'create', prompt: 'Make one cube.' },
    { signal: controller.signal, onProgress: () => controller.abort() },
  )), error => error.name === 'AbortError');
});

test('client surfaces HTTP errors before trying to parse a generation stream', async () => {
  await assert.rejects(withMockFetch(jsonResponse({ error: 'Mock missing API key.' }, 401), () => requestGeneration(
    { mode: 'create', prompt: 'Make one cube.' },
  )), /Mock missing API key/);
});
