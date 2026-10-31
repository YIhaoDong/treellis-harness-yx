import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { applyGenerationEnvelope, validateAML } from '../src/generation/amlContract.mjs'

const cube = (name = 'Cube') => ({ name, primitive: { type: 'cube', w: 1, h: 1, d: 1 } })
const clone = value => JSON.parse(JSON.stringify(value))
const check = (path = '0', value = 1) => ({ kind: 'count', path, otherPath: '', axis: 'x', comparison: 'eq', value, tolerance: 0 })
const patch = checks => ({ action: 'patch', replacement: null, patches: [], message: 'The requested measurable result already holds.', plan: [], checks })
const replacement = node => ({ action: 'replace', replacement: node, patches: [], message: 'Added the selected detail.', plan: [], checks: [] })
const baseline = () => ({ name: 'Scene', uid: 'scene-id', operation: 'union', children: [
  { ...cube('Body'), uid: 'body-id', editor: { keep: 'body' } },
  { name: 'Cowl', uid: 'cowl-id', _uid: 'legacy-cowl', kind: 'primitive', nodeKind: 'primitive', editor: { keep: 'cowl' }, primitive: { type: 'cylinder', r: 1, h: 1, radialSegments: 24 } },
] })
function selectedCandidate(scene = baseline()) {
  const candidate = applyGenerationEnvelope(replacement({ name: 'Cowl', operation: 'union', children: [
    { name: 'Original body', primitive: { type: 'cylinder', r: 1, h: 1 } }, cube('Detail'),
  ] }), { mode: 'node', scene, node: scene.children[1], path: '0.1', allowStructure: true })
  const full = clone(scene)
  full.children[1] = candidate.root
  return { scene, candidate, full }
}

test('an explicit selected primitive-to-assembly replacement preserves its host identity in full-scene validation', () => {
  const { scene, candidate, full } = selectedCandidate()
  assert.equal(candidate.root.uid, 'cowl-id')
  assert.equal(candidate.root._uid, 'legacy-cowl')
  assert.deepEqual(candidate.root.editor, scene.children[1].editor)
  assert.equal(candidate.root.kind, undefined)
  assert.equal(candidate.root.nodeKind, undefined)
  assert.ok(candidate.root.children.every(child => child.uid === undefined))
  assert.equal(validateAML(full, { baseline: scene, allowPositionalMatch: true }).ok, false)
  const result = validateAML(full, { baseline: scene, allowPositionalMatch: true, selectedReplacementPath: '0.1' })
  assert.equal(result.ok, true, result.errors.join('\n'))
  assert.deepEqual(full.children[0], scene.children[0])
})

test('the selected replacement baseline is exact, not a global relaxation of changed-kind UID matching', () => {
  const { scene, full } = selectedCandidate()
  assert.equal(validateAML(full, { baseline: scene, allowPositionalMatch: true, selectedReplacementPath: '0.0' }).ok, false)
  const stolen = clone(full)
  stolen.children[1].uid = scene.children[0].uid
  const report = validateAML(stolen, { baseline: scene, allowPositionalMatch: true, selectedReplacementPath: '0.1' })
  assert.equal(report.ok, false)
  assert.ok(report.errors.some(error => /uid: unsupported or changed metadata/.test(error)))
})

test('selected replacement permission cannot authorize sibling metadata changes or invented metadata', () => {
  for (const mutate of [
    root => { root.children[0].editor.keep = 'changed' },
    root => { root.children[1].editor.keep = 'changed' },
    root => { root.children[1].arbitrary = true },
    root => { root.children[1].children[0].uid = 'body-id' },
  ]) {
    const { scene, full } = selectedCandidate()
    mutate(full)
    assert.equal(validateAML(full, { baseline: scene, allowPositionalMatch: true, selectedReplacementPath: '0.1' }).ok, false)
  }
})

test('the generated replacement still cannot impersonate host identities before reconciliation', () => {
  const scene = baseline()
  for (const metadata of [{ uid: 'cowl-id' }, { uid: 'body-id' }, { editor: { keep: 'cowl' } }]) {
    assert.throws(() => applyGenerationEnvelope(replacement({ ...cube('Cowl'), ...metadata }), {
      mode: 'node', scene, node: scene.children[1], path: '0.1', allowStructure: true,
    }), /unsupported or changed metadata/)
  }
})

test('kind changes cannot retain stale render selectors or legacy kind-specific primitive settings', () => {
  for (const selector of ['kind', 'nodeKind', 'repeatType', 'repeatMode']) {
    const scene = baseline()
    scene.children[1][selector] = 'old-selector'
    const { full } = selectedCandidate(scene)
    full.children[1][selector] = 'old-selector'
    const report = validateAML(full, { baseline: scene, allowPositionalMatch: true, selectedReplacementPath: '0.1' })
    assert.equal(report.ok, false)
    assert.ok(report.errors.some(error => /stale render-kind metadata/.test(error)))
  }
  const scene = baseline(), full = clone(scene)
  full.children[1] = { name: 'Cowl', uid: 'cowl-id', primitive: { type: 'cube', w: 1, h: 1, d: 1, radialSegments: 24 } }
  assert.equal(validateAML(full, { baseline: scene, allowPositionalMatch: true, selectedReplacementPath: '0.1' }).ok, false)
})

test('a selected changed parent cannot transfer old descendant identities into new content semantics', () => {
  const old = { name: 'Assembly', uid: 'parent-id', operation: 'union', children: [{ ...cube('Part'), uid: 'old-part' }] }
  const scene = { name: 'Scene', operation: 'union', children: [old] }
  const next = applyGenerationEnvelope(replacement({ name: 'Assembly', repeat: { type: 'linear', count: 2, t: [2, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, children: [cube('Part')] }), {
    mode: 'node', scene, node: old, path: '0.0', allowStructure: true,
  })
  assert.equal(next.root.uid, 'parent-id')
  assert.equal(next.root.children[0].uid, undefined)
  const full = { ...clone(scene), children: [next.root] }
  assert.equal(validateAML(full, { baseline: scene, selectedReplacementPath: '0.0' }).ok, true)
  full.children[0].children[0].uid = 'old-part'
  assert.equal(validateAML(full, { baseline: scene, selectedReplacementPath: '0.0' }).ok, false)
})

test('nested selected replacement works through preserved ambiguous-name ancestors', () => {
  const old = baseline()
  const scene = { name: 'Outer', operation: 'union', children: [
    { name: 'Duplicate', operation: 'union', custom: { preserve: true }, children: old.children },
    { name: 'Duplicate', operation: 'union', children: [cube('Other')] },
  ] }
  const { candidate } = selectedCandidate(old)
  const full = clone(scene)
  full.children[0].children[1] = candidate.root
  const report = validateAML(full, { baseline: scene, allowPositionalMatch: true, selectedReplacementPath: '0.0.1' })
  assert.equal(report.ok, true, report.errors.join('\n'))
})

test('selected replacement paths must exist in both baseline and result and use strict node-path syntax', () => {
  for (const selectedReplacementPath of ['0.01', '0.__proto__', '0.-1', '0.9', {}, 0]) {
    const scene = baseline()
    assert.equal(validateAML(clone(scene), { baseline: scene, selectedReplacementPath }).ok, false)
  }
  const scene = baseline(), full = clone(scene)
  full.children.pop()
  assert.equal(validateAML(full, { baseline: scene, selectedReplacementPath: '0.1' }).ok, false)
  assert.equal(validateAML(cube(), { selectedReplacementPath: '0' }).ok, false)
})

test('a checked no-op in edit and node modes clones the exact baseline and reports zero changes', () => {
  const scene = baseline(), before = JSON.stringify(scene)
  for (const mode of ['edit', 'node']) {
    const node = mode === 'node' ? scene.children[1] : scene
    const envelope = patch([check(mode === 'node' ? '0.1' : '0', mode === 'node' ? 1 : 2)])
    const candidate = applyGenerationEnvelope(envelope, { mode, scene, node, path: '0.1' })
    assert.equal(candidate.action, 'patch')
    assert.deepEqual(candidate.changes, [])
    assert.equal(JSON.stringify(candidate.root), JSON.stringify(node))
    assert.notEqual(candidate.root, node)
    assert.notEqual(candidate.root.primitive || candidate.root.children, node.primitive || node.children)
    assert.notEqual(candidate.checks, envelope.checks)
  }
  assert.equal(JSON.stringify(scene), before)
})

test('empty patches without a valid measurable check, or in create mode, remain rejected', () => {
  const scene = baseline()
  assert.throws(() => applyGenerationEnvelope(patch([]), { mode: 'edit', scene }), /at least one measurable/)
  for (const invalid of [{ ...check(), kind: 'looks_good' }, { ...check(), path: 'missing' }, { ...check(), tolerance: -1 }, { ...check(), value: Infinity }, { ...check(), otherPath: 'bad.path' }]) {
    assert.throws(() => applyGenerationEnvelope(patch([invalid]), { mode: 'edit', scene }))
  }
  assert.throws(() => applyGenerationEnvelope(patch([check()]), { mode: 'create' }), /require a replacement/)
  assert.throws(() => applyGenerationEnvelope({ ...patch([check()]), replacement: cube() }, { mode: 'edit', scene }), /replacement null/)
})

test('unchanged value patches also require checks and report no changed paths', () => {
  const scene = { name: 'Array', transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    repeat: { type: 'circular', count: 3, n: 3, radius: 2, t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    children: [{ ...cube('Part'), primitive: { ...cube().primitive, material: { color: '#ffffff', roughness: 0.8 } } }],
  }
  const patches = [
    { path: '/name', value: 'Array' }, { path: '/transform/t', value: [0, 0, 0] }, { path: '/transform/s/1', value: 1 },
    { path: '/repeat/r', value: [0, 0, 0] }, { path: '/repeat/t/0', value: 0 }, { path: '/repeat/count', value: 3 }, { path: '/repeat/radius', value: 2 },
    { path: '/children/0/primitive/w', value: 1 }, { path: '/children/0/primitive/material/color', value: '#ffffff' },
  ]
  const before = JSON.stringify(scene)
  assert.throws(() => applyGenerationEnvelope({ ...patch([]), patches }, { mode: 'edit', scene }), /at least one measurable/)
  const candidate = applyGenerationEnvelope({ ...patch([check('0', 3)]), patches }, { mode: 'edit', scene })
  assert.deepEqual(candidate.changes, [])
  assert.equal(JSON.stringify(candidate.root), before)
  assert.equal(JSON.stringify(scene), before)
})

test('patch change tracking distinguishes missing defaults, real changes and unchanged siblings', () => {
  const scene = { name: 'Array', repeat: { type: 'linear', count: 3, n: 3 }, children: [cube('Part')] }
  const candidate = applyGenerationEnvelope({ ...patch([]), patches: [
    { path: '/name', value: 'Array' }, { path: '/repeat/count', value: 4 },
    { path: '/children/0/transform/t/0', value: 0 }, { path: '/children/0/primitive/w', value: 1 },
    { path: '/children/0/primitive/material/color', value: '#ffffff' },
  ] }, { mode: 'edit', scene })
  assert.deepEqual(candidate.changes, ['/repeat/count', '/children/0/transform/t/0', '/children/0/primitive/material/color'])
  assert.equal(candidate.root.repeat.count, 4)
  assert.equal(candidate.root.repeat.n, 4)
  assert.deepEqual(candidate.root.children[0].transform.t, [0, 0, 0])
  assert.equal(scene.repeat.count, 3)
  assert.equal(scene.children[0].transform, undefined)
})

test('checked unchanged completion and checkpoints do not call the scene/history apply callback', async () => {
  const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  const reactURL = asModule(`export const useState=initial=>{let value=initial;return [value,next=>{value=typeof next==='function'?next(value):next}];};export const useRef=initial=>({current:initial});export const useEffect=fn=>fn();export const useLayoutEffect=fn=>fn();`)
  const clientURL = asModule('export const requestGeneration=(...args)=>globalThis.__amlNoopRequest(...args);')
  const hookSource = (await readFile(new URL('../src/hooks/useGenerationRun.jsx', import.meta.url), 'utf8'))
    .replace("'react'", JSON.stringify(reactURL))
    .replace("'../staticDemo/mode.mjs'", JSON.stringify(new URL('../src/staticDemo/mode.mjs', import.meta.url).href))
    .replace("'../generation/client.mjs'", JSON.stringify(clientURL))
    .replace("'../generation/progressState.mjs'", JSON.stringify(new URL('../src/generation/progressState.mjs', import.meta.url).href))
  const { default: useGenerationRun } = await import(asModule(hookSource))
  const scene = baseline(), before = JSON.stringify(scene)
  let historyApplies = 0, completions = 0
  globalThis.__amlNoopRequest = async (_input, options) => {
    const candidate = applyGenerationEnvelope(patch([check('0', 2)]), { mode: 'edit', scene })
    const result = { result: candidate.root, action: candidate.action, changes: candidate.changes, meta: {} }
    options.onCheckpoint({ ...result, type: 'checkpoint', completedSteps: 1, totalSteps: 1 })
    return result
  }
  try {
    const run = useGenerationRun({ scene, identity: 'checked-noop', onApply: () => historyApplies++, onComplete: () => completions++ })
    await run.run({ mode: 'edit', scene, prompt: 'Keep the existing two parts.', effort: 'max' })
    assert.equal(historyApplies, 0)
    assert.equal(completions, 1)
    assert.equal(JSON.stringify(scene), before)
  } finally { delete globalThis.__amlNoopRequest }
})
