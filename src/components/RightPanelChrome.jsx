// src/components/RightPanelChrome.jsx
import React from 'react'

export default function RightPanelChrome({
  title = 'Parameters',
  onClose,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  children,
}) {
  return (
    <aside className="split-right-panel">
      <div className="panel-bar">
        <div className="btn-row">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl/Cmd+Z)"
            className="btn btn--dark btn--grow"
          >↶ Undo</button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y or Ctrl/Cmd+Shift+Z)"
            className="btn btn--blue btn--grow"
          >↷ Redo</button>
        </div>
        <div className="hint">Undo: Ctrl/Cmd+Z; Redo: Ctrl+Y or Shift+Ctrl/Cmd+Z</div>
      </div>

      <div className="panel-bar panel-bar--row">
        <div className="panel-title">{title}</div>
        <button
          className="btn btn--sm btn--ghost"
          onClick={onClose}
          title="Close"
        >✕</button>
      </div>

      {/* 面板主体内容 */}
      {children}
    </aside>
  )
}
