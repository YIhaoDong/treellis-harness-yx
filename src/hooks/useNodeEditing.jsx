// src/hooks/useNodeEditing.jsx
import { useCallback } from 'react'
import { deepClone, getNodeAtPath } from '../utils/tree'
import { normalizeHex, applyColorToDescendants } from '../utils/color'
import useClipboard from './useClipboard'
import { pasteSubtreeAsUnion } from '../utils/sceneOps'

/**
 * 统一管理节点编辑逻辑：
 * - renameNodeAtPath(path, name)
 * - updateNodeColor(path, hex, scope='auto'|'single'|'subtree')
 * - applyUpdatedNodeAtPath(path, updatedNode, meta)
 * - copyNode(path)
 * - pasteAsUnion(targetPath)
 *
 * ✅ Step 2: support injected clipboard (App-level single source of truth)
 */
export default function useNodeEditing({
  liveScene,
  setLiveScene,
  recordGeneration,
  beginEdit,
  endEdit,
  setPanelPath,
  setPanelTitle,
  editDirtyRef,
  editTagRef,

  // ✅ NEW: optional injected clipboard from App
  clipboard = null,
}) {
  // Clipboard: use injected if provided; otherwise fallback to internal one (backward compatible)
  const internalClipboard = useClipboard()
  const cb = clipboard || internalClipboard
  const { hasClipboard, getClipboard, setClipboard } = cb

  // Rename
  const renameNodeAtPath = useCallback((path, nextNameRaw) => {
    if (!liveScene || path == null) return
    const nextName = String(nextNameRaw ?? '').trim()

    beginEdit()

    const parts = String(path).split('.').slice(1).map(n => parseInt(n, 10))
    const cloned = deepClone(liveScene)

    let cur = cloned
    for (const i of parts) cur = cur.children[i]

    const safe = nextName.length ? nextName : (cur.name || 'Untitled')
    cur.name = safe

    setLiveScene(cloned)
    setPanelTitle?.(safe)

    if (editDirtyRef) editDirtyRef.current = true
    if (editTagRef) editTagRef.current = 'rename'
  }, [liveScene, beginEdit, setLiveScene, setPanelTitle, editDirtyRef, editTagRef])

  // Color update
  const updateNodeColor = useCallback((path, hex, scope = 'auto') => {
    const norm = normalizeHex(hex)
    if (!liveScene || path == null || !norm) return

    beginEdit()

    const parts = String(path).split('.').slice(1).map(n => parseInt(n, 10))
    const cloned = deepClone(liveScene)

    let cur = cloned
    for (const i of parts) cur = cur.children[i]

    const isPrim = !!cur?.primitive && !cur?.operation

    if (scope === 'single' || (scope === 'auto' && isPrim)) {
      cur.primitive = { ...(cur.primitive || {}) }
      cur.primitive.material = { ...(cur.primitive.material || {}) }
      cur.primitive.material.color = norm
    } else {
      applyColorToDescendants(cur, norm)
    }

    setLiveScene(cloned)

    if (editDirtyRef) editDirtyRef.current = true
    if (editTagRef) editTagRef.current = 'color'
  }, [liveScene, beginEdit, setLiveScene, editDirtyRef, editTagRef])

  // Apply updated node from NodePromptModal
  const applyUpdatedNodeAtPath = useCallback((path, updatedNode, meta = null) => {
    if (!liveScene || !updatedNode || path == null) return
    const parts = String(path).split('.').slice(1).map(n => parseInt(n, 10))
    const nextScene = parts.length === 0 ? updatedNode : deepClone(liveScene)
    if (parts.length) {
      let parent = nextScene
      for (let i = 0; i < parts.length - 1; i++) parent = parent.children[parts[i]]
      const idx = parts[parts.length - 1]

      if (!Array.isArray(parent.children) || parent.children[idx] == null) {
        alert('Target path not found.')
        return
      }

      parent.children.splice(idx, 1, updatedNode)
    }
    recordGeneration(nextScene, 'node-prompt', meta || {})
    setLiveScene(nextScene)

    setPanelPath?.(path)
    setPanelTitle?.(updatedNode?.name || 'Parameters')
  }, [liveScene, recordGeneration, setLiveScene, setPanelPath, setPanelTitle])

  // Copy subtree to clipboard (no history)
  const copyNode = useCallback((path) => {
    if (!liveScene || path == null) return
    const n = getNodeAtPath(liveScene, path)
    if (!n) return
    setClipboard(n, path)
  }, [liveScene, setClipboard])

  // Paste as Union at target path
  const pasteAsUnion = useCallback((targetPath) => {
    if (!liveScene || targetPath == null) return
    const clip = getClipboard()
    if (!clip || !clip.subtree) {
      alert('Clipboard is empty.')
      return
    }

    beginEdit()

    const { nextScene, newUnionPath, error } =
      pasteSubtreeAsUnion(liveScene, targetPath, clip.subtree, { sourcePath: clip.sourcePath })

    if (error === 'PASTE_INTO_DESCENDANT') {
      endEdit?.()
      alert('Cannot paste a node into one of its own descendants.')
      return
    }
    if (error) {
      endEdit?.()
      alert('Paste failed: ' + error)
      return
    }

    setLiveScene(nextScene)

    if (editDirtyRef) editDirtyRef.current = true
    if (editTagRef) editTagRef.current = 'paste-as-union'

    endEdit?.('paste-as-union', {
      sourcePath: clip.sourcePath || null,
      targetPath,
      newUnionPath: newUnionPath || targetPath,
    })

    const finalPath = newUnionPath || targetPath
    setPanelPath?.(finalPath)
    setPanelTitle?.('Union')
  }, [liveScene, beginEdit, endEdit, getClipboard, setLiveScene, editDirtyRef, editTagRef, setPanelPath, setPanelTitle])

  return {
    hasClipboard,
    copyNode,
    pasteAsUnion,

    renameNodeAtPath,
    updateNodeColor,
    applyUpdatedNodeAtPath,
  }
}
