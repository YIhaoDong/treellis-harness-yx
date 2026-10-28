// hooks/useNodeDeletion.jsx
import { useCallback } from 'react'
import { deepClone } from '../utils/tree'

/**
 * 统一处理节点删除：
 * - 可撤销（beginEdit/endEdit）
 * - 同步 UI（关闭当前面板 / 清空高亮）
 * - 标记快照标签
 */
export default function useNodeDeletion({
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
}) {
  const deleteNodeAtPath = useCallback((path) => {
    if (!liveScene) return
    const parts = String(path).split('.').slice(1).map(n => parseInt(n, 10))
    if (parts.length === 0) { alert('Root node cannot be deleted.'); return }

    // 校验路径
    let parent = liveScene
    for (let i = 0; i < parts.length - 1; i++) {
      const idx = parts[i]
      if (!parent?.children || !parent.children[idx]) { alert('Path not found.'); return }
      parent = parent.children[idx]
    }
    const delIdx = parts[parts.length - 1]
    if (!Array.isArray(parent.children) || parent.children[delIdx] == null) { alert('Path not found.'); return }

    // 执行删除（可撤销）
    beginEdit()
    const cloned = deepClone(liveScene)
    let p2 = cloned
    for (let i = 0; i < parts.length - 1; i++) p2 = p2.children[parts[i]]
    p2.children.splice(delIdx, 1)
    setLiveScene(cloned)

    // 如果右侧面板正在看被删节点/其后代，则关闭
    if (panelPath && String(panelPath).startsWith(String(path))) {
      setPanelPath(null)
      setPanelTitle('')
    }

    // 清理高亮并打标
    if (setHighlightPath) setHighlightPath(null)
    editDirtyRef.current = true
    editTagRef.current = 'delete'
    endEdit('delete')
  }, [
    liveScene, setLiveScene,
    panelPath, setPanelPath, setPanelTitle,
    setHighlightPath,
    beginEdit, endEdit,
    editDirtyRef, editTagRef,
  ])

  return { deleteNodeAtPath }
}
