// src/App.jsx
import React, { useState, useCallback, useEffect } from 'react'
import ThreeSceneFromJSON from './components/ThreeSceneFromJSON'
import StructureTree from './components/StructureTree'
import PromptPanel from './components/PromptPanel'
import ResizablePromptPane from './components/ResizablePromptPane'
import HistoryPanel from './components/HistoryPanel'
import NodePromptModal from './components/NodePromptModal'
import SaveScene from './components/SaveScene'
import AddNodePicker from './components/AddNodePicker'
import ParameterPanel from './components/ParameterPanel.jsx'
import SceneToolbar, { WorkspaceIcon } from './components/SceneToolbar'
import RightPanelChrome from './components/RightPanelChrome'
import './styles.css'
import './workspace.css'

// hooks
import { useTranslateRanges, useParamMaxOverrides, useRepeatRanges } from './hooks/useParamRanges'
import useSplitter from './hooks/useSplitter'
import usePanelSpecs from './hooks/usePanelSpecs'
import useEditHistory from './hooks/useEditHistory'
import useSceneSource from './hooks/useSceneSource'
import useAddPicker from './hooks/useAddPicker'
import useNodeEditing from './hooks/useNodeEditing.jsx'
import useSceneSelection from './hooks/useSceneSelection'
import useParamEditing from './hooks/useParamEditing'
import useNodeDeletion from './hooks/useNodeDeletion'
import useNodePrompt from './hooks/useNodePrompt'
import useHistoryPanel from './hooks/useHistoryPanel'
import usePanelTitleSync from './hooks/usePanelTitleSync'

// ✅ App-level clipboard (single source of truth)
import useClipboard from './hooks/useClipboard'

// ✅ Instance Library hook
import useInstanceLibrary from './hooks/useInstanceLibrary'

const POLL_INTERVAL_MS = 1500

// ===== App-level centered modal (shared) =====
function TTCSModal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="ttcs-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="ttcs-modal">
        <div className="ttcs-modal__bar">
          <div className="ttcs-modal__title">{title}</div>
          <button className="ttcs-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ttcs-modal__body">{children}</div>
      </div>
    </div>
  )
}

function safeJSONStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return '<< Failed to stringify liveScene >>'
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** ===== Legend icon chips (self-contained SVG; no external assets) ===== */
function LegendChip({ type }) {
  const common = { width: 30, height: 30, viewBox: '0 0 30 30' }

  if (type === 'linear') {
    return (
      <svg {...common} aria-hidden="true">
        <line x1="6" y1="15" x2="24" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        {[8, 13, 18, 23].map((x) => <circle key={x} cx={x} cy="15" r="2" fill="currentColor" />)}
      </svg>
    )
  }
  if (type === 'circular') {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="15" cy="15" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        {[0, 90, 180, 270].map((deg) => {
          const rad = (deg * Math.PI) / 180
          const cx = 15 + 9 * Math.cos(rad)
          const cy = 15 + 9 * Math.sin(rad)
          return <circle key={deg} cx={cx} cy={cy} r="2" fill="currentColor" />
        })}
      </svg>
    )
  }
  if (type === 'union') {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="13" cy="15" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="18" cy="15" r="7" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.9" />
      </svg>
    )
  }
  if (type === 'subtract') {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="14" cy="15" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="17" y="10" width="8" height="10" fill="#fff" />
        <circle cx="20" cy="15" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }
  if (type === 'intersect') {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="13" cy="15" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="18" cy="15" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M15 8
             C17.8 9.5 19.5 12 19.5 15
             C19.5 18 17.8 20.5 15 22
             C12.2 20.5 10.5 18 10.5 15
             C10.5 12 12.2 9.5 15 8Z"
          fill="currentColor"
          opacity="0.25"
        />
      </svg>
    )
  }
  if (type === 'cube') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="8" y="8" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }
  if (type === 'sphere') {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="15" cy="15" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }
  if (type === 'cylinder') {
    return (
      <svg {...common} aria-hidden="true">
        <ellipse cx="15" cy="10" rx="7" ry="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M8 10v10c0 2 3 3.5 7 3.5s7-1.5 7-3.5V10" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }
  if (type === 'torus') {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="15" cy="15" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="15" cy="15" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }
  if (type === 'cone') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M15 7 L23 23 H7 Z" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }

  return null
}

export default function App() {
  const { leftPct, setLeftPct, containerRef, startDrag } = useSplitter(40, 20, 70)
  const [reloadKey, setReloadKey] = useState(0)
  const [liveScene, setLiveScene] = useState(null)

  // ✅ Top-left aligned buttons -> centered modals
  const [topModal, setTopModal] = useState(null) // 'legend' | 'library' | 'live' | null
  const toggleTopModal = useCallback((key) => {
    setTopModal((prev) => (prev === key ? null : key))
  }, [])

  const clipboard = useClipboard()

  // ✅ Instance Library (copy-based)
  const {
    items: libraryItems,
    addFromPath: addInstanceFromPath,
    getItem: getLibraryItem,
    remove: removeLibraryItem,
    rename: renameLibraryItem,
  } = useInstanceLibrary()

  const {
    beginEdit,
    endEdit,
    undo,
    redo,
    resetHistory,
    canUndo,
    canRedo,
    editingRef,
    editDirtyRef,
    editTagRef,
    pushSnapshot,
    snapshotsRef,
    downloadSnapshotsAsJSON,
    downloadSnapshotsAsJSONL,
    clearSnapshots,
    recordGeneration,
  } = useEditHistory({ liveScene, setLiveScene })

  const {
    sceneUrl,
    isDraft,
    reloadKey: srcReloadKey,
    enterDraftFromRoot,
    refresh,
    acceptTreeChangeRef,
  } = useSceneSource({
    setLiveScene,
    editingRef,
    pollIntervalMs: POLL_INTERVAL_MS,
  })

  const {
    panelPath, setPanelPath,
    panelTitle, setPanelTitle,
    highlightPath, setHighlightPath,
    treeFocusPath, treeFocusRequestId, acknowledgeTreeFocus,
    handleOpenPanel,
    handleSceneHoverPath,
    handleSceneClickPath,
    clearPanel,
    deselectAll,
  } = useSceneSelection({ liveScene })

  usePanelTitleSync({ liveScene, panelPath, setPanelTitle })

  const {
    addUI,
    setAddUI,
    openAddChild,
    closeAddUI,
    confirmAdd,
  } = useAddPicker({
    liveScene,
    setLiveScene,
    beginEdit,
    endEdit,
    setPanelPath,
    setPanelTitle,
    setHighlightPath,
    editDirtyRef,
    editTagRef,

    // ✅ allow AddNodePicker / confirmAdd to resolve library instance
    getLibraryItem,
  })

  const { openHistory, historyPanelProps } = useHistoryPanel({
    snapshotsRef,
    downloadSnapshotsAsJSON,
    downloadSnapshotsAsJSONL,
    clearSnapshots,
  })

  // Translate ranges
  const {
    rangeOverridesRef, rangeTick,
    rangeDraftRef, rangeDraftTick, setRangeDraftTick,
    getTranslateRange, updateTranslateRange, resetTranslateRange, keyForDraft,
  } = useTranslateRanges()

  // Max-only overrides
  const {
    paramMaxOverridesRef, paramMaxTick,
    paramMaxDraftRef, paramMaxDraftTick, setParamMaxDraftTick,
    getMaxOverride, setMaxOverride, resetMaxOverride,
    keyForSMax, keyForPrimMax,
  } = useParamMaxOverrides()

  // ✅ Repeat ranges
  const {
    repeatOverridesRef, repeatTick,
    repeatDraftRef, repeatDraftTick, setRepeatDraftTick,
    getRepeatRange, updateRepeatRange, resetRepeatRange,
    keyForRepeatDraft,
  } = useRepeatRanges()

  const { selectedNode, panelSpecs } = usePanelSpecs({
    liveScene,
    panelPath,
    getTranslateRange,
    keyForSMax,
    keyForPrimMax,
    getMaxOverride,
    rangeTick,
    paramMaxTick,
    getRepeatRange,
    repeatTick,
  })

  const {
    renameNodeAtPath,
    updateNodeColor,
    applyUpdatedNodeAtPath,
    hasClipboard,
    copyNode,
    pasteAsUnion,
  } = useNodeEditing({
    liveScene,
    setLiveScene,
    recordGeneration,
    beginEdit,
    endEdit,
    setPanelPath,
    setPanelTitle,
    editDirtyRef,
    editTagRef,
    clipboard,
  })

  const { updateSpecValue } = useParamEditing({
    liveScene,
    setLiveScene,
    panelPath,
    panelSpecs,
    beginEdit,
    editDirtyRef,
    editTagRef,
  })

  const { deleteNodeAtPath } = useNodeDeletion({
    liveScene,
    setLiveScene,
    panelPath,
    setPanelPath,
    setPanelTitle,
    setHighlightPath,
    beginEdit,
    endEdit,
    editDirtyRef,
    editTagRef,
  })

  const { openNodePrompt, nodePromptModalProps } = useNodePrompt({
    liveScene,
    applyUpdatedNodeAtPath,
    onScopeChange: handleSceneClickPath,
  })

  const handleSceneChangeFromTree = useCallback((scene) => {
    if (!acceptTreeChangeRef.current) return
    setLiveScene(scene)
    resetHistory()
    if (snapshotsRef.current.length === 0 && scene) pushSnapshot('init')
    acceptTreeChangeRef.current = false
  }, [resetHistory, pushSnapshot, setLiveScene, snapshotsRef, acceptTreeChangeRef])

  // ✅ Library: click item -> copy subtree into centralized clipboard
  const handlePickLibraryItem = useCallback((id) => {
    const it = getLibraryItem(id)
    if (!it || !it.subtree) return
    clipboard.setClipboard(it.subtree, null)
  }, [getLibraryItem, clipboard])

  // ✅ Instantiate: save subtree at path into Library
  const handleInstantiate = useCallback((path, name) => {
    if (!liveScene || !path) return
    const id = addInstanceFromPath(liveScene, path, name)
    if (!id) alert('Instantiate failed.')
  }, [liveScene, addInstanceFromPath])

  // ✅ Legend rows w/ type -> icon chip
  const legendRows = [
    { type: 'linear', name: 'Linear Repeat', sub: 'Array along a line' },
    { type: 'circular', name: 'Circular Repeat', sub: 'Array on a ring' },
    { type: 'union', name: 'Union', sub: 'Group parts into one' },
    { type: 'subtract', name: 'Subtract', sub: 'Remove B from A' },
    { type: 'intersect', name: 'Intersect', sub: 'Keep only overlap' },
    { type: 'cube', name: 'Cube', sub: 'Basic box' },
    { type: 'sphere', name: 'Sphere', sub: 'Round ball' },
    { type: 'cylinder', name: 'Cylinder', sub: 'Tube like' },
    { type: 'torus', name: 'Torus', sub: 'Donut ring' },
    { type: 'cone', name: 'Cone', sub: 'Tapered' },
  ]

  return (
    <div className="app-grid workspace-shell">
      <header className="workspace-header">
        <div className="workspace-brand" aria-label="Treellis local workspace">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#111318" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
            <path d="M13 13 7 16.5M13 13l6.5 3" />
            <polygon points="13,2 18.2,5 18.2,11 13,14 7.8,11 7.8,5" fill="#FFE46B" />
            <rect x="2.5" y="16" width="9" height="7.5" rx="2" fill="#EEF0FF" />
            <circle cx="19.5" cy="19.8" r="4" fill="#EAF8EA" />
          </svg>
          <span className="workspace-brand-name">Treellis</span>
          <span className="workspace-local-label">local</span>
        </div>

        <div className="workspace-header-divider" aria-hidden="true" />

        <SceneToolbar
          onRefresh={() => {
            refresh()
            setReloadKey(k => k + 1)
          }}
          onUpload={(root) => {
            if (!root) return
            resetHistory()
            enterDraftFromRoot(root)
            pushSnapshot('enter-draft')
          }}
          saveSlot={<SaveScene scene={liveScene} />}
          onOpenHistory={openHistory}
          isDraft={isDraft}
        />

        <nav className="workspace-global-tools" aria-label="Workspace tools">
          <button className="workspace-button" onClick={() => toggleTopModal('legend')} aria-pressed={topModal === 'legend'}>
            <WorkspaceIcon name="legend" />
            Legend
          </button>
          <button className="workspace-button" onClick={() => toggleTopModal('library')} aria-pressed={topModal === 'library'}>
            <WorkspaceIcon name="library" />
            Library
            <span className="workspace-count">{libraryItems?.length || 0}</span>
          </button>
          <button className="workspace-button" onClick={() => toggleTopModal('live')} aria-pressed={topModal === 'live'} title="View the live scene JSON">
            <WorkspaceIcon name="code" />
            Scene JSON
          </button>
        </nav>
      </header>

      <div ref={containerRef} className="split-root workspace-main">
        {/* LEFT */}
        <aside className="split-left" style={{ '--left-pct': `${leftPct}%` }}>
          <div className="split-content">
            <StructureTree
              key={`st-${reloadKey}-${srcReloadKey}`}
              url={liveScene ? null : sceneUrl}
              scene={liveScene}
              onHoverPath={handleSceneHoverPath}
              activePath={highlightPath}
              onSceneChange={handleSceneChangeFromTree}
              onOpenPanel={handleOpenPanel}
              onDeletePath={deleteNodeAtPath}
              onAddChild={openAddChild}
              onNodePrompt={openNodePrompt}
              focusPath={treeFocusPath}
              focusRequestId={treeFocusRequestId}
              onFocusDone={acknowledgeTreeFocus}
              onBlankClick={deselectAll}

              hasClipboard={hasClipboard}
              onCopyPath={copyNode}
              onPasteAsUnion={pasteAsUnion}

              // ✅ Library wiring (keep for instantiate / node actions)
              libraryItems={libraryItems}
              onPickLibraryItem={handlePickLibraryItem}
              onRemoveLibraryItem={removeLibraryItem}
              onRenameLibraryItem={renameLibraryItem}
              onInstantiate={handleInstantiate}
            />
          </div>
        </aside>

        {/* DIVIDER */}
        <div
          className="split-divider workspace-divider"
          title="Drag to resize / 拖动调整宽度"
          onMouseDown={(e) => { if (e) startDrag(e.clientX) }}
          onTouchStart={(e) => { if (e.touches && e.touches[0]) startDrag(e.touches[0].clientX) }}
          onDoubleClick={() => setLeftPct(40)}
        />

        {/* CENTER */}
        <main className="split-middle workspace-middle">
          <div className="workspace-viewport">
            <ThreeSceneFromJSON
              key={`scene-${reloadKey}-${srcReloadKey}`}
              url={sceneUrl}
              scene={liveScene}
              highlightPath={highlightPath}
              onHoverPathFromScene={handleSceneHoverPath}
              onClickPathFromScene={handleSceneClickPath}
            />
          </div>

          <ResizablePromptPane>
            <PromptPanel
              currentScene={liveScene}
              onGenerated={(root, meta) => {
                if (!root) return
                recordGeneration(root, 'prompt', meta || {})
                enterDraftFromRoot(root)
              }}
            />
          </ResizablePromptPane>
        </main>

        {/* RIGHT */}
        <RightPanelChrome
          title={panelTitle || 'Parameters'}
          onClose={clearPanel}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        >
          <ParameterPanel
            panelPath={panelPath}
            selectedNode={selectedNode}
            panelSpecs={panelSpecs}
            beginEdit={beginEdit}
            endEdit={endEdit}
            renameNodeAtPath={renameNodeAtPath}
            updateNodeColor={updateNodeColor}
            updateSpecValue={updateSpecValue}
            setHighlightPath={setHighlightPath}

            getTranslateRange={getTranslateRange}
            updateTranslateRange={updateTranslateRange}
            resetTranslateRange={resetTranslateRange}
            keyForDraft={keyForDraft}
            rangeDraftRef={rangeDraftRef}
            setRangeDraftTick={setRangeDraftTick}

            keyForSMax={keyForSMax}
            keyForPrimMax={keyForPrimMax}
            paramMaxDraftRef={paramMaxDraftRef}
            setParamMaxDraftTick={setParamMaxDraftTick}
            setMaxOverride={setMaxOverride}
            resetMaxOverride={resetMaxOverride}

            getRepeatRange={getRepeatRange}
            updateRepeatRange={updateRepeatRange}
            resetRepeatRange={resetRepeatRange}
            keyForRepeatDraft={keyForRepeatDraft}
            repeatDraftRef={repeatDraftRef}
            setRepeatDraftTick={setRepeatDraftTick}
          />
        </RightPanelChrome>
      </div>

      {addUI.open && (
        <AddNodePicker
          state={addUI}
          setState={setAddUI}
          onCancel={closeAddUI}
          onConfirm={confirmAdd}
          getLibraryItem={getLibraryItem}
          libraryItems={libraryItems}
        />
      )}

      <HistoryPanel {...historyPanelProps} />
      <NodePromptModal {...nodePromptModalProps} />

      {/* ===== Centered Modals ===== */}
      <TTCSModal
        open={topModal === 'legend'}
        title="Legend"
        onClose={() => setTopModal(null)}
      >
        <div className="ttcs-legendlist">
          {legendRows.map((r) => (
            <div key={r.type} className="ttcs-legenditem">
              <div className="ttcs-legenditem__chip">
                <LegendChip type={r.type} />
              </div>
              <div className="ttcs-legenditem__meta">
                <div className="ttcs-legenditem__name">{r.name}</div>
                <div className="ttcs-legenditem__sub">{r.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </TTCSModal>

      <TTCSModal
        open={topModal === 'library'}
        title={`Library (${libraryItems?.length || 0})`}
        onClose={() => setTopModal(null)}
      >
        <div className="ttcs-libhint">
          Click <b>Copy</b> to put the subtree into clipboard. Then paste via node action (Paste as Union).
        </div>

        <div className="ttcs-liblist">
          {(libraryItems || []).length === 0 && (
            <div className="muted">No items yet.</div>
          )}

          {(libraryItems || []).map((it) => (
            <div key={it.id} className="ttcs-librow">
              <div className="ttcs-librow__name">{it.name || it.id}</div>

              <div className="ttcs-librow__actions">
                <button
                  className="btn btn--sm"
                  onClick={() => handlePickLibraryItem(it.id)}
                >
                  Copy
                </button>

                <button
                  className="btn btn--sm"
                  onClick={() => {
                    const next = window.prompt('Rename library item:', it.name || '')
                    if (!next) return
                    renameLibraryItem(it.id, next)
                  }}
                >
                  Rename
                </button>

                <button
                  className="btn btn--sm"
                  onClick={() => {
                    const ok = window.confirm(`Remove "${it.name || it.id}"?`)
                    if (!ok) return
                    removeLibraryItem(it.id)
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </TTCSModal>

      <TTCSModal
        open={topModal === 'live'}
        title="Live Scene"
        onClose={() => setTopModal(null)}
      >
        <div className="ttcs-live-actions">
          <button
            className="btn btn--sm"
            onClick={async () => {
              const text = safeJSONStringify(liveScene)
              try {
                await navigator.clipboard.writeText(text)
                alert('Copied.')
              } catch {
                alert('Copy failed. Your browser may block clipboard.')
              }
            }}
          >
            Copy JSON
          </button>

          <button
            className="btn btn--sm"
            onClick={() => {
              const text = safeJSONStringify(liveScene)
              downloadText('scene.json', text)
            }}
          >
            Download scene.json
          </button>
        </div>

        <pre className="ttcs-json">{safeJSONStringify(liveScene)}</pre>
      </TTCSModal>
    </div>
  )
}
