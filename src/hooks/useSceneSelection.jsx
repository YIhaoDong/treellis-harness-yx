// src/hooks/useSceneSelection.jsx
import { useState, useCallback, useEffect, useRef } from 'react'
import { getNodeAtPath } from '../utils/tree'

/**
 * 统一管理场景选中/高亮/树聚焦，以及 3D <-> 树 的交互桥接。
 * 增强：
 * - selectedPath（持久选中）
 * - deselectAll()：空白点击清空选中/高亮/面板
 * - handleSceneClickPath 支持 null（空白点击）
 */
export default function useSceneSelection({ liveScene }) {
  // 右侧面板
  const [panelPath, setPanelPathValue] = useState(null)
  const [panelTitle, setPanelTitle] = useState('')

  // 选中/高亮/树聚焦
  const [selectedPath, setSelectedPath] = useState(null)
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

  // Existing add/paste/parameter operations explicitly set these paths.
  // Hover uses its own handler so it can never replace a committed selection.
  const setPanelPath = useCallback((path) => {
    setPanelPathValue(path)
    if (path) { setSelectedPath(path); setHoverPath(path) }
  }, [])
  const setHighlightPath = useCallback((path) => {
    setSelectedPath(path ?? null)
    setHoverPath(path ?? null)
  }, [])

  // 树节点点开右侧面板
  const handleOpenPanel = useCallback(({ path, title }) => {
    setPanelPath(path)
    setPanelTitle(title || 'Parameters')
    setSelectedPath(path)
    setHighlightPath(path)
    requestTreeFocus(path)
  }, [setPanelPath, setHighlightPath, requestTreeFocus])

  // 根据 liveScene/面板路径，同步标题
  useEffect(() => {
    if (!panelPath || !liveScene) return
    const n = getNodeAtPath(liveScene, panelPath)
    if (n) setPanelTitle(n.name || 'Parameters')
  }, [liveScene, panelPath])

  // Hover previews are transient; selected parts keep priority during navigation.
  const handleSceneHoverPath = useCallback((p) => {
    setHoverPath(p ?? null)
  }, [])

  const deselectAll = useCallback(() => {
    setSelectedPath(null)
    setHoverPath(null)
    setPanelPathValue(null)
    setPanelTitle('')
    requestTreeFocus(null)
  }, [requestTreeFocus])

  // ✅ 空白点击支持：p 可能是 null
  const handleSceneClickPath = useCallback((p) => {
    if (!p) { deselectAll(); return }
    const n = liveScene ? getNodeAtPath(liveScene, p) : null
    if (liveScene && !n) return
    requestTreeFocus(p)
    setSelectedPath(p)
    setHighlightPath(p)
    if (n) { setPanelPath(p); setPanelTitle(n.name || 'Parameters') }
  }, [liveScene, deselectAll, requestTreeFocus, setPanelPath, setHighlightPath])

  // 仅关闭面板（保留选中/高亮）
  const clearPanel = useCallback(() => {
    setPanelPathValue(null)
    setPanelTitle('')
  }, [])

  return {
    // 状态
    panelPath, setPanelPath,
    panelTitle, setPanelTitle,
    highlightPath: panelPath ?? selectedPath ?? hoverPath, setHighlightPath,
    selectedPath, setSelectedPath,
    treeFocusPath, setTreeFocusPath: requestTreeFocus, treeFocusRequestId, acknowledgeTreeFocus,

    // 事件/操作
    handleOpenPanel,
    handleSceneHoverPath,
    handleSceneClickPath,
    clearPanel,
    deselectAll,        // ✅ 暴露
  }
}
