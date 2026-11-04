// src/components/RightPanelChrome.jsx
// The Parameters panel frame: a slim header and the scrolling editor below.
// Undo/Redo live in the workspace header, since they affect the whole scene.
import React from 'react'

export default function RightPanelChrome({
  title = 'Parameters',
  onClose,
  hasSelection = false,
  children,
  onExpand,
  ...panelProps
}) {
  return (
    <aside className="split-right-panel" {...panelProps}>
      <div className="panel-bar panel-bar--row">
        <div className="panel-title">{title}</div>
        {onExpand && <button type="button" className="workspace-parameters-expand" onClick={onExpand}
          aria-label="Expand parameters panel" title="Expand parameters panel">↗</button>}
        {hasSelection && (
          <button type="button" className="panel-close" onClick={onClose} title="Close" aria-label="Close parameters">×</button>
        )}
      </div>

      {children}
    </aside>
  )
}
