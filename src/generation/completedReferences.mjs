// Server-constructed, bounded read-only references to earlier checked parts.
export const COMPLETED_REFERENCE_LIMITS = Object.freeze({ parts: 5, nodesPerPart: 64, nodesTotal: 128, charsPerPart: 10000, charsTotal: 24000, ancestorEntries: 32 })
const validPath = path => typeof path === 'string' && path.length <= 160 && path.split('.').length <= 32 && /^0(?:\.(?:0|[1-9]\d*))*$/.test(path)
const canonical = path => path.split('.').map(Number).join('.')
const within = (path, scope) => path === scope || path.startsWith(`${scope}.`)
const overlaps = (a, b) => within(a, b) || within(b, a)
const clone = value => JSON.parse(JSON.stringify(value))
function at(scene, path) { let node = scene; for (const index of path.split('.').slice(1)) node = node?.children?.[Number(index)]; return node }

// This is optional resume metadata, never a top-level referencePaths API.
export function validateCompletedPartPaths(value, { scene, scopePath, remainingPaths, completedPartsCount }) {
  if (value === undefined) return [] // Legacy resume: history remains explicitly unavailable.
  if (!Array.isArray(value) || value.length > COMPLETED_REFERENCE_LIMITS.parts || value.length > completedPartsCount) throw new Error('The completed part reference history is invalid.')
  const accepted = [], scope = canonical(scopePath), pending = remainingPaths.map(canonical)
  for (const path of value) {
    if (!validPath(path) || !within(path, scope) || !at(scene, path) || accepted.some(other => overlaps(path, other)) || pending.some(other => overlaps(path, other))) throw new Error('The completed part references must exist inside the scope and must not overlap each other or remaining tasks.')
    accepted.push(path)
  }
  return accepted
}

function nodesWithinBudget(node) {
  const stack = [node]
  let count = 0
  while (stack.length) {
    const current = stack.pop()
    if (++count > COMPLETED_REFERENCE_LIMITS.nodesPerPart) return count
    for (const child of current.children || []) {
      stack.push(child)
      if (count + stack.length > COMPLETED_REFERENCE_LIMITS.nodesPerPart) return COMPLETED_REFERENCE_LIMITS.nodesPerPart + 1
    }
  }
  return count
}
function ancestorChain(scene, path) {
  const parts = path.split('.'), ancestors = []
  for (let i = 1; i < parts.length; i++) {
    const parentPath = parts.slice(0, i).join('.'), node = at(scene, parentPath)
    ancestors.push({ path: parentPath, name: String(node.name || '').slice(0, 160), localTransform: clone(node.transform || { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }), ...(node.repeat ? { repeat: clone(node.repeat) } : {}) })
  }
  return ancestors
}

export function buildCompletedPartReferences(scene, { selectedPath, scopePath, completedPartPaths, completedPartsCount, sceneRevision }) {
  const limits = COMPLETED_REFERENCE_LIMITS
  if (!Array.isArray(completedPartPaths) || completedPartPaths.length > limits.parts) throw new Error('Too many completed part references.')
  const paths = [...completedPartPaths].reverse() // Most recent checked part first; no name-based routing.
  const context = {
    readOnly: true, editablePath: selectedPath, sourceSceneRevision: sceneRevision,
    completedPartsCount, knownCompletedPaths: completedPartPaths.length,
    unavailableHistoryParts: Math.max(0, completedPartsCount - completedPartPaths.length),
    historyStatus: completedPartsCount > completedPartPaths.length ? 'completed-history-unavailable-for-some-parts' : 'complete',
    usage: 'Earlier checked parts are references only. Do not edit them or copy their identities. Use them for matching only when the original instruction or shared constraints request it; their presence does not impose symmetry. Subtree transforms are parent-local; ancestorChain is root-to-parent. Repeat templates/count/TRS are unexpanded, including repeats in the ancestor chain; no sampled matrix is claimed to cover every instance.',
    limits: { ...limits }, parts: [],
    omitted: paths.map(path => ({ path, reason: 'reference-not-included-before-budget-evaluation-is-complete' })),
  }
  let totalNodes = 0
  for (const path of paths) {
    const omit = reason => { context.omitted.find(item => item.path === path).reason = reason }
    if (!validPath(path) || !within(path, canonical(scopePath)) || overlaps(path, canonical(selectedPath))) { omit('outside-or-overlapping-editable-scope'); continue }
    const node = at(scene, path)
    if (!node) { omit('reference-node-unavailable'); continue }
    const nodes = nodesWithinBudget(node)
    if (nodes > limits.nodesPerPart || totalNodes + nodes > limits.nodesTotal) { omit('reference-node-budget-exceeded'); continue }
    const chain = ancestorChain(scene, path)
    if (chain.length > limits.ancestorEntries) { omit('ancestor-chain-budget-exceeded'); continue }
    const nodeJSON = JSON.stringify(node)
    if (nodeJSON.length > limits.charsPerPart) { omit('reference-character-budget-exceeded'); continue }
    const item = { readOnly: true, path, name: String(node.name || '').slice(0, 160), sourceSceneRevision: sceneRevision, ancestorChain: chain, node: JSON.parse(nodeJSON) }
    if (JSON.stringify(item).length > limits.charsPerPart) { omit('reference-character-budget-exceeded'); continue }
    const candidate = { ...context, parts: [...context.parts, item], omitted: context.omitted.filter(entry => entry.path !== path) }
    if (JSON.stringify(candidate).length > limits.charsTotal) { omit('total-reference-character-budget-exceeded'); continue }
    context.parts.push(item); context.omitted = candidate.omitted; totalNodes += nodes
  }
  return context
}
