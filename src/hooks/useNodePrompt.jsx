// hooks/useNodePrompt.js
import { useCallback, useMemo, useRef, useState } from 'react'
import { getNodeAtPath } from '../utils/tree'

/**
 * useNodePrompt
 * - 统一托管节点级 Prompt 弹窗的 open/path 状态
 * - 自动把 NodePromptModal 需要的 props 组装好
 * - 应用每个已验证步骤，最终完成时由弹窗自身关闭
 */
export default function useNodePrompt({ liveScene, applyUpdatedNodeAtPath, onScopeChange }) {
  const [state, setState] = useState({ open: false, path: null, session: 0 })
  const pathRef = useRef(null)
  const sessionRef = useRef(0)

  const openNodePrompt = useCallback((path) => {
    if (!path) return
    pathRef.current = path
    setState({ open: true, path, session: ++sessionRef.current })
  }, [])

  const closeNodePrompt = useCallback(() => {
    pathRef.current = null
    setState({ open: false, path: null, session: ++sessionRef.current })
  }, [])

  const node = useMemo(() => {
    const p = state.path
    if (!p || !liveScene) return null
    return getNodeAtPath(liveScene, p)
  }, [liveScene, state.path])

  const handleApply = useCallback((updatedNode, meta, targetPath = state.path ?? pathRef.current) => {
    if (!state.open || state.session !== sessionRef.current || pathRef.current !== state.path) return
    const originalPath = state.path ?? pathRef.current
    const p = targetPath
    if (typeof p !== 'string' || !/^0(?:\.(?:0|[1-9]\d*))*$/.test(p) ||
      !originalPath || !(p === originalPath || originalPath.startsWith(`${p}.`)) || !getNodeAtPath(liveScene, p)) return
    if (!p || !updatedNode) { closeNodePrompt(); return }
    applyUpdatedNodeAtPath(p, updatedNode, meta)
  }, [applyUpdatedNodeAtPath, state.path, state.open, state.session, liveScene, closeNodePrompt])

  const nodePromptModalProps = {
    open: state.open,
    path: state.path,
    node,
    scene: liveScene,
    onClose: closeNodePrompt,
    onApply: handleApply,
    onScopeChange,
  }

  return {
    nodePrompt: state,
    openNodePrompt,
    closeNodePrompt,
    nodePromptModalProps,
  }
}
