// src/components/WorkspaceMoreMenu.jsx
// Less frequent tools live behind "More" so the header keeps to everyday actions.
// On phones the same items are shown as a plain list inside the Tools sheet.
import React, { useEffect, useRef, useState } from 'react'
import { WorkspaceIcon } from './WorkspaceIcon.jsx'

export default function WorkspaceMoreMenu({ items = [], inline = false }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const entries = [...(rootRef.current?.querySelectorAll('[role="menuitem"]') || [])]
        if (!entries.length) return
        event.preventDefault()
        const index = entries.indexOf(document.activeElement)
        const next = event.key === 'ArrowDown' ? (index + 1) % entries.length : (index - 1 + entries.length) % entries.length
        entries[next].focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    rootRef.current?.querySelector('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const choose = (item) => { setOpen(false); item.onSelect?.() }

  if (inline) {
    return (
      <div className="workspace-more-inline" role="group" aria-label="More tools">
        {items.filter(item => item.type !== 'divider').map(item => (
          <button key={item.key} type="button" className={`workspace-button${item.danger ? ' workspace-button--danger' : ''}`}
            onClick={() => choose(item)}>
            <WorkspaceIcon name={item.icon} />{item.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="workspace-more" ref={rootRef}>
      <button ref={buttonRef} type="button" className="workspace-button" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(value => !value)}>
        <WorkspaceIcon name="more" />More
      </button>
      {open && (
        <div className="ui-menu workspace-more__menu" role="menu" aria-label="More tools">
          {items.map(item => item.type === 'divider'
            ? <div key={item.key} className="ui-menu__divider" role="separator" />
            : (
              <button key={item.key} type="button" role="menuitem"
                className={`ui-menu__item${item.danger ? ' ui-menu__item--danger' : ''}`} onClick={() => choose(item)}>
                <WorkspaceIcon name={item.icon} />
                <span>{item.label}{item.hint && <small>{item.hint}</small>}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
