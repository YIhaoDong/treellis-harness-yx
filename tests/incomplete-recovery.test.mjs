import test from 'node:test'
import assert from 'node:assert/strict'
import { runGeneration } from '../src/generation/pipeline.mjs'
import { ASSET_NAMES } from '../src/generation/config.mjs'
import { inspectGeometry } from '../src/generation/geometry.mjs'
import { getGenerationLimits } from '../src/generation/limits.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
const cube = (width = 1) => ({ name: 'Cube', primitive: { type: 'cube', w: width, h: 1, d: 1 } })
const envelope = (mode, width = 2) => ({ action: mode === 'create' ? 'replace' : 'patch', replacement: mode === 'create' ? cube(width) : null,
  patches: mode === 'create' ? [] : [{ path: '/primitive/w', value: width }], message: 'Done', suggestions: [], plan: [], checks: [] })
const tokens = { input_tokens: 100, output_tokens: 200, total_tokens: 300 }
const complete = value => ({ id: 'complete-response', status: 'completed', output_text: JSON.stringify(value), usage: tokens })
const incomplete = (reason = 'max_output_tokens', text = 'TRUNCATED_PRIVATE_TEST_SENTINEL') => ({ id: 'incomplete-response', status: 'incomplete', incomplete_details: { reason }, output_text: text, usage: tokens })
const loadAssets = async () => Object.fromEntries(ASSET_NAMES.map(name => [name, name === 'jsonCase' ? JSON.stringify({ examples: [{ tags: [], description: 'One cube', aml: cube() }] }) : 'Configured authoritative rule.']))

function harness(responses, options = {}) {
  const calls = [], progress = [], checked = []
  const dependencies = { apiKey: 'mock-key', loadAssets, maxRepairs: 2,
    fetchImpl: async (_url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]), { headers: { 'Content-Type': 'application/json' } }) },
    inspectGeometry: async root => { checked.push(clone(root)); return inspectGeometry(root) },
    buildEditContext: async () => ({}), onProgress: event => progress.push(clone(event)), ...options,
  }
  const run = (mode = 'create', effort = 'max') => {
    const scene = { name: 'Assembly', operation: 'union', children: [cube(), { ...cube(), name: 'Untouched' }] }
    return runGeneration({ mode, effort, prompt: 'Set width to two.', ...(mode === 'edit' ? { scene: cube() } : mode === 'node' ? { scene, node: scene.children[0], path: '0.0' } : {}) }, dependencies)
  }
  return { calls, progress, checked, run }
}

for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) for (const mode of ['create', 'edit', 'node']) {
  test(`${effort} ${mode}: budget exhaustion recovers once without accepting truncated output or changing effort`, async () => {
    // Even a complete-looking JSON string is unsafe when the provider marks it incomplete.
    const h = harness([incomplete('max_output_tokens', JSON.stringify(envelope(mode, 99))), complete(envelope(mode))])
    const output = await h.run(mode, effort)
    assert.equal(h.calls.length, 2)
    assert.equal(h.checked.length, 1)
    assert.equal(output.result.primitive.w, 2)
    assert.ok(h.calls.every(body => body.reasoning.effort === effort && body.model === 'gpt-6.1-sol'))
    assert.equal(h.calls[1].max_output_tokens, Math.min(128000, getGenerationLimits(effort).maxOutputTokens * 2))
    assert.equal(h.calls[1].input.some(item => item.role === 'assistant'), false)
    assert.ok(h.calls[1].input.at(-1).content.includes('SAME request and editable scope'))
    assert.equal(output.meta.framework.incompleteRecoveryUsed, true)
    assert.equal(output.meta.framework.attempts.length, 2)
    assert.deepEqual(output.meta.usage, { input_tokens: 200, output_tokens: 400, total_tokens: 600 })
    assert.ok(h.progress.some(event => event.stage === 'repairing' && /output budget/.test(event.message)))
  })
}

test('a repeated max-output failure stops after one regeneration, preserving usage and scene safety', async () => {
  const h = harness([incomplete()])
  await assert.rejects(h.run(), error => error.code === 'INCOMPLETE' && error.attempts.length === 2 && error.usage.output_tokens === 400)
  assert.equal(h.calls.length, 2)
  assert.equal(h.checked.length, 0)
  assert.equal(JSON.stringify(h.calls[1].input).includes('TRUNCATED_PRIVATE_TEST_SENTINEL'), false)
})

test('explicitly disabled repairs also disable incomplete regeneration', async () => {
  const h = harness([incomplete()], { maxRepairs: 0 })
  await assert.rejects(h.run(), error => error.code === 'INCOMPLETE' && error.attempts.length === 1)
  assert.equal(h.calls.length, 1)
  assert.equal(h.checked.length, 0)
})

test('other incomplete reasons and refusals are surfaced without compact regeneration', async () => {
  for (const data of [incomplete('content_filter'), { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot perform this request.' }] }] }]) {
    const h = harness([data])
    await assert.rejects(h.run(), error => ['INCOMPLETE', 'REFUSAL'].includes(error.code))
    assert.equal(h.calls.length, 1)
    assert.equal(h.checked.length, 0)
  }
})

test('geometry repairs and incomplete regeneration share one bounded attempt allowance and retain frozen checks', async () => {
  const first = envelope('create', 1)
  first.checks = [{ kind: 'extent', path: '0', otherPath: '', axis: 'x', comparison: 'eq', value: 2, tolerance: 0.001 }]
  const h = harness([complete(first), incomplete(), complete(envelope('create', 1))])
  await assert.rejects(h.run(), error => error.code === 'VALIDATION_FAILED' && error.attempts.length === 3)
  assert.equal(h.calls.length, 3)
  assert.equal(h.checked.length, 2)
  assert.ok(h.calls[2].input.at(-1).content.includes('FROZEN_ACCEPTANCE_CHECKS'))
  assert.ok(h.calls[2].input.at(-1).content.includes('"value":2'))
  assert.equal(JSON.stringify(h.calls[2].input).includes('TRUNCATED_PRIVATE_TEST_SENTINEL'), false)
})
