// src/utils/tree.jsx

export function getNodeAtPath(root, path) {
  const parts = String(path).split('.').slice(1).map((s) => parseInt(s, 10))
  let node = root
  for (const idx of parts) {
    if (!node?.children || !node.children[idx]) return null
    node = node.children[idx]
  }
  return node
}

export function isPrimitiveNode(n) {
  return !!n?.primitive && typeof n.primitive === 'object'
}

export function getParentPath(path) {
  const s = String(path)
  if (!s || s === '0') return null
  const i = s.lastIndexOf('.')
  return i === -1 ? null : s.slice(0, i)
}

export function isRoot(path) { return String(path) === '0' }

export function isAncestor(ancestorPath, descendantPath) {
  const a = String(ancestorPath || '')
  const d = String(descendantPath || '')
  if (!a || !d) return false
  return a === d || d.startsWith(a + '.')
}

/** 用 newNode 替换 path 处的节点，返回新 scene（不可变） */
export function replaceNodeAtPath(root, path, newNode) {
  const parts = String(path).split('.').slice(1).map(n => parseInt(n, 10))
  if (parts.length === 0) return deepClone(newNode)
  const cloned = deepClone(root)
  let parent = cloned
  for (let i = 0; i < parts.length - 1; i++) parent = parent.children[parts[i]]
  const idx = parts[parts.length - 1]
  parent.children.splice(idx, 1, newNode)
  return cloned
}

export function buildSliderSpecs(node) {
  const specs = []
  const tf = node.transform || {}
  const t = Array.isArray(tf.t) ? tf.t : [0, 0, 0]
  const r = Array.isArray(tf.r) ? tf.r : [0, 0, 0]
  const s = Array.isArray(tf.s) ? tf.s : [1, 1, 1]

  const addVec3 = (baseKey, arr, min, max, step, pretty) => {
    for (let i = 0; i < 3; i++) {
      specs.push({
        label: `${pretty}[${'xyz'[i]}]`,
        path: ['transform', baseKey, i],
        value: Number(arr[i] ?? (baseKey === 's' ? 1 : 0)),
        min, max, step, integer: false
      })
    }
  }

  // 默认范围，之后会在面板层按每个节点/轴覆盖
  addVec3('t', t, -10, 10, 0.1, 'Translate')
  addVec3('r', r, -180, 180, 1, 'Rotate°')
  addVec3('s', s, 0.05, 5, 0.01, 'Scale')

  if (isPrimitiveNode(node)) {
    const p = node.primitive
    for (const key of Object.keys(p)) {
      if (key === 'type') continue
      const val = p[key]
      if (typeof val === 'number' && Number.isFinite(val)) {
        const lowerKey = String(key).toLowerCase()
        let min = 0, max = 10, step = 0.1, integer = false
        if (lowerKey.includes('segment')) { min = 3; max = 128; step = 1; integer = true }
        else if (lowerKey === 't') { min = 0; max = 2; step = 0.01 }
        else if (lowerKey === 'r') { min = 0; max = 10; step = 0.05 }
        else if (['w','h','d'].includes(lowerKey)) { min = 0; max = 10; step = 0.05 }
        else if (key === 'R') { min = 0; max = 10; step = 0.05 }
        specs.push({ label: key, path: ['primitive', key], value: Number(val), min, max, step, integer })
      }
    }
  }
  return specs
}

export const deepClone = (o) => JSON.parse(JSON.stringify(o))
