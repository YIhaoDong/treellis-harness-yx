import React, { useEffect, useState } from 'react'
import { STATIC_DEMO } from '../staticDemo/mode.mjs'
import { DEFAULT_RUN_MODE } from '../utils/llmConfig.js'
import { GenerateButton, GenerationStrategySelect, ModelModeSelect } from './PromptControls.jsx'
import GenerationProgressPopover from './GenerationProgressPopover.jsx'
import { stageLabel, supportsStagedGeneration } from '../generation/progressState.mjs'
import useGenerationService from '../hooks/useGenerationService.jsx'
import useGenerationRun from '../hooks/useGenerationRun.jsx'
import usePromptImages from '../hooks/usePromptImages.jsx'
import PromptImageAttachments from './PromptImageAttachments.jsx'
import AccessSheet, { AccessChip } from './AccessSheet.jsx'
import useGenerationAccess from '../hooks/useGenerationAccess.jsx'
import { dismissLinkNotice } from '../account/session.mjs'
import '../prompt.css'

// Shown in the empty composer so a first-time visitor has something to start from.
export const EXAMPLE_PROMPTS = [
  'A toy biplane with two wings, a propeller and wheels',
  'A rocket with four fins standing on a launch pad',
  'A red Japanese torii gate',
]

export default function PromptPanel({ onGenerated, defaultModel = '', currentScene, disabled = false, onBusyChange }) {
  const [prompt, setPrompt] = useState('')
  const [useCurrent, setUseCurrent] = useState(false)
  const [runMode, setRunMode] = useState(DEFAULT_RUN_MODE)
  const [preferredStrategy, setPreferredStrategy] = useState('staged')
  const attachments = usePromptImages({ disabled, isDisabled: () => busy || disabled })
  const detailed = supportsStagedGeneration(runMode)
  const strategy = detailed ? preferredStrategy : 'single'
  const identity = JSON.stringify({ prompt, effort: runMode, strategy, useCurrent, images: attachments.revision })
  const generation = useGenerationRun({ scene: currentScene, identity, onApply: onGenerated,
    onComplete: (_reply, input) => {
      setPrompt(current => current === input.prompt ? '' : current)
      attachments.clearIfCurrent(input.images)
    } })
  const { busy, error, errorCode, setError } = generation
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  const service = useGenerationService()
  const access = useGenerationAccess({ service })
  const { account } = access
  // Generate stays available without a key: pressing it asks the visitor to sign in or add one.
  const canGenerate = service.ready && !!prompt.trim() && !busy && !disabled && !attachments.loading
  const displayError = error || service.error
  const generate = (resume = false) => {
    if (STATIC_DEMO) return
    if (!canGenerate) return
    if (!access.hasAccess) { access.requestAccess(); return }
    const hasContext = !!(useCurrent && currentScene)
    generation.run({ mode: hasContext ? 'edit' : 'create', prompt,
      scene: hasContext ? currentScene : null, effort: access.effort(runMode), strategy, images: attachments.images }, { apiKey: access.apiKey, resume })
  }
  // Free accounts run only some efforts; move off a locked one.
  useEffect(() => { if (access.effort(runMode) !== runMode) setRunMode(access.effort(runMode)) }, [runMode, access.lockedEfforts.join()])
  // Run the generation that waited for sign-in or a key.
  useEffect(() => {
    if (!access.waiting || !access.settled) return
    access.finishWaiting()
    generate()
  }, [access.waiting, access.settled])
  useEffect(() => { if (errorCode) access.handleRunError(errorCode) }, [errorCode])
  const handleKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); generate() }
  }

  return (
    <div className="prompt-dock">
      <div className="prompt-composer" {...attachments.composerProps}>
        <PromptImageAttachments attachments={attachments} disabled={busy || disabled} />
        <textarea
          className="prompt-textarea"
          aria-label="Scene prompt"
          rows={3}
          placeholder={useCurrent && currentScene ? 'Describe what to change in this model…' : 'Describe something to build…'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {!prompt.trim() && !busy && !disabled && !STATIC_DEMO && <div className="prompt-examples" aria-label="Example prompts">
          <span className="prompt-examples__label">Try</span>
          {EXAMPLE_PROMPTS.map(example => <button type="button" key={example} className="prompt-example" onClick={() => setPrompt(example)}>{example}</button>)}
        </div>}
        <div className="prompt-footer">
          <div className="prompt-footer__group">
            {/* New model replaces the scene; Edit this model sends it along as the starting point. */}
            <div className="prompt-target" role="radiogroup" aria-label="What Generate does">
              <button type="button" role="radio" aria-checked={!useCurrent} disabled={busy}
                onClick={() => setUseCurrent(false)} title="Build a new model from your description">New model</button>
              <button type="button" role="radio" aria-checked={!!useCurrent} disabled={busy || !currentScene}
                onClick={() => setUseCurrent(true)} title="Change the model on screen">Edit this model</button>
            </div>
          </div>
          <div className="prompt-footer__group">
            <ModelModeSelect value={runMode} onChange={(e) => setRunMode(e.target.value)} disabled={busy} locked={access.lockedEfforts} />
            {detailed && <GenerationStrategySelect value={strategy} disabled={busy} onChange={event => setPreferredStrategy(event.target.value)} />}
            {!STATIC_DEMO && <AccessChip access={access} controls="global-prompt-access" />}
            {busy && <button type="button" className="prompt-secondary" onClick={generation.cancel}>Stop</button>}
            <GenerateButton onClick={() => generate()} disabled={!canGenerate} busy={busy} status={`${stageLabel(generation.progress?.stage, generation.progress?.attempt)}…`}
              title={!service.ready ? 'Waiting for the generation server' : !prompt.trim() ? 'Describe what you want to build first' : 'Ctrl/Cmd + Enter'} />
          </div>
        </div>
      </div>
      <GenerationProgressPopover progress={generation.progress} busy={busy} canResume={canGenerate && generation.canResume} onResume={() => generate(true)} />
      {!STATIC_DEMO && !service.ready && service.connecting && <div className="prompt-status prompt-status--delayed" role="status">
        <span className="prompt-status__spinner" aria-hidden="true" />
        Waking up the generation server. The first run of the day can take up to a minute.
      </div>}
      {account.linkSignedIn && <div className="prompt-status prompt-status--success" role="status">
        <span>You're signed in{access.remaining ? ` with ${access.remaining} free generation${access.remaining === 1 ? '' : 's'}` : ''}. Describe a model and press Generate.</span>
        <button type="button" className="prompt-close prompt-status__close" aria-label="Dismiss" onClick={dismissLinkNotice}>×</button>
      </div>}
      <AccessSheet access={access} id="global-prompt-access" onGenerate={() => generate()} />
      {displayError ? <div className={errorCode === 'CLARIFICATION' ? 'prompt-notice' : 'prompt-error'} role={errorCode === 'CLARIFICATION' ? 'status' : 'alert'}>
        {displayError}
        {!service.ready && <button type="button" className="prompt-secondary" onClick={() => service.reconnect()}>Retry connection</button>}
        {errorCode !== 'CLARIFICATION' && generation.canResume && <button type="button" className="prompt-secondary prompt-secondary--border"
          disabled={!canGenerate} onClick={() => generate(true)}>Continue remaining</button>}
      </div> : null}
    </div>
  )
}
