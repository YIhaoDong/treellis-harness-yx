// Browser side of free Treellis accounts: email sign-in through Supabase, and the
// account's remaining free generations from the Treellis server. The Supabase project
// URL and publishable key come from the server's /api/generation/config response.
import { generationBaseURL } from '../generation/baseURL.mjs'

let client = null
let configuring = null
let state = { enabled: false, signedIn: false, email: '', usage: null, freeEfforts: [], freeGenerations: 0 }
const listeners = new Set()
const set = (patch) => { state = { ...state, ...patch }; for (const listener of listeners) listener() }

export const subscribeAccount = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
export const accountSnapshot = () => state

export function configureAccounts(config) {
  if (!config?.supabaseUrl || !config?.supabaseKey || typeof window === 'undefined') return Promise.resolve()
  if (configuring) return configuring
  set({ enabled: true, freeEfforts: config.freeEfforts || [], freeGenerations: config.freeGenerations || 0 })
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
    applySession(data.session)
  }).catch(() => { set({ enabled: false }) })
  return configuring
}

function applySession(session) {
  const email = session?.user?.email || ''
  const changed = email !== state.email || !!session !== state.signedIn
  set({ signedIn: !!session, email, ...(session ? {} : { usage: null }) })
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

const redirectURL = () => `${window.location.origin}${window.location.pathname}`

export async function sendSignInEmail(email) {
  if (!client) throw new Error('Sign-in is not available right now.')
  const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectURL(), shouldCreateUser: true } })
  if (error) throw new Error(error.status === 429 ? 'Too many sign-in emails were requested. Wait a minute and try again.' : error.message)
}

export async function verifySignInCode(email, code) {
  if (!client) throw new Error('Sign-in is not available right now.')
  const { error } = await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
  if (error) throw new Error('That code did not work. Check the latest email, or request a new one.')
}

export async function signOutAccount() {
  if (client) await client.auth.signOut().catch(() => {})
  applySession(null)
}
