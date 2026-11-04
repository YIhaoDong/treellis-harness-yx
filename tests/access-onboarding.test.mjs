import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { emailLinkResult, sendCodeError, verifyCodeError } from '../src/account/authMessages.mjs'

test('sign-in failures read as plain next steps', () => {
  assert.match(sendCodeError({ status: 429, message: 'email rate limit exceeded' }), /Wait a minute/)
  assert.match(sendCodeError({ code: 'over_email_send_rate_limit', status: 400 }), /Wait a minute/)
  assert.match(sendCodeError({ code: 'email_address_invalid', message: 'Email address is invalid' }), /doesn't look right/)
  assert.match(sendCodeError({ status: 500, message: 'Error sending confirmation email' }), /couldn't send the email/)
  assert.match(sendCodeError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), /own OpenAI key/)
  assert.match(verifyCodeError({ code: 'otp_expired', message: 'Token has expired or is invalid' }), /expired or was already used/)
  assert.match(verifyCodeError({ status: 403, message: 'Invalid token' }), /didn't match/)
})

test('an emailed link reports success or an expired link from the URL hash', () => {
  assert.deepEqual(emailLinkResult('#access_token=a&refresh_token=b&type=magiclink'), { signedIn: true, error: '' })
  assert.match(emailLinkResult('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid').error, /expired/)
  assert.equal(emailLinkResult(''), null)
  assert.equal(emailLinkResult('#section-2'), null)
})

const compiled = (await build({ entryPoints: [fileURLToPath(new URL('../src/components/PromptPanel.jsx', import.meta.url))], bundle: true, write: false, format: 'cjs', platform: 'node',
  plugins: [{ name: 'access-harness', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }))
    for (const [filter, mock] of [[/useGenerationRun\.jsx$/, 'generation'], [/useGenerationService\.jsx$/, 'service'], [/usePromptImages\.jsx$/, 'attachments'],
      [/PromptImageAttachments\.jsx$/, 'preview'], [/PromptControls\.jsx$/, 'controls'], [/GenerationProgressPopover\.jsx$/, 'progress'], [/account\/session\.mjs$/, 'session']])
      builder.onResolve({ filter }, () => ({ path: `mock-${mock}`, external: true }))
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty-css', namespace: 'harness' }))
    builder.onLoad({ filter: /.*/, namespace: 'harness' }, () => ({ contents: '', loader: 'js' }))
  } }] })).outputFiles[0].text
const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) : typeof value === 'object' ? [value, ...flatten(value.props?.children)] : []
const text = value => !value ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.props?.children) : String(value)

const mounted = new Set()
test.afterEach(() => { for (const h of mounted) h.unmount(); mounted.clear() })

function harness({ account = {}, localKeyAvailable = false, storedKey = null } = {}) {
  const slots = [], effects = [], requests = [], sent = [], verified = [], listeners = new Set(), storage = new Map(storedKey ? [['OPENAI_API_KEY', storedKey]] : [])
  let index = 0, dirty = true, tree, generationProps
  let state = { enabled: true, signedIn: false, email: '', usage: null, freeEfforts: ['low', 'medium', 'high'], freeGenerations: 3, codeLength: 6, linkSignedIn: false, linkError: '', ...account }
  const setAccount = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    createElement(type, input, ...children) { const p = { ...input, children: children.length === 1 ? children[0] : children }; return typeof type === 'function' ? type(p) : { type, props: p } },
    useState(initial) { const n = index++; slots[n] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[n].value, update => { const value = typeof update === 'function' ? update(slots[n].value) : update; if (!Object.is(value, slots[n].value)) { slots[n].value = value; dirty = true } }] },
    useRef(initial) { const n = index++; slots[n] ??= { current: initial }; return slots[n] },
    useEffect(fn, deps) { const n = index++; if (!same(slots[n]?.deps, deps)) { const old = slots[n]; slots[n] = { deps }; effects.push(() => { old?.cleanup?.(); slots[n].cleanup = fn() }) } },
  }
  const generation = { busy: false, error: '', errorCode: '', progress: null, canResume: false,
    cancel() {}, setError(value) { generation.error = value; dirty = true },
    run(input, options) { requests.push({ input, options }); generation.busy = true; dirty = true },
  }
  const session = {
    accountSnapshot: () => state, subscribeAccount: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    refreshAccountUsage: async () => {}, signOutAccount: async () => setAccount({ signedIn: false, email: '', usage: null }), dismissLinkNotice: () => setAccount({ linkSignedIn: false }),
    sendSignInEmail: async email => { sent.push(email) }, verifySignInCode: async (email, code) => { verified.push({ email, code }) },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'react') return react
    if (name === 'mock-generation') return { __esModule: true, default: value => { generationProps = value; return generation } }
    if (name === 'mock-service') return { __esModule: true, default: () => ({ ready: true, localKeyAvailable, connecting: false }) }
    if (name === 'mock-attachments') return { __esModule: true, default: () => ({ images: [], revision: '', loading: false, composerProps: {}, clear() {}, clearIfCurrent() {} }) }
    if (name === 'mock-session') return session
    if (name === 'mock-controls') return { ModelModeSelect: p => react.createElement('model-select', p), GenerationStrategySelect: () => null, GenerateButton: p => react.createElement('button', { ...p, 'data-generate': true }, 'Generate') }
    if (['mock-preview', 'mock-progress'].includes(name)) return { __esModule: true, default: () => null }
    throw new Error(`Unexpected import ${name}`)
  }, module, module.exports)
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  const h = { requests, sent, verified, storage, generation,
    flush() { let loops = 0; while (dirty) { assert.ok(++loops < 30, 'Updates should settle'); dirty = false; index = 0; tree = module.exports.default({ currentScene: null }); while (effects.length) effects.shift()() } return tree },
    act(fn) { fn(); dirty = true; return h.flush() },
    account(patch) { setAccount(patch); return h.flush() },
    all: () => flatten(tree), text: () => text(tree),
    find(predicate, label = 'element') { const found = h.all().find(predicate); assert.ok(found, `Missing ${label}`); return found },
    button: label => h.find(item => item.type === 'button' && text(item).includes(label), label),
    generate: () => h.act(() => h.find(item => item.props?.['data-generate'], 'Generate').props.onClick()),
    type: value => h.act(() => h.find(item => item.type === 'textarea', 'prompt').props.onChange({ target: { value } })),
    input: (label, value) => h.act(() => h.find(item => item.type === 'input' && item.props['aria-label'] === label, label).props.onChange({ target: { value } })),
    submit: () => h.act(() => h.find(item => item.type === 'form', 'form').props.onSubmit({ preventDefault() {} })),
    sheet: () => h.all().find(item => item.props?.role === 'dialog'),
    effortOptions: () => h.find(item => item.type === 'model-select', 'effort select').props,
    async settle() { await new Promise(resolve => setTimeout(resolve, 0)); dirty = true; return h.flush() },
  }
  h.unmount = () => { for (const slot of slots) slot?.cleanup?.() }
  mounted.add(h)
  h.flush(); return h
}

test('a first visitor can type and press Generate; sign-in is asked for then, and the waiting run starts after it', async () => {
  const h = harness()
  assert.match(h.text(), /Sign in · 3 free/)
  assert.equal(h.sheet(), undefined, 'nothing is asked before the visitor tries to generate')
  h.act(() => h.button('toy biplane').props.onClick())
  assert.match(h.find(item => item.type === 'textarea').props.value, /toy biplane/)
  h.generate()
  assert.equal(h.requests.length, 0)
  assert.match(text(h.sheet()), /Sign in to generate/)
  h.input('Email', ' visitor@uni.edu '); h.submit(); await h.settle()
  assert.deepEqual(h.sent, [' visitor@uni.edu '])
  assert.match(text(h.sheet()), /Check your email[\s\S]*visitor@uni\.edu[\s\S]*Resend code in 1:00|Resend code in 0:/)
  h.input('Sign-in code', '12 34 56'); await h.settle()
  assert.deepEqual(h.verified, [{ email: 'visitor@uni.edu', code: '123456' }], 'a complete code signs in without pressing a button')
  h.account({ signedIn: true, email: 'visitor@uni.edu' })
  assert.equal(h.requests.length, 0, 'the run waits until the free count has loaded')
  h.account({ usage: { used: 0, limit: 3, remaining: 3 } })
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].options.apiKey, '')
  assert.match(h.requests[0].input.prompt, /toy biplane/)
  assert.equal(h.sheet(), undefined)
  assert.match(h.text(), /visitor · 3 left/)
})

test('free accounts lock higher efforts and a run never asks for one', () => {
  const h = harness({ account: { signedIn: true, email: 'a@b.co', usage: { used: 1, limit: 3, remaining: 2 } } })
  assert.deepEqual(h.effortOptions().locked, ['xhigh', 'max'])
  h.act(() => h.effortOptions().onChange({ target: { value: 'max' } }))
  assert.equal(h.effortOptions().value, 'high')
  h.type('A desk lamp'); h.generate()
  assert.equal(h.requests[0].input.effort, 'high')
})

test('an own key is used for the waiting run, remembered only when asked, and unlocks every effort', () => {
  const h = harness()
  h.type('A desk lamp'); h.generate()
  h.act(() => h.button('Use your own OpenAI key').props.onClick())
  assert.match(text(h.sheet()), /never stored on our server/)
  h.input('OpenAI API key', 'sk-own'); h.submit()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].options.apiKey, 'sk-own')
  assert.equal(h.storage.has('OPENAI_API_KEY'), false)
  assert.deepEqual(h.effortOptions().locked, [])
  assert.match(h.text(), /Own key/)
})

test('a used-up account goes straight to the own-key step, and a remembered key needs no sign-in', () => {
  const h = harness({ account: { signedIn: true, email: 'a@b.co', usage: { used: 3, limit: 3, remaining: 0 } } })
  assert.match(h.text(), /Free runs used/)
  h.type('A desk lamp'); h.generate()
  assert.equal(h.requests.length, 0)
  assert.match(text(h.sheet()), /Use your own OpenAI key[\s\S]*used your\s+3\s+free generations/)
  const keyed = harness({ storedKey: 'sk-saved' })
  keyed.type('A desk lamp'); keyed.generate()
  assert.equal(keyed.requests[0].options.apiKey, 'sk-saved')
})

test('without free accounts the chip asks for a key, and a local server key needs nothing', () => {
  const h = harness({ account: { enabled: false } })
  assert.match(h.text(), /Add API key/)
  assert.doesNotMatch(h.text(), /Sign in/)
  h.type('A desk lamp'); h.generate()
  assert.match(text(h.sheet()), /Use your own OpenAI key/)
  assert.doesNotMatch(text(h.sheet()), /Try free/)
  const local = harness({ localKeyAvailable: true })
  assert.match(local.text(), /Local key/)
  local.type('A desk lamp'); local.generate()
  assert.equal(local.requests.length, 1)
})

test('an expired session from the server reopens sign-in', () => {
  const h = harness({ account: { signedIn: true, email: 'a@b.co', usage: { used: 0, limit: 3, remaining: 3 } } })
  h.type('A desk lamp'); h.generate()
  h.generation.busy = false; h.generation.errorCode = 'SESSION_EXPIRED'; h.generation.error = 'Your sign-in has expired.'
  h.act(() => {}); return h.settle().then(() => assert.match(text(h.sheet()), /Try Treellis free/))
})
