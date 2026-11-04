// src/components/UploadScene.jsx
import React, { useRef } from 'react'
import { notify } from '../ui/dialogs.mjs'
import { WorkspaceIcon } from './WorkspaceIcon.jsx'

/**
 * UploadScene — choose a local JSON file and push it into live draft
 *
 * Props:
 *   - onUpload: (sceneObj) => void  // called with parsed {scene} or root object
 */
export default function UploadScene({ onUpload }) {
  const fileInputRef = useRef(null)

  const handleClick = () => {
    if (fileInputRef.current) {
      // reset value so selecting the same file again still triggers change
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const text = String(evt.target?.result || '')
        if (!text.trim()) {
          notify('That file is empty.', { tone: 'error' })
          return
        }
        const json = JSON.parse(text)

        // Support both { scene: {...} } and plain {...}
        const root = json && (json.scene || json)
        if (!root || typeof root !== 'object') {
          notify("That file isn't a Treellis scene.", { tone: 'error' })
          return
        }

        if (typeof onUpload === 'function') {
          onUpload(root)
        }
      } catch (err) {
        console.error('Failed to parse JSON:', err)
        notify("Couldn't read that file. Choose a scene saved from Treellis (.json).", { tone: 'error' })
      }
    }
    reader.readAsText(file)
  }

  return (
    <>
      <button
        type="button"
        className="workspace-button"
        onClick={handleClick}
        title="Open a scene file (.json) saved from Treellis"
      >
        <WorkspaceIcon name="open" />
        Open
      </button>

      {/* hidden file input */}
      <input
        type="file"
        accept=".json,application/json"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  )
}
