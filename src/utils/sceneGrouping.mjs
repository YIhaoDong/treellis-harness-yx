import { Matrix4, Vector3, Quaternion, Euler, MathUtils } from 'three'
import { validateAML } from '../generation/amlContract.mjs'

export const GROUPING_LIMITS = Object.freeze({ maxGroups: 32, maxMembers: 128, maxTotalMembers: 256 })
export class GroupingError extends Error {
  constructor(message, code = 'INVALID_GROUPING') { super(message); this.name = 'GroupingError'; this.code = code }
}
const fail = (message, code) => { throw new GroupingError(message, code) }
const pathPattern = /^0(?:\.(?:0|[1-9]\d*))*$/
const inside = (path, scope) => path === scope || path.startsWith(`${scope}.`)
const clone = value => JSON.parse(JSON.stringify(value))
const parentOf = path => path === '0' ? null : path.slice(0, path.lastIndexOf('.'))
const isRepeat = node => Boolean(node?.repeat) || String(node?.kind || node?.nodeKind || '').toLowerCase() === 'repeat'
const ordinaryUnion = node => node?.operation === 'union' && !node.primitive && !isRepeat(node)
const matrix = (tf = {}) => new Matrix4().compose(new Vector3(...(tf.t || [0, 0, 0])),
  new Quaternion().setFromEuler(new Euler(...(tf.r || [0, 0, 0]).map(MathUtils.degToRad), 'XYZ')),
  new Vector3(...(tf.s || [1, 1, 1])))
function closeMatrix(a, b) {
  return a.elements.every((v, i) => Math.abs(v - b.elements[i]) <= 1e-9 * Math.max(1, Math.abs(v), Math.abs(b.elements[i])))
}
function assertScene(scene) {
  // Existing legacy metadata is accepted as baseline; preservation is checked
  // separately by original-node identity rather than unstable positional paths.
  const report = validateAML(scene, { baseline: scene })
  if (!report.ok) fail(`This scene cannot be regrouped: ${report.errors.join('; ')}`, 'INVALID_SCENE')
}
function walk(node, visit, path = '0', parent = new Matrix4()) {
  const world = parent.clone().multiply(matrix(node.transform))
  visit(node, path, world)
  for (let i = 0; i < (node.children || []).length; i++) walk(node.children[i], visit, `${path}.${i}`, world)
}
function indexScene(scene) {
  const nodes = new Map()
  walk(scene, (node, path, world) => nodes.set(path, { node, world }))
  return nodes
}
function nodeAt(nodes, path) {
  if (typeof path !== 'string' || path.length > 256 || !pathPattern.test(path)) fail('A selected node path is invalid.')
  const entry = nodes.get(path)
  if (!entry) fail(`The selected node ${path} no longer exists.`, 'STALE_SCENE')
  return entry.node
}
function safeParent(nodes, path) {
  const parent = nodeAt(nodes, path)
  if (!ordinaryUnion(parent)) fail('Only siblings inside an ordinary Union can be grouped.', 'UNSAFE_SCOPE')
  for (let p = path; p !== null; p = parentOf(p)) {
    const ancestor = nodeAt(nodes, p)
    if (isRepeat(ancestor) || ancestor.operation && ancestor.operation !== 'union') {
      fail('Grouping inside Boolean operands or Repeat templates is not supported.', 'UNSAFE_SCOPE')
    }
  }
  return parent
}
function checkedName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) fail('Use a group name of 1–160 characters.')
  return name.trim()
}
function selection(nodes, paths, scope = '0') {
  nodeAt(nodes, scope)
  if (!Array.isArray(paths) || paths.length < 2 || paths.length > GROUPING_LIMITS.maxMembers) fail('Select 2–128 sibling nodes to group.')
  if (new Set(paths).size !== paths.length) fail('A node may occur only once in a group.')
  paths.forEach(path => nodeAt(nodes, path))
  const parentPath = parentOf(paths[0])
  if (!parentPath || paths.some(path => parentOf(path) !== parentPath)) fail('Select nodes that share the same parent.', 'UNSAFE_SCOPE')
  if (!inside(parentPath, scope)) fail('The grouping plan targets nodes outside the selected scope.', 'UNSAFE_SCOPE')
  const parent = safeParent(nodes, parentPath)
  const ordered = [...paths].sort((a, b) => Number(a.slice(a.lastIndexOf('.') + 1)) - Number(b.slice(b.lastIndexOf('.') + 1)))
  return { parent, parentPath, paths: ordered, nodes: ordered.map(path => nodeAt(nodes, path)) }
}

/** Read-only eligibility check for toolbar controls. */
export function analyzeGroupingSelection(scene, paths) {
  try {
    // Toolbar eligibility only visits selected ancestor chains; mutation paths
    // perform the complete AML, identity and world-matrix validation below.
    if (!Array.isArray(paths) || !paths.length || paths.length > GROUPING_LIMITS.maxMembers || new Set(paths).size !== paths.length) fail('Select sibling nodes to group, or one Union to ungroup.')
    const nodes = new Map([['0', { node: scene }]])
    for (const path of paths) {
      if (typeof path !== 'string' || path.length > 256 || !pathPattern.test(path)) fail('A selected node path is invalid.')
      let node = scene, prefix = '0'
      for (const index of path.split('.').slice(1)) {
        node = node?.children?.[Number(index)]; prefix += `.${index}`
        if (!node) fail('A selected part no longer exists.', 'STALE_SCENE')
        nodes.set(prefix, { node })
      }
    }
    if (paths.length === 1) {
      const parentPath = parentOf(paths[0])
      if (!parentPath) fail('The scene root cannot be ungrouped.', 'UNSAFE_SCOPE')
      safeParent(nodes, parentPath)
      if (!ordinaryUnion(nodeAt(nodes, paths[0]))) fail('Select an ordinary Union to ungroup.')
      return { ok: true, canGroup: false, canUngroup: true, parentPath, paths }
    }
    const data = selection(nodes, paths)
    return { ok: true, canGroup: true, canUngroup: false, parentPath: data.parentPath, paths: data.paths }
  } catch (error) {
    return { ok: false, canGroup: false, canUngroup: false, error: error.message, message: error.message, code: error.code || 'INVALID_GROUPING' }
  }
}

function context(scene) {
  assertScene(scene)
  const root = clone(scene), originals = indexScene(scene), identities = new Map(), clonedNodes = indexScene(root)
  for (const [path, { node }] of clonedNodes) identities.set(node, path)
  return { scene, root, originals, identities, clonedNodes }
}
function finish(ctx, groups, selectedNodes, { removedPath = null, removedParent = null, changedTransforms = new Set() } = {}) {
  const pathMap = {}, finalNodes = new Map(), selectedPaths = []
  walk(ctx.root, (node, path, world) => {
    finalNodes.set(node, path)
    const oldPath = ctx.identities.get(node)
    if (oldPath !== undefined) {
      pathMap[oldPath] = path
      const original = ctx.originals.get(oldPath)
      const oldData = { ...original.node }, newData = { ...node }
      delete oldData.children; delete newData.children
      if (changedTransforms.has(node)) { delete oldData.transform; delete newData.transform }
      if (JSON.stringify(oldData) !== JSON.stringify(newData) || !closeMatrix(original.world, world)) fail('Regrouping would alter a part. The original scene was retained.', 'GEOMETRY_CHANGED')
    }
  })
  // Every original node survives once, except the deliberately removed wrapper.
  if (Object.keys(pathMap).length !== ctx.originals.size - (removedPath ? 1 : 0)) fail('The grouping result lost or duplicated a scene node.', 'GEOMETRY_CHANGED')
  if (removedPath) pathMap[removedPath] = finalNodes.get(removedParent)
  assertScene(ctx.root)
  for (const node of selectedNodes) selectedPaths.push(finalNodes.get(node))
  return { scene: ctx.root, pathMap, selectedPaths, groups: groups.map(({ wrapper, name, members }) => ({ name, members, path: finalNodes.get(wrapper) })), changed: true }
}

/** Plans reference only original scene paths. No generated geometry is accepted. */
export function applyGroupingPlan(scene, plan, scope = '0') {
  const ctx = context(scene)
  nodeAt(ctx.clonedNodes, scope)
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || !Array.isArray(plan.groups) || plan.groups.length > GROUPING_LIMITS.maxGroups) fail('A grouping plan must contain 0–32 groups.')
  if (Object.keys(plan).some(key => !['groups', 'message'].includes(key))) fail('A grouping plan may contain only groups and a message.')
  let totalMembers = 0
  const claimed = [], tasks = plan.groups.map(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group) || Object.keys(group).some(key => !['name', 'members'].includes(key))) fail('A group may contain only a name and existing member paths.')
    const name = checkedName(group.name), data = selection(ctx.clonedNodes, group.members, scope)
    totalMembers += data.paths.length
    if (totalMembers > GROUPING_LIMITS.maxTotalMembers) fail('The grouping plan exceeds the 256-member budget.')
    for (const path of data.paths) {
      if (claimed.some(other => inside(path, other) || inside(other, path))) fail('Grouping targets overlap. Each existing subtree may be grouped only once.')
      claimed.push(path)
    }
    return { ...data, name }
  })
  if (!tasks.length) {
    return { scene, pathMap: Object.fromEntries([...ctx.originals.keys()].map(path => [path, path])), selectedPaths: [], groups: [], changed: false }
  }
  const groups = []
  for (const task of tasks) {
    const selected = new Set(task.nodes), children = task.parent.children
    const first = children.findIndex(child => selected.has(child))
    const wrapper = { name: task.name, operation: 'union', transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, children: task.nodes }
    task.parent.children = children.flatMap((child, i) => i === first ? [wrapper] : selected.has(child) ? [] : [child])
    groups.push({ wrapper, name: task.name, members: task.paths })
  }
  return finish(ctx, groups, groups.map(group => group.wrapper))
}

export function groupSceneNodes(scene, paths, name = 'Group') {
  return applyGroupingPlan(scene, { groups: [{ name, members: paths }] })
}

/** Undo a Union wrapper while preserving world-space geometry exactly in TRS. */
export function ungroupSceneNode(scene, path) {
  const ctx = context(scene), group = nodeAt(ctx.clonedNodes, path), parentPath = parentOf(path)
  if (!parentPath) fail('The scene root cannot be ungrouped.', 'UNSAFE_SCOPE')
  const parent = safeParent(ctx.clonedNodes, parentPath)
  if (!ordinaryUnion(group)) fail('Only an ordinary Union can be ungrouped.', 'UNSAFE_SCOPE')
  const groupMatrix = matrix(group.transform), identity = closeMatrix(groupMatrix, new Matrix4())
  const changedTransforms = new Set()
  if (!identity) for (const child of group.children) {
    const target = groupMatrix.clone().multiply(matrix(child.transform))
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
    target.decompose(position, rotation, scale)
    const angles = new Euler().setFromQuaternion(rotation, 'XYZ')
    const tf = { ...(child.transform || {}), t: position.toArray(), r: [angles.x, angles.y, angles.z].map(MathUtils.radToDeg), s: scale.toArray() }
    if (!tf.s.every(v => Number.isFinite(v) && v > 0) || !closeMatrix(target, matrix(tf))) fail('This transformed group produces shear when ungrouped. Keep the group to preserve its shape.', 'NON_TRS_TRANSFORM')
    child.transform = tf
    changedTransforms.add(child)
  }
  parent.children.splice(parent.children.indexOf(group), 1, ...group.children)
  return finish(ctx, [], group.children, { removedPath: path, removedParent: parent, changedTransforms })
}

/** Compact read-only candidates: whole CSG/Repeat subtrees may move as units. */
export function groupingSynopsis(scene, scope = '0') {
  assertScene(scene)
  const nodes = indexScene(scene)
  nodeAt(nodes, scope)
  const parents = []
  for (const [path, { node }] of nodes) {
    if (!inside(path, scope) || !ordinaryUnion(node) || node.children.length < 2) continue
    try { safeParent(nodes, path) } catch { continue }
    parents.push({ path, name: node.name || 'Union', members: node.children.map((child, i) => ({
      path: `${path}.${i}`, name: child.name || 'Part', type: child.repeat ? `repeat:${child.repeat.type}` : child.operation || child.primitive?.type,
      children: child.children?.length || 0,
    })) })
  }
  return { scope, parents, limits: GROUPING_LIMITS }
}
