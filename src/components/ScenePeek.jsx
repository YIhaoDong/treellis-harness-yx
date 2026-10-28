// src/components/ScenePeek.jsx
import React, { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

function safeStringify(obj) {
  try {
    return JSON.stringify(obj ?? {}, (k, v) => (typeof v === 'function' ? undefined : v), 2)
  } catch {
    // 循环引用兜底 / circular ref fallback
    return JSON.stringify({ error: 'Unable to stringify scene' }, null, 2)
  }
}

export default function ScenePeek({ liveScene }) {
  const [open, setOpen] = useState(false)
  const text = useMemo(() => safeStringify(liveScene), [liveScene])

  // 快捷键：Ctrl/Cmd + L / Toggle with Ctrl/Cmd + L
  useEffect(() => {
    const onKey = (e) => {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const copyToClipboard = async () => {
    try { await navigator.clipboard.writeText(text); alert('已复制 JSON / Copied!') }
    catch { alert('复制失败 / Copy failed') }
  }

  const downloadJson = () => {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'liveScene.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {/* 悬浮按钮 / Floating button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 1000,
          padding: '10px 14px', borderRadius: 12,
          border: '1px solid #e5e7eb', background: '#ffffff',
          boxShadow: '0 4px 16px rgba(0,0,0,.12)', cursor: 'pointer',
          fontWeight: 700
        }}
        title="View Live Scene (Ctrl/Cmd + L)"
      >
        Live Scene
      </button>

      {/* Modal */}
      {open && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
            display: 'grid', placeItems: 'center', zIndex: 1001
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(960px, 92vw)', height: 'min(72vh, 88vh)',
              background: '#fff', borderRadius: 16, overflow: 'hidden',
              display: 'grid', gridTemplateRows: '56px 1fr 48px',
              boxShadow: '0 12px 40px rgba(0,0,0,.25)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid #eee' }}>
              <strong>Live Scene JSON</strong>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={copyToClipboard} style={{ padding: '6px 10px' }}>Copy</button>
                <button onClick={downloadJson} style={{ padding: '6px 10px' }}>Download</button>
                <button onClick={() => setOpen(false)} style={{ padding: '6px 10px' }}>Close</button>
              </div>
            </div>

            <pre style={{
              margin: 0, padding: 16, overflow: 'auto',
              background: '#0b1020', color: '#e8e8f0',
              fontSize: 12, lineHeight: 1.45
            }}>{text}</pre>

            <div style={{ padding: '8px 16px', borderTop: '1px solid #eee', color: '#6b7280' }}>
              Tip: Press <kbd>Ctrl/Cmd</kbd> + <kbd>L</kbd> to toggle.
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
