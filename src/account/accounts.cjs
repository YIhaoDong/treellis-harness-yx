// Free Treellis accounts: a signed-in user runs a limited number of generations on the
// lab's OpenAI key. Supabase holds the accounts (magic-link email sign-in) and the usage
// counts (supabase/schema.sql); this server only calls its HTTP APIs.

const accountError = (status, code, message) => Object.assign(new Error(message), { status, code });

const list = (value, fallback) => {
  const items = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
};
const count = (value, fallback) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
};

function accountSettingsFromEnv(env = process.env) {
  return {
    url: (env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    publishableKey: (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim(),
    secretKey: (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    openaiKey: (env.ACCOUNT_OPENAI_API_KEY || '').trim(),
    freeGenerations: count(env.FREE_GENERATIONS, 3),
    // Failed runs are refunded; this bounds how many runs one account can start in total.
    freeAttempts: count(env.FREE_ATTEMPTS, 10),
    freeEfforts: list(env.FREE_EFFORTS, ['low', 'medium', 'high']),
    // Digits in the emailed sign-in code: Supabase → Authentication → Providers → Email → Email OTP Length.
    codeLength: Math.min(10, Math.max(6, count(env.SIGN_IN_CODE_LENGTH, 6))),
  };
}

function createAccounts(settings = accountSettingsFromEnv(), { fetchImpl = (...args) => fetch(...args) } = {}) {
  const { url, publishableKey, secretKey, openaiKey, freeGenerations, freeAttempts, freeEfforts, codeLength = 6 } = settings;
  const enabled = !!(url && publishableKey && secretKey && openaiKey);
  // Legacy anon/service_role keys are JWTs and also go in Authorization; the newer
  // sb_publishable_/sb_secret_ keys go only in the apikey header.
  const keyHeaders = (key) => ({ apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) });

  const call = async (path, { key, headers = {}, body } = {}) => {
    let response;
    try {
      response = await fetchImpl(`${url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...keyHeaders(key), ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw accountError(503, 'ACCOUNTS_UNAVAILABLE', 'The account service is unreachable. Try again in a moment, or use your own OpenAI key.');
    }
    const data = await response.json().catch(() => null);
    return { response, data };
  };

  const rpc = async (name, body) => {
    const { response, data } = await call(`/rest/v1/rpc/${name}`, { key: secretKey, body });
    if (!response.ok) {
      console.error(`[accounts] ${name} failed (${response.status})`, data);
      throw accountError(503, 'ACCOUNTS_UNAVAILABLE', 'The account service is unavailable. Try again in a moment, or use your own OpenAI key.');
    }
    return Array.isArray(data) ? data[0] : data;
  };

  const usageOf = (row) => {
    const used = Math.max(0, Number(row?.used_count) || 0);
    const attempts = Math.max(0, Number(row?.attempt_count) || 0);
    const remaining = attempts >= freeAttempts ? 0 : Math.max(0, freeGenerations - used);
    return { used, limit: freeGenerations, remaining };
  };

  return {
    enabled,
    openaiKey,
    // Public values for the browser: the publishable key is designed to be exposed.
    publicConfig() {
      return enabled ? { supabaseUrl: url, supabaseKey: publishableKey, freeGenerations, freeEfforts, codeLength } : null;
    },
    // Resolve a Supabase access token to its user. Never trust a token the server did not verify.
    async verify(token) {
      if (!token) throw accountError(401, 'SIGN_IN_REQUIRED', 'Sign in for free generations, or use your own OpenAI key.');
      const { response, data } = await call('/auth/v1/user', { key: publishableKey, headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 401 || response.status === 403 || (response.ok && !data?.id))
        throw accountError(401, 'SESSION_EXPIRED', 'Your sign-in has expired. Sign in again to keep using your free generations.');
      if (!response.ok) throw accountError(503, 'ACCOUNTS_UNAVAILABLE', 'The account service is unavailable. Try again in a moment, or use your own OpenAI key.');
      return { id: data.id, email: data.email || '' };
    },
    async usage(user) {
      return usageOf(await rpc('generation_usage_for', { p_user: user.id }));
    },
    checkEffort(effort) {
      if (effort && !freeEfforts.includes(effort))
        throw accountError(403, 'EFFORT_NOT_INCLUDED',
          `Free generations run at ${freeEfforts.join(', ')} effort. Choose one of those, or use your own OpenAI key for higher efforts.`);
    },
    // Atomically take one free generation, or refuse when none are left.
    async claim(user) {
      const row = await rpc('claim_generation', { p_user: user.id, p_limit: freeGenerations, p_attempt_limit: freeAttempts });
      if (!row?.allowed) throw accountError(403, 'FREE_LIMIT_REACHED',
        `You have used your ${freeGenerations} free generations. Use your own OpenAI key to keep going.`);
      return usageOf(row);
    },
    // A run that failed (not one the user stopped) gives its generation back.
    async refund(user) {
      await rpc('refund_generation', { p_user: user.id });
    },
  };
}

module.exports = { accountSettingsFromEnv, createAccounts };
