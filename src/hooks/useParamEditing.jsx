// src/hooks/useParamEditing.jsx
import { useCallback } from 'react'
import { deepClone } from '../utils/tree'

/**
 * 负责参数滑块数值更新（transform / primitive / repeat），并与编辑历史打通
 *
 * spec.path examples:
 * - ['transform','t',0]   translate x
 * - ['transform','r',2]   rotate z
 * - ['transform','s',1]   scale y
 * - ['primitive','r']     cylinder radius
 * - ['repeat','count']    repeat count
 * - ['repeat','t',0]      repeat delta translate x
 * - ['repeat','r',2]      repeat delta rotate z
 * - ['repeat','s',1]      repeat end scale y
 * - ['repeat','radius']   circular radius
 * - ['repeat','angle']    optional sweep angle (if you later support)
 */
export default function useParamEditing({
  liveScene,
  setLiveScene,
  panelPath,
  panelSpecs,
  beginEdit,
  editDirtyRef,
  editTagRef,
}) {
  const updateSpecValue = useCallback((idx, nextVal) => {
    if (!liveScene || panelPath == null || !panelSpecs || !panelSpecs[idx]) return
    const spec = panelSpecs[idx]

    // enum 不应走这里（你已移除 Repeat Type；这里也兜底）
    if (spec.kind === 'enum') return

    const v = spec.integer ? Math.round(nextVal) : nextVal

    // 开始一次可撤销的编辑
    beginEdit()

    // 找到当前选中节点
    const parts = String(panelPath).split('.').slice(1).map(n => parseInt(n, 10))
    const cloned = deepClone(liveScene)
    let cur = cloned
    for (const i of parts) cur = cur.children[i]

    // 写回值
    const p0 = spec.path?.[0]

    if (p0 === 'transform') {
      cur.transform = cur.transform ? { ...cur.transform } : {}
      const kind = spec.path[1] // 't' | 'r' | 's'
      const axis = spec.path[2] // 0/1/2
      if (kind === 't' || kind === 'r' || kind === 's') {
        const defaults = kind === 's' ? [1, 1, 1] : [0, 0, 0]
        const arr = Array.isArray(cur.transform[kind]) ? cur.transform[kind].slice() : defaults.slice()
        arr[axis] = v
        cur.transform[kind] = arr
      }
    } else if (p0 === 'primitive') {
      cur.primitive = { ...cur.primitive, [spec.path[1]]: v }
    } else if (p0 === 'repeat') {
      // repeat write-back
      cur.repeat = (cur.repeat && typeof cur.repeat === 'object') ? { ...cur.repeat } : {}

      const k1 = spec.path[1]

      if (k1 === 'count') {
        // 兼容：如果你旧数据用 n，也一起同步一下
        cur.repeat.count = v
        if ('n' in cur.repeat) cur.repeat.n = v
      } else if (k1 === 't' || k1 === 'r' || k1 === 's') {
        const axis = spec.path[2]
        const defaults = (k1 === 's') ? [1, 1, 1] : [0, 0, 0]
        const arr = Array.isArray(cur.repeat[k1]) ? cur.repeat[k1].slice() : defaults.slice()
        arr[axis] = v
        cur.repeat[k1] = arr
      } else if (k1 === 'radius') {
        cur.repeat.radius = v
      } else if (k1 === 'angle') {
        cur.repeat.angle = v
      } else {
        // 兜底：直接写字段
        cur.repeat[k1] = v
      }
    }

    // 提交到状态，并标记历史快照信息
    setLiveScene(cloned)
    if (editDirtyRef) editDirtyRef.current = true
    if (editTagRef) editTagRef.current = 'param-change'
  }, [liveScene, panelPath, panelSpecs, beginEdit, setLiveScene, editDirtyRef, editTagRef])

  return { updateSpecValue }
}