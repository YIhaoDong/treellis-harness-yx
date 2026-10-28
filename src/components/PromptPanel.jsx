import React, { useEffect, useState } from 'react'
import { DEFAULT_RUN_MODE } from '../utils/llmConfig.js'
import { GenerateButton, GenerationStrategySelect, ModelModeSelect } from './PromptControls.jsx'
import GenerationProgressPopover from './GenerationProgressPopover.jsx'
import { stageLabel, supportsStagedGeneration } from '../generation/progressState.mjs'
import useGenerationService from '../hooks/useGenerationService.jsx'
import useGenerationRun from '../hooks/useGenerationRun.jsx'
import '../prompt.css'

export default function PromptPanel({ onGenerated, defaultModel = '', currentScene }) {
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const [useCurrent, setUseCurrent] = useState(true)
  const [runMode, setRunMode] = useState(DEFAULT_RUN_MODE)
  const [preferredStrategy, setPreferredStrategy] = useState('staged')
  const detailed = supportsStagedGeneration(runMode)
  const strategy = detailed ? preferredStrategy : 'single'
  const identity = JSON.stringify({ prompt, effort: runMode, strategy, useCurrent })
  const generation = useGenerationRun({ scene: currentScene, identity, onApply: onGenerated,
    onComplete: (_reply, input) => setPrompt(current => current === input.prompt ? '' : current) })
  const { busy, error, errorCode, setError } = generation
  const service = useGenerationService()
  useEffect(() => {
    try { setApiKey((localStorage.getItem('OPENAI_API_KEY') || '').trim()) } catch {}
  }, [])
  useEffect(() => { if (service.ready) setShowOptions(!apiKey && !service.localKeyAvailable) }, [service.ready, service.localKeyAvailable])
  const canGenerate = service.ready && (!!apiKey.trim() || service.localKeyAvailable) && !!prompt.trim() && !busy
  const displayError = error || service.error
  const saveKey = () => {
    try {
      const key = apiKey.trim()
      if (key) localStorage.setItem('OPENAI_API_KEY', key)
      else localStorage.removeItem('OPENAI_API_KEY')
    } catch { setError('This browser cannot save the key. You can still use it for this session.') }
  }
  const generate = (resume = false) => {
    if (!canGenerate) return
    const hasContext = !!(useCurrent && currentScene)
    generation.run({ mode: hasContext ? 'edit' : 'create', prompt,
      scene: hasContext ? currentScene : null, effort: runMode, strategy }, { apiKey, resume })
  }
  const handleKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); generate() }
  }

  return (
    <div className="prompt-dock">
      <div className="prompt-composer">
        <textarea
          className="prompt-textarea"
          aria-label="Scene prompt"
          rows={3}
          placeholder="Describe what you want to build or change…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="prompt-footer">
          <div className="prompt-footer__group">
            <label className="prompt-context" title="Include current scene as context when generating">
              <input type="checkbox" checked={!!useCurrent} disabled={busy}
                onChange={(e) => setUseCurrent(e.target.checked)} />
              Use current scene
            </label>
          </div>
          <div className="prompt-footer__group">
            <ModelModeSelect value={runMode} onChange={(e) => setRunMode(e.target.value)} disabled={busy} />
            {detailed && <GenerationStrategySelect value={strategy} disabled={busy} onChange={event => setPreferredStrategy(event.target.value)} />}
            <button type="button" className="prompt-secondary" title="Options"
              aria-expanded={showOptions} aria-controls="global-prompt-settings"
              onClick={() => setShowOptions((v) => !v)}>⚙ Key</button>
            {busy && <button type="button" className="prompt-secondary" onClick={generation.cancel}>Stop</button>}
            <GenerateButton onClick={() => generate()} disabled={!canGenerate} busy={busy} status={`${stageLabel(generation.progress?.stage, generation.progress?.attempt)}…`}
              title={!service.ready ? 'Start the generation server' : !apiKey && !service.localKeyAvailable ? 'Missing API key' : !prompt.trim() ? 'Enter a prompt' : 'Ctrl/Cmd + Enter'} />
          </div>
        </div>
      </div>
      <GenerationProgressPopover progress={generation.progress} busy={busy} canResume={canGenerate && generation.canResume} onResume={() => generate(true)} />
      {showOptions && (
        <div className="prompt-key-settings" id="global-prompt-settings">
          <label className="prompt-key-label" htmlFor="global-api-key">API key</label>
          <input id="global-api-key" className="prompt-key-input" type="password"
            autoComplete="off" placeholder={service.localKeyAvailable ? "Local test key configured" : "OpenAI API key"} value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} />
          <button type="button" className="prompt-secondary prompt-secondary--border"
            onClick={saveKey}>Save Key</button>
        </div>
      )}
      {displayError ? <div className={errorCode === 'CLARIFICATION' ? 'prompt-notice' : 'prompt-error'} role={errorCode === 'CLARIFICATION' ? 'status' : 'alert'}>
        {displayError}
        {!service.ready && <button type="button" className="prompt-secondary" onClick={() => service.reconnect()}>Retry connection</button>}
        {errorCode !== 'CLARIFICATION' && generation.canResume && <button type="button" className="prompt-secondary prompt-secondary--border"
          disabled={!canGenerate} onClick={() => generate(true)}>Continue remaining</button>}
      </div> : null}
    </div>
  )
}
