// === HistoryPanel.jsx ===
import React, { useMemo, useState } from 'react'

export default function HistoryPanel({
  open,
  onClose,
  snapshots = [],
  onDownloadJSON,
  onDownloadJSONL,
  onClear,
}) {
  if (!open) return null

  const [expandedId, setExpandedId] = useState(null)

  const totalBytes = useMemo(
    () => snapshots.reduce((acc, s) => acc + (s.sizeBytes || 0), 0),
    [snapshots]
  )

  const fmtBytes = (n) => {
    if (!Number.isFinite(n)) return '-'
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }

  const reversed = useMemo(() => [...snapshots].reverse(), [snapshots])

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 880,
          maxWidth: '96vw',
          maxHeight: '90vh',
          overflow: 'hidden',
          background: '#fff',
          borderRadius: 16,
          border: '1px solid #e5e7eb',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: 14,
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>History Snapshots</div>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
              {snapshots.length} snapshots • {fmtBytes(totalBytes)} total
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onDownloadJSON}
              style={btnStyle()}
              title="Download all as a single JSON file"
            >
              Download .json
            </button>
            <button
              onClick={onDownloadJSONL}
              style={btnStyle()}
              title="Download as JSON Lines (one snapshot per line)"
            >
              Download .jsonl
            </button>
            <button
              onClick={onClear}
              style={btnStyle('danger')}
              title="Clear snapshots of this session (memory only)"
            >
              Clear
            </button>
            <button
              onClick={onClose}
              style={btnIcon()}
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ padding: 12, overflow: 'auto' }}>
          {reversed.length === 0 ? (
            <div style={{ color: '#94a3b8' }}>No snapshots yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {reversed.map((s, idx) => {
                const open = expandedId === s.id
                return (
                  <div
                    key={s.id || idx}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 12,
                      background: '#fff',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        alignItems: 'center',
                        padding: '10px 12px',
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>
                          {s.tag || 'edit'}{' '}
                          <span
                            style={{
                              fontWeight: 400,
                              color: '#64748b',
                              fontSize: 12,
                              marginLeft: 8,
                            }}
                          >
                            {new Date(s.ts || Date.now()).toLocaleString()}
                          </span>
                        </div>
                        <div
                          style={{
                            color: '#94a3b8',
                            fontSize: 12,
                            marginTop: 2,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={s.iso}
                        >
                          id: {s.id} • size: {fmtBytes(s.sizeBytes)} • iso:{' '}
                          {s.iso}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() =>
                            setExpandedId(open ? null : s.id)
                          }
                          style={btnStyle(open ? 'secondary' : 'primary')}
                          title={open ? 'Hide JSON' : 'Show JSON'}
                        >
                          {open ? 'Hide JSON' : 'View JSON'}
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div
                        style={{
                          borderTop: '1px solid #f1f5f9',
                          padding: 12,
                          background: '#fafafa',
                        }}
                      >
                        <pre
                          style={{
                            margin: 0,
                            maxHeight: 360,
                            overflow: 'auto',
                            fontSize: 12,
                            lineHeight: 1.4,
                            whiteSpace: 'pre',
                          }}
                        >
{JSON.stringify(
  {
    id: s.id,
    ts: s.ts,
    iso: s.iso,
    tag: s.tag,
    sizeBytes: s.sizeBytes,
    meta: s.meta || null,
    scene: s.scene, // full snapshot
  },
  null,
  2
)}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function btnStyle(variant = 'primary') {
  const base = {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    cursor: 'pointer',
    fontWeight: 700,
    background: '#fff',
    color: '#111827',
  }
  if (variant === 'primary') {
    return { ...base, background: '#111827', color: '#fff', borderColor: '#1f2937' }
  }
  if (variant === 'secondary') {
    return { ...base, background: '#2563eb', color: '#fff', borderColor: '#1d4ed8' }
  }
  if (variant === 'danger') {
    return { ...base, background: '#ef4444', color: '#fff', borderColor: '#dc2626' }
  }
  return base
}

function btnIcon() {
  return {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    background: '#fff',
    cursor: 'pointer',
    fontWeight: 800,
  }
}
