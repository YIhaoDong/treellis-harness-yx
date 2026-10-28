// src/components/SaveScene.jsx
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizeSceneFilename, suggestSceneFilename } from '../utils/sceneFilename.mjs'

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
    if (!scene) return
    previousFocusRef.current = document.activeElement
    setName(suggestSceneFilename(scene, filename))
    setError('')
    setOpen(true)
  }
  const handleSave = (event) => {
    event.preventDefault()
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
        className="btn btn--ghost"
        onClick={handleOpen}
        disabled={!scene}
        title={!scene ? 'No scene to save / 当前没有可导出的场景' : 'Save current scene as JSON / 另存为 JSON'}
      >
        💾 Save As
      </button>
      {open && createPortal(
        <div className="ttcs-modal-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close()
        }} onKeyDown={onDialogKeyDown}>
          <form
            ref={dialogRef}
            className="ttcs-modal"
            style={{ width: 'min(440px, 92vw)' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-scene-title"
            onSubmit={handleSave}
          >
            <div className="ttcs-modal__bar">
              <div className="ttcs-modal__title" id="save-scene-title">Save scene as</div>
              <button type="button" className="ttcs-modal__close" onClick={close} aria-label="Close save dialog">×</button>
            </div>
            <div className="ttcs-modal__body" style={{ padding: 20 }}>
              <label htmlFor="save-scene-filename" style={{ display: 'block', color: '#374151', fontSize: 13, marginBottom: 8 }}>File name</label>
              <input
                ref={inputRef}
                id="save-scene-filename"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={name}
                onChange={(event) => { setName(event.target.value); setError('') }}
                aria-invalid={!!error}
                aria-describedby={error ? 'save-scene-error' : 'save-scene-hint'}
                style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '10px 12px', border: `1px solid ${error ? '#dc7777' : '#d9dde4'}`, borderRadius: 9, font: 'inherit' }}
              />
              <div id="save-scene-hint" style={{ color: '#777c86', fontSize: 12, marginTop: 8 }}>.json is added automatically.</div>
              {error && <div id="save-scene-error" role="alert" style={{ color: '#a33636', fontSize: 12, marginTop: 8 }}>{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
                <button type="button" className="btn btn--ghost" onClick={close}>Cancel</button>
                <button type="submit" className="btn" disabled={!scene} style={{ background: '#242831', color: '#fff', borderColor: '#242831' }}>Save</button>
              </div>
            </div>
          </form>
        </div>,
        document.body
      )}
    </>
  )
}
