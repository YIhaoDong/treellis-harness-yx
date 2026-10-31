import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import '../sceneLibraries.css'

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function SceneLibraries({ open, onClose, items = [], onSelect, busy = false }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const controls = [...(dialogRef.current?.querySelectorAll(focusableSelector) || [])]
        .filter(control => control.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first) {
        event.preventDefault()
        dialogRef.current?.focus()
      } else if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocusIn = (event) => {
      if (!dialogRef.current?.contains(event.target)) closeRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn)
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="scene-libraries-overlay" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose?.()
    }}>
      <section
        className="scene-libraries"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="scene-libraries__header">
          <div>
            <h2 id={titleId}>Libraries <span className="scene-libraries__count">{items.length}</span></h2>
            <p id={descriptionId}>Choose a creation to open it in Treellis.</p>
          </div>
          <button ref={closeRef} type="button" className="scene-libraries__close" onClick={onClose} aria-label="Close Libraries">×</button>
        </header>
        <div className="scene-libraries__body" aria-busy={busy}>
          {items.length ? (
            <div className="scene-libraries__grid">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className="scene-libraries__card"
                  disabled={busy}
                  onClick={() => onSelect?.(item)}
                  aria-label={`Open ${item.title}`}
                >
                  <span className="scene-libraries__card-top">
                    <span className="scene-libraries__index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="scene-libraries__arrow" aria-hidden="true">↗</span>
                  </span>
                  {item.thumbnail && <img className="scene-libraries__thumbnail" src={item.thumbnail} alt="" loading="lazy" />}
                  <span className="scene-libraries__title">{item.title}</span>
                </button>
              ))}
            </div>
          ) : <p className="scene-libraries__empty">No creations are available yet.</p>}
        </div>
        <footer className="scene-libraries__footer">
          <span role="status">{busy ? 'Finish the current generation before switching creations.' : 'Click any creation to switch the current scene.'}</span>
          <span className="scene-libraries__escape">Esc to close</span>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
