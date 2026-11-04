// Browser side of free Treellis accounts: email sign-in through Supabase, and the
// account's remaining free generations from the Treellis server. The Supabase project
// URL and publishable key come from the server's /api/generation/config response.
import { generationBaseURL } from '../generation/baseURL.mjs'
import { emailLinkResult, sendCodeError, verifyCodeError } from './authMessages.mjs'

let client = null
let configuring = null
let state = { enabled: false, signedIn: false, email: '', usage: null, freeEfforts: [], freeGenerations: 0, codeLength: 6,
  // Set when this page was opened from an emailed sign-in link.
  linkSignedIn: false, linkError: '' }
const listeners = new Set()
const set = (patch) => { state = { ...state, ...patch }; for (const listener of listeners) listener() }

export const subscribeAccount = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
export const accountSnapshot = () => state

export function configureAccounts(config) {
  if (!config?.supabaseUrl || !config?.supabaseKey || typeof window === 'undefined') return Promise.resolve()
  if (configuring) return configuring
  const link = emailLinkResult(window.location.hash)
  if (link?.error) {
    // Supabase leaves its error in the address bar; remove it so a reload starts clean.
    try { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`) } catch {}
  }
  set({ enabled: true, freeEfforts: config.freeEfforts || [], freeGenerations: config.freeGenerations || 0,
    codeLength: config.codeLength || 6, linkError: link?.error || '' })
  configuring = import('@supabase/supabase-js').then(async ({ createClient }) => {
    // Implicit flow: the emailed link signs in on whichever device opens it.
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    })
    client.auth.onAuthStateChange((_event, session) => {
      // Supabase advises against awaiting its own calls inside this callback.
      setTimeout(() => applySession(session), 0)
    })
    const { data } = await client.auth.getSession()
    if (link?.signedIn && data.session) set({ linkSignedIn: true })
    applySession(data.session)
  }).catch(() => { set({ enabled: false }) })
  return configuring
}

function applySession(session) {
  const email = session?.user?.email || ''
  const changed = email !== state.email || !!session !== state.signedIn
  set({ signedIn: !!session, email, ...(session ? { linkError: '' } : { usage: null, linkSignedIn: false }) })
  if (session && changed) void refreshAccountUsage()
}

export async function accountToken() {
  if (!client) return ''
  try { const { data } = await client.auth.getSession(); return data.session?.access_token || '' }
  catch { return '' }
}

export async function refreshAccountUsage() {
  const token = await accountToken()
  if (!token) return
  try {
    const response = await fetch(`${generationBaseURL()}/api/account`, { headers: { 'X-Treellis-Session': token }, cache: 'no-store' })
    if (response.ok) set({ usage: await response.json() })
  } catch {}
}

export const dismissLinkNotice = () => set({ linkSignedIn: false, linkError: '' })

const redirectURL = () => `${window.location.origin}${window.location.pathname}`

export async function sendSignInEmail(email) {
  if (!client) throw new Error('Sign-in is not available right now. You can still use your own OpenAI key.')
  let error
  try {
    ({ error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectURL(), shouldCreateUser: true } }))
  } catch (failure) { error = failure }
  if (error) throw new Error(sendCodeError(error))
}

export async function verifySignInCode(email, code) {
  if (!client) throw new Error('Sign-in is not available right now. You can still use your own OpenAI key.')
  let error
  try {
    ({ error } = await client.auth.verifyOtp({ email: email.trim(), token: code.replace(/\D/g, ''), type: 'email' }))
  } catch (failure) { error = failure }
  if (error) throw new Error(verifyCodeError(error))
}

export async function signOutAccount() {
  if (client) await client.auth.signOut().catch(() => {})
  applySession(null)
}
