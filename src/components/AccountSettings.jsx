import React, { useEffect, useState } from 'react'
import { accountSnapshot, sendSignInEmail, signOutAccount, subscribeAccount, verifySignInCode } from '../account/session.mjs'
import { RUN_MODES } from '../utils/llmConfig.js'

export function useAccount() {
  const [account, setAccount] = useState(accountSnapshot)
  useEffect(() => {
    setAccount(accountSnapshot())
    return subscribeAccount(() => setAccount(accountSnapshot()))
  }, [])
  return account
}

const effortNames = (ids) => ids.map(id => RUN_MODES[id]?.label || id).join(', ')

// Free account sign-in, shown above the own-key field in the ⚙ Key settings.
export default function AccountSettings({ hasOwnKey = false }) {
  const account = useAccount()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  if (!account.enabled) return null

  const attempt = async (action) => {
    setWorking(true); setMessage('')
    try { await action() } catch (failure) { setMessage(failure.message || String(failure)) } finally { setWorking(false) }
  }
  const send = (event) => {
    event.preventDefault()
    if (!email.trim()) return
    attempt(async () => { await sendSignInEmail(email); setSentTo(email.trim()); setCode('') })
  }
  const verify = (event) => {
    event.preventDefault()
    if (!code.trim()) return
    attempt(async () => { await verifySignInCode(sentTo, code); setSentTo(''); setCode('') })
  }

  const efforts = effortNames(account.freeEfforts)
  if (account.signedIn) {
    const usage = account.usage
    const left = usage ? usage.remaining : null
    return (
      <div className="prompt-account">
        <div className="prompt-account__status">
          Signed in as <strong>{account.email}</strong>
          {left !== null && <> · {left > 0 ? `${left} of ${usage.limit} free generations left` : 'free generations used up'}</>}
        </div>
        <div className="prompt-account__hint">
          {hasOwnKey ? 'Your own key below is used while it is filled in. Clear it to use your free generations.'
            : left === 0 ? 'Add your own OpenAI key below to keep generating.'
            : `Free generations run at ${efforts} effort. Leave the key below empty to use them.`}
        </div>
        <button type="button" className="prompt-secondary prompt-secondary--border" onClick={() => signOutAccount()}>Sign out</button>
      </div>
    )
  }
  return (
    <div className="prompt-account">
      <div className="prompt-account__status">
        <strong>Try Treellis free:</strong> sign in with your email for {account.freeGenerations} generations on us, or use your own OpenAI key below.
      </div>
      {!sentTo ? (
        <form className="prompt-account__row" onSubmit={send}>
          <input className="prompt-key-input" type="email" autoComplete="email" placeholder="you@example.com" aria-label="Email"
            value={email} onChange={(e) => setEmail(e.target.value)} disabled={working} />
          <button type="submit" className="prompt-secondary prompt-secondary--border" disabled={working || !email.trim()}>
            {working ? 'Sending…' : 'Email me a sign-in link'}</button>
        </form>
      ) : (
        <form className="prompt-account__row" onSubmit={verify}>
          <span className="prompt-account__hint">Sent to {sentTo}. Open the link in the email, or enter its code here:</span>
          <input className="prompt-key-input prompt-account__code" inputMode="numeric" autoComplete="one-time-code" placeholder="Code" aria-label="Sign-in code"
            value={code} onChange={(e) => setCode(e.target.value)} disabled={working} />
          <button type="submit" className="prompt-secondary prompt-secondary--border" disabled={working || !code.trim()}>Sign in</button>
          <button type="button" className="prompt-secondary" onClick={() => { setSentTo(''); setMessage('') }} disabled={working}>Use another email</button>
        </form>
      )}
      {message && <div className="prompt-account__hint prompt-account__hint--error" role="alert">{message}</div>}
    </div>
  )
}
