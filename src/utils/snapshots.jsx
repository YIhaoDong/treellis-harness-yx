// src/utils/snapshots.js
import { deepClone } from './tree'

/**
 * 构建一条快照记录（不含 id，由调用方决定如何生成 id）
 * - 复制 scene（deepClone）
 * - 计算 sizeBytes（以 {scene} 打包后的 JSON 大小为准）
 */
export function buildSnapshot(scene, tag = 'edit', meta = {}) {
  if (!scene) throw new Error('buildSnapshot: scene required')
  const ts = Date.now()
  const iso = new Date(ts).toISOString()

  // 以 { scene } 作为保存/导出载体来估算体积
  const wrapped = { scene }
  let sizeBytes = 0
  try {
    sizeBytes = new Blob([JSON.stringify(wrapped)]).size
  } catch {
    // 兜底：Node 环境或极端情况下，用字符串长度近似
    sizeBytes = JSON.stringify(wrapped).length
  }

  return {
    ts,
    iso,
    tag,
    sizeBytes,
    meta,
    scene: deepClone(scene),
  }
}

/** 把快照数组转成规范的 JSON 文本（带头信息） */
export function toJSONText(snapshots) {
  const payload = {
    format: 'livescene-snapshots',
    version: 1,
    exportedAt: new Date().toISOString(),
    count: Array.isArray(snapshots) ? snapshots.length : 0,
    snapshots: (snapshots || []).map(({ ts, iso, tag, sizeBytes, meta, scene }) => ({
      ts,
      iso,
      tag,
      sizeBytes,
      meta: meta || null,
      scene,
    })),
  }
  return JSON.stringify(payload, null, 2)
}

/** 把快照数组转为 JSONL（每行一个对象） */
export function toJSONLText(snapshots) {
  const lines = (snapshots || []).map(({ ts, iso, tag, sizeBytes, meta, scene }) =>
    JSON.stringify({ ts, iso, tag, sizeBytes, meta: meta || null, scene })
  )
  return lines.join('\n')
}

/** 触发浏览器下载纯文本（JSON/JSONL 等） */
export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
