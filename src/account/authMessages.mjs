// Plain-language messages for Supabase Auth failures, and the result of an emailed
// sign-in link that brought the visitor back to Treellis. Kept free of browser APIs
// so they can be tested directly.

const NETWORK = 'Sign-in is busy right now. Try again in a moment, or use your own OpenAI key.'

export function sendCodeError(error) {
  const code = error?.code || ''
  const text = String(error?.message || '')
  if (error?.status === 429 || /rate.?limit/i.test(code + text))
    return 'Too many codes were requested. Wait a minute, then try again.'
  if (/email_address_invalid|validation_failed/.test(code) || /invalid|validate email/i.test(text))
    return "That email address doesn't look right. Check it and try again."
  if (/signup_disabled|email_provider_disabled/.test(code)) return 'Sign-up is closed right now. You can still use your own OpenAI key.'
  if (/sending|smtp/i.test(text) || error?.status >= 500)
    return "We couldn't send the email. Check the address, or try again in a minute."
  if (error?.name === 'AuthRetryableFetchError' || /fetch|network/i.test(text)) return NETWORK
  return text || NETWORK
}

export function verifyCodeError(error) {
  const code = error?.code || ''
  const text = String(error?.message || '')
  if (error?.status === 429 || /rate.?limit/i.test(code + text)) return 'Too many tries. Wait a minute, then try again.'
  if (/otp_expired/.test(code) || /expired/i.test(text)) return 'That code has expired or was already used. Send a new one.'
  if (error?.name === 'AuthRetryableFetchError' || /fetch|network/i.test(text)) return NETWORK
  return "That code didn't match. Check the latest email, or send a new code."
}

// Supabase returns from an emailed link with either tokens or an error in the URL hash.
export function emailLinkResult(hash = '') {
  const params = new URLSearchParams(String(hash).replace(/^#/, ''))
  if (params.get('access_token')) return { signedIn: true, error: '' }
  const code = params.get('error_code') || params.get('error') || ''
  if (!code) return null
  return { signedIn: false, error: /expired|access_denied/.test(code)
    ? 'That sign-in link has expired or was already used. Send a new code below.'
    : 'That sign-in link did not work. Send a new code below.' }
}
