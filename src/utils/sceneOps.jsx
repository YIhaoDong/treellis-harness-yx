// src/utils/sceneOps.jsx
// 纯函数：不触 UI；输入旧 scene，返回新 scene

import { deepClone, getNodeAtPath, isAncestor } from './tree'
import { makeUnionNode } from './factories'

/** 深拷贝选中子树（可用于独立 copy） */
export function copySubtree(scene, path) {
  if (!scene || path == null) return null
  const n = getNodeAtPath(scene, path)
  return n ? deepClone(n) : null
}

/**
 * 将 targetPath 处的节点用 Union 替换：
 *   Union.children = [ 原 target, copiedSubtree ]
 * @returns { nextScene, newUnionPath, error|null }
 */
export function pasteSubtreeAsUnion(scene, targetPath, copiedSubtree, opts = {}) {
  if (!scene || targetPath == null || !copiedSubtree) {
    return { nextScene: scene, newUnionPath: null, error: 'EMPTY_INPUT' }
  }

  const { sourcePath = null } = opts
  if (sourcePath && (String(targetPath) === String(sourcePath) || isAncestor(sourcePath, targetPath))) {
    return { nextScene: scene, newUnionPath: null, error: 'PASTE_INTO_DESCENDANT' }
  }

  const cloned = deepClone(scene)
  const parts = String(targetPath).split('.').slice(1).map(n => parseInt(n, 10))

  // 根节点特判
  if (parts.length === 0) {
    const originalClone = deepClone(cloned)
    const pastedClone = deepClone(copiedSubtree)
    const union = makeUnionNode([originalClone, pastedClone])
    return { nextScene: union, newUnionPath: '0', error: null }
  }

  // 普通路径
  let parent = cloned
  for (let i = 0; i < parts.length - 1; i++) parent = parent.children[parts[i]]
  const idx = parts[parts.length - 1]
  if (!Array.isArray(parent.children) || parent.children[idx] == null) {
    return { nextScene: scene, newUnionPath: null, error: 'TARGET_NOT_FOUND' }
  }

  const originalClone = deepClone(parent.children[idx])
  const pastedClone = deepClone(copiedSubtree)
  const union = makeUnionNode([originalClone, pastedClone])

  parent.children.splice(idx, 1, union)
  return { nextScene: cloned, newUnionPath: String(targetPath), error: null }
}
