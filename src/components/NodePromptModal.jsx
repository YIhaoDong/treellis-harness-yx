import React, { useEffect, useRef, useState } from 'react'
import { STATIC_DEMO } from '../staticDemo/mode.mjs'
import { nodeDisplayName } from '../utils/promptMeta.jsx'
import { DEFAULT_RUN_MODE } from '../utils/llmConfig.js'
import { GenerateButton, GenerationProgress, GenerationStrategySelect, ModelModeSelect } from './PromptControls.jsx'
import { stageLabel, supportsStagedGeneration } from '../generation/progressState.mjs'
import useGenerationService from '../hooks/useGenerationService.jsx'
import useGenerationRun from '../hooks/useGenerationRun.jsx'
import usePromptImages from '../hooks/usePromptImages.jsx'
import PromptImageAttachments from './PromptImageAttachments.jsx'
import { boundedNodeConversation, followupNodeAt, nodeFollowupSuggestions, nodeReplyConversation } from '../utils/nodeFollowup.mjs'
import '../prompt.css'

export default function NodePromptModal({ open, path, node, scene, onClose, onApply, onScopeChange, disabled = false, onBusyChange }) {
  const [prompt, setPrompt] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [runMode, setRunMode] = useState(DEFAULT_RUN_MODE)
  const [preferredStrategy, setPreferredStrategy] = useState('staged')
  const [activePath, setActivePath] = useState(path)
  const [conversation, setConversation] = useState([])
  const [replyContext, setReplyContext] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const taRef = useRef(null)
  const lastReplyRef = useRef(null)
  const pendingRef = useRef(null)
  const attachments = usePromptImages({ disabled, isDisabled: () => busy || !!pendingRef.current || disabled })
  const detailed = supportsStagedGeneration(runMode)
  const strategy = detailed ? preferredStrategy : 'single'
  const identity = JSON.stringify({ prompt, effort: runMode, strategy, path: activePath, conversation, images: attachments.revision })
  const generation = useGenerationRun({ scene, path: activePath, open, identity,
    imageRevision: attachments.revision,
    onApply: (result, meta) => onApply?.(result, meta, activePath), onComplete: () => onClose?.() })
  const { busy, error, errorCode, setError, clarification, clarificationIsCurrent } = generation
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  const activeNode = followupNodeAt(scene, activePath) || (!scene && activePath === path ? node : null)
  const nodeName = nodeDisplayName(activeNode)
  const service = useGenerationService()
  const revision = JSON.stringify(scene)
  const replyIsCurrent = !replyContext || (replyContext.revision === revision && replyContext.path === activePath)
  const hasReply = !!clarification || conversation.length > 0
  const canRun = open && service.ready && !busy && !disabled && !attachments.loading && !pendingAction && (!!apiKey.trim() || service.localKeyAvailable) && !!activeNode && !!activePath
  const canSubmit = canRun && replyIsCurrent && (!clarification || clarificationIsCurrent) && !!prompt.trim()
  const displayError = (errorCode === 'CLARIFICATION' && clarification ? '' : error) || service.error
  const suggestions = nodeFollowupSuggestions(scene, clarification?.path, clarification?.suggestions)
  const staleReply = !!clarification && !busy && !pendingAction && !clarificationIsCurrent
  const close = () => { pendingRef.current = null; setPendingAction(null); generation.cancel(); onClose?.() }
  const focusReply = () => {
    taRef.current?.focus()
    taRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }
  useEffect(() => {
    generation.reset()
    setActivePath(path)
    setConversation([])
    setReplyContext(null)
    setPendingAction(null)
    pendingRef.current = null
    lastReplyRef.current = null
    attachments.clear()
    if (!open) return
    setPrompt('')
    let key = ''
    try { if (!STATIC_DEMO) key = (localStorage.getItem('OPENAI_API_KEY') || '').trim() } catch {}
    setApiKey(key)
    setShowOptions(!key && !service.localKeyAvailable)
    const timer = setTimeout(() => taRef.current?.focus(), 50)
    return () => { clearTimeout(timer) }
  }, [open, path])
  useEffect(() => {
    if (!open || !clarification || lastReplyRef.current === clarification) return
    lastReplyRef.current = clarification
    setConversation(nodeReplyConversation(clarification))
    setReplyContext({ revision: clarification.revision, path: clarification.path })
    setPrompt('')
    focusReply()
  }, [open, clarification])
  useEffect(() => {
    if (!pendingAction || activePath !== pendingAction.path || pendingRef.current !== pendingAction) return
    pendingRef.current = null
    setPendingAction(null)
    if (!open || busy || disabled || attachments.loading || !service.ready || !activeNode || revision !== pendingAction.revision || attachments.revision !== pendingAction.imageRevision) {
      setError('The scene or reference images changed, or another task is running. Ask again before applying this suggestion.')
      return
    }
    generation.run({ mode: 'node', prompt: pendingAction.instruction, scene, node: activeNode,
      path: activePath, effort: runMode, strategy, conversation: pendingAction.conversation, images: attachments.images }, { apiKey })
  }, [pendingAction, activePath, open, busy, disabled, attachments.loading, attachments.revision, service.ready, activeNode, revision, apiKey, runMode, strategy])
  useEffect(() => { if (open && service.ready && service.localKeyAvailable && !apiKey) setShowOptions(false) }, [service.ready, service.localKeyAvailable, open])
  useEffect(() => {
    if (!open) return
    const onEscape = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [open, onClose])
  const saveKey = () => {
    if (STATIC_DEMO) return
    try {
      const key = apiKey.trim()
      if (key) localStorage.setItem('OPENAI_API_KEY', key)
      else localStorage.removeItem('OPENAI_API_KEY')
    } catch { setError('This browser cannot save the key. You can still use it for this session.') }
  }
  const submit = (resume = false) => {
    if (STATIC_DEMO) return
    if (!canSubmit || pendingRef.current) return
    generation.run({ mode: 'node', prompt, scene, node: activeNode, path: activePath, effort: runMode, strategy,
      conversation: boundedNodeConversation(conversation), images: attachments.images }, { apiKey, resume })
  }
  const acceptSuggestion = suggestion => {
    if (!canRun || pendingRef.current || !clarificationIsCurrent || clarification?.revision !== revision || clarification.path !== activePath) return
    const selected = nodeFollowupSuggestions(scene, activePath, [suggestion])[0]
    if (!selected) return
    const action = { ...selected, conversation: nodeReplyConversation(clarification), revision, imageRevision: attachments.revision }
    pendingRef.current = action
    setPendingAction(action)
    setConversation(action.conversation)
    setReplyContext({ revision, path: selected.path })
    setPrompt(selected.instruction)
    setActivePath(selected.path)
    onScopeChange?.(selected.path)
  }
  const startNewQuestion = () => {
    if (busy || pendingRef.current) return
    const previousPrompt = clarification?.prompt || prompt
    generation.reset()
    setConversation([])
    setReplyContext(null)
    lastReplyRef.current = null
    setPrompt(previousPrompt)
    focusReply()
  }
  if (!open) return null

  return (
    <div className="prompt-modal-overlay" role="dialog" aria-modal="true"
      aria-labelledby="node-prompt-title" onClick={close}>
      <div className="prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-modal__header">
          <div>
            <div className="prompt-modal__eyebrow">Node prompt</div>
            <h2 className="prompt-modal__title" id="node-prompt-title">AI Edit · {nodeName}</h2>
            <div className="prompt-modal__path">Path: {activePath}</div>
          </div>
          <button type="button" className="prompt-close" onClick={close} aria-label="Close">×</button>
        </div>
        {clarification && <section className="node-reply" aria-label="Assistant response">
          <div className="node-reply__heading">Treellis</div>
          <p className="node-reply__message">{clarification.message}</p>
          {!!suggestions.length && <div className="node-reply__suggestions" aria-label="Suggested actions">
            {suggestions.map((suggestion, index) => <button type="button" className="node-reply__suggestion"
              key={`${suggestion.path}-${index}`} disabled={!canRun || !clarificationIsCurrent}
              onClick={() => acceptSuggestion(suggestion)}>
              <span className="node-reply__action">{suggestion.label} <span aria-hidden="true">↗</span></span>
              <span className="node-reply__target">{suggestion.parentScope ? 'Parent scope' : 'Current node'} · {suggestion.name} · {suggestion.path}</span>
            </button>)}
          </div>}
          <div className="node-reply__footer">
            <button type="button" className="prompt-secondary prompt-secondary--border" disabled={busy || !!pendingAction || staleReply}
              onClick={focusReply}>Custom answer</button>
            <span>{suggestions.length ? 'Choose an action or reply below.' : 'Reply below to continue.'}</span>
          </div>
          {staleReply && <div className="node-reply__stale" role="status">
            The scene, selection or reference images changed. Ask again before using these suggestions.
            <button type="button" className="prompt-secondary prompt-secondary--border" onClick={startNewQuestion}>Start new question</button>
          </div>}
        </section>}
        {!clarification && !replyIsCurrent && <div className="node-reply__stale" role="status">
          The scene changed. Ask again to use its latest state.
          <button type="button" className="prompt-secondary prompt-secondary--border" disabled={busy} onClick={startNewQuestion}>Start new question</button>
        </div>}
        <div className="prompt-composer" {...attachments.composerProps}>
          <PromptImageAttachments attachments={attachments} disabled={busy || disabled || !!pendingAction} />
          <textarea
            className={`prompt-textarea prompt-textarea--node${hasReply ? ' prompt-textarea--reply' : ''}`}
            aria-label="Node prompt"
            ref={taRef}
            value={prompt}
            disabled={busy || !!pendingAction}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              const isMac = navigator.platform.toUpperCase().includes('MAC')
              if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={hasReply ? 'Reply or describe another change…' : 'Describe how to modify this node…'}
          />
          <div className="prompt-footer">
            <div className="prompt-footer__group">
              <ModelModeSelect value={runMode} onChange={(e) => setRunMode(e.target.value)} disabled={busy} />
              {detailed && <GenerationStrategySelect value={strategy} disabled={busy} onChange={event => setPreferredStrategy(event.target.value)} />}
              <button type="button" className="prompt-secondary" title="Options" disabled={busy}
                aria-expanded={showOptions} aria-controls="node-prompt-settings"
                onClick={() => setShowOptions((v) => !v)}>⚙ Key</button>
            </div>
            <div className="prompt-footer__group">
              <button type="button" className="prompt-secondary" onClick={busy ? generation.cancel : close}>{busy ? "Stop" : "Cancel"}</button>
              {hasReply ? <button type="button" className="prompt-generate" onClick={() => submit()} disabled={!canSubmit} title="Ctrl/Cmd + Enter">
                <span aria-live="polite">{busy ? `${stageLabel(generation.progress?.stage, generation.progress?.attempt)}…` : 'Continue'}</span>
                {busy ? <span className="prompt-spinner" aria-hidden="true" /> : <span aria-hidden="true">↑</span>}
              </button> : <GenerateButton onClick={() => submit()} disabled={!canSubmit} busy={busy} status={`${stageLabel(generation.progress?.stage, generation.progress?.attempt)}…`} title="Ctrl/Cmd + Enter" />}
            </div>
          </div>
        </div>
        {!clarification && <GenerationProgress progress={generation.progress} busy={busy} canResume={canSubmit && generation.canResume} onResume={() => submit(true)} />}
        <div className="prompt-caption">
          <span>Edits apply to this node and its subtree</span>
          <span>Ctrl / ⌘ + Enter to generate · Esc to close</span>
        </div>
        {showOptions && (
          <div className="prompt-key-settings" id="node-prompt-settings">
            <label className="prompt-key-label" htmlFor="node-api-key">API key</label>
            <input id="node-api-key" className="prompt-key-input" type="password" autoComplete="off"
              placeholder={service.localKeyAvailable ? "Local test key configured" : "OpenAI API key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button type="button" className="prompt-secondary prompt-secondary--border" onClick={saveKey}>Save Key</button>
          </div>
        )}
        {displayError && <div className={errorCode === 'CLARIFICATION' ? 'prompt-notice' : 'prompt-error'} role={errorCode === 'CLARIFICATION' ? 'status' : 'alert'}>
          {String(displayError).slice(0, 1200)}
          {!service.ready && <button type="button" className="prompt-secondary" onClick={() => service.reconnect()}>Retry connection</button>}
        </div>}
      </div>
    </div>
  )
}
