// src/components/InstanceLibrary.jsx
import React, { useEffect, useMemo, useState } from 'react'

/**
 * InstanceLibrary (copy-based)
 *
 * Props:
 * - items: Array<{ id, name, createdAt?, sourcePath?, subtree }>
 * - onPick: (id) => void
 * - onRemove?: (id) => void
 * - onRename?: (id, nextName) => void
 * - style?: React.CSSProperties  (positioning override)
 */
export default function InstanceLibrary({
  items = [],
  onPick,
  onRemove,
  onRename,
  style,
}) {
  const STORAGE_KEY = 'ttcs.library.open'
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0') } catch {}
  }, [open])

  const ordered = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : []
    arr.sort((a, b) => (Number(b?.createdAt || 0) - Number(a?.createdAt || 0)))
    return arr
  }, [items])

  const toggle = () => setOpen(v => !v)

  const baseWrapStyle = {
    position: 'absolute',
    left: 10,
    top: 56,
    zIndex: 30,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    ...style,
  }

  const panelStyle = {
    width: 300,
    maxWidth: 'min(86vw, 340px)',
    maxHeight: 'min(60vh, 520px)',
    overflow: 'auto',
    background: '#ffffff',
    borderRadius: 14,
    border: '1px solid #e5e7eb',
    boxShadow: '0 10px 28px rgba(0,0,0,0.14)',
    padding: 10,
  }

  const rowStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    alignItems: 'center',
    padding: '8px 8px',
    borderRadius: 10,
    border: '1px solid #f1f5f9',
    background: '#fff',
  }

  const smallBtn = (variant = 'ghost') => {
    const base = {
      padding: '6px 8px',
      borderRadius: 9,
      border: '1px solid #e5e7eb',
      background: '#fff',
      cursor: 'pointer',
      fontWeight: 800,
      lineHeight: 1,
    }
    if (variant === 'danger') return { ...base, borderColor: '#fecaca', background: '#fff1f2' }
    if (variant === 'dark') return { ...base, background: '#111827', color: '#fff', borderColor: '#111827' }
    return base
  }

  const handlePick = (id) => {
    if (typeof onPick === 'function') onPick(id)
  }

  const handleRename = (id, currentName) => {
    if (typeof onRename !== 'function') return
    const next = window.prompt('Rename instance / 重命名实例', String(currentName || 'Instance'))
    if (next == null) return
    const nm = String(next).trim()
    if (!nm) return
    onRename(id, nm)
  }

  const handleRemove = (id) => {
    if (typeof onRemove !== 'function') return
    const ok = window.confirm('Remove this instance from Library?\n是否从 Library 删除该实例？')
    if (!ok) return
    onRemove(id)
  }

  return (
    <div
      style={baseWrapStyle}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ✅ Toggle button: uses SAME class as Legend, so it will match LiveScene once CSS is unified */}
      <button
        onClick={toggle}
        className="ttcs-legend__toggle"
        aria-expanded={open}
        title="Instance Library / 实例库"
        style={{
          // open 时反色（你现在的交互习惯）
          background: open ? '#111827' : undefined,
          color: open ? '#ffffff' : undefined,
          borderColor: open ? '#111827' : undefined,
        }}
      >
        <span aria-hidden style={{ fontSize: 14 }}>{open ? '✕' : '📚'}</span>
        <span>Library</span>
        <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 800, opacity: 0.85 }}>
          ({ordered.length})
        </span>
      </button>

      {open && (
        <div style={panelStyle} role="region" aria-label="Instance Library">
          <div style={{ fontSize: 13, fontWeight: 900, color: '#111827', padding: '2px 4px 10px 4px' }}>
            Instance Library
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginLeft: 8 }}>
              Click to copy to clipboard / 点击复制到剪贴板
            </span>
          </div>

          {ordered.length === 0 ? (
            <div style={{ color: '#94a3b8', padding: 10, fontSize: 13 }}>
              No instances yet. Use “Instantiate / 实例化” on a node to add one.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {ordered.map((it) => (
                <div key={it.id} style={rowStyle}>
                  <button
                    onClick={() => handlePick(it.id)}
                    style={{
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: 0,
                      minWidth: 0,
                    }}
                    title="Copy to clipboard / 复制到剪贴板"
                  >
                    <div style={{ fontWeight: 900, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.name || 'Instance'}
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      id: {String(it.id).slice(0, 14)}{String(it.id).length > 14 ? '…' : ''}
                      {it.sourcePath ? ` • from ${it.sourcePath}` : ''}
                    </div>
                  </button>

                  <div style={{ display: 'flex', gap: 6 }}>
                    {typeof onRename === 'function' && (
                      <button
                        style={smallBtn('ghost')}
                        onClick={() => handleRename(it.id, it.name)}
                        title="Rename / 重命名"
                        aria-label="Rename"
                      >
                        ✎
                      </button>
                    )}
                    {typeof onRemove === 'function' && (
                      <button
                        style={smallBtn('danger')}
                        onClick={() => handleRemove(it.id)}
                        title="Delete / 删除"
                        aria-label="Delete"
                      >
                        ✕
                      </button>
                    )}
                    <button
                      style={smallBtn('dark')}
                      onClick={() => handlePick(it.id)}
                      title="Copy / 复制"
                      aria-label="Copy"
                    >
                      🗐
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ padding: 8, color: '#94a3b8', fontSize: 12 }}>
            Tip: After copying, paste via the node “📥 Paste” button.
          </div>
        </div>
      )}
    </div>
  )
}