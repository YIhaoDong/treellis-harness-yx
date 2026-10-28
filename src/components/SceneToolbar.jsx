// components/SceneToolbar.jsx
import React from 'react'
import UploadScene from './UploadScene'

export function WorkspaceIcon({ name }) {
  const paths = {
    file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
    reload: <><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    legend: <><rect x="3" y="13" width="8" height="8" rx="1.5" /><circle cx="17" cy="17" r="4" /><path d="M12 3l4.5 7.5h-9z" /></>,
    library: <><path d="M12 3 2 8l10 5 10-5z" /><path d="m2 13 10 5 10-5m-20 5 10 5 10-5" /></>,
    code: <><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1" /><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" /></>,
  }
  return (
    <svg className="workspace-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.file}
    </svg>
  )
}

export default function SceneToolbar({
  onRefresh,
  onUpload,
  saveSlot,
  onOpenHistory,
  isDraft,
}) {
  return (
    <div className="workspace-toolbar" role="group" aria-label="Scene file tools">
      <div className="workspace-scene-file">
        <WorkspaceIcon name="file" />
        <span className="workspace-filename">scene.json</span>
        <span
          className={`workspace-scene-state${isDraft ? ' workspace-scene-state--draft' : ''}`}
          title={isDraft ? 'Viewing draft (blob URL).' : 'Viewing saved /scene.json.'}
        >
          <span className="workspace-state-dot" />
          {isDraft ? 'Draft' : 'Saved'}
        </span>
        <button className="workspace-button workspace-reload" onClick={onRefresh} aria-label="Reload scene" title="Reload saved scene.json">
          <WorkspaceIcon name="reload" />
        </button>
      </div>

      <div className="workspace-file-actions">
        <UploadScene onUpload={onUpload} />

        {saveSlot}

        <button className="workspace-button" onClick={onOpenHistory} title="Open History snapshots">
          <WorkspaceIcon name="history" />
          History
        </button>
      </div>
    </div>
  )
}
