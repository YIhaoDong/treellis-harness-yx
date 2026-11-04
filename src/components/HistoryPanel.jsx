// === HistoryPanel.jsx ===
// The session log: a snapshot of the scene after each change during this visit,
// exported for research. It lives only in memory and is not the same as Undo.
import React, { useMemo, useState } from 'react'
import Dialog from './Dialog.jsx'
import { askConfirm } from '../ui/dialogs.mjs'

const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function HistoryPanel({
  open,
  onClose,
  snapshots = [],
  onDownloadJSON,
  onDownloadJSONL,
  onClear,
}) {
  const [expandedId, setExpandedId] = useState(null)
  const totalBytes = useMemo(() => snapshots.reduce((acc, s) => acc + (s.sizeBytes || 0), 0), [snapshots, open])
  const reversed = useMemo(() => [...snapshots].reverse(), [snapshots, open])
  const empty = reversed.length === 0

  const clear = async () => {
    const ok = await askConfirm({
      title: 'Clear the session log?',
      message: 'This removes every snapshot recorded during this visit. Your scene is not changed.',
      confirmLabel: 'Clear log',
      danger: true,
    })
    if (ok) onClear?.()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Session log"
      subtitle={`Snapshots of the scene after each change during this visit, for research exports. ${snapshots.length} snapshots · ${fmtBytes(totalBytes)}`}
      footer={<>
        <button type="button" className="ui-btn ui-btn--danger-quiet" onClick={clear} disabled={empty}>Clear log</button>
        <button type="button" className="ui-btn" onClick={onDownloadJSONL} disabled={empty} title="One snapshot per line">Download .jsonl</button>
        <button type="button" className="ui-btn ui-btn--primary" onClick={onDownloadJSON} disabled={empty}>Download .json</button>
      </>}
    >
      {empty ? (
        <div className="ui-empty">
          <div className="ui-empty__title">No snapshots yet</div>
          <p>A snapshot is added each time the scene changes: an edit, a generation or a loaded example.</p>
        </div>
      ) : (
        <div className="ttcs-history-list">
          {reversed.map((s, idx) => {
            const expanded = expandedId === s.id
            return (
              <div key={s.id || idx} className="ttcs-history-row">
                <div className="ttcs-history-row__head">
                  <div style={{ minWidth: 0 }}>
                    <div className="ttcs-history-row__tag">{s.tag || 'edit'}</div>
                    <div className="ttcs-history-row__meta" title={s.iso}>
                      {new Date(s.ts || Date.now()).toLocaleString()} · {fmtBytes(s.sizeBytes)}
                    </div>
                  </div>
                  <button type="button" className="ui-btn ui-btn--sm" onClick={() => setExpandedId(expanded ? null : s.id)} aria-expanded={expanded}>
                    {expanded ? 'Hide JSON' : 'View JSON'}
                  </button>
                </div>
                {expanded && (
                  <pre>{JSON.stringify({ id: s.id, ts: s.ts, iso: s.iso, tag: s.tag, sizeBytes: s.sizeBytes, meta: s.meta || null, scene: s.scene }, null, 2)}</pre>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}
