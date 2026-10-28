import test from 'node:test'
import assert from 'node:assert/strict'
import { callModel } from '../src/generation/provider.mjs'

const body = { model: 'gpt-6.1-sol', store: false, reasoning: { effort: 'max' }, input: [] }
const options = { apiKey: 'mock-key', recovery: { retryBaseMs: 1, pollIntervalMs: 1, maxRecoveryRetries: 1 } }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const event = (type, rest = {}) => `data: ${JSON.stringify({ type, ...rest })}\n\n`
const done = { id: 'resp_final', status: 'completed', output_text: '{"whole":true}' }
const stream = text => new Response(text, { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_test' } })

test('a truncated created event before a response id is parsed gets a bounded automatic retry', async () => {
  const calls = [], progress = []
  const result = await callModel(body, { ...options, onProgress: p => progress.push(p), fetchImpl: async (_url, init) => {
    calls.push({ method: init.method, body: init.body && JSON.parse(init.body) })
    return calls.length === 1 ? stream('data: {"type":"response.created","response":') : json(done)
  } })
  assert.deepEqual(result, done)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], calls[0])
  assert.equal(progress.filter(p => p.stage === 'retrying').length, 1)
})

test('pre-id closed and malformed streams stop after the existing retry budget', async () => {
  for (const content of ['', 'data: [DONE]\n\n', 'data: {broken}\n\n']) {
    let calls = 0
    await assert.rejects(callModel(body, { ...options, fetchImpl: async () => { calls++; return stream(content) } }), { code: 'PROVIDER_STREAM_ERROR' })
    assert.equal(calls, 3)
  }
})

test('Stop during pre-id stream recovery backoff prevents a second request', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(callModel(body, { ...options, signal: controller.signal, onProgress: p => {
    if (p.stage === 'retrying') controller.abort()
  }, fetchImpl: async () => { calls++; return stream('data: {broken}\n\n') } }), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('malformed streams after a parsed response id never create a second response', async () => {
  let creates = 0, retrieves = 0
  await assert.rejects(callModel(body, { ...options, fetchImpl: async (_url, init) => {
    if (init.method === 'POST') {
      creates++
      return stream(event('response.created', { response: { id: 'resp_original', status: 'queued' } }) + 'data: {broken}\n\n')
    }
    retrieves++
    return json({ error: { code: 'server_error', message: 'Temporary outage' } }, 503)
  } }), error => error.code === 'PROVIDER_ERROR' && error.responseId === 'resp_original')
  assert.equal(creates, 1)
  assert.equal(retrieves, 2)
})
