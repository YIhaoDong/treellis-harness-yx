// C:\Users\eeshi\Desktop\TTCS_Local_LLM_Overwrite - 副本\src\utils\color.js

export const DEFAULT_COLOR = '#f1f5f9'

export function normalizeHex(hex) {
  let h = String(hex || '').trim()
  if (!h) return null
  if (h[0] === '#') h = h.slice(1)
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length !== 6) return null
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return '#' + h.toUpperCase()
}

export function isValidHexInput(hex) {
  return !!normalizeHex(hex)
}

export function getPrimitiveColor(node) {
  const c = node?.primitive?.material?.color
  return normalizeHex(c) || DEFAULT_COLOR
}

export function collectDescendantPrimitiveColors(node) {
  const set = new Set()
  const walk = (n) => {
    if (!n) return
    if (n.primitive) {
      const c = normalizeHex(n.primitive?.material?.color || DEFAULT_COLOR)
      if (c) set.add(c)
    }
    const arr = Array.isArray(n.children) ? n.children : []
    for (const ch of arr) walk(ch)
  }
  walk(node)
  return set
}

export function applyColorToDescendants(node, hex) {
  if (!node) return
  if (node.primitive) {
    node.primitive = { ...node.primitive }
    node.primitive.material = { ...(node.primitive.material || {}) }
    node.primitive.material.color = hex
  }
  const arr = Array.isArray(node.children) ? node.children : []
  for (let i = 0; i < arr.length; i++) applyColorToDescendants(arr[i], hex)
}
