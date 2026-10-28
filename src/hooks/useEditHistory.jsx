// src/hooks/useEditHistory.jsx
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { deepClone } from '../utils/tree'
import { buildSnapshot, toJSONText, toJSONLText, downloadText } from '../utils/snapshots'

/**
 * 统一管理：
 * - 一次编辑的生命周期：beginEdit / endEdit（带 tag/meta）
 * - 历史堆栈：undo / redo（内部自动记快照）
 * - 快照列表：pushSnapshot / 导出 / 清空
 * - 兼容 App 里现有写法：暴露 editingRef / editDirtyRef / editTagRef
 */
export default function useEditHistory({ liveScene, setLiveScene }) {
  const sceneRef = useRef(liveScene)
  useLayoutEffect(() => { sceneRef.current = liveScene }, [liveScene])
  // 历史堆栈
  const historyRef = useRef({ past: [], future: [] })
  const editingRef = useRef(false)

  // 与现有调用兼容：调用处会设置这俩标记
  const editDirtyRef = useRef(false)
  const editTagRef = useRef(null)

  // 快照
  const snapshotsRef = useRef([])

  // 本 Hook 内部用于触发重渲染（App 不需要拿这个值）
  const [historyTick, setHistoryTick] = useState(0)
  const [snapshotsTick, setSnapshotsTick] = useState(0)

  // ---- 快照工具 ----
  const pushSnapshotForScene = useCallback((scene, tag = 'edit', meta = {}) => {
    try {
      if (!scene) return
      const core = buildSnapshot(scene, tag, meta)
      const id = `${core.ts}-${(snapshotsRef.current.length + 1)}`
      snapshotsRef.current.push({ id, ...core })
      setSnapshotsTick(t => t + 1)
    } catch (e) {
      console.warn('pushSnapshot failed:', e)
    }
  }, [])

  const pushSnapshot = useCallback((tag = 'edit', meta = {}) => {
    if (!liveScene) return
    pushSnapshotForScene(liveScene, tag, meta)
  }, [liveScene, pushSnapshotForScene])

  const downloadSnapshotsAsJSON = useCallback(() => {
    const text = toJSONText(snapshotsRef.current)
    downloadText(`livescene_snapshots_${Date.now()}.json`, text, 'application/json')
  }, [])
  const downloadSnapshotsAsJSONL = useCallback(() => {
    const text = toJSONLText(snapshotsRef.current)
    downloadText(`livescene_snapshots_${Date.now()}.jsonl`, text, 'application/x-ndjson')
  }, [])
  const clearSnapshots = useCallback(() => {
    snapshotsRef.current = []
    setSnapshotsTick(t => t + 1)
  }, [])

  // ---- 编辑生命周期 ----
  const beginEdit = useCallback(() => {
    if (!liveScene) return
    if (!editingRef.current) {
      historyRef.current.past.push(deepClone(liveScene))
      historyRef.current.future = []
      editingRef.current = true
      editDirtyRef.current = false
      editTagRef.current = null
      setHistoryTick(t => t + 1)
    }
  }, [liveScene])

  const endEdit = useCallback((tagOverride = null, meta = null) => {
    if (editingRef.current) {
      if (editDirtyRef.current) {
        const tag = tagOverride || editTagRef.current || 'edit'
        pushSnapshot(tag, meta || {})
      }
      editingRef.current = false
      editDirtyRef.current = false
      editTagRef.current = null
      setHistoryTick(t => t + 1)
    }
  }, [pushSnapshot])

  // A completed generation is one undoable action; snapshot its returned scene.
  const recordGeneration = useCallback((nextScene, tag = 'prompt', meta = {}) => {
    if (!nextScene) return
    if (sceneRef.current) historyRef.current.past.push(deepClone(sceneRef.current))
    sceneRef.current = nextScene
    historyRef.current.future = []
    editingRef.current = false
    editDirtyRef.current = false
    editTagRef.current = null
    pushSnapshotForScene(nextScene, tag, meta)
    setHistoryTick(t => t + 1)
  }, [pushSnapshotForScene])

  // ---- 撤销 / 重做 ----
  const undo = useCallback(() => {
    const { past, future } = historyRef.current
    if (!past.length || !sceneRef.current) return
    const prev = past.pop()
    future.push(deepClone(sceneRef.current))
    sceneRef.current = prev
    setLiveScene(prev)
    editingRef.current = false
    setHistoryTick(t => t + 1)
    // 记录撤销后的状态快照
    pushSnapshotForScene(prev, 'undo')
  }, [liveScene, setLiveScene, pushSnapshotForScene])

  const redo = useCallback(() => {
    const { past, future } = historyRef.current
    if (!future.length || !sceneRef.current) return
    const next = future.pop()
    past.push(deepClone(sceneRef.current))
    sceneRef.current = next
    setLiveScene(next)
    editingRef.current = false
    setHistoryTick(t => t + 1)
    // 记录重做后的状态快照
    pushSnapshotForScene(next, 'redo')
  }, [liveScene, setLiveScene, pushSnapshotForScene])

  // 外部场景整体替换时（从树或上传进入），重置历史编辑状态
  const resetHistory = useCallback(() => {
    historyRef.current = { past: [], future: [] }
    editingRef.current = false
    setHistoryTick(t => t + 1)
  }, [])

  // 派生状态
  const canUndo = historyRef.current.past.length > 0
  const canRedo = historyRef.current.future.length > 0

  return {
    // 生命周期 & 历史
    beginEdit,
    endEdit,
    recordGeneration,
    undo,
    redo,
    resetHistory,
    canUndo,
    canRedo,
    editingRef,     // 供外部逻辑（如轮询）判断是否正在编辑
    // 与旧写法兼容的标记
    editDirtyRef,
    editTagRef,
    // 快照
    pushSnapshot,
    snapshotsRef,
    downloadSnapshotsAsJSON,
    downloadSnapshotsAsJSONL,
    clearSnapshots,
  }
}
