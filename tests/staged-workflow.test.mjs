import test from 'node:test'
import assert from 'node:assert/strict'
import { runGenerationWorkflow, runStagedGeneration } from '../src/generation/workflow.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
const cube = name => ({ name, uid: `uid-${name}`, primitive: { type: 'cube', w: 1, h: 1, d: 1 }, transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } })
const scene = () => ({ name: 'Plane', operation: 'union', uid: 'plane', children: [cube('Wing'), cube('Engine'), cube('Tail')] })
const steps = () => [{ path: '0.0', title: 'Wings', instruction: 'Add visible wing detail.' }, { path: '0.1', title: 'Engine', instruction: 'Add engine vents.' }]
const tokens = { input_tokens: 100, output_tokens: 200, total_tokens: 300 }
function harness(options = {}) {
  const calls = [], plans = [], checkpoints = [], progress = []
  const deps = {
    apiKey: 'mock-key', maxRepairs: 2,
    callModel: async (body, callOptions) => {
      plans.push({ body, callOptions })
      return { id: 'plan-id', status: 'completed', output_text: JSON.stringify(options.plan || { summary: 'Refine the wings and engine.', steps: steps(), constraints: ['Preserve all attachment locations.'] }), usage: tokens }
    },
    runGeneration: async (input, dependencies) => {
      calls.push({ input: clone(input), dependencies })
      if (options.generate) return options.generate(input, dependencies, calls.length)
      const result = input.mode === 'create' ? scene() : { ...clone(input.node), name: `${input.node.name} detailed` }
      return { result, action: 'replace', changes: ['detail'], meta: { usage: tokens, framework: { attempts: [{ passed: true }] } } }
    },
    onProgress: event => progress.push(clone(event)),
    onCheckpoint: async checkpoint => { checkpoints.push(clone(checkpoint)); await options.onCheckpoint?.(checkpoint) },
  }
  return { calls, plans, checkpoints, progress, deps, run: (input = {}) => runGenerationWorkflow({ mode: 'edit', scene: scene(), prompt: 'Make the plane more detailed.', effort: 'max', strategy: 'staged', ...input }, deps) }
}

test('single strategy remains the original single generation without planning or checkpoints', async () => {
  const h = harness()
  const result = await h.run({ strategy: 'single', mode: 'node', path: '0.0', node: scene().children[0] })
  assert.equal(result.result.name, 'Wing detailed')
  assert.equal(h.calls.length, 1); assert.equal(h.plans.length, 0); assert.equal(h.checkpoints.length, 0)
})

test('staged editing applies checked parts sequentially and preserves all outside fields exactly', async () => {
  const original = scene(), h = harness()
  const result = await h.run({ scene: original })
  assert.deepEqual(original, scene())
  assert.deepEqual(result.result.children[2], original.children[2])
  assert.equal(result.result.uid, original.uid)
  assert.equal(result.result.children[0].name, 'Wing detailed')
  assert.equal(result.result.children[1].name, 'Engine detailed')
  assert.equal(h.calls[1].input.scene.children[0].name, 'Wing detailed')
  assert.equal(h.calls[0].input.mode, 'node')
  assert.equal(h.calls[0].dependencies.maxRepairs, 1)
  assert.equal(h.plans[0].body.model, 'gpt-6.1-sol')
  assert.equal(h.plans[0].body.reasoning.effort, 'max')
  assert.ok(h.calls.every(call => call.input.effort === 'max'))
  assert.equal(h.checkpoints.length, 2)
  assert.deepEqual(h.checkpoints[0].result.children[1], original.children[1])
  assert.equal(h.checkpoints[0].resume.steps.length, 1)
  assert.equal(h.checkpoints[1].resume, null)
  assert.deepEqual(result.meta.usage, { input_tokens: 300, output_tokens: 600, total_tokens: 900 })
  assert.equal(result.meta.framework.strategy, 'staged')
  assert.equal(result.meta.framework.completedSteps, 2)
  assert.equal(result.meta.framework.planningResponseId, 'plan-id')
  assert.equal(h.progress.find(event => event.planReady).resume.steps.length, 2)
})

test('every staged progress event carries the full task plan and advances completion only after checked results', async () => {
  const h = harness({ generate: async (input, dependencies, count) => {
    dependencies.onProgress({ stage: 'generating', message: 'Drafting', plan: ['Pipeline-local draft task'], completedSteps: 99, totalSteps: 99, phase: 'wrong', strategy: 'single', planReady: false })
    dependencies.onProgress({ stage: 'validating', message: 'Checking the subtree' })
    const inFlight = h.progress.at(-1)
    assert.equal(inFlight.completedSteps, count - 1)
    assert.equal(h.checkpoints.length, count - 1)
    assert.equal(inFlight.step, count)
    assert.equal(inFlight.title, count === 1 ? 'Wings' : 'Engine')
    return { result: { ...clone(input.node), name: `${input.node.name} detailed` }, meta: { usage: tokens } }
  } })
  h.deps.callModel = async (_body, dependencies) => {
    dependencies.onProgress({ stage: 'generating', message: 'Preparing a plan', plan: ['Provider-local task'], completedSteps: 99, totalSteps: 99, phase: 'wrong', strategy: 'single', planReady: true })
    return { status: 'completed', output_text: JSON.stringify({ summary: 'Refine the wings and engine.', steps: steps(), constraints: [] }) }
  }
  await h.run()
  for (const event of h.progress) {
    assert.equal(event.strategy, 'staged')
    assert.ok(Number.isInteger(event.completedSteps) && Number.isInteger(event.totalSteps))
    assert.ok(event.completedSteps <= event.totalSteps)
    if (!event.planReady) {
      assert.equal(event.phase, 'plan')
      assert.equal(event.completedSteps, 0)
      assert.equal(event.totalSteps, 0)
      assert.deepEqual(event.plan, [])
    } else {
      assert.equal(event.phase, 'parts')
      assert.equal(event.totalSteps, 2)
      assert.deepEqual(event.plan, ['Wings', 'Engine'])
    }
  }
  assert.deepEqual(h.progress.filter(event => event.stage === 'part_complete').map(event => event.completedSteps), [1, 2])
  assert.equal(h.progress.at(-1).completedSteps, 2)
  for (const [index, checkpoint] of h.checkpoints.entries()) {
    assert.equal(checkpoint.strategy, 'staged')
    assert.equal(checkpoint.phase, 'parts')
    assert.equal(checkpoint.planReady, true)
    assert.equal(checkpoint.completedSteps, index + 1)
    assert.equal(checkpoint.totalSteps, 2)
    assert.deepEqual(checkpoint.plan, ['Wings', 'Engine'])
    assert.equal(checkpoint.meta.framework.planReady, true)
    assert.deepEqual(checkpoint.meta.framework.workflowPlan, checkpoint.plan)
  }
})

test('creation reports the known base task without claiming that the full plan is ready', async () => {
  const h = harness({ generate: async (input, dependencies) => {
    dependencies.onProgress({ stage: 'validating', message: 'Checking', plan: ['Internal generation check'] })
    return { result: input.mode === 'create' ? scene() : clone(input.node), meta: { usage: tokens } }
  } })
  await h.run({ mode: 'create', scene: null })
  const beforePlan = h.progress.filter(event => !event.planReady)
  assert.ok(beforePlan.length >= 3)
  for (const event of beforePlan) {
    assert.equal(event.phase, 'plan')
    assert.equal(event.totalSteps, 1)
    assert.deepEqual(event.plan, ['Base assembly'])
  }
  assert.equal(beforePlan[0].completedSteps, 0)
  assert.equal(beforePlan.at(-1).completedSteps, 1)
  const base = h.checkpoints[0]
  assert.equal(base.phase, 'plan')
  assert.equal(base.planReady, false)
  assert.equal(base.completedSteps, 1)
  assert.equal(base.totalSteps, 1)
  assert.deepEqual(base.plan, ['Base assembly'])
  assert.equal(base.meta.framework.planReady, false)
  const planned = h.progress.find(event => event.planReady)
  assert.equal(planned.completedSteps, 1)
  assert.equal(planned.totalSteps, 3)
  assert.deepEqual(planned.plan, ['Base assembly', 'Wings', 'Engine'])
  assert.deepEqual(h.checkpoints.map(checkpoint => checkpoint.completedSteps), [1, 2, 3])
})

test('a node workflow returns only the original selected scope and cannot modify other scene branches', async () => {
  const inputScene = scene()
  inputScene.children[0] = { name: 'Wing assembly', children: [cube('Left wing'), cube('Right wing')], operation: 'union' }
  const h = harness({ plan: { summary: 'Refine two wings', steps: [{ path: '0.0.0', title: 'Left', instruction: 'Add ribs' }, { path: '0.0.1', title: 'Right', instruction: 'Add ribs' }], constraints: [] } })
  const result = await h.run({ mode: 'node', scene: inputScene, path: '0.0', node: inputScene.children[0] })
  assert.equal(result.result.name, 'Wing assembly')
  assert.equal(result.result.children[0].name, 'Left wing detailed')
  assert.deepEqual(h.calls[1].input.scene.children[1], inputScene.children[1])
  assert.equal(h.checkpoints[0].result.children.length, 2)
  assert.equal(h.checkpoints[0].resume.scopePath, '0.0')
  assert.equal(result.meta.mode, 'node_edit')
  assert.equal(result.meta.anchor.path, '0.0')
})

test('one primitive selected scope can be refined as its own target', async () => {
  const h = harness({ plan: { summary: 'One selected part', steps: [{ path: '0.0', title: 'Wing', instruction: 'Add detail' }], constraints: [] } })
  const result = await h.run({ mode: 'node', path: '0.0', node: scene().children[0] })
  assert.equal(result.result.name, 'Wing detailed')
  assert.equal(h.checkpoints[0].resume, null)
})

test('new generation publishes a coarse skeleton before planning independent refinements', async () => {
  const h = harness()
  const result = await h.run({ mode: 'create', scene: null })
  assert.equal(h.calls[0].input.mode, 'create')
  assert.match(h.calls[0].input.prompt, /at most 18 primitive/)
  assert.equal(h.checkpoints[0].meta.framework.phase, 'base')
  assert.equal(h.checkpoints[0].resume.phase, 'plan')
  assert.equal(h.checkpoints[0].step, 1)
  assert.equal(h.checkpoints[1].totalSteps, 3)
  assert.equal(result.meta.framework.completedSteps, 3)
  assert.deepEqual(result.meta.usage, { input_tokens: 400, output_tokens: 800, total_tokens: 1200 })
})

test('a failed later part preserves checkpoints and can resume without repeating completed parts or the planner', async () => {
  const first = harness({ generate: async (input, _dependencies, count) => {
    if (count === 2) throw Object.assign(new Error('Part failed'), { code: 'VALIDATION_FAILED', usage: tokens })
    return { result: { ...clone(input.node), name: `${input.node.name} detailed` }, changes: [], meta: { usage: tokens } }
  } })
  let failure
  await assert.rejects(first.run(), error => { failure = error; return error.code === 'VALIDATION_FAILED' })
  assert.equal(first.checkpoints.length, 1)
  assert.equal(failure.completedSteps, 1)
  assert.equal(failure.resume.steps[0].path, '0.1')
  assert.equal(failure.partialResult.children[0].name, 'Wing detailed')
  const second = harness()
  const result = await second.run({ scene: first.checkpoints[0].result, resume: failure.resume })
  assert.equal(second.plans.length, 0); assert.equal(second.calls.length, 1)
  assert.equal(second.calls[0].input.path, '0.1')
  assert.equal(result.result.children[0].name, 'Wing detailed')
  assert.equal(result.meta.framework.completedSteps, 2)
  assert.deepEqual(result.meta.usage, { input_tokens: 400, output_tokens: 800, total_tokens: 1200 })
})

test('Stop after a checkpoint aborts remaining work and preserves a resumable checked scene', async () => {
  const controller = new AbortController()
  const h = harness({ onCheckpoint: () => controller.abort() })
  h.deps.signal = controller.signal
  let failure
  await assert.rejects(h.run(), error => { failure = error; return error.name === 'AbortError' })
  assert.equal(h.calls.length, 1)
  assert.equal(h.checkpoints.length, 1)
  assert.equal(failure.completedSteps, 1)
  assert.equal(failure.resume.steps.length, 1)
  assert.deepEqual(failure.resume.plan, ['Wings', 'Engine'])
  const continued = harness()
  await continued.run({ scene: h.checkpoints[0].result, resume: failure.resume })
  assert.equal(continued.plans.length, 0)
  assert.equal(continued.progress[0].completedSteps, 1)
  assert.equal(continued.progress[0].totalSteps, 2)
  assert.equal(continued.progress[0].planReady, true)
  for (const event of continued.progress) assert.deepEqual(event.plan, ['Wings', 'Engine'])
  assert.equal(continued.checkpoints[0].completedSteps, 2)
  assert.deepEqual(continued.checkpoints[0].plan, ['Wings', 'Engine'])
})

test('a cancelled coarse creation can resume planning from its published skeleton', async () => {
  const controller = new AbortController(), first = harness({ onCheckpoint: () => controller.abort() })
  first.deps.signal = controller.signal
  let failure
  await assert.rejects(first.run({ mode: 'create', scene: null }), error => { failure = error; return error.name === 'AbortError' })
  assert.equal(failure.resume.phase, 'plan')
  const second = harness()
  const result = await second.run({ mode: 'create', scene: first.checkpoints[0].result, resume: failure.resume })
  assert.equal(second.plans.length, 1)
  assert.equal(second.calls.length, 2)
  assert.ok(second.calls.every(call => call.input.mode === 'node'))
  assert.equal(result.meta.framework.completedSteps, 3)
  assert.equal(second.progress[0].completedSteps, 1)
  assert.equal(second.progress[0].planReady, false)
  assert.deepEqual(second.progress[0].plan, ['Base assembly'])
  assert.deepEqual(second.progress.find(event => event.planReady).plan, ['Base assembly', 'Wings', 'Engine'])
})

test('plans cannot target an out-of-scope node, missing node, whole assembly or overlapping parts', async () => {
  const badPlans = [
    [{ path: '0.2', title: 'Outside', instruction: 'Change tail' }],
    [{ path: '0.0.5', title: 'Missing', instruction: 'Change absent part' }],
    [{ path: '0.0', title: 'Whole', instruction: 'Rebuild whole selected assembly' }],
    [{ path: '0.0.0', title: 'Duplicate1', instruction: 'Detail' }, { path: '0.0.0', title: 'Duplicate2', instruction: 'Detail' }],
    [{ path: '0.0.0', title: 'Parent', instruction: 'Detail' }, { path: '0.0.0.0', title: 'Child', instruction: 'Detail' }],
  ]
  for (const planned of badPlans) {
    const current = scene()
    current.children[0] = { name: 'Wings', operation: 'union', children: [{ name: 'Left assembly', operation: 'union', children: [cube('Tip')] }, cube('Right')] }
    const h = harness({ plan: { summary: 'Bad plan', steps: planned, constraints: [] } })
    await assert.rejects(h.run({ mode: 'node', scene: current, path: '0.0', node: current.children[0] }), error => error.code === 'INVALID_PLAN')
    assert.equal(h.calls.length, 0)
  }
})

test('an assembly root is never emitted as one giant staged replacement', async () => {
  const h = harness({ plan: { summary: 'Bad root plan', steps: [{ path: '0', title: 'Everything', instruction: 'Replace it all' }], constraints: [] } })
  await assert.rejects(h.run(), error => error.code === 'INVALID_PLAN')
  assert.equal(h.calls.length, 0)
})

test('resume validation binds original prompt, selected effort, entry scope and current scene', async () => {
  const first = harness()
  await first.run()
  const checkpoint = first.checkpoints[0]
  const modifications = [
    { prompt: 'A different instruction' }, { effort: 'low' },
    { mode: 'node', path: '0.0', node: checkpoint.result.children[0] },
    { scene: { ...clone(checkpoint.result), name: 'Manually edited' } },
    { resume: { ...checkpoint.resume, completedSteps: -1 } },
    { resume: { ...checkpoint.resume, totalSteps: 9 } },
    { resume: { ...checkpoint.resume, steps: [...checkpoint.resume.steps, ...checkpoint.resume.steps] } },
  ]
  for (const changed of modifications) {
    const next = harness()
    await assert.rejects(next.run({ scene: clone(checkpoint.result), resume: clone(checkpoint.resume), ...changed }), error => ['STALE_PLAN', 'INVALID_PLAN'].includes(error.code))
    assert.equal(next.calls.length, 0); assert.equal(next.plans.length, 0)
  }
})

test('input limits apply to single and staged requests before any provider calls', async () => {
  for (const strategy of ['single', 'staged']) {
    const h = harness()
    await assert.rejects(h.run({ strategy, prompt: 'x'.repeat(12001) }), error => error.code === 'INVALID_INPUT')
    await assert.rejects(h.run({ strategy, effort: 'unsupported' }), error => error.code === 'INVALID_EFFORT')
    assert.equal(h.calls.length, 0); assert.equal(h.plans.length, 0)
  }
})

test('a pre-cancelled request never starts a model call', async () => {
  const controller = new AbortController(); controller.abort()
  const h = harness(); h.deps.signal = controller.signal
  await assert.rejects(h.run(), error => error.name === 'AbortError')
  assert.equal(h.calls.length, 0); assert.equal(h.plans.length, 0)
})

test('full original requests fit inside the internal step prompt limit without losing user text', async () => {
  const prompt = 'z'.repeat(12000), h = harness()
  await runStagedGeneration({ mode: 'edit', scene: scene(), prompt, effort: 'xhigh' }, h.deps)
  assert.ok(h.calls.every(call => call.input.prompt.includes(prompt) && call.input.prompt.length < 15500))
})

test('one diagnosed invalid plan can be corrected before any part is changed', async () => {
  const h = harness(), plannerCalls = []
  h.deps.callModel = async body => {
    plannerCalls.push(clone(body))
    return { id: `plan-${plannerCalls.length}`, status: 'completed', usage: tokens, output_text: JSON.stringify({ summary: 'Two parts', constraints: [], steps: plannerCalls.length === 1 ? [{ path: '0', title: 'Whole assembly', instruction: 'Detail it' }] : steps() }) }
  }
  const result = await h.run()
  assert.equal(plannerCalls.length, 2)
  assert.ok(plannerCalls[1].input.at(-1).content.includes('DIAGNOSTIC:'))
  assert.ok(!plannerCalls[0].text.format.schema.properties.steps.items.properties.path.enum.includes('0'))
  assert.equal(h.calls.length, 2)
  assert.equal(result.meta.framework.planningResponseId, 'plan-2')
  assert.deepEqual(result.meta.usage, { input_tokens: 400, output_tokens: 800, total_tokens: 1200 })
})

test('planning corrections are bounded to one and provider failures never retry automatically', async () => {
  const bad = harness({ plan: { summary: 'Invalid', steps: [{ path: '0', title: 'Whole', instruction: 'Detail' }], constraints: [] } })
  await assert.rejects(bad.run(), error => error.code === 'INVALID_PLAN')
  assert.equal(bad.plans.length, 2)
  const failed = harness(); let calls = 0
  failed.deps.callModel = async () => { calls++; throw Object.assign(new Error('Rate limited'), { code: 'PROVIDER_ERROR' }) }
  await assert.rejects(failed.run(), error => error.code === 'PROVIDER_ERROR')
  assert.equal(calls, 1); assert.equal(failed.calls.length, 0)
})

test('a coarse assembly over 18 source primitives never replaces the user scene', async () => {
  const h = harness({ generate: async () => ({ result: { name: 'Oversized', operation: 'union', children: Array.from({ length: 19 }, (_, i) => cube(`Part ${i}`)) }, meta: { usage: tokens } }) })
  await assert.rejects(h.run({ mode: 'create', scene: null }), error => error.code === 'VALIDATION_FAILED')
  assert.equal(h.checkpoints.length, 0); assert.equal(h.plans.length, 0)
})

test('coarse budgets count source primitive nodes without multiplying repeat instances', async () => {
  const base = scene()
  base.children[2] = { name: 'Repeated detail', repeat: { type: 'linear', count: 64, t: [1, 0, 0] }, children: [cube('One repeated source')] }
  const h = harness({ generate: async input => ({ result: input.mode === 'create' ? base : clone(input.node), meta: { usage: tokens } }) })
  const result = await h.run({ mode: 'create', scene: null })
  assert.equal(result.meta.framework.completedSteps, 3)
  assert.equal(h.checkpoints.length, 3)
  assert.equal(result.result.children[2].repeat.count, 64)
})
