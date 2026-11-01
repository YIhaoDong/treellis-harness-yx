import React, { useState } from 'react'
import '../structurePanel.css'

function StructureIcon({ name }) {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'select' ? <><rect x="2.5" y="2.5" width="6" height="6" rx="1.2" /><rect x="11.5" y="11.5" width="6" height="6" rx="1.2" /><path d="M12 3h5v5M3 12v5h5" /></> :
        name === 'group' ? <><rect x="2" y="2" width="16" height="16" rx="2.5" strokeDasharray="2 2" /><rect x="5" y="6" width="4" height="8" rx=".7" /><rect x="11" y="6" width="4" height="8" rx=".7" /></> :
          name === 'ungroup' ? <><rect x="2" y="5" width="6" height="10" rx="1.5" /><rect x="12" y="5" width="6" height="10" rx="1.5" /><path d="M9 3h2M9 17h2" /></> :
            <><path d="m10 2 1.8 5.5L17 9l-5.2 1.7L10 16l-1.8-5.3L3 9l5.2-1.5L10 2Z" /><path d="m16 13 .8 2.2L19 16l-2.2.8L16 19l-.8-2.2L13 16l2.2-.8L16 13Z" /></>}
    </svg>
  )
}

export default function SceneStructurePanel({
  view = 'tree', onViewChange, multiSelect = false, onMultiSelectChange,
  selectedPaths = [], onGroup, onUngroup, canGroup = false, canUngroup = false,
  groupingBusy = false, onSmartGroup, canSmartGroup = false, smartStatus, error,
  onClearSelection, onCancelSmartGroup, onExpand, compact = false, children,
}) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const count = new Set(selectedPaths).size
  const status = typeof smartStatus === 'string' ? smartStatus : smartStatus?.message || smartStatus?.label || ''
  return (
    <section className="scene-structure-panel" aria-label="Scene structure" data-actions-open={actionsOpen}>
      <div className="scene-structure-toolbar">
        <div className="scene-structure-toolbar__main">
          <div className="scene-structure-views" role="group" aria-label="Structure view">
            <button type="button" aria-pressed={view === 'tree'} onClick={() => onViewChange?.('tree')}>Tree</button>
            <button type="button" aria-pressed={view === 'layers'} onClick={() => onViewChange?.('layers')}>Layers</button>
          </div>
          {onExpand && <button type="button" className="scene-structure-expand" onClick={onExpand}
            aria-label="Expand structure panel" title="Expand structure panel">↗</button>}
          {compact && <button type="button" className="scene-structure-more" aria-label="Structure actions"
            aria-expanded={actionsOpen} aria-controls="scene-structure-extra-tools"
            onClick={() => setActionsOpen(open => !open)}>Actions ···</button>}
          <button type="button" className="scene-structure-button scene-structure-multi" aria-pressed={multiSelect}
            title="Toggle multi-select. Hold Shift and click to add or remove a selection."
            onClick={() => onMultiSelectChange?.(!multiSelect)}>
            <StructureIcon name="select" /><span>Multi-select</span>
          </button>
          <span className="scene-structure-shift" title="Hold Shift and click to add or remove a selection">Shift + click</span>
        </div>
        <div id="scene-structure-extra-tools" className="scene-structure-toolbar__actions">
          <span className="scene-structure-count" aria-live="polite">{count ? `${count} selected` : 'No selection'}</span>
          {count > 0 && onClearSelection && <button type="button" className="scene-structure-button scene-structure-clear" onClick={onClearSelection} title="Clear selection" aria-label="Clear selection">×</button>}
          <div className="scene-structure-edit-actions" role="group" aria-label="Group selected parts">
            <button type="button" className="scene-structure-button" disabled={!canGroup || groupingBusy} onClick={onGroup} title="Group selected parts"><StructureIcon name="group" /><span>Group</span></button>
            <button type="button" className="scene-structure-button" disabled={!canUngroup || groupingBusy} onClick={onUngroup} title="Ungroup selected group"><StructureIcon name="ungroup" /><span>Ungroup</span></button>
          </div>
          <button type="button" className="scene-structure-button scene-structure-smart" disabled={!canSmartGroup || groupingBusy} onClick={onSmartGroup}>
            <StructureIcon name="smart" /><span>{groupingBusy ? 'Organizing…' : 'Smart group'}</span>
          </button>
          {groupingBusy && onCancelSmartGroup && <button type="button" className="scene-structure-button" onClick={onCancelSmartGroup}>Stop</button>}
        </div>
        {status && <div className="scene-structure-status" role="status">{status}</div>}
        {error && <div className="scene-structure-error" role="alert">{String(error?.message || error)}</div>}
      </div>
      <div className="scene-structure-content">{children}</div>
    </section>
  )
}
