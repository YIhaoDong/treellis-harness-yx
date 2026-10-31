import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGenerationEnvelope, createResponseFormat, validateAML } from '../src/generation/amlContract.mjs';

const cube = (name = 'Cube') => ({ name, primitive: { type: 'cube', w: 1, h: 1, d: 1 } });
const response = (overrides = {}) => ({ action: 'patch', replacement: null, patches: [{ path: '/primitive/w', value: 2 }], message: 'Updated.', plan: [], checks: [], ...overrides });
const patch = (root, patches, extra = {}) => applyGenerationEnvelope(response({ patches }), { mode: 'edit', scene: root, ...extra });

test('strict schema exposes recursive renderer types and mode-specific actions', () => {
  const { schema, strict } = createResponseFormat('create');
  assert.equal(strict, true);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.action.enum, ['replace', 'clarify']);
  assert.equal(schema.$defs.node.anyOf.length, 7);
  for (const [name, definition] of Object.entries(schema.$defs)) {
    if (name === 'node' || name === 'vector') continue;
    assert.equal(definition.additionalProperties, false);
    assert.deepEqual(definition.required, Object.keys(definition.properties));
  }
});

test('small radii are valid while negative dimensions, invalid colors and mixed node kinds fail', () => {
  assert.equal(validateAML({ name: 'Pin', primitive: { type: 'cylinder', r: 0.02, h: 0.25 } }).ok, true);
  assert.equal(validateAML({ ...cube(), operation: 'union' }).ok, false);
  assert.equal(validateAML({ name: 'Bad', primitive: { type: 'sphere', r: -1 } }).ok, false);
  assert.equal(validateAML({ name: 'Bad', primitive: { type: 'sphere', r: Infinity } }).ok, false);
  assert.equal(validateAML({ name: 'Bad', primitive: { type: 'sphere', r: 1, material: { color: 'red' } } }).ok, false);
  assert.equal(validateAML({ name: 'Bad', operation: 'subtract', children: [cube()] }).ok, false);
});

test('parameter patches preserve baseline metadata, segment settings, UIDs and siblings byte for byte', () => {
  const scene = { name: 'Scene', operation: 'union', _uid: 'root', meta: { owner: 'local' }, children: [
    { name: 'Wheel', _uid: 'wheel', primitive: { type: 'cylinder', r: 0.5, h: 0.2, radialSegments: 24, material: { color: '#ffffff', roughness: 0.8 } } },
    { ...cube('Body'), _uid: 'body', custom: { keep: ['all', 3] } },
  ] };
  const before = JSON.stringify(scene);
  const { root, changes } = patch(scene, [{ path: '/children/0/primitive/r', value: 0.75 }]);
  assert.equal(JSON.stringify(scene), before);
  assert.deepEqual(root.children[1], scene.children[1]);
  assert.deepEqual(root.meta, scene.meta);
  assert.equal(root.children[0]._uid, 'wheel');
  assert.equal(root.children[0].primitive.radialSegments, 24);
  assert.deepEqual(root.children[0].primitive.material, scene.children[0].primitive.material);
  assert.deepEqual(changes, ['/children/0/primitive/r']);
});

test('patch can supply missing transform vectors and material color', () => {
  const { root } = patch(cube(), [{ path: '/transform/t/1', value: 3 }, { path: '/transform/s', value: [1, 2, 1] }, { path: '/primitive/material/color', value: '#aAbBcC' }]);
  assert.deepEqual(root.transform.t, [0, 3, 0]);
  assert.deepEqual(root.transform.s, [1, 2, 1]);
  assert.equal(root.primitive.material.color, '#aAbBcC');
});

test('node mode is scope-relative and never mutates parent or selection', () => {
  const scene = { operation: 'union', children: [cube('Selected'), cube('Sibling')] };
  const before = JSON.stringify(scene);
  const result = applyGenerationEnvelope(response(), { mode: 'node', node: scene.children[0], scene, path: '0.0' });
  assert.equal(result.root.primitive.w, 2);
  assert.equal(result.root.children, undefined);
  assert.equal(JSON.stringify(scene), before);
  assert.throws(() => applyGenerationEnvelope(response({ patches: [{ path: '/children/1/primitive/w', value: 3 }] }), { mode: 'node', node: scene.children[0], scene }), /outside the selected scope/);
});

test('patch rejects object injection, structural changes, UID edits, malformed indices and invalid parameters', () => {
  const scene = { ...cube(), _uid: 'original' };
  for (const path of ['/__proto__/polluted', '/constructor/prototype/a', '/primitive/type', '/_uid', '/children', '/transform/t/3', '/children/-1/primitive/w', '/children/01/primitive/w', '/primitive/widthSegments', '/primitive/ignored']) {
    assert.throws(() => patch(scene, [{ path, value: 1 }]));
  }
  assert.throws(() => patch(scene, [{ path: '/primitive/w', value: -3 }]), /dimension must be/);
  assert.throws(() => patch(scene, [{ path: '/transform/s', value: [1, 0, 1] }]), /scale components/);
  assert.throws(() => patch(scene, [{ path: '/primitive/w', value: { polluted: 1 } }]), /finite number/);
  assert.equal({}.polluted, undefined);
});

test('multiple patches are atomic when a later patch is invalid', () => {
  const scene = cube(), before = JSON.stringify(scene);
  assert.throws(() => patch(scene, [{ path: '/primitive/w', value: 8 }, { path: '/primitive/h', value: -1 }]));
  assert.equal(JSON.stringify(scene), before);
});

test('clarification carries question without generating changes', () => {
  const scene = cube();
  const result = applyGenerationEnvelope(response({ action: 'clarify', patches: [], message: 'Which axis should be longer?' }), { mode: 'edit', scene });
  assert.equal(result.action, 'clarify');
  assert.equal(result.root, scene);
  assert.deepEqual(result.changes, []);
  assert.throws(() => applyGenerationEnvelope(response({ action: 'clarify', message: '?' }), { mode: 'edit', scene }), /no changes/);
});

test('replacements require explicit structure permission, strip nulls and retain selection identity', () => {
  const envelope = response({ action: 'replace', replacement: { name: 'New shape', transform: null, primitive: { type: 'sphere', r: 0.4, material: null }, operation: null, repeat: null, children: null }, patches: [] });
  assert.throws(() => applyGenerationEnvelope(envelope, { mode: 'edit', scene: cube() }), /does not allow/);
  const created = applyGenerationEnvelope(envelope, { mode: 'create' });
  assert.deepEqual(created.root, { name: 'New shape', primitive: { type: 'sphere', r: 0.4 } });
  const changed = applyGenerationEnvelope(envelope, { mode: 'node', node: { ...cube(), _uid: 'kept' }, path: '0.3', allowStructure: true });
  assert.equal(changed.root._uid, 'kept');
  assert.deepEqual(changed.changes, ['0.3']);
  assert.throws(() => applyGenerationEnvelope(response(), { mode: 'create' }), /require a replacement/);
});

test('new nodes cannot introduce metadata or legacy renderer segment settings', () => {
  assert.equal(validateAML({ ...cube(), arbitrary: true }).ok, false);
  const old = { ...cube(), _uid: 'kept', primitive: { type: 'cube', w: 1, h: 1, d: 1, widthSegments: 24 } };
  assert.equal(validateAML(old, { baseline: old }).ok, true);
  assert.equal(validateAML(old).ok, false);
  assert.equal(validateAML({ ...old, _uid: 'changed' }, { baseline: old }).ok, false);
});

test('nested repeats count expanded primitives and enforce budgets without expansion', () => {
  const repeat = (count, child) => ({ name: 'Array', repeat: { type: 'linear', count, t: [10, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, children: [child] });
  const within = validateAML(repeat(8, repeat(4, cube())));
  assert.equal(within.ok, true, within.errors.join('\n'));
  assert.equal(within.stats.instances, 32);
  assert.equal(validateAML(repeat(64, repeat(64, cube()))).ok, false);
  assert.equal(validateAML(repeat(65, cube())).ok, false);
  assert.equal(validateAML({ name: 'Ring', repeat: { type: 'circular', count: 3, radius: 0 }, children: [cube()] }).ok, false);
  assert.equal(validateAML({ name: 'Many', operation: 'union', children: Array.from({ length: 5 }, () => cube()) }, { maxNodes: 3 }).ok, false);
});

test('repeat edits retain legacy n alias and update count consistently', () => {
  const scene = { name: 'Array', repeat: { type: 'linear', count: 3, n: 3, t: [4, 0, 0] }, children: [cube()] };
  const { root } = patch(scene, [{ path: '/repeat/count', value: 5 }]);
  assert.equal(root.repeat.count, 5);
  assert.equal(root.repeat.n, 5);
});

test('invalid envelopes and unchecked shape fields are rejected', () => {
  const scene = cube();
  assert.throws(() => applyGenerationEnvelope(response({ extra: true }), { mode: 'edit', scene }), /unsupported fields/);
  assert.throws(() => applyGenerationEnvelope(response({ checks: [{ kind: 'align', path: '0', otherPath: '', axis: 'y', comparison: 'eq', value: 0, tolerance: 0.1 }] }), { mode: 'edit', scene }), /needs otherPath/);
  assert.throws(() => applyGenerationEnvelope(response({ checks: [{ kind: 'count', path: '../0', otherPath: '', axis: 'y', comparison: 'eq', value: 2, tolerance: 0 }] }), { mode: 'edit', scene }), /invalid fields/);
  const polluted = JSON.parse('{"name":"Unsafe","primitive":{"type":"sphere","r":1},"__proto__":{"polluted":1}}');
  assert.equal(validateAML(polluted).ok, false);
});

test('structural insertion and reorder retain uniquely matched child metadata and tessellation', () => {
  const baseline = { name: 'Assembly', uid: 'root-id', operation: 'union', children: [
    { name: 'Wheel', uid: 'wheel-id', note: { keep: true }, primitive: { type: 'sphere', r: 1, widthSegments: 24, heightSegments: 24, material: { color: '#ffffff', roughness: 0.7 } } },
    { ...cube('Body'), uid: 'body-id', editor: { collapsed: true } },
  ] };
  const replacement = { name: 'Assembly', operation: 'union', children: [
    cube('Added'), cube('Body'), { name: 'Wheel', primitive: { type: 'sphere', r: 1.2, material: { color: '#00ff00' } } },
  ] };
  const result = applyGenerationEnvelope(response({ action: 'replace', replacement, patches: [] }), { mode: 'edit', scene: baseline, allowStructure: true });
  assert.equal(result.root.uid, 'root-id');
  assert.equal(result.root.children[0].uid, undefined);
  assert.equal(result.root.children[1].uid, 'body-id');
  assert.deepEqual(result.root.children[1].editor, { collapsed: true });
  const wheel = result.root.children[2];
  assert.equal(wheel.uid, 'wheel-id');
  assert.deepEqual(wheel.note, { keep: true });
  assert.equal(wheel.primitive.widthSegments, 24);
  assert.equal(wheel.primitive.heightSegments, 24);
  assert.equal(wheel.primitive.r, 1.2);
  assert.deepEqual(wheel.primitive.material, { color: '#00ff00', roughness: 0.7 });
  assert.equal(validateAML(result.root, { baseline }).ok, true);
  assert.equal(baseline.children[0].primitive.r, 1);
});

test('structural matching does not guess identities across duplicate names, changed kinds, or parents', () => {
  const baseline = { name: 'Assembly', operation: 'union', children: [
    { ...cube('Duplicate'), uid: 'dup-a', note: 'A' }, { ...cube('Duplicate'), uid: 'dup-b', note: 'B' },
    { ...cube('Changed'), uid: 'changed', note: 'Old cube' },
    { name: 'Group', operation: 'union', children: [{ ...cube('Moved'), uid: 'moved', note: 'Original parent' }] },
  ] };
  const replacement = { name: 'Assembly', operation: 'union', children: [
    cube('Duplicate'), cube('Duplicate'), { name: 'Changed', primitive: { type: 'sphere', r: 1 } }, cube('Moved'),
    { name: 'Group', operation: 'union', children: [cube('New')] },
  ] };
  const { root } = applyGenerationEnvelope(response({ action: 'replace', replacement, patches: [] }), { mode: 'edit', scene: baseline, allowStructure: true });
  for (const child of root.children.slice(0, 4)) { assert.equal(child.uid, undefined); assert.equal(child.note, undefined); }
  const attemptedReuse = JSON.parse(JSON.stringify(root));
  attemptedReuse.children[0].uid = 'dup-a';
  attemptedReuse.children[1].uid = 'dup-a';
  assert.equal(validateAML(attemptedReuse, { baseline }).ok, false);
});

test('new duplicate names cannot acquire one uniquely named original UID', () => {
  const baseline = { name: 'Assembly', operation: 'union', children: [{ ...cube('Part'), uid: 'original' }] };
  const replacement = { name: 'Assembly', operation: 'union', children: [cube('Part'), cube('Part')] };
  const { root } = applyGenerationEnvelope(response({ action: 'replace', replacement, patches: [] }), { mode: 'edit', scene: baseline, allowStructure: true });
  assert.ok(root.children.every(child => child.uid === undefined));
});

test('positional metadata matching is reserved for structure-preserving patches', () => {
  const baseline = { name: 'Assembly', operation: 'union', children: [{ ...cube('Legacy'), note: 'keep' }] };
  const { root } = patch(baseline, [{ path: '/children/0/name', value: 'Renamed' }]);
  assert.equal(root.children[0].note, 'keep');
  assert.equal(validateAML(root, { baseline }).ok, false);
  assert.equal(validateAML(root, { baseline, allowPositionalMatch: true }).ok, true);
});

test('root replacement of a legacy repeat does not carry stale render-kind selectors', () => {
  const baseline = { name: 'Legacy', uid: 'selection', kind: 'repeat', repeatType: 'linear', repeat: { type: 'linear', count: 3 }, children: [cube()] };
  const { root } = applyGenerationEnvelope(response({ action: 'replace', replacement: cube('Cube'), patches: [] }), { mode: 'node', node: baseline, allowStructure: true });
  assert.equal(root.uid, 'selection');
  assert.equal(root.kind, undefined);
  assert.equal(root.repeatType, undefined);
});
