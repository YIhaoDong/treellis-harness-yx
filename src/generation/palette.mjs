// Read-only color facts for planning/edit prompts; never copies scene geometry.
const HEX = /^#[0-9a-fA-F]{6}$/
const PATH = /^0(?:\.(?:0|[1-9]\d*))*$/
const MAX_COLORS = 16, MAX_SOURCES = 3, MAX_SCAN = 4096, MAX_DEPTH = 32
const within = (path, scope) => path === scope || path.startsWith(`${scope}.`)

export function summarizeScenePalette(scene, selectedPath = '0') {
  const options = selectedPath && typeof selectedPath === 'object' ? selectedPath : { scopePath: selectedPath }
  const scopePath = PATH.test(options.scopePath || '') ? options.scopePath : '0'
  const preferred = (Array.isArray(options.preferredPaths) ? options.preferredPaths : []).filter(path => typeof path === 'string' && PATH.test(path)).slice(0, 32)
  const parentPath = scopePath.split('.').slice(0, -1).join('.')
  const groups = new Map(), seen = new WeakSet()
  let scanned = 0, sourceCount = 0, scanTruncated = false
  const priority = path => {
    const index = preferred.findIndex(scope => within(path, scope))
    return index >= 0 ? index : within(path, parentPath || '0') ? 32 : 33
  }
  function visit(node, path, depth) {
    if (++scanned > MAX_SCAN || depth > MAX_DEPTH) { scanTruncated = true; return }
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    const raw = node.primitive?.material?.color
    if (typeof raw === 'string' && HEX.test(raw)) {
      const color = raw.toUpperCase(), inside = within(path, scopePath)
      const group = groups.get(color) || { color, inside: [], outside: [], index: groups.size, outsidePriority: Infinity }
      const sources = inside ? group.inside : group.outside
      const source = { path, name: String(typeof node.name === 'string' ? node.name : typeof node.label === 'string' ? node.label : '').slice(0, 80), priority: priority(path) }
      sources.push(source)
      sources.sort((a, b) => a.priority - b.priority)
      if (sources.length > MAX_SOURCES) sources.length = MAX_SOURCES
      if (!inside) group.outsidePriority = Math.min(group.outsidePriority, source.priority)
      groups.set(color, group); sourceCount++
    }
    if (Array.isArray(node.children)) for (let i = 0; i < node.children.length; i++) {
      if (scanned >= MAX_SCAN) { scanTruncated = true; break }
      visit(node.children[i], `${path}.${i}`, depth + 1)
    }
  }
  visit(scene?.scene || scene, '0', 0)
  const all = [...groups.values()], selected = new Map()
  const add = group => { if (selected.size < MAX_COLORS) selected.set(group.color, group) }
  // Keep outside references available even when a detailed selection has many colors.
  all.filter(group => group.inside.length).slice(0, 6).forEach(add)
  all.filter(group => group.outside.length).sort((a, b) => a.outsidePriority - b.outsidePriority || a.index - b.index).slice(0, 10).forEach(add)
  all.forEach(add)
  const colors = [...selected.values()].map(group => {
    const sources = group.inside.length && group.outside.length ? [group.inside[0], ...group.outside.slice(0, 2)] : [...group.inside, ...group.outside].slice(0, MAX_SOURCES)
    return { color: group.color, sources: sources.map(({ path, name }) => ({ path, name })) }
  })
  return { readOnly: true, colors, omittedColors: groups.size - colors.length, omittedSources: sourceCount - colors.reduce((total, item) => total + item.sources.length, 0), scanTruncated }
}
