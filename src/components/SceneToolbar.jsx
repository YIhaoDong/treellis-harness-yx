// components/SceneToolbar.jsx
// The scene's name and save status, Undo/Redo, and opening or downloading a file.
import React from 'react'
import UploadScene from './UploadScene'
import { WorkspaceIcon } from './WorkspaceIcon.jsx'

export { WorkspaceIcon }

const timeOf = (at) => {
  try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

export function saveStatusText(status, savedAt) {
  switch (status) {
    case 'saving': return { label: 'Saving…', title: 'Saving your changes in this browser.' }
    case 'saved': return { label: 'Saved', title: `Saved in this browser${savedAt ? ` at ${timeOf(savedAt)}` : ''}. Use Download to keep a copy as a file.` }
    case 'error': return { label: 'Not saved', title: "This browser can't store the scene (private browsing or full storage). Use Download to keep your work." }
    default: return { label: 'Example', title: 'An example scene. Your changes are saved in this browser automatically.' }
  }
}

export default function SceneToolbar({
  sceneName,
  saveStatus,
  savedAt,
  onUpload,
  saveSlot,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  showSaveStatus = true,
}) {
  const status = saveStatusText(saveStatus, savedAt)
  return (
    <div className="workspace-toolbar" role="group" aria-label="Scene">
      <div className="workspace-scene-file" title={status.title}>
        <WorkspaceIcon name="file" />
        <span className="workspace-filename">{sceneName || 'Untitled scene'}</span>
        {showSaveStatus && (
          <span className={`workspace-scene-state workspace-scene-state--${saveStatus || 'example'}`} aria-live="polite">
            <span className="workspace-state-dot" />
            {status.label}
          </span>
        )}
      </div>

      <div className="workspace-history-actions" role="group" aria-label="Undo and redo">
        <button type="button" className="workspace-button workspace-icon-button" onClick={onUndo} disabled={!canUndo}
          aria-label="Undo" title="Undo (Ctrl/⌘ Z)">
          <WorkspaceIcon name="undo" />
        </button>
        <button type="button" className="workspace-button workspace-icon-button" onClick={onRedo} disabled={!canRedo}
          aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)">
          <WorkspaceIcon name="redo" />
        </button>
      </div>

      <div className="workspace-file-actions">
        <UploadScene onUpload={onUpload} />
        {saveSlot}
      </div>
    </div>
  )
}
