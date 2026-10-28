import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { validateCompletedPartPaths, buildCompletedPartReferences, COMPLETED_REFERENCE_LIMITS } from '../src/generation/completedReferences.mjs'
import { runGenerationWorkflow } from '../src/generation/workflow.mjs'
import { applyGenerationEnvelope } from '../src/generation/amlContract.mjs'
import { buildEditContext, inspectGeometry } from '../src/generation/geometry.mjs'
import { ASSET_NAMES } from '../src/generation/config.mjs'
const clone = value => JSON.parse(JSON.stringify(value))
const rev = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const cube = name => ({ name, uid: `uid-${name}`, primitive: { type: 'cube', w: 1, h: 1, d: 1 } })
const scene = () => ({ name: 'Assembly', operation: 'union', transform: { t: [3, 4, 5], r: [0, 30, 0], s: [1, 2, 1] }, children: [cube('Alpha'), cube('Beta'), cube('Outside')] })
const plan = { summary: 'Independent parts', constraints: [], steps: [{ path: '0.0', title: 'A', instruction: 'Detail Alpha' }, { path: '0.1', title: 'B', instruction: 'Detail Beta' }] }
function harness({ stopAfter = 0 } = {}) {
  const contexts = [], calls = [], checkpoints = [], controller = new AbortController()
  const dependencies = { apiKey: 'mock-key', signal: controller.signal,
    callModel: async () => ({ status: 'completed', output_text: JSON.stringify(plan) }),
    buildEditContext: async (_scene, path) => ({ selectedPath: path, existingContextField: true }),
    runGeneration: async (input, dependencies) => {
      calls.push({ input: clone(input), dependencies })
      if (input.mode === 'node') contexts.push(await dependencies.buildEditContext(input.scene, input.path))
      const result = clone(input.node || input.scene)
      result.primitive.w += 1
      return { result, action: 'patch', changes: ['/primitive/w'], meta: {} }
    },
    onCheckpoint: checkpoint => { checkpoints.push(clone(checkpoint)); if (checkpoints.length === stopAfter) controller.abort() },
  }
  return { contexts, calls, checkpoints, dependencies, run: extra => runGenerationWorkflow({ mode: 'edit', scene: scene(), prompt: 'Refine two independent parts.', effort: 'max', strategy: 'staged', ...extra }, dependencies) }
}

test('each later staged part receives full earlier checked parameters from the current revision', async () => {
  const h = harness(), result = await h.run()
  assert.deepEqual(h.contexts[0].completedPartsReferences.parts, [])
  const references = h.contexts[1].completedPartsReferences
  assert.equal(references.readOnly, true)
  assert.equal(references.editablePath, '0.1')
  assert.equal(references.parts[0].path, '0.0')
  assert.equal(references.parts[0].node.primitive.w, 2)
  assert.equal(references.sourceSceneRevision, rev(h.calls[1].input.scene))
  assert.deepEqual(references.parts[0].ancestorChain[0].localTransform, scene().transform)
  assert.equal(h.contexts[1].existingContextField, true)
  assert.deepEqual(h.checkpoints[0].resume.completedPartPaths, ['0.0'])
  assert.equal(references.usage.includes('does not impose symmetry'), true)
  assert.deepEqual(result.result.children[2], scene().children[2])
})

test('Stop and resume restore exact completed paths without rerunning earlier parts', async () => {
  const first = harness({ stopAfter: 1 })
  let saved
  await assert.rejects(first.run(), error => { saved = error; return error.name === 'AbortError' })
  const second = harness()
  second.dependencies.callModel = async () => { throw new Error('Do not re-plan resumed work') }
  await second.run({ scene: saved.partialResult, resume: saved.resume })
  assert.equal(second.calls.length, 1)
  assert.equal(second.calls[0].input.path, '0.1')
  assert.equal(second.contexts[0].completedPartsReferences.parts[0].node.primitive.w, 2)
})

test('old resumes remain executable and mark missing history instead of guessing from names', async () => {
  const first = harness({ stopAfter: 1 })
  let saved
  await assert.rejects(first.run(), error => { saved = error; return true })
  delete saved.resume.completedPartPaths
  const second = harness()
  await second.run({ scene: saved.partialResult, resume: saved.resume })
  const context = second.contexts[0].completedPartsReferences
  assert.deepEqual(context.parts, [])
  assert.equal(context.unavailableHistoryParts, 1)
  assert.equal(context.historyStatus, 'completed-history-unavailable-for-some-parts')
})

test('a legacy continuation can persist newly completed paths without claiming lost earlier history', async () => {
  const first = harness({ stopAfter: 1 }), three = { ...plan, steps: [...plan.steps, { path: '0.2', title: 'C', instruction: 'Detail the third part' }] }
  first.dependencies.callModel = async () => ({ status: 'completed', output_text: JSON.stringify(three) })
  let stopped, continued
  await assert.rejects(first.run(), error => { stopped = error; return true })
  delete stopped.resume.completedPartPaths
  const second = harness({ stopAfter: 1 })
  await assert.rejects(second.run({ scene: stopped.partialResult, resume: stopped.resume }), error => { continued = error; return true })
  assert.deepEqual(continued.resume.completedPartPaths, ['0.1'])
  const last = harness()
  await last.run({ scene: continued.partialResult, resume: continued.resume })
  assert.equal(last.contexts[0].completedPartsReferences.unavailableHistoryParts, 1)
  assert.equal(last.contexts[0].completedPartsReferences.parts[0].path, '0.1')
})

test('invalid completed history is rejected before any model request', async () => {
  const first = harness({ stopAfter: 1 })
  let saved
  await assert.rejects(first.run(), error => { saved = error; return true })
  for (const paths of [['0.1'], ['0.0', '0.0'], ['0'], ['0.99'], ['0.00'], ['0.2', '0.0'], {}, null]) {
    const next = harness()
    await assert.rejects(next.run({ scene: saved.partialResult, resume: { ...saved.resume, completedPartPaths: paths } }), { code: 'INVALID_PLAN' })
    assert.equal(next.calls.length, 0)
  }
  const root = { children: [{ children: [cube('Nested')] }, cube('Pending')] }
  assert.throws(() => validateCompletedPartPaths(['0.0', '0.0.0'], { scene: root, scopePath: '0', remainingPaths: ['0.1'], completedPartsCount: 2 }), /overlap/)
  assert.throws(() => validateCompletedPartPaths(['0.1'], { scene: root, scopePath: '0.0', remainingPaths: ['0.0.0'], completedPartsCount: 1 }), /inside the scope/)
})

test('ordinary single-node context is untouched and arbitrary input referencePaths cannot add references', async () => {
  const h = harness()
  await h.run({ referencePaths: ['0.2'], completedPartPaths: ['0.2'], referenceSubtrees: { secret: true } })
  assert.deepEqual(h.contexts[0].completedPartsReferences.parts, [])
  assert.ok(h.contexts[1].completedPartsReferences.parts.every(part => part.path !== '0.2'))
  const single = harness()
  await single.run({ mode: 'node', strategy: 'single', path: '0.0', node: scene().children[0] })
  assert.equal(single.contexts[0].completedPartsReferences, undefined)
})

test('repeat templates and nonidentity ancestor coordinates remain compact, exact and detached', () => {
  const reference = { name: 'Repeated detail', repeat: { type: 'linear', count: 64, t: [5, 0, 0] }, children: [cube('Template')] }
  const root = { ...scene(), children: [{ name: 'Rotated parent', transform: { r: [0, 0, 45], s: [2, 1, 1] }, repeat: { type: 'linear', count: 3, t: [2, 0, 0] }, children: [reference] }, cube('Target')] }
  const context = buildCompletedPartReferences(root, { selectedPath: '0.1', scopePath: '0', completedPartPaths: ['0.0.0'], completedPartsCount: 1, sceneRevision: rev(root) })
  const part = context.parts[0]
  assert.deepEqual(part.node, reference)
  assert.equal(part.node.children.length, 1)
  assert.equal(part.ancestorChain.length, 2)
  assert.deepEqual(part.ancestorChain[1].localTransform.r, [0, 0, 45])
  assert.equal(part.ancestorChain[1].repeat.count, 3)
  part.node.children[0].primitive.w = 999
  part.ancestorChain[0].localTransform.t[0] = 999
  assert.equal(reference.children[0].primitive.w, 1)
  assert.equal(root.transform.t[0], 3)
})

test('whole references are omitted explicitly at node and character budgets', () => {
  const root = { children: [
    { name: 'Oversize nodes', operation: 'union', children: Array.from({ length: 64 }, (_, i) => cube(`Part${i}`)) },
    { ...cube('Oversize chars'), metadata: 'x'.repeat(11000) }, cube('Useful'), cube('Target'),
  ] }
  const context = buildCompletedPartReferences(root, { selectedPath: '0.3', scopePath: '0', completedPartPaths: ['0.0', '0.1', '0.2'], completedPartsCount: 3, sceneRevision: rev(root) })
  assert.deepEqual(context.parts.map(part => part.path), ['0.2'])
  assert.ok(context.omitted.some(item => item.path === '0.0' && item.reason === 'reference-node-budget-exceeded'))
  assert.ok(context.omitted.some(item => item.path === '0.1' && item.reason === 'reference-character-budget-exceeded'))
  assert.ok(JSON.stringify(context).length <= COMPLETED_REFERENCE_LIMITS.charsTotal)
  const many = { children: [...Array.from({ length: 5 }, (_, i) => ({ ...cube(`Large${i}`), note: 'x'.repeat(8500) })), cube('Target')] }
  const limited = buildCompletedPartReferences(many, { selectedPath: '0.5', scopePath: '0', completedPartPaths: ['0.0', '0.1', '0.2', '0.3', '0.4'], completedPartsCount: 5, sceneRevision: rev(many) })
  assert.ok(limited.parts.length < 5)
  assert.equal(limited.parts[0].path, '0.4')
  assert.ok(limited.omitted.some(item => item.reason === 'total-reference-character-budget-exceeded'))
  assert.ok(JSON.stringify(limited).length <= COMPLETED_REFERENCE_LIMITS.charsTotal)
  const group = name => ({ name, operation: 'union', children: Array.from({ length: 63 }, (_, i) => cube(`${name}${i}`)) })
  const nodes = { children: [group('A'), group('B'), group('C'), cube('Target')] }
  const bounded = buildCompletedPartReferences(nodes, { selectedPath: '0.3', scopePath: '0', completedPartPaths: ['0.0', '0.1', '0.2'], completedPartsCount: 3, sceneRevision: rev(nodes) })
  assert.equal(bounded.parts.length, 2) // Exactly 64 nodes per part and 128 total are allowed.
  assert.equal(bounded.omitted[0].reason, 'reference-node-budget-exceeded')
  assert.throws(() => validateCompletedPartPaths(['0.0', '0.1', '0.2', '0.3', '0.4', '0.5'], { scene: { children: Array.from({ length: 7 }, (_, i) => cube(String(i))) }, scopePath: '0', remainingPaths: ['0.6'], completedPartsCount: 6 }), /invalid/)
})

test('reference access never authorizes editing a sibling or impersonating its host UID', () => {
  const root = scene(), target = root.children[1]
  const envelope = { action: 'patch', replacement: null, patches: [{ path: '/children/0/primitive/w', value: 9 }], message: 'Wrong scope', plan: [], checks: [] }
  assert.throws(() => applyGenerationEnvelope(envelope, { mode: 'node', scene: root, node: target, path: '0.1' }), /outside the selected scope/)
  assert.throws(() => applyGenerationEnvelope({ ...envelope, action: 'replace', patches: [], replacement: { ...cube('Copied'), uid: root.children[0].uid } }, { mode: 'node', scene: root, node: target, path: '0.1', allowStructure: true }), /unsupported or changed metadata/)
})

test('the wrapper refuses to attach stale references if context preparation changes the scene', async () => {
  const h = harness()
  h.dependencies.buildEditContext = async root => { root.name = 'Unexpected server mutation'; return {} }
  await assert.rejects(h.run(), { code: 'STALE_SCENE' })
})

test('real node pipeline serializes exact checked parameters in the model-facing read-only context', async () => {
  const requests = [], original = scene()
  const loadAssets = async () => Object.fromEntries(await Promise.all(ASSET_NAMES.map(async name => [name, await readFile(new URL(`../public/prompts/${name}.txt`, import.meta.url), 'utf8')])))
  await runGenerationWorkflow({ mode: 'edit', scene: original, prompt: 'Refine the two selected planned parts independently.', effort: 'max', strategy: 'staged' }, {
    apiKey: 'mock-key', loadAssets, buildEditContext, inspectGeometry,
    callModel: async () => ({ status: 'completed', output_text: JSON.stringify(plan) }),
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body))
      const envelope = { action: 'patch', replacement: null, patches: [{ path: '/primitive/w', value: 2 }], message: 'Refined.', plan: [], checks: [], suggestions: [] }
      return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(envelope) }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  const content = requests[1].input.at(-1).content
  const context = JSON.parse(content.split('SPATIAL_CONTEXT (read-only; paths refer to the full scene):\n')[1].split('\n\nSUGGESTION_TARGETS')[0])
  assert.equal(context.completedPartsReferences.parts[0].node.primitive.w, 2)
  assert.deepEqual(context.completedPartsReferences.parts[0].ancestorChain[0].localTransform, original.transform)
  assert.equal(context.completedPartsReferences.editablePath, '0.1')
  assert.deepEqual(original, scene())
})

test('staged creation never includes its whole coarse base as a completed reference', async () => {
  const contexts = [], checkpoints = []
  await runGenerationWorkflow({ mode: 'create', prompt: 'Create a small assembly.', effort: 'max', strategy: 'staged' }, {
    apiKey: 'mock-key', callModel: async () => ({ status: 'completed', output_text: JSON.stringify(plan) }),
    buildEditContext: async () => ({}), onCheckpoint: checkpoint => checkpoints.push(clone(checkpoint)),
    runGeneration: async (input, dependencies) => {
      if (input.mode === 'create') return { result: scene(), changes: ['0'], meta: {} }
      contexts.push(await dependencies.buildEditContext(input.scene, input.path))
      const node = clone(input.node); node.primitive.w++
      return { result: node, changes: ['/primitive/w'], meta: {} }
    },
  })
  assert.deepEqual(checkpoints[0].resume.completedPartPaths, [])
  assert.equal(contexts[0].completedPartsReferences.completedPartsCount, 0)
  assert.deepEqual(contexts[0].completedPartsReferences.parts, [])
  assert.deepEqual(contexts[1].completedPartsReferences.parts.map(part => part.path), ['0.0'])
})

test('the sixth allowed task receives at most five exact prior references and the fifth checkpoint resumes', async () => {
  const h = harness(), root = { name: 'Six parts', operation: 'union', children: Array.from({ length: 6 }, (_, i) => cube(`P${i}`)) }
  h.dependencies.callModel = async () => ({ status: 'completed', output_text: JSON.stringify({ summary: 'Six tasks', constraints: [], steps: root.children.map((node, i) => ({ path: `0.${i}`, title: node.name, instruction: 'Refine this part.' })) }) })
  await h.run({ scene: root })
  assert.equal(h.contexts[5].completedPartsReferences.parts.length, 5)
  assert.equal(h.contexts[5].completedPartsReferences.parts[0].path, '0.4')
  assert.deepEqual(h.checkpoints[4].resume.completedPartPaths, ['0.0', '0.1', '0.2', '0.3', '0.4'])
  assert.equal(h.checkpoints[5].resume, null)
  const aborting = harness({ stopAfter: 6 })
  aborting.dependencies.callModel = h.dependencies.callModel
  await assert.rejects(aborting.run({ scene: root }), error => error.name === 'AbortError' && error.completedSteps === 6 && error.resume === null)
  assert.equal(aborting.checkpoints[5].resume, null)
  assert.equal(aborting.contexts[5].completedPartsReferences.parts.length, 5)
})

test('creation with six refinements also has no six-path resume if Stop races with its final checkpoint', async () => {
  const root = { name: 'Six base parts', operation: 'union', children: Array.from({ length: 6 }, (_, i) => cube(`P${i}`)) }, controller = new AbortController(), checkpoints = [], contexts = []
  await assert.rejects(runGenerationWorkflow({ mode: 'create', prompt: 'Create the six-part object.', effort: 'max', strategy: 'staged' }, {
    apiKey: 'mock-key', signal: controller.signal, buildEditContext: async () => ({}),
    callModel: async () => ({ status: 'completed', output_text: JSON.stringify({ summary: 'Six refinements', constraints: [], steps: root.children.map((node, i) => ({ path: `0.${i}`, title: node.name, instruction: 'Refine this existing part.' })) }) }),
    runGeneration: async (input, dependencies) => {
      if (input.mode === 'create') return { result: root, changes: ['0'], meta: {} }
      contexts.push(await dependencies.buildEditContext(input.scene, input.path))
      const node = clone(input.node); node.primitive.w++
      return { result: node, changes: ['/primitive/w'], meta: {} }
    },
    onCheckpoint: checkpoint => { checkpoints.push(clone(checkpoint)); if (checkpoints.length === 7) controller.abort() },
  }), error => error.name === 'AbortError' && error.completedSteps === 7 && error.resume === null)
  assert.equal(checkpoints[5].resume.completedPartPaths.length, 5)
  assert.equal(checkpoints[6].resume, null)
  assert.equal(contexts[5].completedPartsReferences.parts.length, 5)
})
