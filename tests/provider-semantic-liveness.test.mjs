import test from 'node:test'
import assert from 'node:assert/strict'
import { callModel } from '../src/generation/provider.mjs'

const body = { model: 'gpt-6.1-sol', store: false, reasoning: { effort: 'max' }, max_output_tokens: 128000, input: [] }
const options = { apiKey: 'mock-key', recovery: { streamIdleMs: 30, pollIntervalMs: 1, retryBaseMs: 1, requestTimeoutMs: 100 } }
const event = (type, extra = {}) => `data: ${JSON.stringify({ type, ...extra })}\n\n`
const accepted = event('response.created', { response: { id: 'resp_original', status: 'in_progress' } })
const completed = { id: 'resp_original', status: 'completed', output_text: '{"complete":true}', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function tickingStream(t, next) {
  let timer, cancelled = false, ticks = 0
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(accepted))
      timer = setInterval(() => {
        const text = next(++ticks)
        if (text === null) { clearInterval(timer); controller.close() }
        else controller.enqueue(new TextEncoder().encode(text))
      }, 5)
    },
    cancel() { cancelled = true; clearInterval(timer) },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
  t.after(() => clearInterval(timer))
  return { response, get cancelled() { return cancelled } }
}

for (const [label, tick] of [
  ['comment heartbeats', () => ': keep-alive\n\n'],
  ['partial SSE frame bytes', index => index === 1 ? 'data: {"type":"response.output_text.delta","delta":"' : 'x'],
  ['repeated in-progress events', index => event('response.in_progress', index % 2 ? { response: { id: 'resp_original', status: 'in_progress' } } : {})],
  ['replayed queued/in-progress state cycles', index => event(index % 2 ? 'response.queued' : 'response.in_progress')],
  ['empty delta and unknown heartbeat events', index => index % 2 ? event('response.output_text.delta', { delta: '' }) : event('ping')],
]) test(`${label} cannot hide a lost terminal; recovery retrieves only the original response`, { timeout: 2000 }, async t => {
  const calls = [], live = tickingStream(t, tick)
  const result = await callModel(body, { ...options, fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method })
    if (init.method === 'POST') return live.response
    return json(calls.length < 12 ? { id: 'resp_original', status: 'in_progress' } : completed)
  } })
  assert.deepEqual(result, completed)
  assert.equal(live.cancelled, true)
  assert.equal(calls.filter(call => call.method === 'POST').length, 1)
  assert.ok(calls.slice(1).every(call => call.method === 'GET' && call.url.endsWith('/resp_original')))
  assert.equal(calls.some(call => call.url.endsWith('/cancel')), false)
})

for (const deltaType of ['response.output_text.delta', 'response.reasoning_summary_text.delta', 'response.reasoning_text.delta']) test(`${deltaType} progress keeps a longer response alive without recovery or private-text leakage`, { timeout: 2000 }, async t => {
  const calls = [], progress = []
  const live = tickingStream(t, index => index < 16 ? event(deltaType, { delta: deltaType === 'response.reasoning_text.delta' ? 'PRIVATE_REASONING' : 'x' }) : event('response.completed', { response: completed }))
  const result = await callModel(body, { ...options, onProgress: value => progress.push(value), fetchImpl: async (url, init) => { calls.push({ url, method: init.method }); return live.response } })
  assert.deepEqual(result, completed)
  assert.equal(calls.length, 1)
  assert.doesNotMatch(JSON.stringify(progress), /PRIVATE_REASONING/)
})

test('semantic recovery survives transient GET failures, retains effort and never cancels or repeats accepted work', { timeout: 2000 }, async t => {
  const calls = [], live = tickingStream(t, () => ': heartbeat\n\n')
  let gets = 0
  const result = await callModel(body, { ...options, fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) })
    if (init.method === 'POST') return live.response
    if (++gets === 1) throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
    if (gets === 2) return json({ error: { code: 'server_error' } }, 503)
    return json(completed)
  } })
  assert.deepEqual(result, completed)
  assert.equal(gets, 3)
  assert.equal(calls.filter(call => call.method === 'POST').length, 1)
  assert.equal(calls[0].body.reasoning.effort, 'max')
  assert.equal(calls[0].body.max_output_tokens, 128000)
  assert.ok(calls.slice(1).every(call => call.url.endsWith('/resp_original')))
})

test('Stop after semantic recovery cancels only the original response and prevents later polls', { timeout: 2000 }, async t => {
  const controller = new AbortController(), calls = [], live = tickingStream(t, () => ': heartbeat\n\n')
  await assert.rejects(callModel(body, { ...options, signal: controller.signal, fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method })
    if (url.endsWith('/cancel')) return json({ id: 'resp_original', status: 'cancelled' })
    if (init.method === 'POST') return live.response
    controller.abort()
    return json({ id: 'resp_original', status: 'in_progress' })
  } }), { name: 'AbortError' })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'POST'])
  assert.equal(calls.at(-1).url.endsWith('/resp_original/cancel'), true)
})

test('auth, permission, quota and permanent retrieval errors remain terminal after semantic silence', { timeout: 2000 }, async t => {
  for (const [status, code] of [[401, 'invalid_api_key'], [403, 'permission_denied'], [404, 'not_found'], [429, 'insufficient_quota']]) {
    const calls = [], live = tickingStream(t, () => ': heartbeat\n\n')
    await assert.rejects(callModel(body, { ...options, fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method })
      return init.method === 'POST' ? live.response : json({ error: { code } }, status)
    } }), error => error.status === status && error.providerCode === code && error.responseId === 'resp_original')
    assert.deepEqual(calls.map(call => call.method), ['POST', 'GET'])
  }
})

test('a confirmed nonretryable failed response ends semantic recovery without new work', { timeout: 2000 }, async t => {
  const calls = [], live = tickingStream(t, () => ': heartbeat\n\n')
  await assert.rejects(callModel(body, { ...options, fetchImpl: async (_url, init) => {
    calls.push(init.method)
    return init.method === 'POST' ? live.response : json({ id: 'resp_original', status: 'failed', error: { code: 'invalid_request_error', message: 'Request failed.' } })
  } }), error => error.confirmedFailure === true && error.retryable === false)
  assert.deepEqual(calls, ['POST', 'GET'])
})

test('HTTP 200 heartbeat activity before any parsed ID never triggers a duplicate generation', { timeout: 2000 }, async t => {
  const controller = new AbortController(), calls = []
  let timer
  const response = new Response(new ReadableStream({
    start(stream) { timer = setInterval(() => stream.enqueue(new TextEncoder().encode(': heartbeat\n\n')), 5) },
    cancel() { clearInterval(timer) },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
  t.after(() => clearInterval(timer))
  const stopTimer = setTimeout(() => controller.abort(), 100)
  t.after(() => clearTimeout(stopTimer))
  await assert.rejects(callModel(body, { ...options, signal: controller.signal, fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method })
    return response
  } }), { name: 'AbortError' })
  assert.deepEqual(calls.map(call => call.method), ['POST'])
})
