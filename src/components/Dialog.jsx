// src/components/Dialog.jsx
// The one dialog frame used across the app: title + optional subtitle, a scrolling
// body, and an optional footer for actions. Escape and the backdrop close it, focus
// stays inside while it is open and returns to the trigger afterwards.
import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Dialog({
  open,
  title,
  subtitle,
  onClose,
  footer,
  footerNote,
  size = 'md',
  as: Frame = 'section',
  onSubmit,
  initialFocus,
  className = '',
  children,
}) {
  const frameRef = useRef(null)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const titleId = useId()
  const subtitleId = useId()

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    const target = initialFocus?.current || frameRef.current?.querySelector('[autofocus]') || closeRef.current
    target?.focus?.()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const controls = [...(frameRef.current?.querySelectorAll(focusable) || [])].filter(node => node.getClientRects().length)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first) return
      if (event.shiftKey && (document.activeElement === first || !frameRef.current.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !frameRef.current.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    // Only the top-most dialog reacts; the in-page confirm/prompt dialogs sit above.
    const guarded = (event) => {
      if (document.querySelector('.ttcs-modal-overlay--top')) return
      onKeyDown(event)
    }
    document.addEventListener('keydown', guarded, true)
    return () => {
      document.removeEventListener('keydown', guarded, true)
      if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true })
    }
  }, [open, initialFocus])

  if (!open) return null

  return createPortal(
    <div className="ttcs-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <Frame
        ref={frameRef}
        className={`ttcs-modal ttcs-modal--${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        onSubmit={onSubmit}
        tabIndex={-1}
      >
        <header className="ttcs-modal__bar">
          <div className="ttcs-modal__heading">
            <h2 className="ttcs-modal__title" id={titleId}>{title}</h2>
            {subtitle && <p className="ttcs-modal__subtitle" id={subtitleId}>{subtitle}</p>}
          </div>
          <button ref={closeRef} type="button" className="ttcs-modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="ttcs-modal__body">{children}</div>
        {(footer || footerNote) && (
          <footer className="ttcs-modal__footer">
            {footerNote && <span className="ttcs-modal__footer-note">{footerNote}</span>}
            {footer}
          </footer>
        )}
      </Frame>
    </div>,
    document.body,
  )
}
