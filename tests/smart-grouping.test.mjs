import test from 'node:test'
import assert from 'node:assert/strict'
import { runSmartGrouping, createGroupingResponseFormat } from '../src/generation/grouping.mjs'
import { MODEL_ID } from '../src/generation/config.mjs'

const sphere = name => ({ name, primitive: { type: 'sphere', r: 1 } })
const scene = () => ({ name: 'Propeller', operation: 'union', children: [sphere('Spinner'), sphere('Blade A'), sphere('Blade B')] })
const plan = { groups: [{ name: 'Blades', members: ['0.1', '0.2'] }], message: 'Grouped both blades for joint editing.' }
const response = value => ({ id: 'resp_mock', status: 'completed', output_text: JSON.stringify(value), usage: { input_tokens: 400, output_tokens: 80, total_tokens: 480 } })

test('dedicated smart grouping sends only compact read-only synopsis and uses chosen effort', async () => {
  const calls = [], progress = [], original = scene(), before = JSON.stringify(original)
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const result = await runSmartGrouping({ mode: 'organize', scene: original, scope: '0', effort, prompt: 'Organize both blades.' }, {
      apiKey: 'mock-key', callModel: async (body, options) => { calls.push(body); assert.equal(options.apiKey, 'mock-key'); return response(plan) }, onProgress: event => progress.push(event),
    })
    assert.equal(result.result, result.scene); assert.equal(result.groups.length, 1)
    assert.equal(result.scene.children[1].name, 'Blades'); assert.equal(result.meta.apiCalls, 1)
    assert.equal(result.meta.usage.total_tokens, 480); assert.equal(result.meta.effort, effort)
    assert.equal(calls.at(-1).reasoning.effort, effort)
    assert.equal(calls.at(-1).model, MODEL_ID)
    assert.deepEqual(calls.at(-1).text.format, createGroupingResponseFormat())
    const user = JSON.parse(calls.at(-1).input[1].content)
    assert.ok(user.sceneSynopsis.parents.length); assert.equal(user.scene, undefined)
    assert.equal(JSON.stringify(user).includes('"primitive"'), false)
  }
  assert.equal(JSON.stringify(original), before)
  assert.equal(progress.at(-1).stage, 'complete')
})

test('no useful grouping and no safe candidates are valid no-ops', async () => {
  const original = scene()
  const result = await runSmartGrouping({ scene: original }, { apiKey: 'mock', callModel: async () => response({ groups: [], message: 'Already organized.' }) })
  assert.equal(result.scene, original); assert.equal(result.changed, false)
  let called = false
  const single = sphere('Solo')
  const noCandidates = await runSmartGrouping({ scene: single }, { callModel: async () => { called = true } })
  assert.equal(noCandidates.scene, single); assert.equal(noCandidates.meta.apiCalls, 0); assert.equal(called, false)
})

test('invalid or malicious output cannot rewrite, duplicate, target other scope or change the original scene', async () => {
  const original = { name: 'Root', operation: 'union', children: [scene(), sphere('Other')] }, before = JSON.stringify(original)
  for (const invalid of [
    { ...plan, replacement: sphere('Invented') },
    { groups: [{ name: 'Wrong parent', members: ['0.0.1', '0.1'] }], message: '' },
    { groups: [{ name: 'Invented path', members: ['0.0.1', '0.99'] }], message: '' },
    { groups: [{ name: 'Duplication', members: ['0.0.1', '0.0.1'] }], message: '' },
    { groups: [], message: 4 },
  ]) await assert.rejects(runSmartGrouping({ scene: original, scope: '0.0' }, { apiKey: 'mock', callModel: async () => response(invalid) }))
  assert.equal(JSON.stringify(original), before)
})

test('incomplete, malformed, refused and aborted plans never apply partial scene output', async () => {
  const original = scene(), before = JSON.stringify(original)
  for (const data of [{ status: 'incomplete', output_text: JSON.stringify(plan) }, { status: 'completed', output_text: '{"groups":[' }, { status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'No' }] }] }]) {
    await assert.rejects(runSmartGrouping({ scene: original }, { apiKey: 'mock', callModel: async () => data }))
  }
  const controller = new AbortController()
  await assert.rejects(runSmartGrouping({ scene: original }, { apiKey: 'mock', signal: controller.signal, callModel: async () => { controller.abort(); return response(plan) } }), { name: 'AbortError' })
  assert.equal(JSON.stringify(original), before)
  await assert.rejects(runSmartGrouping({ scene: original, effort: 'ultra' }, { apiKey: 'mock' }), { code: 'INVALID_EFFORT' })
  await assert.rejects(runSmartGrouping({ scene: original, prompt: 'x'.repeat(4001) }, { apiKey: 'mock' }), { code: 'INVALID_INPUT' })
  await assert.rejects(runSmartGrouping({ scene: original }, {}), { code: 'MISSING_KEY' })
})
