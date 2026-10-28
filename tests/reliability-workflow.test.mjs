import test from 'node:test'
import assert from 'node:assert/strict'
import { runGenerationWorkflow } from '../src/generation/workflow.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
const cube = name => ({ name, uid: `uid-${name}`, primitive: { type: 'cube', w: 1, h: 1, d: 1 } })
const assembly = () => ({ name: 'Editable', operation: 'union', children: [cube('First'), cube('Second')] })
const fixture = mode => mode === 'node' ? { name: 'Scene', operation: 'union', children: [assembly(), cube('Untouched')] } : assembly()
const scope = (scene, mode) => mode === 'node' ? scene.children[0] : scene
const request = (mode, effort, scene = mode === 'create' ? null : fixture(mode)) => ({ mode, effort, strategy: 'staged', prompt: 'Refine these two parts.', scene,
  ...(mode === 'node' ? { path: '0.0', node: scene.children[0] } : {}) })
const tokens = { input_tokens: 10, output_tokens: 20, total_tokens: 30 }

function dependencies(mode, { failureCode, failurePart = 2, resumeOnly = false, failPlanning = false } = {}) {
  const checkpoints = [], parts = [], planner = [], baseCalls = []
  const path = mode === 'node' ? '0.0' : '0'
  return { checkpoints, parts, planner, baseCalls, apiKey: 'mock-key',
    callModel: async body => {
      planner.push(clone(body))
      assert.equal(resumeOnly, false, 'A checked part resume must not repeat planning')
      if (failPlanning) throw Object.assign(new Error('Planning transport stopped'), { code: 'NETWORK_ERROR' })
      return { status: 'completed', output_text: JSON.stringify({ summary: 'Two independent parts.', constraints: ['Keep the outside scene unchanged.'], steps: [
        { path: `${path}.0`, title: 'First part', instruction: 'Refine the first part.' },
        { path: `${path}.1`, title: 'Second part', instruction: 'Refine the second part.' },
      ] }), usage: tokens }
    },
    runGeneration: async input => {
      if (input.mode === 'create') { baseCalls.push(clone(input)); return { result: assembly(), meta: { usage: tokens }, changes: [] } }
      parts.push(clone(input))
      if (failureCode && parts.length === failurePart) throw Object.assign(new Error(`Injected ${failureCode}`), { code: failureCode, usage: tokens })
      return { result: { ...clone(input.node), primitive: { ...input.node.primitive, w: 2 } }, meta: { usage: tokens }, changes: ['/primitive/w'] }
    },
    onCheckpoint: async checkpoint => checkpoints.push(clone(checkpoint)),
  }
}

for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) for (const mode of ['create', 'edit', 'node']) {
  test(`${effort} ${mode}: checked progress survives terminal errors and resumes remaining tasks only`, async () => {
    for (const failureCode of ['NETWORK_ERROR', 'PROVIDER_ERROR', 'INCOMPLETE', 'VALIDATION_FAILED']) {
      const original = request(mode, effort), before = clone(original), first = dependencies(mode, { failureCode })
      let failure
      await assert.rejects(runGenerationWorkflow(original, first), error => { failure = error; return error.code === failureCode })
      assert.deepEqual(original, before)
      const expectedCompleted = mode === 'create' ? 2 : 1
      assert.equal(failure.completedSteps, expectedCompleted)
      assert.equal(first.checkpoints.length, expectedCompleted)
      assert.equal(failure.resume.steps.length, 1)
      assert.equal(failure.resume.steps[0].title, 'Second part')
      const completedScope = first.checkpoints.at(-1).result
      assert.equal(completedScope.children[0].primitive.w, 2)
      assert.equal(completedScope.children[1].primitive.w, 1)
      assert.deepEqual(failure.partialResult, completedScope)
      const currentScene = mode === 'node' ? { ...clone(original.scene), children: [clone(completedScope), clone(original.scene.children[1])] } : clone(completedScope)
      const second = dependencies(mode, { resumeOnly: true })
      const resumed = { ...request(mode, effort, currentScene), resume: failure.resume }
      const output = await runGenerationWorkflow(resumed, second)
      assert.equal(second.planner.length, 0)
      assert.equal(second.baseCalls.length, 0)
      assert.equal(second.parts.length, 1)
      assert.equal(second.parts[0].path, failure.resume.steps[0].path)
      assert.equal(second.parts[0].effort, effort)
      assert.equal(output.result.children[0].primitive.w, 2)
      assert.equal(output.result.children[1].primitive.w, 2)
      assert.equal(output.meta.framework.completedSteps, mode === 'create' ? 3 : 2)
      assert.equal(second.checkpoints.at(-1).resume, null)
      if (mode === 'node') assert.deepEqual(currentScene.children[1], fixture(mode).children[1])
    }
  })
}

test('a staged first-part failure retains the ready plan even with zero completed parts', async () => {
  for (const effort of ['high', 'xhigh', 'max']) {
    const original = request('edit', effort), first = dependencies('edit', { failureCode: 'INCOMPLETE', failurePart: 1 })
    let failure
    await assert.rejects(runGenerationWorkflow(original, first), error => { failure = error; return error.code === 'INCOMPLETE' })
    assert.equal(failure.completedSteps, 0)
    assert.equal(failure.resume.steps.length, 2)
    assert.equal(first.checkpoints.length, 0)
    const next = dependencies('edit', { resumeOnly: true })
    await runGenerationWorkflow({ ...original, resume: failure.resume }, next)
    assert.equal(next.parts.length, 2)
  }
})

test('a planning transport failure after creation preserves its base and never regenerates it on continuation', async () => {
  const first = dependencies('create', { failPlanning: true })
  let failure
  await assert.rejects(runGenerationWorkflow(request('create', 'max'), first), error => { failure = error; return error.code === 'NETWORK_ERROR' })
  assert.equal(failure.resume.phase, 'plan')
  assert.equal(first.baseCalls.length, 1)
  assert.equal(first.checkpoints.length, 1)
  const next = dependencies('create')
  await runGenerationWorkflow({ ...request('create', 'max', failure.partialResult), resume: failure.resume }, next)
  assert.equal(next.baseCalls.length, 0)
  assert.equal(next.planner.length, 1)
  assert.equal(next.parts.length, 2)
})

for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
  test(`${effort}: an output-limited plan regenerates once within the two-attempt planning allowance`, async () => {
    const h = dependencies('edit'), actualPlanner = h.callModel, calls = [], progress = []
    h.onProgress = event => progress.push(clone(event))
    h.callModel = async body => {
      calls.push(clone(body))
      if (calls.length === 1) return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'TRUNCATED_PLAN_SENTINEL', usage: tokens }
      return actualPlanner(body)
    }
    const result = await runGenerationWorkflow(request('edit', effort), h)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].max_output_tokens, Math.min(128000, calls[0].max_output_tokens * 2))
    assert.equal(calls[1].reasoning.effort, effort)
    assert.equal(JSON.stringify(calls[1].input).includes('TRUNCATED_PLAN_SENTINEL'), false)
    assert.equal(calls[1].input.some(item => item.role === 'assistant'), false)
    assert.equal(h.checkpoints.length, 2)
    assert.equal(result.meta.usage.output_tokens, tokens.output_tokens * 4)
    assert.ok(progress.some(event => /plan output budget/.test(event.message)))
  })
}

test('repeated planner output limits and other incomplete reasons fail safely with no unchecked part', async () => {
  for (const reason of ['max_output_tokens', 'content_filter']) {
    const h = dependencies('edit'), calls = []
    h.callModel = async body => {
      calls.push(clone(body))
      return { status: 'incomplete', incomplete_details: { reason }, output_text: 'TRUNCATED_PLAN_SENTINEL', usage: tokens }
    }
    await assert.rejects(runGenerationWorkflow(request('edit', 'max'), h), error => error.code === 'INCOMPLETE' && error.completedSteps === 0 && error.resume === null)
    assert.equal(calls.length, reason === 'max_output_tokens' ? 2 : 1)
    assert.equal(h.parts.length, 0)
    assert.equal(h.checkpoints.length, 0)
  }
})

test('an invalid-plan correction and incomplete-plan recovery cannot multiply planning attempts', async () => {
  const h = dependencies('edit'), calls = []
  h.callModel = async body => {
    calls.push(clone(body))
    return calls.length === 1 ? { status: 'completed', output_text: JSON.stringify({ summary: 'Bad assembly scope', constraints: [], steps: [{ path: '0', title: 'All parts', instruction: 'Replace all parts' }] }) }
      : { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: tokens }
  }
  await assert.rejects(runGenerationWorkflow(request('edit', 'max'), h), error => error.code === 'INCOMPLETE')
  assert.equal(calls.length, 2)
  assert.equal(h.parts.length, 0)
  assert.equal(h.checkpoints.length, 0)
})

test('staged planning receives actual read-only scene colors and asks for executable HEX references without changing source colors', async () => {
  const scene = assembly()
  scene.children[0].primitive.material = { color: '#fdceff' }
  scene.children[1].primitive.material = { color: '#c7e7ff' }
  const before = clone(scene), h = dependencies('edit')
  await runGenerationWorkflow(request('edit', 'max', scene), h)
  const body = h.planner[0], synopsis = JSON.parse(body.input.at(-1).content.split('ASSEMBLY_SYNOPSIS:\n')[1])
  assert.equal(synopsis.palette.readOnly, true)
  assert.deepEqual(synopsis.palette.colors.map(item => item.color).sort(), ['#C7E7FF', '#FDCEFF'])
  assert.ok(synopsis.palette.colors.some(item => item.sources.some(source => source.path === '0.0')))
  assert.ok(synopsis.palette.colors.some(item => item.sources.some(source => source.path === '0.1')))
  assert.ok(!synopsis.palette.colors.some(item => item.color === '#3A3A3A'))
  assert.match(body.input[0].content, /explicit #RRGGBB from that palette/)
  assert.match(body.input[0].content, /Never invent an existing dark material/)
  assert.deepEqual(scene, before)
  assert.equal(h.parts[0].node.primitive.material.color, '#fdceff')
})

test('palette context cannot expand a node planner scope to a differently colored outside branch', async () => {
  const scene = fixture('node')
  scene.children[0].children[0].primitive.material = { color: '#fdceff' }
  scene.children[1].primitive.material = { color: '#123456' }
  const before = clone(scene), h = dependencies('node')
  await runGenerationWorkflow(request('node', 'max', scene), h)
  const body = h.planner[0], synopsis = JSON.parse(body.input.at(-1).content.split('ASSEMBLY_SYNOPSIS:\n')[1])
  assert.equal(synopsis.selectedScope, '0.0')
  assert.equal(synopsis.palette.readOnly, true)
  assert.ok(synopsis.palette.colors.some(item => item.color === '#123456'))
  const allowed = body.text.format.schema.properties.steps.items.properties.path.enum
  assert.ok(allowed.every(path => path.startsWith('0.0.')))
  assert.ok(!allowed.includes('0.1'))
  assert.deepEqual(scene, before)
  assert.deepEqual(h.parts[1].scene.children[1], before.children[1])
})

test('planning an uncolored scene does not invent a scene palette or fabricate a dark-color dependency', async () => {
  const h = dependencies('edit')
  await runGenerationWorkflow(request('edit', 'xhigh'), h)
  const synopsis = JSON.parse(h.planner[0].input.at(-1).content.split('ASSEMBLY_SYNOPSIS:\n')[1])
  assert.equal(synopsis.palette.readOnly, true)
  assert.deepEqual(synopsis.palette.colors, [])
  assert.equal(synopsis.palette.omittedColors, 0)
})
