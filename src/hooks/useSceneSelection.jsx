// Shared persistent selection for the structure tree, layers and 3D viewport.
import { useState, useCallback, useEffect, useRef } from 'react'
import { getNodeAtPath } from '../utils/tree'

const isPath = (path) => typeof path === 'string' && /^0(?:\.(?:0|[1-9]\d*))*$/.test(path)
const samePaths = (a, b) => a.length === b.length && a.every((path, i) => path === b[i])

export default function useSceneSelection({ liveScene }) {
  const [panelPath, setPanelPathValue] = useState(null)
  const [panelTitle, setPanelTitle] = useState('')
  const [selectedPaths, setSelectedPaths] = useState([])
  const selectionRef = useRef([])
  const [selectedPath, setPrimaryPath] = useState(null)
  const primaryRef = useRef(null)
  const [multiSelect, setMultiSelectValue] = useState(false)
  const multiSelectRef = useRef(false)
  const [hoverPath, setHoverPath] = useState(null)
  const [treeFocusPath, setTreeFocusPath] = useState(null)
  const [treeFocusRequestId, setTreeFocusRequestId] = useState(0)
  const focusRequestRef = useRef({ path: null, id: 0 })

  const requestTreeFocus = useCallback((path) => {
    const request = { path: path ?? null, id: focusRequestRef.current.id + 1 }
    focusRequestRef.current = request
    setTreeFocusPath(request.path)
    setTreeFocusRequestId(request.id)
  }, [])
  const acknowledgeTreeFocus = useCallback((path, requestId) => {
    const current = focusRequestRef.current
    if (current.path !== path || current.id !== requestId) return
    focusRequestRef.current = { ...current, path: null }
    setTreeFocusPath(null)
  }, [])

  const validPath = useCallback((path) => isPath(path) && (!liveScene || !!getNodeAtPath(liveScene, path)), [liveScene])
  const commitSelection = useCallback((paths, focusPath, { focus = true, validate = true, scene: nextScene = liveScene } = {}) => {
    const valid = path => isPath(path) && (!nextScene || !!getNodeAtPath(nextScene, path))
    const unique = [...new Set(paths)].filter(path => validate ? valid(path) : isPath(path))
    const primary = unique.includes(focusPath) ? focusPath : unique.at(-1) ?? null
    if (!samePaths(selectionRef.current, unique)) {
      selectionRef.current = unique
      setSelectedPaths(unique)
    }
    primaryRef.current = primary
    setPrimaryPath(primary)
    setHoverPath(null)
    setPanelPathValue(primary)
    setPanelTitle(primary ? getNodeAtPath(nextScene, primary)?.name || 'Parameters' : '')
    if (focus) requestTreeFocus(primary)
  }, [liveScene, requestTreeFocus])

  // Programmatic add/paste/group actions deliberately replace the selection set.
  // A next scene permits grouping + selection in the same React event batch.
  const selectPaths = useCallback((paths, { focusPath, scene: nextScene = liveScene } = {}) => {
    commitSelection(Array.isArray(paths) ? paths : [], focusPath, { scene: nextScene })
  }, [commitSelection, liveScene])
  const setSelectedPath = useCallback((update) => {
    const path = typeof update === 'function' ? update(primaryRef.current) : update
    commitSelection(path == null ? [] : [path], path, { focus: false, validate: false })
  }, [commitSelection])
  const setPanelPath = useCallback((path) => {
    if (path == null) { setPanelPathValue(null); return }
    commitSelection([path], path, { focus: false, validate: false })
  }, [commitSelection])
  const setHighlightPath = useCallback((path) => {
    commitSelection(path == null ? [] : [path], path, { focus: false, validate: false })
  }, [commitSelection])
  const setMultiSelect = useCallback((update) => {
    const next = !!(typeof update === 'function' ? update(multiSelectRef.current) : update)
    multiSelectRef.current = next
    setMultiSelectValue(next)
  }, [])

  const deselectAll = useCallback(() => commitSelection([], null), [commitSelection])
  const selectClickedPath = useCallback((path, { shiftKey = false, additive = false } = {}) => {
    if (path == null) {
      // Shift-clicking empty viewport space should not discard a multi-selection.
      if (!shiftKey && !additive && !multiSelectRef.current) deselectAll()
      return
    }
    if (!validPath(path)) return
    let next = [path]
    if (shiftKey || additive || multiSelectRef.current) {
      const current = selectionRef.current
      next = current.includes(path) ? current.filter(item => item !== path) : [...current, path]
    }
    commitSelection(next, next.includes(path) ? path : next.at(-1))
  }, [validPath, commitSelection, deselectAll])

  const handleOpenPanel = useCallback(({ path, title, shiftKey, additive }) => {
    selectClickedPath(path, { shiftKey, additive })
    if (primaryRef.current === path && title) setPanelTitle(title)
  }, [selectClickedPath])
  const handleSceneClickPath = useCallback((path, options = {}) => {
    selectClickedPath(path, options)
  }, [selectClickedPath])
  const handleSceneHoverPath = useCallback((path) => { setHoverPath(path ?? null) }, [])
  const clearPanel = useCallback(() => { setPanelPathValue(null); setPanelTitle('') }, [])

  // Accept an object or Map; exact/longest ancestor mappings preserve descendants.
  const remapSelection = useCallback((pathMap, { scene: nextScene = liveScene } = {}) => {
    const entries = (pathMap instanceof Map ? [...pathMap] : Object.entries(pathMap || {}))
      .sort(([a], [b]) => b.length - a.length)
    const remap = (path) => {
      if (path == null) return null
      const entry = entries.find(([from]) => path === from || path.startsWith(`${from}.`))
      if (!entry) return path
      return entry[1] == null ? null : `${entry[1]}${path.slice(entry[0].length)}`
    }
    commitSelection(selectionRef.current.map(remap).filter(Boolean), remap(primaryRef.current), { validate: false, scene: nextScene })
  }, [commitSelection, liveScene])

  useEffect(() => {
    if (!liveScene) return
    const current = selectionRef.current
    const remaining = current.filter(validPath)
    if (!samePaths(current, remaining)) {
      commitSelection(remaining, primaryRef.current, { focus: false })
      return
    }
    if (hoverPath && !validPath(hoverPath)) setHoverPath(null)
    if (treeFocusPath && !validPath(treeFocusPath)) requestTreeFocus(null)
    if (panelPath) {
      const node = validPath(panelPath) ? getNodeAtPath(liveScene, panelPath) : null
      if (node) setPanelTitle(node.name || 'Parameters')
      else { setPanelPathValue(null); setPanelTitle('') }
    }
  }, [liveScene, validPath, commitSelection, panelPath, hoverPath, treeFocusPath, requestTreeFocus])

  return {
    panelPath, setPanelPath, panelTitle, setPanelTitle,
    highlightPath: panelPath ?? selectedPath ?? hoverPath, setHighlightPath,
    highlightPaths: selectedPaths.length ? selectedPaths : hoverPath ? [hoverPath] : [],
    selectedPath, setSelectedPath, selectedPaths, selectPaths, remapSelection,
    multiSelect, setMultiSelect,
    treeFocusPath, setTreeFocusPath: requestTreeFocus, treeFocusRequestId, acknowledgeTreeFocus,
    handleOpenPanel, handleSceneHoverPath, handleSceneClickPath, clearPanel, deselectAll,
  }
}
