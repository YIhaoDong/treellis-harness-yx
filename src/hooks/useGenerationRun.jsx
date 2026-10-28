import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { requestGeneration } from '../generation/client.mjs'
import { replaceScope, resumeIsCurrent, scopeAt, updateProgress } from '../generation/progressState.mjs'

const changedMessage = 'The scene or selection changed. Your latest edits and completed parts were kept. Start a new generation.'

function nextConversation(previous, prompt, answer) {
  const turns = [...(Array.isArray(previous) ? previous : []),
    { role: 'user', content: String(prompt || '') },
    { role: 'assistant', content: String(answer || '') },
  ].filter(turn => ['user', 'assistant'].includes(turn?.role) && typeof turn.content === 'string' && turn.content.trim())
    .slice(-6).map(turn => ({ role: turn.role, content: turn.content.slice(0, 4000) }))
  while (turns.reduce((total, turn) => total + turn.content.length, 0) > 12000) turns.shift()
  return turns
}

export default function useGenerationRun({ scene, path = null, open = true, identity, onApply, onComplete }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [progress, setProgress] = useState(null)
  const [ticket, setTicket] = useState(null)
  const [clarification, setClarification] = useState(null)
  const sceneRef = useRef(scene)
  const activeRef = useRef(null)
  const ticketRef = useRef(null)
  const latestRef = useRef({ identity, path, open, onApply, onComplete })
  latestRef.current = { identity, path, open, onApply, onComplete }
  const keepTicket = (value) => { ticketRef.current = value; setTicket(value) }
  const update = (event) => setProgress(previous => updateProgress(previous || {}, event))

  const cancel = () => {
    const active = activeRef.current
    activeRef.current = null
    active?.controller.abort()
    setBusy(false)
    if (active) setProgress(previous => ({ ...previous, stage: 'stopped', finishedAt: Date.now() }))
  }

  useLayoutEffect(() => {
    sceneRef.current = scene
    const active = activeRef.current
    if (active && (path !== active.path || !open || JSON.stringify(scene) !== active.revision)) {
      activeRef.current = null
      active.controller.abort()
      keepTicket(null)
      setBusy(false)
      setError(changedMessage)
      setProgress(previous => ({ ...previous, stage: 'stopped', finishedAt: Date.now() }))
    }
  }, [scene, path, open])
  useEffect(() => {
    const current = ticketRef.current
    if (current && !resumeIsCurrent(current, { identity, scene: sceneRef.current, path })) keepTicket(null)
  }, [identity, scene, path])
  useEffect(() => () => { activeRef.current?.controller.abort(); activeRef.current = null }, [])

  const reset = () => { cancel(); keepTicket(null); setProgress(null); setError(''); setErrorCode(''); setClarification(null) }
  const run = async (input, { apiKey = '', resume = false } = {}) => {
    if (activeRef.current) return
    const previousTicket = ticketRef.current
    if (resume && !resumeIsCurrent(previousTicket, { identity, scene: sceneRef.current, path })) return
    const controller = new AbortController()
    const active = { controller, identity, path, revision: JSON.stringify(sceneRef.current), checkpoints: 0 }
    activeRef.current = active
    const actualInput = resume ? { ...input, mode: previousTicket.mode, scene: sceneRef.current,
      ...(path ? { node: scopeAt(sceneRef.current, path) } : {}), resume: previousTicket.resume } : input
    if (!resume) keepTicket(null)
    setBusy(true); setError(''); setErrorCode(''); setClarification(null)
    setProgress(previous => ({ ...(resume ? previous : {}), startedAt: Date.now(), finishedAt: null,
      elapsedBefore: resume && previous ? (previous.elapsedBefore || 0) + Math.max(0, (previous.finishedAt || Date.now()) - previous.startedAt) : 0,
      stage: 'preparing', title: '', message: '', step: 0, summary: '', outputChars: 0,
      ...(resume ? {} : { completed: [], completedSteps: 0 }) }))
    const isActive = () => activeRef.current === active && !controller.signal.aborted
    const assertCurrent = () => {
      if (!isActive()) throw new DOMException('Cancelled', 'AbortError')
      if (!latestRef.current.open || latestRef.current.path !== path || JSON.stringify(sceneRef.current) !== active.revision) {
        keepTicket(null)
        throw new Error(changedMessage)
      }
    }
    const acceptResume = (resumeData) => {
      if (resumeData === undefined) return
      if (!resumeData || latestRef.current.identity !== active.identity) { keepTicket(null); return }
      keepTicket({ resume: resumeData, identity: active.identity, revision: active.revision, path, mode: actualInput.mode })
    }
    const apply = (event) => {
      assertCurrent()
      const next = path ? replaceScope(sceneRef.current, path, event.result) : event.result
      const revision = JSON.stringify(next)
      if (revision !== active.revision) {
        latestRef.current.onApply?.(event.result, event.meta)
        sceneRef.current = next
        active.revision = revision
      }
    }
    try {
      const reply = await requestGeneration(actualInput, { apiKey, signal: controller.signal,
        onProgress: (event) => { if (isActive()) { update(event); acceptResume(event.resume) } },
        onCheckpoint: (event) => {
          apply(event)
          active.checkpoints += 1
          update(event)
          acceptResume(event.resume)
        },
      })
      assertCurrent()
      apply(reply) // The last checkpoint normally already applied this exact result.
      keepTicket(null)
      setProgress(previous => ({ ...previous, stage: 'complete', finishedAt: Date.now() }))
      latestRef.current.onComplete?.(reply, actualInput)
    } catch (failure) {
      if (isActive()) {
        setError(failure.message || String(failure)); setErrorCode(failure.code || '')
        const asking = failure.code === 'CLARIFICATION'
        if (asking) setClarification({ message: failure.message || String(failure),
          suggestions: Array.isArray(failure.suggestions) ? failure.suggestions : [],
          revision: active.revision, path, prompt: actualInput.prompt,
          conversation: nextConversation(actualInput.conversation, actualInput.prompt, failure.message),
        })
        acceptResume(failure.resume)
        update({ stage: asking ? 'clarification' : 'failed', ...(failure.completedSteps !== undefined ? { completedSteps: failure.completedSteps } : {}),
          ...(failure.totalSteps !== undefined ? { totalSteps: failure.totalSteps } : {}) })
        setProgress(previous => ({ ...previous, finishedAt: Date.now() }))
      }
    } finally {
      if (activeRef.current === active) { activeRef.current = null; setBusy(false) }
    }
  }
  return { busy, error, errorCode, setError, progress, run, cancel, reset, clarification,
    clarificationIsCurrent: !!clarification && !busy && open && clarification.path === path && clarification.revision === JSON.stringify(scene),
    canResume: !busy && resumeIsCurrent(ticket, { identity, scene, path }) }
}
