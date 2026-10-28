import test from 'node:test'
import assert from 'node:assert/strict'
import { callModel } from '../src/generation/provider.mjs'

const body = { model: 'gpt-6.1-sol', store: false, reasoning: { effort: 'max' }, input: [] }
const options = { apiKey: 'mock-key', recovery: { retryBaseMs: 1, pollIntervalMs: 1, streamIdleMs: 20, requestTimeoutMs: 50 } }
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const event = (type, rest = {}) => `data: ${JSON.stringify({ type, ...rest })}\n\n`
const done = (id = 'resp_original') => ({ id, status: 'completed', output_text: '{"whole":true}', usage: { output_tokens: 5 } })
const stream = (text, { stall = false, fail = false, onCancel = () => {} } = {}) => new Response(new ReadableStream({
  start(controller) {
    if (text) controller.enqueue(new TextEncoder().encode(text))
    if (fail) setTimeout(() => controller.error(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })), 1)
    else if (!stall) controller.close()
  },
  cancel: onCancel,
}), { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_stream' } })
const accepted = id => event('response.created', { response: { id, status: 'queued' } })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('a broken accepted stream retrieves its original response, never creating duplicate work', async () => {
  const calls = [], progress = []
  const result = await callModel(body, { ...options, onProgress: p => progress.push(p), fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) })
    if (calls.length === 1) return stream(accepted('resp_original') + event('response.output_text.delta', { delta: '{"partial":' }), { fail: true })
    if (calls.length === 2) return json({ id: 'resp_original', status: 'in_progress' })
    return json(done())
  } })
  assert.deepEqual(result, done())
  assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'GET'])
  assert.ok(calls.slice(1).every(c => c.url.endsWith('/resp_original')))
  assert.equal(calls[0].body.background, true)
  assert.equal(calls[0].body.store, false)
  assert.equal(calls[0].body.reasoning.effort, 'max')
  assert.ok(progress.some(p => p.stage === 'recovering'))
  assert.doesNotMatch(JSON.stringify(result), /partial/)
})

test('an idle stream reconnects without timing out the model or losing completed work', async () => {
  const calls = [], progress = []
  let streamCancelled = false
  const started = Date.now()
  const result = await callModel(body, { ...options, recovery: { ...options.recovery, streamIdleMs: 10 }, onProgress: p => progress.push(p), fetchImpl: async (url, init) => {
    calls.push(init.method)
    if (init.method === 'POST') return stream(accepted('resp_original'), { stall: true, onCancel: () => { streamCancelled = true } })
    return json(calls.length < 5 ? { id: 'resp_original', status: 'in_progress' } : done())
  } })
  assert.equal(result.status, 'completed')
  assert.ok(Date.now() - started >= 10)
  assert.equal(streamCancelled, true)
  assert.deepEqual(calls, ['POST', 'GET', 'GET', 'GET', 'GET'])
  assert.ok(progress.some(p => /still processing/.test(p.message)))
})

test('a closed accepted stream with malformed/partial JSON recovers a complete server result', async () => {
  for (const tail of ['', 'data: {malformed}\n\n', event('response.output_text.delta', { delta: '{"partial":' })]) {
    let creates = 0, retrieves = 0
    const result = await callModel(body, { ...options, fetchImpl: async (_url, init) => {
      if (init.method === 'POST') { creates++; return stream(accepted('resp_original') + tail) }
      retrieves++; return json(done())
    } })
    assert.deepEqual(result, done())
    assert.equal(creates, 1); assert.equal(retrieves, 1)
  }
})

test('JSON queued background responses are polled until terminal without an overall duration limit', async () => {
  let calls = 0
  const result = await callModel(body, { ...options, fetchImpl: async () => {
    calls++
    return json(calls < 12 ? { id: 'resp_original', status: calls < 3 ? 'queued' : 'in_progress' } : done())
  } })
  assert.equal(calls, 12)
  assert.equal(result.status, 'completed')
})

test('transient HTTP failures and pre-acceptance network failures retry, retaining effort and payload', async () => {
  for (const failure of [408, 409, 429, 500, 503, 'network']) {
    const calls = [], progress = []
    const result = await callModel(body, { ...options, onProgress: p => progress.push(p), fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body))
      if (calls.length === 1) {
        if (failure === 'network') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
        return json({ error: { code: failure === 429 ? 'rate_limit_exceeded' : 'server_error', message: 'Temporary failure' } }, failure)
      }
      return json(done())
    } })
    assert.equal(result.status, 'completed')
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1], calls[0])
    assert.equal(progress.filter(p => p.stage === 'retrying').length, 1)
  }
})

test('provider Retry-After controls the visible delay before a transient retry', async () => {
  let calls = 0
  const progress = [], started = Date.now()
  await callModel(body, { ...options, onProgress: p => progress.push(p), fetchImpl: async () => ++calls === 1
    ? json({ error: { code: 'rate_limit_exceeded', message: 'Slow down' } }, 429, { 'Retry-After': '0.02' }) : json(done()) })
  assert.ok(Date.now() - started >= 18)
  assert.equal(progress.find(p => p.stage === 'retrying').retryInMs, 20)
})

test('long Retry-After delays are preserved and remain immediately cancellable', async () => {
  const controller = new AbortController()
  let requestedDelay, calls = 0
  await assert.rejects(callModel(body, { ...options, signal: controller.signal, onProgress: progress => {
    if (progress.stage === 'retrying') { requestedDelay = progress.retryInMs; controller.abort() }
  }, fetchImpl: async () => {
    calls++
    return json({ error: { code: 'rate_limit_exceeded' } }, 429, { 'Retry-After': '300' })
  } }), { name: 'AbortError' })
  assert.equal(requestedDelay, 300000)
  assert.equal(calls, 1)
})

test('invalid requests, authentication, permission and billing/quota failures fail immediately', async () => {
  for (const [status, code] of [[400, 'invalid_request_error'], [401, 'invalid_api_key'], [403, 'permission_denied'], [429, 'insufficient_quota'], [429, 'billing_hard_limit_reached'], [429, 'credit_balance_exhausted'], [429, 'organization_spend_limit_exceeded'], [429, 'project_spend_limit_exceeded']]) {
    let calls = 0
    await assert.rejects(callModel(body, { ...options, fetchImpl: async () => {
      calls++
      return json({ error: { code, message: 'Request sk-hidden_secret failed' } }, status, { 'x-request-id': 'req_action' })
    } }), error => {
      assert.equal(error.status, status)
      assert.equal(error.providerCode, code)
      assert.equal(error.requestId, 'req_action')
      assert.equal(error.retryable, false)
      assert.doesNotMatch(error.message, /sk-hidden/)
      return true
    })
    assert.equal(calls, 1)
  }
})

test('transient terminal overload and availability codes restart only the failed task', async () => {
  for (const code of ['server_is_overloaded', 'service_unavailable_error', 'slow_down']) {
    let calls = 0
    const result = await callModel(body, { ...options, fetchImpl: async () => ++calls === 1
      ? stream(event('response.failed', { response: { id: 'resp_original', status: 'failed', error: { code, message: 'Temporary failure' } } }))
      : json(done('resp_retried')) })
    assert.equal(calls, 2)
    assert.equal(result.id, 'resp_retried')
  }
})

test('a confirmed terminal server failure alone permits a bounded fresh model attempt', async () => {
  for (const duringPolling of [false, true]) {
    let creates = 0, retrieves = 0
    const result = await callModel(body, { ...options, fetchImpl: async (_url, init) => {
      if (init.method === 'POST') {
        creates++
        if (creates > 1) return json(done('resp_retried'))
        return stream(accepted('resp_original') + (duringPolling ? '' : event('response.failed', { response: { id: 'resp_original', status: 'failed', error: { code: 'server_error', message: 'Server interrupted' } } })))
      }
      retrieves++
      return json({ id: 'resp_original', status: 'failed', error: { code: 'server_error', message: 'Server interrupted' } })
    } })
    assert.equal(result.id, 'resp_retried')
    assert.equal(creates, 2)
    assert.equal(retrieves, duringPolling ? 1 : 0)
  }
})

test('temporary retrieval failures retry the accepted response, never creating another one', async () => {
  let creates = 0, retrieves = 0
  const result = await callModel(body, { ...options, fetchImpl: async (url, init) => {
    if (init.method === 'POST') { creates++; return stream(accepted('resp_original')) }
    assert.match(url, /\/resp_original$/)
    retrieves++
    if (retrieves === 1) throw Object.assign(new TypeError('socket closed'), { cause: { code: 'ECONNRESET' } })
    if (retrieves === 2) return json({ error: { code: 'server_error', message: 'Temporary outage' } }, 503)
    return json(done())
  } })
  assert.equal(result.status, 'completed')
  assert.equal(creates, 1); assert.equal(retrieves, 3)
})

test('consecutive retrieval failure budget exposes the accepted response id and safe diagnostics', async () => {
  let creates = 0, retrieves = 0
  await assert.rejects(callModel(body, { ...options, recovery: { ...options.recovery, maxRecoveryRetries: 2 }, fetchImpl: async (_url, init) => {
    if (init.method === 'POST') { creates++; return stream(accepted('resp_original')) }
    retrieves++
    return json({ error: { code: 'server_error', message: 'Failure sk-secret_123' } }, 503, { 'x-request-id': 'req_last' })
  } }), error => {
    assert.equal(error.responseId, 'resp_original')
    assert.equal(error.requestId, 'req_last')
    assert.equal(error.status, 503)
    assert.doesNotMatch(error.message, /sk-secret/)
    return true
  })
  assert.equal(creates, 1); assert.equal(retrieves, 3)
})

test('create retry budget is bounded and preserves the provider request id', async () => {
  let calls = 0
  await assert.rejects(callModel(body, { ...options, fetchImpl: async () => {
    calls++
    return json({ error: { code: 'server_error', message: 'Temporary failure' } }, 500, { 'x-request-id': `req_${calls}` })
  } }), error => error.status === 500 && error.requestId === 'req_3')
  assert.equal(calls, 3)
})

test('recovered results expose public summaries only, with bounded redaction', async () => {
  const progress = []
  let calls = 0
  await callModel(body, { ...options, onProgress: p => progress.push(p), fetchImpl: async () => ++calls === 1
    ? stream(accepted('resp_original')) : json({ ...done(), output: [
      { type: 'reasoning', encrypted_content: 'RAW_PRIVATE', content: [{ type: 'reasoning_text', text: 'RAW_PRIVATE' }], summary: [{ type: 'summary_text', text: `sk-hidden_token ${'Public summary '.repeat(200)}` }] },
    ] }) })
  assert.doesNotMatch(JSON.stringify(progress), /RAW_PRIVATE|sk-hidden/)
  assert.ok(progress.find(p => p.summary).summary.length <= 1600)
})

test('Stop during an accepted stream cancels upstream background work and resolves locally immediately', async () => {
  const controller = new AbortController(), calls = []
  let cancelledTransport = false
  const started = Date.now()
  const pending = callModel(body, { ...options, signal: controller.signal, fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method, signal: init.signal })
    if (url.endsWith('/cancel')) return json({ id: 'resp_original', status: 'cancelled' })
    return stream(accepted('resp_original'), { stall: true, onCancel: () => { cancelledTransport = true } })
  } })
  await wait(2)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  await wait(1)
  assert.ok(Date.now() - started < 200)
  assert.equal(cancelledTransport, true)
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url.endsWith('/resp_original/cancel'), true)
  assert.equal(calls[1].signal.aborted, false)
})

test('Stop during retry backoff prevents any later model request', async () => {
  const controller = new AbortController()
  let calls = 0
  const pending = callModel(body, { ...options, recovery: { ...options.recovery, retryBaseMs: 1000 }, signal: controller.signal, onProgress: p => {
    if (p.stage === 'retrying') setTimeout(() => controller.abort(), 1)
  }, fetchImpl: async () => { calls++; return json({ error: { code: 'server_error', message: 'Temporary' } }, 500) } })
  await assert.rejects(pending, { name: 'AbortError' })
  await wait(10)
  assert.equal(calls, 1)
})

test('Stop during background polling cancels accepted work without applying a later completion', async () => {
  const controller = new AbortController(), progress = [], calls = []
  const pending = callModel(body, { ...options, recovery: { ...options.recovery, pollIntervalMs: 1000 }, signal: controller.signal, onProgress: p => {
    progress.push(p)
    if (/still processing/.test(p.message)) setTimeout(() => controller.abort(), 1)
  }, fetchImpl: async (url, init) => {
    calls.push(url)
    if (url.endsWith('/cancel')) return json({ id: 'resp_original', status: 'cancelled' })
    return json({ id: 'resp_original', status: 'in_progress' })
  } })
  await assert.rejects(pending, { name: 'AbortError' })
  await wait(1)
  assert.equal(calls.filter(c => c.endsWith('/cancel')).length, 1)
  assert.equal(progress.some(p => p.stage === 'writing'), false)
})

test('a completed response is never cancelled when Stop races with completion delivery', async () => {
  const controller = new AbortController(), calls = []
  await callModel(body, { ...options, signal: controller.signal, fetchImpl: async url => { calls.push(url); return json(done()) } })
  controller.abort()
  await wait(1)
  assert.equal(calls.length, 1)
})

test('per-request transport watchdog retries a stalled connection without imposing a model deadline', async () => {
  let calls = 0
  const signals = []
  const result = await callModel(body, { ...options, recovery: { ...options.recovery, requestTimeoutMs: 10 }, fetchImpl: async (_url, init) => {
    signals.push(init.signal)
    if (++calls === 1) return new Promise(() => {})
    return json(done())
  } })
  assert.equal(result.status, 'completed')
  assert.equal(calls, 2)
  assert.equal(signals[0].aborted, true)
})

test('incomplete recovery retains the provider token-exhaustion reason for the generation pipeline', async () => {
  let calls = 0
  const response = { id: 'resp_original', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"partial":' }
  const result = await callModel(body, { ...options, fetchImpl: async () => ++calls === 1 ? stream(accepted('resp_original')) : json(response) })
  assert.deepEqual(result, response)
})
