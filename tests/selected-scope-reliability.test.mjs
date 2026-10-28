import test from 'node:test'
import assert from 'node:assert/strict'
import { runGeneration } from '../src/generation/pipeline.mjs'
import { ASSET_NAMES } from '../src/generation/config.mjs'
import { inspectGeometry } from '../src/generation/geometry.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
const cube = (name = 'Cube', width = 2) => ({ name, primitive: { type: 'cube', w: width, h: 1, d: 1 } })
const loadAssets = async () => Object.fromEntries(ASSET_NAMES.map(name => [name, name === 'jsonCase' ? JSON.stringify({ examples: [{ tags: [], description: 'One cube', aml: cube() }] }) : 'Configured authoritative rule.']))
const check = (path, value) => ({ kind: 'extent', path, otherPath: '', axis: 'x', comparison: 'eq', value, tolerance: 0.001 })
const envelope = changes => ({ action: 'patch', replacement: null, patches: [], message: 'The requested size is already satisfied.', suggestions: [], plan: [], checks: [], ...changes })
function harness(envelopes, options = {}) {
  const calls = [], inspected = []
  const dependencies = { apiKey: 'mock-key', loadAssets, maxRepairs: 0, buildEditContext: async () => ({}),
    fetchImpl: async (_url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(envelopes[Math.min(calls.length - 1, envelopes.length - 1)]) }), { headers: { 'Content-Type': 'application/json' } }) },
    inspectGeometry: async root => { inspected.push(clone(root)); return inspectGeometry(root) }, ...options,
  }
  return { calls, inspected, run: input => runGeneration(input, dependencies) }
}

test('a selected primitive can become a checked detail assembly without losing its host identity or rejecting it in whole-scene validation', async () => {
  const selected = { name: 'Cowl', uid: 'host-cowl', annotation: { label: 'preserve' }, transform: { t: [1, 0, 0], r: [0, 0, 90], s: [1, 1, 1] }, primitive: { type: 'cylinder', r: 1, h: 1 } }
  const sibling = { ...cube('Outside'), uid: 'outside-uid', transform: { t: [4, 0, 0] } }
  const scene = { name: 'Scene', uid: 'root-uid', operation: 'union', children: [selected, sibling] }, before = clone(scene)
  const replacement = { name: 'Cowl', operation: 'union', transform: clone(selected.transform), children: [
    { name: 'Original body', primitive: { type: 'cylinder', r: 1, h: 1 } },
    { name: 'Visible detail', transform: { t: [1, 0, 0] }, ...cube('Visible detail', 0.1) },
  ] }
  const h = harness([envelope({ action: 'replace', replacement, message: 'Added visible detail.', checks: [] })])
  const output = await h.run({ mode: 'node', scene, node: selected, path: '0.0', prompt: 'Add one visible detail to this cowl.', effort: 'max' })
  assert.equal(h.calls.length, 1)
  assert.equal(output.result.operation, 'union')
  assert.equal(output.result.uid, selected.uid)
  assert.deepEqual(output.result.annotation, selected.annotation)
  assert.deepEqual(output.result.transform, selected.transform)
  assert.deepEqual(h.inspected[0].children[1], sibling)
  assert.deepEqual(scene, before)
  assert.equal(output.meta.framework.attempts[0].passed, true)
  assert.equal(output.meta.framework.geometry.stats.nodeCount, 5)
})

test('explicit selected replacement mapping cannot permit generated UID impersonation in its descendants', async () => {
  const selected = { ...cube('Selected'), uid: 'selected-uid' }
  const scene = { name: 'Scene', operation: 'union', children: [selected, { ...cube('Outside'), uid: 'outside-uid' }] }
  const replacement = { name: 'Selected', operation: 'union', children: [{ ...cube('Impersonator'), uid: 'outside-uid' }] }
  const h = harness([envelope({ action: 'replace', replacement })])
  await assert.rejects(h.run({ mode: 'node', scene, node: selected, path: '0.0', prompt: 'Add detail.', effort: 'max' }), error => error.code === 'VALIDATION_FAILED' && /uid/.test(error.message))
  assert.equal(h.inspected.length, 0)
})

for (const mode of ['edit', 'node']) {
  test(`${mode}: an objectively checked no-op succeeds once and returns byte-equivalent scene data with no changes`, async () => {
    const selected = { ...cube('Selected'), uid: 'selected-uid', extra: { note: 'keep' } }
    const scene = mode === 'node' ? { name: 'Scene', operation: 'union', children: [selected, { ...cube('Outside'), uid: 'outside-uid' }] } : selected
    const before = clone(scene), path = mode === 'node' ? '0.0' : '0'
    const h = harness([envelope({ checks: [check(path, 2)] })])
    const output = await h.run({ mode, scene, ...(mode === 'node' ? { node: selected, path } : {}), prompt: 'Make the width exactly two.', effort: 'xhigh' })
    assert.equal(h.calls.length, 1)
    assert.equal(h.inspected.length, 1)
    assert.deepEqual(scene, before)
    assert.deepEqual(output.result, selected)
    assert.deepEqual(output.changes, [])
    assert.equal(output.action, 'patch')
    assert.ok(output.meta.framework.checks.every(result => result.passed))
  })
}

test('a checked no-op still fails when its measurable check is false and does not bypass bounded repair', async () => {
  const scene = { ...cube(), uid: 'original' }, before = clone(scene)
  const h = harness([envelope({ checks: [check('0', 3)] })], { maxRepairs: 1 })
  await assert.rejects(h.run({ mode: 'edit', scene, prompt: 'Set the width to three.', effort: 'max' }), error => error.code === 'VALIDATION_FAILED' && error.attempts.length === 2)
  assert.equal(h.calls.length, 2)
  assert.equal(h.inspected.length, 2)
  assert.deepEqual(scene, before)
})

test('a no-op cannot replace frozen failed acceptance checks with weaker passing checks', async () => {
  const scene = cube('Original', 1)
  const h = harness([
    envelope({ patches: [{ path: '/primitive/w', value: 1 }], checks: [check('0', 2)] }),
    envelope({ checks: [check('0', 1)] }),
  ], { maxRepairs: 1 })
  await assert.rejects(h.run({ mode: 'edit', scene, prompt: 'Set width to two.', effort: 'max' }), error => error.code === 'VALIDATION_FAILED')
  assert.equal(h.calls.length, 2)
  assert.ok(JSON.stringify(h.calls[1].input).includes('FROZEN_ACCEPTANCE_CHECKS'))
  assert.equal(scene.primitive.w, 1)
})

test('an empty patch without objective checks remains invalid and cannot become a silent success', async () => {
  const h = harness([envelope({ checks: [] })])
  await assert.rejects(h.run({ mode: 'edit', scene: cube(), prompt: 'Improve this object.', effort: 'max' }), error => error.code === 'VALIDATION_FAILED')
  assert.equal(h.inspected.length, 0)
})

test('creation still requires a replacement and cannot complete as an empty checked patch', async () => {
  const h = harness([envelope({ checks: [check('0', 2)] })])
  await assert.rejects(h.run({ mode: 'create', prompt: 'Create one cube.', effort: 'max' }), error => error.code === 'VALIDATION_FAILED')
  assert.equal(h.inspected.length, 0)
})
