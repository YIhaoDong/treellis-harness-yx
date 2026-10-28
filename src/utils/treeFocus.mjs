const TREE_PATH = /^0(?:\.(?:0|[1-9]\d*))*$/

export function treeAncestorPaths(path) {
  if (typeof path !== 'string' || !TREE_PATH.test(path)) return []
  const parts = path.split('.')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('.'))
}

export function expandTreeAncestors(collapsedPaths, path) {
  const ancestors = treeAncestorPaths(path)
  if (!ancestors.some(ancestor => collapsedPaths.has(ancestor))) return collapsedPaths
  const next = new Set(collapsedPaths)
  ancestors.forEach(ancestor => next.delete(ancestor))
  return next
}

// react-d3-tree ignores a user-supplied `collapsed` flag. Keep the complete
// source tree intact and project only the currently expanded descendants.
export function visibleTreeData(node, collapsedPaths) {
  const { children, ...visible } = node
  if (children?.length && !collapsedPaths.has(node._path)) {
    visible.children = children.map(child => visibleTreeData(child, collapsedPaths))
  }
  return visible
}

export function sameTreeViewport(a, b, tolerance = 0.001) {
  return Math.abs(a.zoom - b.zoom) < tolerance &&
    Math.abs(a.translate.x - b.translate.x) < tolerance &&
    Math.abs(a.translate.y - b.translate.y) < tolerance
}

// Keep React and D3 on the same transform throughout the pan. Cancelling leaves
// the last displayed frame in place, so a newer focus or manual drag can take over.
export function animateTreeViewport(from, to, {
  onUpdate,
  onComplete,
  duration = 300,
  reducedMotion = false,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  now = () => performance.now(),
} = {}) {
  let active = true
  let frame = null
  const startedAt = now()
  const tick = () => {
    if (!active) return
    const progress = reducedMotion || duration <= 0 || sameTreeViewport(from, to)
      ? 1 : Math.max(0, Math.min(1, (now() - startedAt) / duration))
    const eased = 1 - (1 - progress) ** 3
    onUpdate(progress === 1 ? to : {
      zoom: from.zoom,
      translate: {
        x: from.translate.x + (to.translate.x - from.translate.x) * eased,
        y: from.translate.y + (to.translate.y - from.translate.y) * eased,
      },
    })
    if (!active) return
    if (progress === 1) { active = false; onComplete?.() }
    else frame = requestFrame(tick)
  }
  frame = requestFrame(tick)
  return () => {
    active = false
    if (frame != null) cancelFrame(frame)
  }
}

// D3 applies translate(tx, ty) scale(k): translation is in SVG viewport units,
// not scaled node units. Only an outer CSS/SVG scale changes CSS-pixel deltas.
export function centerTreeViewport(viewport, nodeRect, visibleRect, screenScale = { x: 1, y: 1 }) {
  const values = [viewport.zoom, viewport.translate.x, viewport.translate.y,
    nodeRect.left, nodeRect.top, nodeRect.width, nodeRect.height,
    visibleRect.left, visibleRect.top, visibleRect.width, visibleRect.height,
    screenScale.x, screenScale.y]
  if (!values.every(Number.isFinite) || viewport.zoom <= 0 ||
    screenScale.x <= 0 || screenScale.y <= 0 || visibleRect.width <= 0 || visibleRect.height <= 0) return null
  return {
    zoom: viewport.zoom,
    translate: {
      x: viewport.translate.x + (visibleRect.left + visibleRect.width / 2 - nodeRect.left - nodeRect.width / 2) / screenScale.x,
      y: viewport.translate.y + (visibleRect.top + visibleRect.height / 2 - nodeRect.top - nodeRect.height / 2) / screenScale.y,
    },
  }
}
