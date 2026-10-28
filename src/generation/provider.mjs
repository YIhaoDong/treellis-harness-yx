import { getGenerationLimits } from './limits.mjs'
import { Agent, fetch as undiciFetch } from 'undici'

const RESPONSE_URL = 'https://api.openai.com/v1/responses'
const MAX_EVENT_CHARS = 8 * 1024 * 1024
const MAX_SUMMARY_CHARS = 1600
const DEFAULT_RECOVERY = Object.freeze({
  maxRetries: 2, maxRecoveryRetries: 5, retryBaseMs: 1000,
  pollIntervalMs: 2000, streamIdleMs: 60000, requestTimeoutMs: 30000,
})
const cleanMessage = value => String(value || '').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1200)
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? cleanMessage(value) : null
const waiting = response => ['queued', 'in_progress'].includes(response?.status)
const quotaError = error => /insufficient_quota|billing|hard_limit|usage_limit|quota_exceeded|credits_exhausted|credit_balance|spend_limit/i.test(`${error?.code || ''} ${error?.type || ''} ${error?.message || ''}`)
const transientCode = code => /^(server_error|internal_error|internal_server_error|rate_limit_exceeded|overloaded|server_is_overloaded|service_unavailable_error|slow_down|temporarily_unavailable|timeout|request_timeout)$/.test(code || '')

// Remove the native transport's model-duration limits. Short transport watchdogs
// below reconnect to the same background response; they never stop its thinking.
const generationAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 20000 })
export function generationFetch(input, init = {}) {
  return undiciFetch(input, { ...init, dispatcher: generationAgent })
}

export class ProviderError extends Error {
  constructor(message, code = 'PROVIDER_ERROR', details = {}) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    Object.assign(this, details)
  }
}

function cancelled() { return new DOMException('Cancelled', 'AbortError') }
function hasOutputText(response) {
  return typeof response?.output_text === 'string' || (response?.output || []).some(item =>
    (item.content || []).some(part => part.type === 'output_text' && typeof part.text === 'string'))
}
function responseText(response) {
  return typeof response?.output_text === 'string' ? response.output_text : (response?.output || []).flatMap(item =>
    (item.content || []).filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text)).join('')
}
function networkError(error) {
  if (error instanceof ProviderError) return error
  const causeCode = [error?.cause?.code, error?.cause?.errors?.[0]?.code, error?.code]
    .find(code => typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)) || null
  return new ProviderError('Could not reach OpenAI. Please check your connection and try again.', 'NETWORK_ERROR', { causeCode, retryable: true })
}
function retryAfter(response) {
  const value = response.headers?.get?.('retry-after')
  if (!value) return null
  const seconds = Number(value)
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : null
}
function providerFailure(error = {}, details = {}) {
  const status = details.status
  const providerCode = cleanMessage(error.code || error.type || '')
  const quota = quotaError(error)
  const message = status === 401 ? 'The API key was rejected. Please check the Key setting.'
    : status === 429 && quota ? 'This API key has no available quota. Please check its billing or usage limit.'
      : status === 429 ? 'OpenAI is rate-limiting this key or its quota is exhausted. Please try again later.'
        : cleanMessage(error.message || `OpenAI could not complete this generation${status ? ` (${status})` : ''}.`)
  return new ProviderError(message, 'PROVIDER_ERROR', {
    ...details, providerCode,
    retryable: !quota && ([408, 409, 429].includes(status) || status >= 500 || transientCode(providerCode)),
  })
}

/**
 * Stream only public summaries. A background Response survives a broken stream:
 * retrieve that same response until it completes rather than repeating its work.
 * There is no default model execution deadline. Recovery options are injectable
 * for deterministic fault tests; normal requests use the conservative defaults.
 */
export async function callModel(body, {
  apiKey, fetchImpl = generationFetch, signal, onProgress = () => {}, timeoutMs, recovery = {},
} = {}) {
  if (signal?.aborted) throw cancelled()
  const limits = getGenerationLimits(body?.reasoning?.effort || 'medium')
  const deadlineMs = timeoutMs ?? limits.timeoutMs
  if (deadlineMs !== null && (!Number.isFinite(deadlineMs) || deadlineMs <= 0)) throw new ProviderError('The generation timeout is invalid.', 'CONFIG_ERROR')
  const policy = { ...DEFAULT_RECOVERY, ...recovery }
  for (const key of Object.keys(DEFAULT_RECOVERY)) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0 || (key.endsWith('Retries') && !Number.isInteger(policy[key]))) throw new ProviderError('The connection recovery setting is invalid.', 'CONFIG_ERROR')
  }

  const controller = new AbortController()
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
  let timedOut = false, reader, abortedReject, settled = false, responseId = null, requestId = null, responseTerminal = false
  const cancelledResponses = new Set()
  const stopReading = () => { try { void reader?.cancel().catch(() => {}) } catch {} }
  const assertActive = () => {
    if (signal?.aborted) throw cancelled()
    if (controller.signal.aborted) throw new ProviderError('The model exceeded this mode’s time limit.', 'TIMEOUT')
  }
  const emit = event => { assertActive(); if (!settled) onProgress(event) }
  const cancelBackground = () => {
    if (!responseId || responseTerminal || cancelledResponses.has(responseId)) return
    const id = responseId
    cancelledResponses.add(id)
    const cancelController = new AbortController()
    const cancelTimer = setTimeout(() => cancelController.abort(), 10000)
    cancelTimer.unref?.()
    // Use a fresh signal: the generation signal is already aborted on Stop.
    Promise.resolve().then(() => fetchImpl(`${RESPONSE_URL}/${encodeURIComponent(id)}/cancel`, {
      method: 'POST', headers, signal: cancelController.signal,
    })).then(response => response.body?.cancel?.()).catch(() => {}).finally(() => clearTimeout(cancelTimer))
  }
  const rememberResponse = response => {
    const id = safeId(response?.id)
    if (id) responseId = id
    if (['completed', 'incomplete', 'failed', 'cancelled'].includes(response?.status)) responseTerminal = true
    if (controller.signal.aborted) cancelBackground()
  }
  const externalAbort = () => controller.abort()
  signal?.addEventListener('abort', externalAbort, { once: true })
  const abortPromise = new Promise((_, reject) => { abortedReject = reject })
  const onAbort = () => {
    stopReading()
    cancelBackground()
    abortedReject(signal?.aborted ? cancelled() : new ProviderError(
      'The model exceeded this mode’s time limit. Try step-by-step generation or a lower reasoning effort.', 'TIMEOUT'))
  }
  controller.signal.addEventListener('abort', onAbort, { once: true })
  const timer = deadlineMs === null ? null : setTimeout(() => { timedOut = true; controller.abort() }, deadlineMs)
  const pause = milliseconds => new Promise((resolve, reject) => {
    assertActive()
    const onStop = () => { clearTimeout(waitTimer); controller.signal.removeEventListener('abort', onStop); reject(signal?.aborted ? cancelled() : new ProviderError('The model exceeded this mode’s time limit.', 'TIMEOUT')) }
    const end = Date.now() + milliseconds
    let waitTimer
    const tick = () => {
      const remaining = end - Date.now()
      if (remaining > 0) waitTimer = setTimeout(tick, Math.min(remaining, 2147483647))
      else { controller.signal.removeEventListener('abort', onStop); resolve() }
    }
    controller.signal.addEventListener('abort', onStop, { once: true })
    tick()
  })
  const backoff = (attempt, error) => error?.retryAfterMs ?? Math.min(policy.retryBaseMs * 2 ** (attempt - 1), 30000)
  const diagnostics = error => {
    if (responseId && !error.responseId) error.responseId = responseId
    if (requestId && !error.requestId) error.requestId = requestId
    return error
  }

  const readStream = async (response, transportController) => {
    if (!response.body?.getReader) throw new ProviderError('OpenAI returned no readable response stream.', 'PROVIDER_STREAM_ERROR')
    reader = response.body.getReader()
    const currentReader = reader
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const summaries = new Map()
    let buffer = '', outputText = '', outputChars = 0, lastOutputEmit = 0, lastSummaryEmit = 0, lastSummary = '', latestSummary = '', terminal
    const reportSummary = (event, done = false) => {
      const key = `${event.item_id ?? event.output_index ?? 'summary'}:${event.summary_index ?? 0}`
      const text = done ? String(event.text || summaries.get(key) || '') : `${summaries.get(key) || ''}${event.delta || ''}`
      summaries.set(key, text.slice(-MAX_SUMMARY_CHARS))
      const summary = cleanMessage(text.slice(-MAX_SUMMARY_CHARS)).trim()
      latestSummary = summary
      const now = Date.now()
      if (summary && summary !== lastSummary && (done || !lastSummaryEmit || now - lastSummaryEmit >= 120)) {
        lastSummaryEmit = now; lastSummary = summary
        emit({ stage: 'thinking', message: 'GPT is preparing the model…', summary })
      }
    }
    const eventFromBlock = block => {
      const lines = block.split(/\r?\n/)
      const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
      if (!data || data === '[DONE]') return
      let event
      try { event = JSON.parse(data) } catch { throw new ProviderError('OpenAI returned a malformed response event.', 'PROVIDER_STREAM_ERROR') }
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new ProviderError('OpenAI returned an invalid response event.', 'PROVIDER_STREAM_ERROR')
      const eventType = event.type || lines.find(line => line.startsWith('event:'))?.slice(6).trim()
      if (event.response) rememberResponse(event.response)
      if (eventType === 'response.created') emit({ stage: 'provider', message: 'OpenAI accepted the request.' })
      else if (eventType === 'response.queued') emit({ stage: 'provider', message: 'OpenAI queued the request…' })
      else if (eventType === 'response.in_progress') emit({ stage: 'provider', message: 'GPT is processing the request…' })
      else if (eventType === 'response.reasoning_summary_text.delta') reportSummary(event)
      else if (eventType === 'response.reasoning_summary_text.done') reportSummary(event, true)
      else if (eventType === 'response.output_text.delta') {
        const delta = String(event.delta || '')
        outputText += delta; outputChars += [...delta].length
        const now = Date.now()
        if (!lastOutputEmit || now - lastOutputEmit >= 120) { lastOutputEmit = now; emit({ stage: 'writing', message: 'Writing the model data…', outputChars }) }
      } else if (eventType === 'response.completed' || eventType === 'response.incomplete') {
        if (!event.response || typeof event.response !== 'object') throw new ProviderError('OpenAI returned an invalid completion event.', 'PROVIDER_STREAM_ERROR')
        if (latestSummary && latestSummary !== lastSummary) emit({ stage: 'thinking', message: 'GPT is preparing the model…', summary: latestSummary })
        if (outputChars) emit({ stage: 'writing', message: 'Model data received.', outputChars })
        terminal = { ...event.response, status: eventType === 'response.completed' ? 'completed' : 'incomplete' }
        responseTerminal = true
        if (outputText && !hasOutputText(terminal)) terminal.output_text = outputText
      } else if (eventType === 'response.failed' || eventType === 'error') {
        const error = event.response?.error || event.error || event
        throw providerFailure(error, { confirmedFailure: eventType === 'response.failed', requestId })
      }
      // Raw/private reasoning and encrypted reasoning never reach the UI.
    }
    const drain = final => {
      let match
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        eventFromBlock(block)
        if (terminal) return
      }
      if (final && buffer.trim()) { eventFromBlock(buffer); buffer = '' }
      if (buffer.length > MAX_EVENT_CHARS) throw new ProviderError('OpenAI returned an oversized response event.', 'PROVIDER_STREAM_ERROR')
    }
    try {
      while (!terminal) {
        let idleTimer
        const idle = new Promise((_, reject) => {
          if (policy.streamIdleMs) idleTimer = setTimeout(() => {
            transportController.abort()
            try { void currentReader.cancel().catch(() => {}) } catch {}
            reject(new ProviderError('The stream became idle. Reconnecting to the running response…', 'PROVIDER_STREAM_ERROR', { causeCode: 'STREAM_IDLE', retryable: true }))
          }, policy.streamIdleMs)
        })
        let chunk
        try { chunk = await Promise.race([currentReader.read(), idle, abortPromise]) }
        finally { clearTimeout(idleTimer) }
        assertActive()
        try { buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true }) }
        catch { throw new ProviderError('OpenAI returned invalid UTF-8 response data.', 'PROVIDER_STREAM_ERROR') }
        drain(chunk.done)
        if (chunk.done) break
      }
      if (!terminal) throw new ProviderError('The connection ended before OpenAI completed the response. Your scene has not been changed.', 'PROVIDER_STREAM_ERROR')
      return terminal
    } finally {
      try { void currentReader.cancel().catch(() => {}) } catch {}
      try { currentReader.releaseLock() } catch {}
      if (reader === currentReader) reader = null
    }
  }

  const request = async (url, init) => {
    assertActive()
    const transportController = new AbortController()
    const abortTransport = () => transportController.abort()
    controller.signal.addEventListener('abort', abortTransport, { once: true })
    let transportTimer, transportReject
    const transportTimeout = new Promise((_, reject) => { transportReject = reject })
    if (policy.requestTimeoutMs) transportTimer = setTimeout(() => {
      transportController.abort()
      transportReject(new ProviderError('The connection to OpenAI stalled. Reconnecting…', 'NETWORK_ERROR', { causeCode: 'TRANSPORT_TIMEOUT', retryable: true }))
    }, policy.requestTimeoutMs)
    const work = async () => {
      const response = await fetchImpl(url, { ...init, signal: transportController.signal })
      assertActive()
      if (transportController.signal.aborted) throw new ProviderError('The connection to OpenAI stalled.', 'NETWORK_ERROR', { retryable: true })
      requestId = safeId(response.headers?.get?.('x-request-id')) || requestId
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw providerFailure(data.error, { status: response.status, requestId, retryAfterMs: retryAfter(response) })
      }
      if ((response.headers?.get?.('content-type') || '').includes('text/event-stream')) {
        clearTimeout(transportTimer)
        return readStream(response, transportController)
      }
      // JSON compatibility also handles a server returning a queued background Response.
      let result
      try { result = await response.json() }
      catch { throw new ProviderError('OpenAI returned an unreadable response.', 'PROVIDER_STREAM_ERROR') }
      assertActive()
      rememberResponse(result)
      return result
    }
    try { return await Promise.race([work(), transportTimeout, abortPromise]) }
    catch (error) { assertActive(); throw networkError(error) }
    finally { clearTimeout(transportTimer); controller.signal.removeEventListener('abort', abortTransport); transportController.abort() }
  }

  const inspectResult = result => {
    rememberResponse(result)
    if (result?.status === 'failed') throw providerFailure(result.error, { confirmedFailure: true, requestId })
    if (result?.status === 'cancelled') throw new ProviderError('OpenAI cancelled this generation. You can try again.', 'PROVIDER_CANCELLED', { retryable: false })
    return result
  }
  const pollResponse = async () => {
    let consecutiveFailures = 0
    emit({ stage: 'recovering', message: 'Reconnecting to the same running generation…' })
    while (true) {
      assertActive()
      let result
      try {
        result = inspectResult(await request(`${RESPONSE_URL}/${encodeURIComponent(responseId)}`, { method: 'GET', headers: { ...headers, Accept: 'application/json' } }))
        if (!waiting(result)) {
          if (!['completed', 'incomplete'].includes(result?.status)) throw new ProviderError('OpenAI returned an invalid generation status.', 'PROVIDER_STREAM_ERROR')
          const publicSummary = (result.output || []).filter(item => item.type === 'reasoning').flatMap(item => item.summary || [])
            .filter(part => part.type === 'summary_text').map(part => String(part.text || '')).join('\n')
          if (publicSummary) emit({ stage: 'thinking', message: 'GPT has finished preparing the model.', summary: cleanMessage(publicSummary.slice(-MAX_SUMMARY_CHARS)) })
          const outputChars = [...responseText(result)].length
          if (outputChars) emit({ stage: 'writing', message: 'Model data recovered.', outputChars })
          return result
        }
        consecutiveFailures = 0
        emit({ stage: 'provider', message: result.status === 'queued' ? 'OpenAI queued the request…' : 'GPT is still processing the same generation…' })
      } catch (caught) {
        assertActive()
        const error = networkError(caught)
        if (error.confirmedFailure || (!error.retryable && error.code !== 'PROVIDER_STREAM_ERROR') || consecutiveFailures >= policy.maxRecoveryRetries) throw diagnostics(error)
        const attempt = ++consecutiveFailures
        const retryInMs = backoff(attempt, error)
        emit({ stage: 'recovering', message: 'Connection interrupted. Retrying the same generation…', attempt, maxAttempts: policy.maxRecoveryRetries, retryInMs })
        await pause(retryInMs)
        continue
      }
      await pause(policy.pollIntervalMs)
    }
  }
  const work = async () => {
    let retries = 0
    while (true) {
      try {
        let result
        try {
          result = inspectResult(await request(RESPONSE_URL, {
            method: 'POST', headers: { ...headers, Accept: 'text/event-stream' },
            body: JSON.stringify({ ...body, background: true, store: false, stream: true, reasoning: { ...body.reasoning, summary: 'auto' } }),
          }))
        } catch (caught) {
          assertActive()
          const error = networkError(caught)
          // Once OpenAI has accepted a response, never regenerate it merely
          // because its stream broke or sent a recoverable error event.
          if (responseId && !error.confirmedFailure && (error.retryable || error.code === 'PROVIDER_STREAM_ERROR')) return await pollResponse()
          throw error
        }
        if (waiting(result)) {
          if (!responseId) throw new ProviderError('OpenAI did not provide the background generation identifier.', 'PROVIDER_STREAM_ERROR')
          return await pollResponse()
        }
        return result
      } catch (caught) {
        assertActive()
        const error = diagnostics(networkError(caught))
        // A known running response must be retrieved, never duplicated. Only a
        // confirmed terminal server failure permits a new bounded attempt.
        const retryable = error.retryable ?? (error.code === 'PROVIDER_STREAM_ERROR')
        if ((responseId && !error.confirmedFailure) || !retryable || retries >= policy.maxRetries) throw error
        const attempt = ++retries
        const retryInMs = backoff(attempt, error)
        emit({ stage: 'retrying', message: error.confirmedFailure ? 'OpenAI interrupted this attempt. Restarting this task automatically…' : 'OpenAI is temporarily unavailable. Retrying automatically…', attempt, maxAttempts: policy.maxRetries, retryInMs })
        await pause(retryInMs)
        responseId = null; requestId = null; responseTerminal = false
      }
    }
  }

  try { return await Promise.race([work(), abortPromise]) }
  catch (error) {
    if (signal?.aborted) throw cancelled()
    if (timedOut) throw new ProviderError('The model exceeded this mode’s time limit. Try step-by-step generation or a lower reasoning effort.', 'TIMEOUT')
    throw diagnostics(networkError(error))
  } finally {
    settled = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', externalAbort)
    controller.signal.removeEventListener('abort', onAbort)
    stopReading()
  }
}
