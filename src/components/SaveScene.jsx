// src/components/SaveScene.jsx
import React, { useEffect, useRef, useState } from 'react'
import { STATIC_DEMO } from '../staticDemo/mode.mjs'
import { createPortal } from 'react-dom'
import { normalizeSceneFilename, suggestSceneFilename } from '../utils/sceneFilename.mjs'
import { WorkspaceIcon } from './WorkspaceIcon.jsx'

/**
 * SaveScene — name and download the current scene as JSON
 *
 * Props:
 *   - scene: object | null
 *   - filename?: string (optional)  e.g. "scene.json"
 *   - wrap?: boolean (default: true) — if true, export as { scene: ... }
 */
export default function SaveScene({ scene, filename, wrap = true }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const triggerRef = useRef(null)
  const previousFocusRef = useRef(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => {
      const previous = previousFocusRef.current
      if (previous?.isConnected) previous.focus()
      else triggerRef.current?.focus()
    }
  }, [open])

  const close = () => setOpen(false)
  const handleOpen = () => {
    if (STATIC_DEMO) return
    if (!scene) return
    previousFocusRef.current = document.activeElement
    setName(suggestSceneFilename(scene, filename))
    setError('')
    setOpen(true)
  }
  const handleSave = (event) => {
    event.preventDefault()
    if (STATIC_DEMO) return
    if (!scene) return
    const result = normalizeSceneFilename(name)
    if (result.error) {
      setError(result.error)
      inputRef.current?.focus()
      return
    }
    try {
      const text = JSON.stringify(wrap ? { scene } : scene, null, 2)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = result.filename
        document.body.appendChild(anchor)
        try { anchor.click() } finally { anchor.remove() }
      } finally {
        // Allow the browser to start reading the download before releasing it.
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      close()
    } catch {
      setError('Unable to save this scene. Please try again.')
    }
  }
  const onDialogKeyDown = (event) => {
    // Keep workspace shortcuts from running while the filename dialog is open.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      const controls = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || [])
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-button"
        onClick={handleOpen}
        disabled={!scene}
        title={!scene ? 'No scene to download yet' : 'Download this scene as a file (.json) you can open later'}
      >
        <WorkspaceIcon name="download" />
        Download
      </button>
      {open && createPortal(
        <div className="ttcs-modal-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close()
        }} onKeyDown={onDialogKeyDown}>
          <form
            ref={dialogRef}
            className="ttcs-modal ttcs-modal--sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-scene-title"
            onSubmit={handleSave}
          >
            <div className="ttcs-modal__bar">
              <div className="ttcs-modal__heading">
                <h2 className="ttcs-modal__title" id="save-scene-title">Download scene</h2>
                <p className="ttcs-modal__subtitle">Saves a .json file you can open in Treellis later.</p>
              </div>
              <button type="button" className="ttcs-modal__close" onClick={close} aria-label="Close save dialog">×</button>
            </div>
            <div className="ttcs-modal__body">
              <label htmlFor="save-scene-filename" className="ui-field__label">File name</label>
              <input
                ref={inputRef}
                id="save-scene-filename"
                className="ui-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={name}
                onChange={(event) => { setName(event.target.value); setError('') }}
                aria-invalid={!!error}
                aria-describedby={error ? 'save-scene-error' : 'save-scene-hint'}
                style={{ marginTop: 6, borderColor: error ? '#dc7777' : undefined }}
              />
              {error
                ? <div id="save-scene-error" role="alert" className="ui-error">{error}</div>
                : <div id="save-scene-hint" className="ui-hint">.json is added automatically.</div>}
            </div>
            <div className="ttcs-modal__footer">
              <button type="button" className="ui-btn" onClick={close}>Cancel</button>
              <button type="submit" className="ui-btn ui-btn--primary" disabled={!scene}>Download</button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </>
  )
}
