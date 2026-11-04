// src/App.jsx
import React, { useState, useCallback, useEffect } from 'react'
import { STATIC_DEMO, publishStaticScene } from './staticDemo/mode.mjs'
import { createInitialScene } from './staticDemo/initialScene.mjs'
import { askConfirm, askText, notify } from './ui/dialogs.mjs'
import ThreeSceneFromJSON from './components/ThreeSceneFromJSON'
import StructureTree from './components/StructureTree'
import SceneLayers from './components/SceneLayers.jsx'
import SceneStructurePanel from './components/SceneStructurePanel.jsx'
import { ModelModeSelect } from './components/PromptControls.jsx'
import PromptPanel from './components/PromptPanel'
import ResizablePromptPane from './components/ResizablePromptPane'
import HistoryPanel from './components/HistoryPanel'
import NodePromptModal from './components/NodePromptModal'
import SaveScene from './components/SaveScene'
import AddNodePicker from './components/AddNodePicker'
import ParameterPanel from './components/ParameterPanel.jsx'
import SceneToolbar, { WorkspaceIcon } from './components/SceneToolbar'
import RightPanelChrome from './components/RightPanelChrome'
import SceneLibraries from './components/SceneLibraries.jsx'
import MobileWorkspaceTabs from './components/MobileWorkspaceTabs.jsx'
import Dialog from './components/Dialog.jsx'
import WorkspaceMoreMenu from './components/WorkspaceMoreMenu.jsx'
import WelcomeCard, { welcomeDismissed, rememberWelcomeDismissed } from './components/WelcomeCard.jsx'
import useScenePersistence, { loadSavedScene, clearSavedScene } from './hooks/useScenePersistence.jsx'
import useResponsiveWorkspace from './hooks/useResponsiveWorkspace.jsx'
import { studyScenes, createLibraryScene } from './libraries/studyScenes.mjs'
import './styles.css'
import './ui.css'
import './workspace.css'
import './mobileWorkspace.css'

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
import useSceneOrganization from './hooks/useSceneOrganization.jsx'
import { getNodeAtPath } from './utils/tree.jsx'

// ✅ App-level clipboard (single source of truth)
import useClipboard from './hooks/useClipboard'

// ✅ Instance Library hook
import useInstanceLibrary from './hooks/useInstanceLibrary'

const POLL_INTERVAL_MS = 1500

// ===== App-level dialogs share one frame =====
function TTCSModal({ open, title, subtitle, onClose, footer, footerNote, size, children }) {
  return <Dialog open={open} title={title} subtitle={subtitle} onClose={onClose} footer={footer} footerNote={footerNote} size={size}>{children}</Dialog>
}

function safeJSONStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return '<< Failed to stringify liveScene >>'
  }
}

function downloadText(filename, text) {
  if (STATIC_DEMO) return
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

function opensOnPrompt() {
  if (typeof window === 'undefined') return false
  return /^\/try\/?$/.test(window.location.pathname) || /(?:^#|&)(?:access_token|error_code)=/.test(window.location.hash)
}

export default function App() {
  const { compact, viewport } = useResponsiveWorkspace()
  // The /try link (conference QR code) and emailed sign-in links open on the Prompt tab.
  const [mobilePanel, setMobilePanel] = useState(() => opensOnPrompt() ? 'create' : 'structure')
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  useEffect(() => { if (!compact) setMobileToolsOpen(false) }, [compact])
  const { leftPct, setLeftPct, containerRef, startDrag } = useSplitter(40, 20, 70)
  const [reloadKey, setReloadKey] = useState(0)
  const [frameLibraryScene, setFrameLibraryScene] = useState(false)
  // A scene saved in this browser on an earlier visit comes back first.
  const [restored] = useState(() => STATIC_DEMO ? null : loadSavedScene())
  const [liveScene, setLiveScene] = useState(() => STATIC_DEMO ? createInitialScene() : restored?.scene || null)
  const [showWelcome, setShowWelcome] = useState(() => !STATIC_DEMO && !welcomeDismissed())
  useEffect(() => { publishStaticScene(liveScene) }, [liveScene])
  const [structureView, setStructureView] = useState('tree')
  const [sceneGenerationBusy, setSceneGenerationBusy] = useState(false)
  const [nodeGenerationBusy, setNodeGenerationBusy] = useState(false)
  const [organizationDialog, setOrganizationDialog] = useState(null)
  const [groupName, setGroupName] = useState('Group')
  const [organizationEffort, setOrganizationEffort] = useState('medium')
  const [organizationPrompt, setOrganizationPrompt] = useState('')

  // ✅ Top-left aligned buttons -> centered modals
  const [topModal, setTopModal] = useState(null) // 'libraries' | 'legend' | 'library' | 'live' | null
  const closeTopModal = useCallback(() => setTopModal(null), [])
  const toggleTopModal = useCallback((key) => {
    setMobileToolsOpen(false)
    setTopModal((prev) => (prev === key ? null : key))
  }, [])

  const clipboard = useClipboard()
  useEffect(() => {
    if (STATIC_DEMO) clipboard.clearClipboard()
  }, [clipboard.clearClipboard])

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
    pushSnapshotForScene,
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
    reset: resetSceneSource,
    acceptTreeChangeRef,
  } = useSceneSource({
    setLiveScene,
    editingRef,
    pollIntervalMs: POLL_INTERVAL_MS,
  })

  const persistence = useScenePersistence({ scene: liveScene, enabled: !STATIC_DEMO,
    restoredScene: restored?.scene, restoredAt: restored?.savedAt })
  // Continue a restored scene as a draft so the server's /scene.json cannot replace it.
  useEffect(() => {
    if (!restored?.scene) return
    enterDraftFromRoot(restored.scene)
    pushSnapshotForScene(restored.scene, 'restore')
  }, [])

  const {
    panelPath, setPanelPath,
    panelTitle, setPanelTitle,
    highlightPath, setHighlightPath,
    selectedPaths, highlightPaths, multiSelect, setMultiSelect, selectPaths, remapSelection,
    treeFocusPath, treeFocusRequestId, acknowledgeTreeFocus, setTreeFocusPath: focusStructureNode,
    handleOpenPanel,
    handleSceneHoverPath,
    handleSceneClickPath,
    clearPanel,
    deselectAll,
  } = useSceneSelection({ liveScene })

  const generationBusy = sceneGenerationBusy || nodeGenerationBusy
  const organization = useSceneOrganization({ scene: liveScene, selectedPaths, blocked: generationBusy,
    recordGeneration, enterDraftFromRoot, selectPaths, remapSelection })
  const smartScope = selectedPaths.length === 1 ? selectedPaths[0] : selectedPaths.length > 1 &&
    selectedPaths.every(path => path.slice(0, path.lastIndexOf('.')) === selectedPaths[0].slice(0, selectedPaths[0].lastIndexOf('.')))
      ? selectedPaths[0].slice(0, selectedPaths[0].lastIndexOf('.')) || '0' : '0'
  const smartScopeName = liveScene && getNodeAtPath(liveScene, smartScope)?.name || 'Current scene'

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

  const { openNodePrompt, closeNodePrompt, nodePromptModalProps } = useNodePrompt({
    liveScene,
    applyUpdatedNodeAtPath,
    onScopeChange: handleSceneClickPath,
  })

  const handleSceneChangeFromTree = useCallback((scene) => {
    if (!acceptTreeChangeRef.current) return
    // A scene loaded from the server is the starting point, not something to save.
    persistence.markPristine(scene)
    setLiveScene(scene)
    resetHistory()
    // Log the scene that just arrived (pushSnapshot would still see the previous one).
    if (snapshotsRef.current.length === 0 && scene) pushSnapshotForScene(scene, 'init')
    acceptTreeChangeRef.current = false
  }, [resetHistory, pushSnapshotForScene, setLiveScene, snapshotsRef, acceptTreeChangeRef, persistence.markPristine])

  // ✅ Library: click item -> copy subtree into centralized clipboard
  const handlePickLibraryItem = useCallback((id) => {
    const it = getLibraryItem(id)
    if (!it || !it.subtree) return
    clipboard.setClipboard(it.subtree, null)
  }, [getLibraryItem, clipboard])

  const handleLoadLibraryScene = useCallback((item) => {
    if (generationBusy || organization.busy) return
    const root = createLibraryScene(item.id)
    if (!root) return
    recordGeneration(root, 'library-load', { libraryId: item.id, title: item.title })
    enterDraftFromRoot(root)
    deselectAll()
    setMultiSelect(false)
    closeAddUI()
    closeNodePrompt()
    setOrganizationDialog(null)
    setTopModal(null)
    setFrameLibraryScene(true)
    setMobilePanel('structure')
    setReloadKey(key => key + 1)
  }, [generationBusy, organization.busy, recordGeneration, enterDraftFromRoot,
    deselectAll, setMultiSelect, closeAddUI, closeNodePrompt])

  // ✅ Instantiate: save subtree at path into Library
  const handleInstantiate = useCallback((path, name) => {
    if (!liveScene || !path) return
    const id = addInstanceFromPath(liveScene, path, name)
    if (!id) notify("Couldn't save that part.", { tone: 'error' })
    else notify(`Saved "${name}" to Parts.`)
  }, [liveScene, addInstanceFromPath])

  // Deleting asks first, from the tree and from Layers alike.
  const confirmDeletePath = useCallback(async (path) => {
    const node = liveScene && getNodeAtPath(liveScene, path)
    if (!node) return
    const count = Array.isArray(node.children) ? node.children.length : 0
    const ok = await askConfirm({
      title: `Delete “${node.name || 'this part'}”?`,
      message: count ? `Its ${count} part${count === 1 ? '' : 's'} will be deleted too. You can undo this.` : 'You can undo this.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) deleteNodeAtPath(path)
  }, [liveScene, deleteNodeAtPath])

  const startOver = useCallback(async () => {
    const ok = await askConfirm({
      title: 'Start over?',
      message: 'This replaces your current scene with the default example. Download it first if you want to keep a copy.',
      confirmLabel: 'Start over',
      danger: true,
    })
    if (!ok) return
    clearSavedScene()
    persistence.markPristine()
    resetHistory()
    deselectAll()
    closeAddUI()
    closeNodePrompt()
    setTopModal(null)
    resetSceneSource()
    setReloadKey(key => key + 1)
  }, [persistence.markPristine, resetHistory, deselectAll, closeAddUI, closeNodePrompt, resetSceneSource])

  const dismissWelcome = useCallback(() => { rememberWelcomeDismissed(); setShowWelcome(false) }, [])
  const focusPrompt = useCallback(() => {
    dismissWelcome()
    setMobilePanel('create')
    setTimeout(() => document.querySelector('.prompt-dock .prompt-textarea')?.focus(), 60)
  }, [dismissWelcome])

  const moreItems = [
    { key: 'legend', icon: 'legend', label: 'Shape guide', hint: 'What each node shape means', onSelect: () => toggleTopModal('legend') },
    { key: 'parts', icon: 'parts', label: `Saved parts (${libraryItems?.length || 0})`, hint: 'Reuse parts across scenes', onSelect: () => toggleTopModal('library') },
    { key: 'history', icon: 'history', label: 'Session log', hint: 'Snapshots for research exports', onSelect: () => { setMobileToolsOpen(false); openHistory() } },
    { key: 'json', icon: 'code', label: 'Scene JSON', hint: 'View or copy the raw scene', onSelect: () => toggleTopModal('live') },
    { key: 'divider', type: 'divider' },
    { key: 'tips', icon: 'help', label: 'Show tips', onSelect: () => { setMobileToolsOpen(false); rememberWelcomeDismissed(false); setShowWelcome(true); setMobilePanel('model') } },
    { key: 'restart', icon: 'restart', label: 'Start over', hint: 'Back to the default example', danger: true, onSelect: () => { setMobileToolsOpen(false); void startOver() } },
  ]

  // Shape guide: what each node in the tree stands for, grouped like the Add dialog.
  const legendGroups = [
    { title: 'Shapes', rows: [
      { type: 'cube', name: 'Cube', sub: 'A box', fill: '#eceeff' },
      { type: 'sphere', name: 'Sphere', sub: 'A ball', fill: '#f3fff2' },
      { type: 'cylinder', name: 'Cylinder', sub: 'A tube or rod', fill: '#e8ffe6' },
      { type: 'torus', name: 'Torus', sub: 'A ring', fill: '#fff4e1' },
      { type: 'cone', name: 'Cone', sub: 'A tapered point', fill: '#fff6ec' },
    ] },
    { title: 'Combine', rows: [
      { type: 'union', name: 'Union', sub: 'Joins parts into one', fill: '#fee8ff' },
      { type: 'subtract', name: 'Subtract', sub: 'Cuts the second part out of the first', fill: '#ecf7ff' },
      { type: 'intersect', name: 'Intersect', sub: 'Keeps only where parts overlap', fill: '#fff6ec' },
    ] },
    { title: 'Repeat', rows: [
      { type: 'linear', name: 'Linear repeat', sub: 'Copies a part along a line', fill: '#ecf7ff' },
      { type: 'circular', name: 'Circular repeat', sub: 'Copies a part around a ring', fill: '#ffebfd' },
    ] },
  ]

  return (
    <div className="app-grid workspace-shell" data-mobile-panel={mobilePanel} data-tools-open={mobileToolsOpen}>
      <header className="workspace-header">
        <div className="workspace-brand" aria-label="Treellis">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#111318" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
            <path d="M13 13 7 16.5M13 13l6.5 3" />
            <polygon points="13,2 18.2,5 18.2,11 13,14 7.8,11 7.8,5" fill="#FFE46B" />
            <rect x="2.5" y="16" width="9" height="7.5" rx="2" fill="#EEF0FF" />
            <circle cx="19.5" cy="19.8" r="4" fill="#EAF8EA" />
          </svg>
          <span className="workspace-brand-name">Treellis</span>
        </div>

        <div className="workspace-header-divider" aria-hidden="true" />

        <SceneToolbar
          sceneName={liveScene?.name}
          saveStatus={persistence.status}
          savedAt={persistence.savedAt}
          showSaveStatus={!STATIC_DEMO}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => {
            const result = undo()
            if (result && !result.preserveSelection) deselectAll()
            if (result?.sceneSwitch) setReloadKey(key => key + 1)
          }}
          onRedo={() => {
            const result = redo()
            if (result && !result.preserveSelection) deselectAll()
            if (result?.sceneSwitch) setReloadKey(key => key + 1)
          }}
          onUpload={(root) => {
            if (!root) return
            resetHistory()
            enterDraftFromRoot(root)
            pushSnapshotForScene(root, 'open-file')
            setMobilePanel('structure')
            setMobileToolsOpen(false)
          }}
          saveSlot={<SaveScene scene={liveScene} />}
        />

        <nav className="workspace-global-tools" aria-label="Workspace tools">
          <button className="workspace-button workspace-libraries-trigger" onClick={() => toggleTopModal('libraries')}
            aria-haspopup="dialog" aria-expanded={topModal === 'libraries'} title="Open an example model">
            <WorkspaceIcon name="library" />
            Examples
          </button>
          <WorkspaceMoreMenu items={moreItems} inline={compact} />
        </nav>
        <div className="workspace-mobile-actions">
          <button type="button" className="workspace-button" onClick={() => toggleTopModal('libraries')}
            aria-haspopup="dialog" aria-expanded={topModal === 'libraries'}>
            <WorkspaceIcon name="library" />Examples
          </button>
          <button type="button" className="workspace-button workspace-icon-button" aria-expanded={mobileToolsOpen}
            aria-label="More tools" title="More tools" onClick={() => setMobileToolsOpen(open => !open)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
      </header>

      <div ref={containerRef} className="split-root workspace-main">
        {/* LEFT */}
        <aside id="workspace-structure-panel" className="split-left" style={{ '--left-pct': `${leftPct}%` }}
          role={compact ? 'tabpanel' : undefined} aria-labelledby={compact ? 'workspace-tab-structure' : undefined}>
          <div className="split-content">
            <SceneStructurePanel
              compact={compact}
              view={structureView} onViewChange={view => { setStructureView(view); focusStructureNode(panelPath || selectedPaths.at(-1) || null) }}
              multiSelect={multiSelect} onMultiSelectChange={setMultiSelect}
              selectedPaths={selectedPaths} onClearSelection={deselectAll}
              onGroup={() => { setGroupName('Group'); setOrganizationDialog('group') }}
              onUngroup={organization.ungroup} canGroup={organization.canGroup} canUngroup={organization.canUngroup}
              onSmartGroup={() => setOrganizationDialog('smart')} canSmartGroup={!!liveScene && !generationBusy && !organization.busy}
              groupingBusy={organization.busy} onCancelSmartGroup={organization.cancel}
              smartStatus={organization.status} error={organization.error}
              onShowGuide={() => toggleTopModal('legend')}
            >
            <div style={{ height: '100%', display: structureView === 'tree' ? 'block' : 'none' }}>
            <StructureTree
              layoutScale={compact ? viewport.height <= 500 ? 0.32 : 0.45 : 1}
              key={`st-${reloadKey}-${srcReloadKey}`}
              url={liveScene ? null : sceneUrl}
              scene={liveScene}
              onHoverPath={handleSceneHoverPath}
              activePath={highlightPath}
              selectedPaths={selectedPaths}
              pathRemap={organization.pathRemap}
              onSceneChange={handleSceneChangeFromTree}
              onOpenPanel={handleOpenPanel}
              onDeletePath={confirmDeletePath}
              onAddChild={openAddChild}
              onNodePrompt={openNodePrompt}
              focusPath={structureView === 'tree' && (!compact || mobilePanel === 'structure') ? treeFocusPath : null}
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
            <div style={{ height: '100%', display: structureView === 'layers' ? 'block' : 'none' }}>
              <SceneLayers scene={liveScene} selectedPaths={selectedPaths} activePath={highlightPath}
                focusPath={structureView === 'layers' && (!compact || mobilePanel === 'structure') ? treeFocusPath : null} focusRequestId={treeFocusRequestId}
                onFocusDone={acknowledgeTreeFocus} pathRemap={organization.pathRemap}
                onSelect={handleSceneClickPath} onHoverPath={handleSceneHoverPath} onBlankClick={deselectAll}
                onNodePrompt={openNodePrompt} onAddChild={openAddChild} onDeletePath={confirmDeletePath} />
            </div>
            </SceneStructurePanel>
          </div>
        </aside>

        {/* DIVIDER */}
        <div
          className="split-divider workspace-divider"
          title="Drag to resize. Double-click to reset."
          onMouseDown={(e) => { if (e) startDrag(e.clientX) }}
          onTouchStart={(e) => { if (e.touches && e.touches[0]) startDrag(e.touches[0].clientX) }}
          onDoubleClick={() => setLeftPct(40)}
        />

        {/* CENTER */}
        <main id="workspace-center-panel" className="split-middle workspace-middle" role={compact ? 'tabpanel' : undefined}
          aria-labelledby={compact ? `workspace-tab-${mobilePanel === 'create' ? 'create' : 'model'}` : undefined}>
          <div className="workspace-viewport">
            <ThreeSceneFromJSON
              key={`scene-${reloadKey}-${srcReloadKey}`}
              url={sceneUrl}
              scene={liveScene}
              frameOnLoad={frameLibraryScene}
              responsiveFraming={compact}
              highlightPath={highlightPath}
              highlightPaths={highlightPaths}
              onHoverPathFromScene={handleSceneHoverPath}
              onClickPathFromScene={handleSceneClickPath}
            />
            {showWelcome && (
              <WelcomeCard compact={compact} onDismiss={dismissWelcome} onStartPrompt={focusPrompt}
                onBrowseExamples={() => { dismissWelcome(); toggleTopModal('libraries') }} />
            )}
          </div>

          <ResizablePromptPane compact={compact}>
            <PromptPanel
              currentScene={liveScene}
              disabled={organization.busy} onBusyChange={setSceneGenerationBusy}
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
          id="workspace-parameters-panel" role={compact ? 'tabpanel' : undefined}
          aria-labelledby={compact ? 'workspace-tab-parameters' : undefined}
          hasSelection={!!panelPath}
          onClose={() => { if (compact) setMobilePanel('model'); else clearPanel() }}
        >
          <ParameterPanel
            compact={compact}
            panelPath={panelPath}
            selectionCount={selectedPaths.length}
            selectedNode={selectedNode}
            panelSpecs={panelSpecs}
            beginEdit={beginEdit}
            endEdit={endEdit}
            renameNodeAtPath={renameNodeAtPath}
            updateNodeColor={updateNodeColor}
            updateSpecValue={updateSpecValue}
            setHighlightPath={path => { if (!selectedPaths.includes(path)) setHighlightPath(path) }}

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

      <MobileWorkspaceTabs active={mobilePanel} onChange={panel => { setMobilePanel(panel); setMobileToolsOpen(false) }}
        selectedCount={selectedPaths.length} busy={generationBusy || organization.busy} />

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
      <NodePromptModal {...nodePromptModalProps} disabled={organization.busy} onBusyChange={setNodeGenerationBusy} />

      <TTCSModal open={organizationDialog === 'group'} title="Group selected parts" size="sm"
        subtitle={`${selectedPaths.length} parts selected. They keep their current positions.`} onClose={() => setOrganizationDialog(null)}>
        <form className="scene-organization-form" onSubmit={event => {
          event.preventDefault()
          if (organization.group(groupName)) setOrganizationDialog(null)
        }}>
          <label>Group name<input className="ui-input" autoFocus maxLength={160} required value={groupName} onChange={event => setGroupName(event.target.value)} /></label>
          {organization.error && <div role="alert" className="ui-error">{organization.error}</div>}
          <div className="scene-organization-form__actions">
            <button type="button" className="ui-btn" onClick={() => setOrganizationDialog(null)}>Cancel</button>
            <button type="submit" className="ui-btn ui-btn--primary" disabled={!organization.canGroup || !groupName.trim()}>Create group</button>
          </div>
        </form>
      </TTCSModal>
      <TTCSModal open={organizationDialog === 'smart'} title="Smart group" onClose={() => setOrganizationDialog(null)}
        subtitle={<>AI sorts the parts of <strong>{smartScopeName}</strong> into named groups. Parts and positions stay the same, and you can undo it.</>}>
        <form className="scene-organization-form" onSubmit={event => {
          event.preventDefault(); setOrganizationDialog(null)
          void organization.organize({ scope: smartScope, effort: organizationEffort, prompt: organizationPrompt })
        }}>
          <label>How should it group them? (optional)<textarea rows={3} maxLength={4000} value={organizationPrompt}
            placeholder="For example: group the two blades together, and separate supports from wires."
            onChange={event => setOrganizationPrompt(event.target.value)} /></label>
          <div className="scene-organization-form__actions">
            <ModelModeSelect value={organizationEffort} onChange={event => setOrganizationEffort(event.target.value)} />
            <button type="button" className="ui-btn" onClick={() => setOrganizationDialog(null)}>Cancel</button>
            <button type="submit" className="ui-btn ui-btn--primary" disabled={generationBusy || organization.busy || !liveScene}>Organize</button>
          </div>
        </form>
      </TTCSModal>

      {/* ===== Centered Modals ===== */}
      <SceneLibraries open={topModal === 'libraries'} onClose={closeTopModal}
        items={studyScenes} onSelect={item => { dismissWelcome(); handleLoadLibraryScene(item) }} busy={generationBusy || organization.busy} />
      <TTCSModal
        open={topModal === 'legend'}
        title="Shape guide"
        subtitle="Each node in the tree is a shape, a way of combining shapes, or a repeat."
        size="lg"
        onClose={() => setTopModal(null)}
      >
        {legendGroups.map(group => (
          <section key={group.title} className="ttcs-legend-group">
            <h3 className="ttcs-legend-group__title">{group.title}</h3>
            <div className="ttcs-legendlist">
              {group.rows.map((r) => (
                <div key={r.type} className="ttcs-legenditem">
                  <div className="ttcs-legenditem__chip" style={{ '--chip-fill': r.fill }}>
                    <LegendChip type={r.type} />
                  </div>
                  <div className="ttcs-legenditem__meta">
                    <div className="ttcs-legenditem__name">{r.name}</div>
                    <div className="ttcs-legenditem__sub">{r.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </TTCSModal>

      <TTCSModal
        open={topModal === 'library'}
        title="Saved parts"
        subtitle="Parts you save from the tree, ready to reuse in any scene."
        onClose={() => setTopModal(null)}
      >
        {(libraryItems || []).length === 0 ? (
          <div className="ui-empty">
            <div className="ui-empty__title">No saved parts yet</div>
            <p>Hover a node in the tree and choose <strong>Save as part</strong>. Saved parts can be added to any scene from <strong>Add</strong> → <strong>Saved part</strong>.</p>
          </div>
        ) : (
          <>
            <p className="ttcs-libhint"><strong>Copy</strong> a part, then use <strong>Paste</strong> on any node to add it there.</p>
            <div className="ttcs-liblist">
              {(libraryItems || []).map((it) => (
                <div key={it.id} className="ttcs-librow">
                  <div className="ttcs-librow__name">{it.name || it.id}</div>
                  <div className="ttcs-librow__actions">
                    <button type="button" className="ui-btn ui-btn--sm" onClick={() => { handlePickLibraryItem(it.id); notify(`Copied "${it.name || 'part'}". Use Paste on a node to add it.`) }}>
                      Copy
                    </button>
                    <button type="button" className="ui-btn ui-btn--sm" onClick={async () => {
                      const next = await askText({ title: 'Rename part', label: 'Name', value: it.name || '', confirmLabel: 'Rename' })
                      if (next) renameLibraryItem(it.id, next)
                    }}>
                      Rename
                    </button>
                    <button type="button" className="ui-btn ui-btn--sm ui-btn--danger-quiet" onClick={async () => {
                      const ok = await askConfirm({ title: 'Remove this part?', message: `"${it.name || it.id}" will be removed from Saved parts. Scenes that already use it keep their copy.`, confirmLabel: 'Remove', danger: true })
                      if (ok) removeLibraryItem(it.id)
                    }}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </TTCSModal>

      <TTCSModal
        open={topModal === 'live'}
        title="Scene JSON"
        subtitle="The scene exactly as Treellis stores it."
        size="lg"
        onClose={() => setTopModal(null)}
        footer={<>
          <button type="button" className="ui-btn" onClick={async () => {
            try {
              await navigator.clipboard.writeText(safeJSONStringify(liveScene))
              notify('Copied the scene JSON.')
            } catch {
              notify("Couldn't copy. Your browser blocked clipboard access.", { tone: 'error' })
            }
          }}>Copy JSON</button>
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => downloadText('scene.json', safeJSONStringify(liveScene))}>
            Download scene.json
          </button>
        </>}
      >
        <pre className="ttcs-json">{safeJSONStringify(liveScene)}</pre>
      </TTCSModal>

    </div>
  )
}
