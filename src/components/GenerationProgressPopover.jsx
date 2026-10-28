import React, { useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ProgressOverlayContext } from './ProgressOverlayContext.jsx'
import { GenerationProgress } from './PromptControls.jsx'
import { elapsedLabel, stageLabel, taskProgress } from '../generation/progressState.mjs'

export function GenerationProgressDisclosure({ progress, busy = false, canResume = false, onResume }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [now, setNow] = useState(Date.now())
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const restoringFocusRef = useRef(false)
  const panelId = `generation-details-${useId()}`
  const open = !!progress && (pinned || (!dismissed && (hovered || focused)))

  useEffect(() => {
    if (!progress || !busy) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy, progress?.startedAt])

  useEffect(() => {
    if (progress) return
    setHovered(false)
    setFocused(false)
    setPinned(false)
    setDismissed(false)
  }, [!!progress])

  const close = (restoreFocus = false) => {
    setPinned(false)
    setDismissed(true)
    if (restoreFocus) {
      restoringFocusRef.current = true
      triggerRef.current?.focus()
      restoringFocusRef.current = false
    }
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) close()
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      // Keep Escape local when a node prompt dialog is open underneath.
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  if (!progress) return null
  const { completed, total, totalKnown } = taskProgress(progress, { busy })
  const stage = stageLabel(progress.stage, progress.attempt)
  const label = totalKnown ? `${completed}/${total} tasks` : completed > 0 ? `${completed} completed` : stage
  const elapsed = elapsedLabel((progress.elapsedBefore || 0) + (progress.finishedAt ?? now) - (progress.startedAt ?? now))
  const state = busy ? 'busy' : progress.stage === 'complete' ? 'complete' : progress.stage === 'failed' ? 'failed' : 'stopped'

  return <div className="generation-progress-popover" ref={rootRef} data-open={open || undefined}
    onMouseEnter={() => { setHovered(true); setDismissed(false) }}
    onMouseLeave={() => setHovered(false)}
    onFocusCapture={(event) => {
      setFocused(true)
      if (!restoringFocusRef.current && !event.currentTarget.contains(event.relatedTarget)) setDismissed(false)
    }}
    onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
    }}>
    <button type="button" ref={triggerRef} className="generation-progress-popover__trigger"
      aria-label={`Generation status: ${label}, elapsed ${elapsed}, ${stage}`}
      aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog"
      onClick={() => {
        if (pinned) close()
        else { setPinned(true); setDismissed(false) }
      }}>
      <span className="generation-progress-popover__dot" data-state={state} aria-hidden="true" />
      <span className="generation-progress-popover__count">{label}</span>
      <span className="generation-progress-popover__time">{elapsed}</span>
      <svg className="generation-progress-popover__chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="m4 10 4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {open && <div className="generation-progress-popover__panel-wrap">
      <div id={panelId} className="generation-progress-popover__panel" role="dialog" aria-label="Generation details">
        <div className="generation-progress-popover__heading">
          <span>Generation details</span>
          <button type="button" className="generation-progress-popover__close" aria-label="Close generation details" onClick={() => close(true)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <GenerationProgress progress={progress} busy={busy} canResume={canResume} onResume={onResume} />
      </div>
    </div>}
  </div>
}

export default function GenerationProgressPopover(props) {
  const target = useContext(ProgressOverlayContext)
  return target && props.progress ? createPortal(<GenerationProgressDisclosure {...props} />, target) : null
}
