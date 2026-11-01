import React, { useEffect, useRef, useState } from 'react'
import { ProgressOverlayContext } from './ProgressOverlayContext.jsx'

export default function ResizablePromptPane({ children, compact = false }) {
  const paneRef = useRef(null)
  const separatorRef = useRef(null)
  const dragRef = useRef(null)
  const [height, setHeight] = useState(256)
  const [bounds, setBounds] = useState({ min: 160, max: 600 })
  const [dragging, setDragging] = useState(false)
  const [progressHost, setProgressHost] = useState(null)
  const spaceAbove = bounds.max + 120 - height
  const progressPlacement = spaceAbove >= 220 || spaceAbove >= height ? 'above' : 'below'
  const progressPanelHeight = Math.max(96, (progressPlacement === 'above' ? spaceAbove : height) - 48)

  const getBounds = () => {
    const available = paneRef.current.parentElement.clientHeight - separatorRef.current.offsetHeight
    const max = Math.max(0, available - 120)
    return { min: Math.min(160, max), max }
  }

  const resize = (nextHeight) => {
    const limits = getBounds()
    setHeight(Math.min(limits.max, Math.max(limits.min, nextHeight)))
  }

  useEffect(() => {
    const measure = () => {
      if (compact || paneRef.current.parentElement.clientHeight <= 0) return
      const limits = getBounds()
      setBounds(limits)
      setHeight((value) => Math.min(limits.max, Math.max(limits.min, value)))
    }
    const cancel = () => {
      const pointerId = dragRef.current?.pointerId
      dragRef.current = null
      setDragging(false)
      if (pointerId != null && separatorRef.current?.hasPointerCapture(pointerId)) {
        separatorRef.current.releasePointerCapture(pointerId)
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(paneRef.current.parentElement)
    window.addEventListener('blur', cancel)
    return () => {
      observer.disconnect()
      window.removeEventListener('blur', cancel)
    }
  }, [compact])

  const finishDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <>
      <div className="workspace-prompt-boundary">
      <div
        ref={separatorRef}
        className={`workspace-prompt-resizer${dragging ? ' is-dragging' : ''}`}
        role="separator"
        aria-label="Resize prompt area"
        aria-orientation="horizontal"
        aria-controls="workspace-prompt-area"
        aria-valuemin={Math.round(bounds.min)}
        aria-valuemax={Math.round(bounds.max)}
        aria-valuenow={Math.round(height)}
        tabIndex={0}
        title="Drag to resize prompt area"
        onPointerDown={(event) => {
          if (dragRef.current || event.button !== 0) return
          event.preventDefault()
          dragRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: paneRef.current.getBoundingClientRect().height,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          resize(drag.startHeight + drag.startY - event.clientY)
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 48 : 16
          const next = {
            ArrowUp: height + step,
            ArrowDown: height - step,
            Home: bounds.min,
            End: bounds.max,
          }[event.key]
          if (next == null) return
          event.preventDefault()
          resize(next)
        }}
      />
      <div ref={setProgressHost} className="workspace-prompt-progress-anchor"
        data-placement={progressPlacement}
        style={{ '--progress-panel-max-height': `${progressPanelHeight}px` }} />
      </div>
      <div ref={paneRef} id="workspace-prompt-area" className="workspace-prompt-dock" style={{ height }}>
        <ProgressOverlayContext.Provider value={progressHost}>
          {children}
        </ProgressOverlayContext.Provider>
      </div>
    </>
  )
}
