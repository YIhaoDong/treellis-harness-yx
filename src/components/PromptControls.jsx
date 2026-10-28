import React from 'react'
import { MODEL_FAMILY_LABEL, RUN_MODES } from '../utils/llmConfig.js'
import { elapsedLabel, stageLabel, taskProgress } from '../generation/progressState.mjs'

export function ModelModeSelect({ value, onChange, disabled = false }) {
  return (
    <select className="prompt-mode" aria-label="Reasoning effort" title="GPT-6.1 reasoning effort"
      value={value} onChange={onChange} disabled={disabled}>
      {Object.entries(RUN_MODES).map(([id, mode]) => (
        <option key={id} value={id}>{MODEL_FAMILY_LABEL} · {mode.label}</option>
      ))}
    </select>
  )
}

export function GenerateButton({ onClick, disabled, busy, title, status = 'Generating…' }) {
  return (
    <button type="button" className="prompt-generate" onClick={onClick}
      disabled={disabled} title={title}>
      <span aria-live="polite">{busy ? status : 'Generate'}</span>
      {busy ? <span className="prompt-spinner" aria-hidden="true" /> : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

export function GenerationStrategySelect({ value, onChange, disabled }) {
  return <select className="prompt-mode prompt-strategy" aria-label="Generation strategy"
    title="Step by step applies each checked part as it finishes" value={value} onChange={onChange} disabled={disabled}>
    <option value="single">Single pass</option>
    <option value="staged">Step by step</option>
  </select>
}

export function GenerationProgress({ progress, busy, canResume, onResume }) {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy])
  if (!progress) return null
  const elapsed = elapsedLabel((progress.elapsedBefore || 0) + (progress.finishedAt || now) - (progress.startedAt || now))
  const { completed, total, totalKnown, tasks } = taskProgress(progress, { busy })
  const hasTasks = progress.strategy === 'staged' || total > 0 || tasks.length > 0
  const countLabel = totalKnown ? `Completed ${completed}/${total} tasks` : `Completed ${completed} ${completed === 1 ? 'task' : 'tasks'} · Total pending`
  const currentLabel = `${stageLabel(progress.stage, progress.attempt)}${progress.title && busy ? ` · ${progress.title}` : ''}`
  const taskLabels = { completed: 'Completed', active: 'In progress', pending: 'Pending', paused: 'Paused', failed: 'Needs attention' }
  const taskIcons = { completed: '✓', active: '', pending: '○', paused: 'Ⅱ', failed: '!' }
  const terminal = !busy && progress.stage !== 'complete'
  return <section className="generation-progress" aria-label="Generation progress">
    <div className="generation-progress__header">
      <span role="status" className="generation-progress__count">{hasTasks ? countLabel : currentLabel}</span>
      <span className="generation-progress__elapsed" aria-label={`Elapsed ${elapsed}`}>Elapsed {elapsed}</span>
      {hasTasks && <div className="generation-progress__current">{currentLabel}</div>}
    </div>
    {!!tasks.length && <ol className="generation-progress__tasks" aria-label="Generation tasks">
      {tasks.map(item => <li key={item.step} data-status={item.status} aria-current={item.status === 'active' ? 'step' : undefined}>
        <span className={`generation-progress__task-icon${item.status === 'active' ? ' generation-progress__task-icon--active' : ''}`} aria-hidden="true">{taskIcons[item.status]}</span>
        <span className="generation-progress__task-title">{item.title}</span>
        <span className="generation-progress__task-state">{taskLabels[item.status]}</span>
      </li>)}
    </ol>}
    {busy && progress.message && <p className="generation-progress__message">{progress.message}</p>}
    {progress.summary && <p className="generation-progress__summary"><span>Model summary</span> {progress.summary}</p>}
    {progress.outputChars > 0 && busy && <p className="generation-progress__message">Output received · {progress.outputChars.toLocaleString()} characters</p>}
    {terminal && completed > 0 && <div className="generation-progress__saved">Checked results kept.</div>}
    {canResume && <button type="button" className="prompt-secondary prompt-secondary--border generation-progress__resume" onClick={onResume}>Continue remaining</button>}
  </section>
}
