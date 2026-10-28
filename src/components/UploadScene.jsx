// src/components/UploadScene.jsx
import React, { useRef } from 'react'

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
          alert('Empty file.')
          return
        }
        const json = JSON.parse(text)

        // Support both { scene: {...} } and plain {...}
        const root = json && (json.scene || json)
        if (!root || typeof root !== 'object') {
          alert('Invalid JSON format: expecting an object or { "scene": { ... } }')
          return
        }

        if (typeof onUpload === 'function') {
          onUpload(root)
        }
      } catch (err) {
        console.error('Failed to parse JSON:', err)
        alert('Invalid JSON file. Please check formatting.')
      }
    }
    reader.readAsText(file)
  }

  return (
    <>
      <button
        className="btn btn--ghost"
        onClick={handleClick}
        title="Upload a JSON scene file / 上传本地 JSON 场景到草稿"
      >
        ⬆ Upload
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
