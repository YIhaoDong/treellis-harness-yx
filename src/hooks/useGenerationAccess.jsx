import { useEffect, useState } from 'react'
import { STATIC_DEMO } from '../staticDemo/mode.mjs'
import { accountSnapshot, refreshAccountUsage, signOutAccount, subscribeAccount } from '../account/session.mjs'
import { RUN_MODES } from '../utils/llmConfig.js'

const KEY_STORAGE = 'OPENAI_API_KEY'
const EFFORTS = Object.keys(RUN_MODES)

export function storedKey() {
  if (STATIC_DEMO) return ''
  try { return (localStorage.getItem(KEY_STORAGE) || '').trim() } catch { return '' }
}

export function useAccount() {
  const [account, setAccount] = useState(accountSnapshot())
  useEffect(() => {
    setAccount(accountSnapshot())
    return subscribeAccount(() => setAccount(accountSnapshot()))
  }, [])
  return account
}

// Highest allowed effort at or below the one asked for.
export function allowedEffort(effort, locked) {
  if (!locked.includes(effort)) return effort
  const below = EFFORTS.slice(0, Math.max(0, EFFORTS.indexOf(effort))).filter(id => !locked.includes(id))
  return below.at(-1) || EFFORTS.find(id => !locked.includes(id)) || effort
}

// How a prompt gets an OpenAI key: the visitor's own key, a local server key, or a free
// account. When none is available, Generate asks for one (`requestAccess`) and the
// composer runs the waiting generation as soon as access arrives (`settled`).
export default function useGenerationAccess({ service, active = true }) {
  const account = useAccount()
  const [apiKey, setApiKey] = useState('')
  const [sheet, setSheet] = useState('')
  const [waiting, setWaiting] = useState(false)
  useEffect(() => {
    if (!active) return
    setApiKey(storedKey()); setSheet(''); setWaiting(false)
  }, [active])

  const ownKey = !!apiKey.trim()
  const localKey = !!service.localKeyAvailable
  const remaining = account.signedIn && account.usage ? account.usage.remaining : null
  const accountReady = account.enabled && account.signedIn && !ownKey && remaining !== 0
  const hasAccess = ownKey || localKey || accountReady
  // A waiting run starts once the account's count has loaded, so a used-up account is never sent.
  const settled = ownKey || localKey || (accountReady && remaining !== null)
  const freePath = account.enabled && !ownKey && !localKey
  const lockedEfforts = freePath && account.freeEfforts.length ? EFFORTS.filter(id => !account.freeEfforts.includes(id)) : []
  const defaultStep = ownKey || !account.enabled ? 'key' : !account.signedIn ? 'start' : remaining === 0 ? 'key' : 'account'

  useEffect(() => { if (active && account.linkError) setSheet('start') }, [active, account.linkError])

  return {
    account, apiKey, ownKey, localKey, remaining, accountReady, hasAccess, settled, lockedEfforts, sheet, waiting,
    effort: effort => allowedEffort(effort, lockedEfforts),
    openSheet: step => setSheet(step || defaultStep),
    closeSheet: () => { setSheet(''); setWaiting(false) },
    // Generate was pressed without a key or account: ask, then run.
    requestAccess: () => { setWaiting(true); setSheet(defaultStep) },
    finishWaiting: () => { setWaiting(false); setSheet('') },
    applyKey(key, remember) {
      const value = key.trim()
      setApiKey(value); setSheet('')
      if (STATIC_DEMO) return ''
      try {
        if (value && remember) localStorage.setItem(KEY_STORAGE, value)
        else localStorage.removeItem(KEY_STORAGE)
        return ''
      } catch { return 'This browser cannot remember the key. It will be used until you close this page.' }
    },
    removeKey() {
      setApiKey('')
      try { if (!STATIC_DEMO) localStorage.removeItem(KEY_STORAGE) } catch {}
    },
    // The server turned a run away because of the account: show the step that fixes it.
    handleRunError(code) {
      if (code === 'SESSION_EXPIRED' || code === 'SIGN_IN_REQUIRED') { void signOutAccount(); setSheet('start') }
      else if (code === 'FREE_LIMIT_REACHED') { void refreshAccountUsage(); setSheet('key') }
    },
  }
}
