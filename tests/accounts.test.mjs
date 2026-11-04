import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { accountSettingsFromEnv, createAccounts } = require('../src/account/accounts.cjs')

const env = { SUPABASE_URL: 'https://demo.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  SUPABASE_SECRET_KEY: 'sb_secret_y', ACCOUNT_OPENAI_API_KEY: 'sk-lab' }
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function fakeSupabase({ users = { good: { id: 'u1', email: 'a@b.co' } }, limit = 3 } = {}) {
  const rows = new Map(), calls = []
  const fetchImpl = async (url, { method, headers, body }) => {
    const path = new URL(url).pathname
    calls.push({ path, method, headers, body: body && JSON.parse(body) })
    if (path === '/auth/v1/user') {
      const user = users[headers.Authorization.replace('Bearer ', '')]
      return user ? reply(200, user) : reply(401, { msg: 'invalid JWT' })
    }
    const args = JSON.parse(body)
    const row = rows.get(args.p_user) || { used: 0, attempts: 0 }
    rows.set(args.p_user, row)
    if (path.endsWith('/claim_generation')) {
      if (row.used >= args.p_limit || row.attempts >= args.p_attempt_limit) return reply(200, [{ allowed: false, used_count: row.used, attempt_count: row.attempts }])
      row.used++; row.attempts++
      return reply(200, [{ allowed: true, used_count: row.used, attempt_count: row.attempts }])
    }
    if (path.endsWith('/refund_generation')) { row.used = Math.max(0, row.used - 1); return reply(204, null) }
    if (path.endsWith('/generation_usage_for')) return reply(200, [{ allowed: true, used_count: row.used, attempt_count: row.attempts }])
    return reply(404, {})
  }
  return { fetchImpl, rows, calls, limit }
}

test('accounts stay off unless Supabase and the lab key are all configured', () => {
  assert.equal(createAccounts(accountSettingsFromEnv({})).enabled, false)
  assert.equal(createAccounts(accountSettingsFromEnv({ ...env, ACCOUNT_OPENAI_API_KEY: '' })).enabled, false)
  const accounts = createAccounts(accountSettingsFromEnv(env))
  assert.equal(accounts.enabled, true)
  assert.deepEqual(accounts.publicConfig(), { supabaseUrl: 'https://demo.supabase.co', supabaseKey: 'sb_publishable_x',
    freeGenerations: 3, freeEfforts: ['low', 'medium', 'high'], codeLength: 8 })
  // Neither secret ever reaches the browser config.
  assert.doesNotMatch(JSON.stringify(accounts.publicConfig()), /sb_secret|sk-lab/)
})

test('legacy anon keys also accepted, with limits and efforts read from the environment', () => {
  const settings = accountSettingsFromEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'eyJanon', SUPABASE_SERVICE_ROLE_KEY: 'eyJservice',
    ACCOUNT_OPENAI_API_KEY: 'sk', FREE_GENERATIONS: '5', FREE_ATTEMPTS: '12', FREE_EFFORTS: 'low, medium' })
  assert.equal(settings.publishableKey, 'eyJanon'); assert.equal(settings.secretKey, 'eyJservice')
  assert.equal(settings.freeGenerations, 5); assert.equal(settings.freeAttempts, 12)
  assert.deepEqual(settings.freeEfforts, ['low', 'medium'])
  assert.equal(accountSettingsFromEnv({ FREE_GENERATIONS: 'many' }).freeGenerations, 3)
  assert.equal(accountSettingsFromEnv({}).codeLength, 8)
  assert.equal(accountSettingsFromEnv({ SIGN_IN_CODE_LENGTH: '6' }).codeLength, 6)
  assert.equal(accountSettingsFromEnv({ SIGN_IN_CODE_LENGTH: '4' }).codeLength, 6)
})

test('verify sends the user token with the publishable key and rejects unknown sessions', async () => {
  const supabase = fakeSupabase()
  const accounts = createAccounts(accountSettingsFromEnv(env), supabase)
  assert.deepEqual(await accounts.verify('good'), { id: 'u1', email: 'a@b.co' })
  const call = supabase.calls[0]
  assert.equal(call.headers.apikey, 'sb_publishable_x')
  assert.equal(call.headers.Authorization, 'Bearer good')
  await assert.rejects(accounts.verify('forged'), { status: 401, code: 'SESSION_EXPIRED' })
  await assert.rejects(accounts.verify(''), { status: 401, code: 'SIGN_IN_REQUIRED' })
})

test('claims stop at the free limit, failed runs are refunded, and attempts are bounded', async () => {
  const supabase = fakeSupabase()
  const accounts = createAccounts(accountSettingsFromEnv({ ...env, FREE_ATTEMPTS: '5' }), supabase)
  const user = { id: 'u1' }
  assert.deepEqual(await accounts.claim(user), { used: 1, limit: 3, remaining: 2 })
  await accounts.claim(user); await accounts.claim(user)
  await assert.rejects(accounts.claim(user), { status: 403, code: 'FREE_LIMIT_REACHED' })
  await accounts.refund(user)
  assert.deepEqual(await accounts.usage(user), { used: 2, limit: 3, remaining: 1 })
  await accounts.claim(user); await accounts.refund(user)
  await accounts.claim(user) // fifth attempt
  await accounts.refund(user)
  assert.deepEqual(await accounts.usage(user), { used: 2, limit: 3, remaining: 0 })
  await assert.rejects(accounts.claim(user), { code: 'FREE_LIMIT_REACHED' })
  // Usage functions are called with the secret key only.
  for (const call of supabase.calls.filter(c => c.path.startsWith('/rest/'))) {
    assert.equal(call.headers.apikey, 'sb_secret_y'); assert.equal(call.headers.Authorization, undefined)
  }
})

test('only the configured efforts run on the lab key', () => {
  const accounts = createAccounts(accountSettingsFromEnv(env))
  for (const effort of ['low', 'medium', 'high', undefined]) assert.doesNotThrow(() => accounts.checkEffort(effort))
  for (const effort of ['xhigh', 'max']) assert.throws(() => accounts.checkEffort(effort), { status: 403, code: 'EFFORT_NOT_INCLUDED' })
})

test('an unreachable or failing Supabase reports the service as unavailable', async () => {
  const down = createAccounts(accountSettingsFromEnv(env), { fetchImpl: async () => { throw new TypeError('fetch failed') } })
  await assert.rejects(down.verify('good'), { status: 503, code: 'ACCOUNTS_UNAVAILABLE' })
  const failing = createAccounts(accountSettingsFromEnv(env), { fetchImpl: async () => reply(500, { message: 'boom' }) })
  const log = console.error; console.error = () => {}
  try { await assert.rejects(failing.claim({ id: 'u1' }), { status: 503, code: 'ACCOUNTS_UNAVAILABLE' }) }
  finally { console.error = log }
})
