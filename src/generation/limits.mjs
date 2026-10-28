const LIMITS = Object.freeze({
  low: Object.freeze({ timeoutMs: null, maxOutputTokens: 16000 }),
  medium: Object.freeze({ timeoutMs: null, maxOutputTokens: 32000 }),
  high: Object.freeze({ timeoutMs: null, maxOutputTokens: 64000 }),
  xhigh: Object.freeze({ timeoutMs: null, maxOutputTokens: 96000 }),
  max: Object.freeze({ timeoutMs: null, maxOutputTokens: 128000 }),
})

// The output ceiling covers both reasoning tokens and the final AML response.
// A larger ceiling permits a complete response; it does not require using it.
// Model requests have no default time limit; Stop cancels them explicitly.
export function getGenerationLimits(effort) {
  if (!Object.hasOwn(LIMITS, effort)) {
    const error = new Error('Choose one of the five supported reasoning efforts.')
    error.code = 'INVALID_EFFORT'
    throw error
  }
  return { ...LIMITS[effort] }
}
