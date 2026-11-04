import React, { useEffect, useState } from 'react'
import { sendSignInEmail, signOutAccount, verifySignInCode } from '../account/session.mjs'
import { storedKey } from '../hooks/useGenerationAccess.jsx'
import { RUN_MODES } from '../utils/llmConfig.js'

const RESEND_SECONDS = 60
const effortNames = ids => ids.map(id => RUN_MODES[id]?.label || id)
const listNames = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
const shortEmail = email => { const name = String(email).split('@')[0]; return name.length > 14 ? `${name.slice(0, 13)}…` : name }

// Shows how this visitor generates, and opens the sheet to change it.
export function AccessChip({ access, disabled = false, controls }) {
  const { account, ownKey, localKey, remaining } = access
  // Same order the server uses: own key, then a local server key, then the free account.
  const [label, tone] = ownKey ? ['Own key', 'ready'] : localKey ? ['Local key', 'ready']
    : account.enabled && account.signedIn ? [remaining === 0 ? 'Free runs used' : remaining === null ? shortEmail(account.email) : `${shortEmail(account.email)} · ${remaining} left`, remaining === 0 ? 'empty' : 'ready']
    : account.enabled ? [`Sign in · ${account.freeGenerations} free`, 'invite'] : ['Add API key', 'invite']
  return <button type="button" className={`prompt-chip prompt-chip--${tone}`} disabled={disabled}
    aria-haspopup="dialog" aria-expanded={!!access.sheet} aria-controls={controls} title="Free generations and API key"
    onClick={() => access.sheet ? access.closeSheet() : access.openSheet()}>
    <span className="prompt-chip__dot" aria-hidden="true" />{label}
  </button>
}

function UsageMeter({ usage }) {
  return <div className="prompt-access__meter" role="img" aria-label={`${usage.remaining} of ${usage.limit} free generations left`}>
    {Array.from({ length: usage.limit }, (_, index) => <span key={index} data-left={index < usage.remaining} />)}
  </div>
}

// Sign in for free generations, or use an own OpenAI key. `inline` renders it inside an
// existing dialog instead of as its own sheet.
export default function AccessSheet({ access, id, inline = false, onGenerate }) {
  const { account, sheet, waiting } = access
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [draftKey, setDraftKey] = useState('')
  const [remember, setRemember] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(0)
  useEffect(() => { setDraftKey(access.apiKey); setRemember(!!storedKey()); setMessage('') }, [sheet])
  useEffect(() => {
    if (!resendAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [resendAt])
  if (!sheet) return null

  const codeLength = account.codeLength || 6
  const step = sheet === 'key' || !account.enabled ? 'key' : account.signedIn ? 'account' : sentTo ? 'code' : 'email'
  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const attempt = async (action) => {
    if (working) return
    setWorking(true); setMessage('')
    try { await action() } catch (failure) { setMessage(failure.message || String(failure)) } finally { setWorking(false) }
  }
  const sendCode = (address) => attempt(async () => {
    await sendSignInEmail(address)
    setSentTo(address.trim()); setCode(''); setResendAt(Date.now() + RESEND_SECONDS * 1000); setNow(Date.now())
  })
  const verify = (digits) => attempt(() => verifySignInCode(sentTo, digits))
  const typeCode = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, codeLength)
    setCode(digits)
    // A complete code signs in straight away, whether typed, pasted or filled in from the email.
    if (digits.length === codeLength && digits !== code) verify(digits)
  }
  const free = account.freeGenerations
  const freeEfforts = effortNames(account.freeEfforts)
  const ownKeyEfforts = effortNames(access.lockedEfforts.length ? access.lockedEfforts : [])
  const usage = account.usage
  const usedUp = account.signedIn && access.remaining === 0
  const close = () => access.closeSheet()
  const link = (label, onClick, extra = {}) => <button type="button" className="prompt-access__link" onClick={onClick} disabled={working} {...extra}>{label}</button>

  let title, body
  if (step === 'email') {
    title = waiting ? 'Sign in to generate' : 'Try Treellis free'
    body = <>
      <p className="prompt-access__lead">Get <strong>{free} free generations</strong>. No password: we email you a {codeLength}-digit code.</p>
      {account.linkError && <p className="prompt-access__message prompt-access__message--error" role="alert">{account.linkError}</p>}
      <form className="prompt-access__form" onSubmit={event => { event.preventDefault(); if (email.trim()) sendCode(email) }}>
        <input className="prompt-key-input" type="email" autoComplete="email" autoFocus required placeholder="you@example.com" aria-label="Email"
          value={email} onChange={event => setEmail(event.target.value)} disabled={working} />
        <button type="submit" className="prompt-access__primary" disabled={working || !email.trim()}>{working ? 'Sending…' : 'Send code'}</button>
      </form>
      <div className="prompt-access__divider"><span>or</span></div>
      {link(<>Use your own OpenAI key <span aria-hidden="true">›</span></>, () => access.openSheet('key'))}
      <p className="prompt-access__fine">Treellis is a research prototype. We store only your email and how many generations you have used.</p>
    </>
  } else if (step === 'code') {
    title = 'Check your email'
    body = <>
      <p className="prompt-access__lead">We sent a {codeLength}-digit code to <strong>{sentTo}</strong>.</p>
      <form className="prompt-access__form" onSubmit={event => { event.preventDefault(); if (code.length >= 6) verify(code) }}>
        <input className="prompt-key-input prompt-access__code" inputMode="numeric" autoComplete="one-time-code" autoFocus
          placeholder={'0'.repeat(codeLength)} aria-label="Sign-in code" maxLength={codeLength}
          value={code} onChange={event => typeCode(event.target.value)} disabled={working} />
        <button type="submit" className="prompt-access__primary" disabled={working || code.length < 6}>{working ? 'Checking…' : 'Sign in'}</button>
      </form>
      <p className="prompt-access__hint">Or open the link in the email on this device. Can't find it? Check your spam folder.</p>
      <div className="prompt-access__actions">
        {link(waitSeconds ? `Resend code in ${Math.floor(waitSeconds / 60)}:${String(waitSeconds % 60).padStart(2, '0')}` : 'Resend code', () => sendCode(sentTo), { disabled: working || waitSeconds > 0 })}
        {link('Use a different email', () => { setSentTo(''); setCode(''); setMessage('') })}
      </div>
    </>
  } else if (step === 'account') {
    title = usedUp ? 'Free generations used' : 'Your free generations'
    body = <>
      <p className="prompt-access__lead">Signed in as <strong>{account.email}</strong></p>
      {usage && <div className="prompt-access__usage"><UsageMeter usage={usage} /><span>{usage.remaining} of {usage.limit} left</span></div>}
      {usedUp ? <>
        <p className="prompt-access__hint">Thanks for trying Treellis. Use your own OpenAI key to keep generating.</p>
        <button type="button" className="prompt-access__primary" onClick={() => access.openSheet('key')}>Use your OpenAI key</button>
      </> : <>
        <p className="prompt-access__hint">Free runs use {listNames(freeEfforts)} effort{ownKeyEfforts.length ? `; ${listNames(ownKeyEfforts)} need your own key` : ''}.</p>
        {waiting && onGenerate && <button type="button" className="prompt-access__primary" onClick={() => { access.finishWaiting(); onGenerate() }}>Generate</button>}
      </>}
      <div className="prompt-access__actions">
        {!usedUp && link(<>Use your own OpenAI key instead <span aria-hidden="true">›</span></>, () => access.openSheet('key'))}
        {link('Sign out', () => { void signOutAccount() })}
      </div>
    </>
  } else {
    title = 'Use your own OpenAI key'
    const looksWrong = draftKey.trim() && !draftKey.trim().startsWith('sk-')
    body = <>
      {usedUp && <p className="prompt-access__message">You have used your {free} free generations. Add your own key to keep going.</p>}
      <p className="prompt-access__lead">Runs are billed to your OpenAI account{ownKeyEfforts.length ? `, and ${listNames(ownKeyEfforts)} effort become available` : ''}.</p>
      <form className="prompt-access__form prompt-access__form--key" onSubmit={event => {
        event.preventDefault()
        if (!draftKey.trim()) return
        const problem = access.applyKey(draftKey, remember)
        if (problem) setMessage(problem)
      }}>
        <input className="prompt-key-input" type="password" autoComplete="off" autoFocus spellCheck={false} aria-label="OpenAI API key"
          placeholder={access.localKey ? 'Local test key configured' : 'sk-…'} value={draftKey} onChange={event => setDraftKey(event.target.value)} />
        <button type="submit" className="prompt-access__primary" disabled={!draftKey.trim()}>{waiting ? 'Use key and generate' : 'Use this key'}</button>
        <label className="prompt-access__check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> Remember on this device</label>
      </form>
      {looksWrong && <p className="prompt-access__hint">OpenAI keys usually start with sk-.</p>}
      <p className="prompt-access__fine">
        Your key goes to OpenAI only for your runs and is never stored on our server. "Remember" keeps it in this browser only.{' '}
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get a key ↗</a>
      </p>
      <div className="prompt-access__actions">
        {access.ownKey && link(account.signedIn && access.remaining !== 0 ? 'Remove key and use free generations' : 'Remove key', () => { access.removeKey(); setDraftKey(''); setRemember(false) })}
        {account.enabled && !account.signedIn && link(<><span aria-hidden="true">‹</span> Try free instead</>, () => access.openSheet('start'))}
        {account.enabled && account.signedIn && !access.ownKey && !usedUp && link(<><span aria-hidden="true">‹</span> Back to free generations</>, () => access.openSheet('account'))}
      </div>
    </>
  }

  const titleId = `${id}-title`
  const content = <>
    <div className="prompt-access__header">
      <h2 className="prompt-access__title" id={titleId}>{title}</h2>
      <button type="button" className="prompt-close" onClick={close} aria-label="Close">×</button>
    </div>
    {body}
    {message && <p className="prompt-access__message prompt-access__message--error" role="alert">{message}</p>}
  </>
  if (inline) return <section className="prompt-access prompt-access--inline" id={id} aria-labelledby={titleId}>{content}</section>
  return <div className="prompt-access-overlay" onClick={close}>
    <div className="prompt-access" id={id} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      {content}
    </div>
  </div>
}
