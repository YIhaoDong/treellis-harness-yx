import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { getGlobalDispatcher } from 'undici'
import { callModel, generationFetch } from '../src/generation/provider.mjs'
import { getGenerationLimits } from '../src/generation/limits.mjs'

const body = { model: 'gpt-6.1-sol', reasoning: { effort: 'max' }, max_output_tokens: 128000, input: [] }
const options = { apiKey: 'mock-local-key', recovery: { retryBaseMs: 1 } }
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const event = (type, rest = {}, newline = '\n') => `event: ${type}${newline}data: ${JSON.stringify({ type, ...rest })}${newline}${newline}`
const completed = (text = '{"ok":true}') => event('response.completed', {
  response: { id: 'resp_streamed', status: 'completed', output_text: text, usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 } },
})
function streamResponse(text, chunkSize = 17) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } })
}

test('all five efforts have higher output ceilings and no default time limit', () => {
  const ceilings = { low: 16000, medium: 32000, high: 64000, xhigh: 96000, max: 128000 }
  for (const [effort, maxOutputTokens] of Object.entries(ceilings)) {
    assert.deepEqual(getGenerationLimits(effort), { timeoutMs: null, maxOutputTokens })
    const copy = getGenerationLimits(effort)
    copy.maxOutputTokens = 1
    assert.equal(getGenerationLimits(effort).maxOutputTokens, maxOutputTokens)
  }
  assert.throws(() => getGenerationLimits('__proto__'), { code: 'INVALID_EFFORT' })
  assert.throws(() => getGenerationLimits('unsupported'), { code: 'INVALID_EFFORT' })
})

test('the provider requests streaming and public summaries while preserving caller effort and schema', async () => {
  let captured
  const schemaBody = { ...body, reasoning: { effort: 'high', summary: 'none' }, text: { format: { type: 'json_schema', name: 'shape', schema: {} } } }
  const result = await callModel(schemaBody, { ...options, fetchImpl: async (url, init) => {
    captured = { url, ...init, body: JSON.parse(init.body) }
    return streamResponse(completed())
  } })
  assert.equal(captured.url, 'https://api.openai.com/v1/responses')
  assert.equal(captured.body.stream, true)
  assert.equal(captured.body.background, true)
  assert.equal(captured.body.store, false)
  assert.equal(captured.body.reasoning.summary, 'auto')
  assert.equal(captured.body.reasoning.effort, 'high')
  assert.deepEqual(captured.body.text, schemaBody.text)
  assert.equal(captured.body.max_output_tokens, 128000)
  assert.equal(captured.headers.Authorization, 'Bearer mock-local-key')
  assert.equal(result.status, 'completed')
})

test('SSE decoding spans UTF-8 bytes, CRLF separators, comments and multiple events', async () => {
  const progress = []
  const summary = '正在细化飞机机翼 🛩️'
  const text = ': keep-alive\r\n\r\n' + event('response.created', { response: { id: 'resp_streamed' } }, '\r\n')
    + event('response.in_progress', {}, '\r\n')
    + event('response.reasoning_summary_text.delta', { item_id: 'r1', summary_index: 0, delta: summary }, '\r\n')
    + event('response.reasoning_summary_text.done', { item_id: 'r1', summary_index: 0, text: summary }, '\r\n')
    + completed()
  const result = await callModel(body, { ...options, fetchImpl: async () => streamResponse(text, 1), onProgress: p => progress.push(p) })
  assert.equal(result.id, 'resp_streamed')
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 5, total_tokens: 17 })
  assert.ok(progress.some(p => p.stage === 'provider'))
  assert.ok(progress.some(p => p.summary === summary))
})

test('only public reasoning summaries are exposed; output JSON is reported as a count', async () => {
  const progress = []
  const output = '{"privateModelGeometry":"机翼"}'
  const text = event('response.reasoning.delta', { delta: 'RAW_REASONING_SHOULD_NEVER_APPEAR' })
    + event('response.reasoning_text.delta', { delta: 'RAW_REASONING_SHOULD_NEVER_APPEAR' })
    + event('response.output_item.added', { item: { type: 'reasoning', encrypted_content: 'RAW_REASONING_SHOULD_NEVER_APPEAR' } })
    + event('response.reasoning_summary_text.delta', { delta: 'Preparing the wings.' })
    + event('response.output_text.delta', { delta: output }) + completed(output)
  await callModel(body, { ...options, fetchImpl: async () => streamResponse(text), onProgress: p => progress.push(p) })
  assert.match(JSON.stringify(progress), /Preparing the wings/)
  assert.doesNotMatch(JSON.stringify(progress), /RAW_REASONING|privateModelGeometry/)
  assert.equal(progress.filter(p => p.stage === 'writing').at(-1).outputChars, [...output].length)
})

test('public summaries are bounded and accidental key-like text is redacted', async () => {
  const progress = []
  const text = event('response.reasoning_summary_text.done', { text: `sk-test_should_be_redacted ${'details '.repeat(90)}` }) + completed()
  await callModel(body, { ...options, fetchImpl: async () => streamResponse(text), onProgress: p => progress.push(p) })
  const summary = progress.find(p => p.summary).summary
  assert.ok(summary.length <= 1600)
  assert.match(summary, /\[redacted\]/)
  assert.doesNotMatch(summary, /sk-test/)
})

test('completion flushes the latest public summary after throttled deltas', async () => {
  const progress = []
  const text = event('response.reasoning_summary_text.delta', { delta: 'Preparing ' })
    + event('response.reasoning_summary_text.delta', { delta: 'the wings.' }) + completed()
  await callModel(body, { ...options, fetchImpl: async () => streamResponse(text, 5000), onProgress: p => progress.push(p) })
  assert.equal(progress.filter(p => p.summary).at(-1).summary, 'Preparing the wings.')
})

test('streamed text can fill a missing output in a genuine completion event', async () => {
  const text = event('response.output_text.delta', { delta: '{"ok":true}' })
    + event('response.completed', { response: { id: 'final', usage: { output_tokens: 4 } } })
  const result = await callModel(body, { ...options, fetchImpl: async () => streamResponse(text) })
  assert.equal(result.status, 'completed')
  assert.equal(result.output_text, '{"ok":true}')
})

test('a closed or DONE-only stream never accepts a partial model', async () => {
  for (const ending of ['', 'data: [DONE]\n\n']) {
    const text = event('response.output_text.delta', { delta: '{"unfinished":' }) + ending
    await assert.rejects(callModel(body, { ...options, fetchImpl: async () => streamResponse(text) }), { code: 'PROVIDER_STREAM_ERROR' })
  }
})

test('incomplete responses retain their reason and usage for pipeline recovery', async () => {
  const response = { id: 'partial', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { output_tokens: 128000 } }
  const result = await callModel(body, { ...options, fetchImpl: async () => streamResponse(event('response.incomplete', { response })) })
  assert.deepEqual(result, response)
})

test('failed and error events report a sanitized provider failure', async () => {
  for (const text of [
    event('response.failed', { response: { error: { code: 'server_error', message: 'Request sk-secret_123 failed' } } }),
    event('error', { code: 'server_error', message: 'Request sk-secret_123 failed' }),
  ]) await assert.rejects(callModel(body, { ...options, fetchImpl: async () => streamResponse(text) }), error => {
    assert.equal(error.code, 'PROVIDER_ERROR')
    assert.equal(error.providerCode, 'server_error')
    assert.match(error.message, /\[redacted\]/)
    assert.doesNotMatch(error.message, /sk-secret/)
    return true
  })
})

test('HTTP authentication, quota and other provider errors have safe useful messages', async () => {
  for (const [status, matcher] of [[401, /key was rejected/], [429, /quota is exhausted/], [500, /\[redacted\]/]]) {
    await assert.rejects(callModel(body, { ...options, fetchImpl: async () => jsonResponse({ error: { message: 'Failure sk-hidden_123' } }, status) }), error => {
      assert.equal(error.code, 'PROVIDER_ERROR')
      assert.equal(error.status, status)
      assert.match(error.message, matcher)
      assert.doesNotMatch(error.message, /sk-hidden/)
      return true
    })
  }
})

test('existing nonstreaming JSON provider mocks remain compatible', async () => {
  const response = { id: 'mock', status: 'completed', output_text: '{}', usage: { output_tokens: 2 } }
  assert.deepEqual(await callModel(body, { ...options, fetchImpl: async () => jsonResponse(response) }), response)
})

test('malformed event and invalid UTF-8 responses are rejected explicitly', async () => {
  for (const text of ['data: {broken}\n\n', 'data: null\n\n']) {
    await assert.rejects(callModel(body, { ...options, fetchImpl: async () => streamResponse(text) }), { code: 'PROVIDER_STREAM_ERROR' })
  }
  await assert.rejects(callModel(body, { ...options, fetchImpl: async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array([0xff])); controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } }) }), { code: 'PROVIDER_STREAM_ERROR' })
})

test('an explicit test timeout covers waiting for response headers', async () => {
  let upstreamSignal
  const started = Date.now()
  await assert.rejects(callModel(body, { ...options, timeoutMs: 20, fetchImpl: async (_, init) => {
    upstreamSignal = init.signal
    return new Promise(() => {})
  } }), { code: 'TIMEOUT' })
  assert.equal(upstreamSignal.aborted, true)
  assert.ok(Date.now() - started < 1000)
})

test('an explicit test timeout also covers a stalled body after headers arrive', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'Content-Type': 'text/event-stream' } })
  await assert.rejects(callModel(body, { ...options, timeoutMs: 20, fetchImpl: async () => response }), { code: 'TIMEOUT' })
  assert.equal(cancelled, true)
})

test('Stop aborts an active body without turning it into a timeout or accepting partial output', async () => {
  const controller = new AbortController()
  let cancelled = false, upstreamSignal
  const response = new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode(event('response.output_text.delta', { delta: '{"unfinished":' }))) },
    cancel() { cancelled = true },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
  const pending = callModel(body, { ...options, signal: controller.signal, fetchImpl: async (_, init) => {
    upstreamSignal = init.signal
    return response
  } })
  await new Promise(resolve => setTimeout(resolve, 5))
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(upstreamSignal.aborted, true)
  assert.equal(cancelled, true)
})

test('already cancelled requests never contact the provider', async () => {
  const controller = new AbortController()
  controller.abort()
  let called = false
  await assert.rejects(callModel(body, { ...options, signal: controller.signal, fetchImpl: async () => { called = true } }), { name: 'AbortError' })
  assert.equal(called, false)
})

test('requests without an explicit timeout wait for completion until Stop is pressed', async () => {
  const controller = new AbortController()
  let settled = false
  const pending = callModel(body, { ...options, signal: controller.signal, fetchImpl: async () => new Promise(() => {}) })
  pending.finally(() => { settled = true }).catch(() => {})
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(settled, false)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

async function localHTTP(t, handler) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve))
    server.closeAllConnections()
    await closed
  })
  return `http://127.0.0.1:${server.address().port}`
}

test('the dedicated real transport waits through delayed headers without changing the global dispatcher', async t => {
  const globalDispatcher = getGlobalDispatcher()
  const origin = await localHTTP(t, (_request, response) => {
    const timer = setTimeout(() => response.end('delayed headers completed'), 50)
    response.on('close', () => clearTimeout(timer))
  })
  const started = Date.now()
  const response = await generationFetch(origin)
  assert.equal(await response.text(), 'delayed headers completed')
  assert.ok(Date.now() - started >= 40)
  assert.equal(getGlobalDispatcher(), globalDispatcher)
})

test('the dedicated real transport waits through a delayed response body', async t => {
  const origin = await localHTTP(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.flushHeaders()
    response.write('first ')
    const timer = setTimeout(() => response.end('last'), 50)
    response.on('close', () => clearTimeout(timer))
  })
  const response = await generationFetch(origin)
  assert.equal(await response.text(), 'first last')
})

test('Stop aborts the dedicated real transport while waiting for headers', async t => {
  let received
  const started = new Promise(resolve => { received = resolve })
  const origin = await localHTTP(t, () => received())
  const controller = new AbortController()
  const pending = generationFetch(origin, { signal: controller.signal })
  await started
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('Stop aborts the dedicated real transport after headers while its body remains open', async t => {
  const origin = await localHTTP(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.flushHeaders()
    response.write('unfinished ')
  })
  const controller = new AbortController()
  const response = await generationFetch(origin, { signal: controller.signal })
  const pending = response.text()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
