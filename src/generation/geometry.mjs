import * as THREE from 'three'
import { CSG } from 'three-csg-ts'
import { summarizeScenePalette } from './palette.mjs'
import { OBJECTIVE_CHECK_KINDS, MAX_AXIS_DOT_TOLERANCE, hasAxisParallelCheck } from './amlContract.mjs'
import { applyExactMatrix } from '../utils/sceneTransforms.mjs'

// CPU-only counterpart of ThreeSceneFromJSON.jsx. Bounds describe the tessellated
// rendered geometry in AML world coordinates, before the canvas's y=-2 offset.
// They are AABBs, not solid-intersection or visual/semantic guarantees.
const IDENTITY = () => new THREE.Matrix4()
const BOOLEAN_OPS = new Set(['subtract', 'difference', 'intersection', 'intersect'])
const SUPPORTED_OPS = new Set(['union', ...BOOLEAN_OPS])
const MAX_REPEAT = 256 // must match src/utils/repeat.jsx
const AXES = { x: 0, y: 1, z: 2 }
const vec = (v, fallback) => [0, 1, 2].map(i => Number.isFinite(Number(v?.[i])) ? Number(v[i]) : fallback[i])
const isRepeat = node => Boolean(node?.repeat && typeof node.repeat === 'object') || String(node?.kind || node?.nodeKind || '').toLowerCase() === 'repeat'
const repeatType = node => {
  const value = String(node.repeat?.type ?? node.repeat?.mode ?? node.repeatType ?? node.repeatMode ?? '').trim().toLowerCase()
  return /circ|rad|ring/.test(value) ? 'circular' : 'linear'
}
const opOf = node => String(node?.operation || 'union').toLowerCase()

function trs(transform = {}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...vec(transform.t, [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...vec(transform.r, [0, 0, 0]).map(THREE.MathUtils.degToRad), 'XYZ')),
    new THREE.Vector3(...vec(transform.s, [1, 1, 1]))
  )
}

function repeatMatrices(node) {
  const rep = node.repeat || {}
  const rawCount = Number(rep.count ?? rep.n ?? 1)
  const count = Math.max(1, Math.min(MAX_REPEAT, Number.isFinite(rawCount) ? Math.floor(rawCount) : 1))
  const t = vec(rep.t, [0, 0, 0]), r = vec(rep.r, [0, 0, 0]), s = vec(rep.s, [1, 1, 1])
  const radius = Number.isFinite(Number(rep.radius)) ? Number(rep.radius) : 1
  return Array.from({ length: count }, (_, i) => {
    const f = count === 1 ? 0 : i / (count - 1)
    const dt = t.map(v => v * f)
    if (repeatType(node) === 'circular') {
      const theta = i * Math.PI * 2 / count
      dt[0] += radius * Math.cos(theta)
      dt[2] += radius * Math.sin(theta)
    }
    return trs({ t: dt, r: r.map(v => v * f), s: s.map(v => 1 + (v - 1) * f) })
  })
}

function serializeBox(box) {
  if (!box || box.isEmpty()) return null
  const min = box.min.toArray(), max = box.max.toArray()
  if (![...min, ...max].every(Number.isFinite)) return null
  return { min, max, size: box.getSize(new THREE.Vector3()).toArray(), center: box.getCenter(new THREE.Vector3()).toArray() }
}

export function inspectGeometry(root, { maxInstances = 2048, maxVertices = 500000 } = {}) {
  const errors = [], warnings = [], nodes = {}
  const stats = { nodeCount: 0, primitiveCount: 0, meshCount: 0, vertices: 0, generatedVertices: 0, csgOperations: 0, repeatInstances: 0 }
  const resources = new Set(), nodeBoxes = new Map(), active = new WeakSet()
  const material = new THREE.MeshBasicMaterial()
  const primitiveLimit = Number.isFinite(maxInstances) ? Math.max(1, Math.floor(maxInstances)) : 2048
  const vertexLimit = Number.isFinite(maxVertices) ? Math.max(1, Math.floor(maxVertices)) : 500000
  const seenWarnings = new Set()
  const warn = text => { if (!seenWarnings.has(text)) { seenWarnings.add(text); warnings.push(text) } }
  const fail = message => { throw new Error(message) }

  function validateVector(value, label, path) {
    if (value == null) return
    if (!Array.isArray(value) || value.some(v => !Number.isFinite(Number(v)))) fail(`${path}: ${label} contains non-finite or unsupported coordinates.`)
  }

  function entry(node, path, world) {
    if (!nodes[path]) {
      nodes[path] = { name: String(node.name || node.label || ''), type: isRepeat(node) ? `repeat_${repeatType(node)}` : (node.primitive?.type || opOf(node)), bounds: null, primitiveCount: 0, instanceCount: 0, worldMatrices: [] }
      nodeBoxes.set(path, new THREE.Box3())
      stats.nodeCount++
      if (stats.nodeCount > 4096) fail(`${path}: node budget exceeded (4096).`)
    }
    const result = nodes[path]
    result.instanceCount++
    if (result.worldMatrices.length < 4) result.worldMatrices.push(world.toArray())
    return result
  }

  function meshBounds(meshes, path) {
    const box = new THREE.Box3(), point = new THREE.Vector3()
    for (const mesh of meshes) {
      const attr = mesh.geometry.getAttribute('position')
      for (let i = 0; i < attr.count; i++) {
        point.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrix)
        if (![point.x, point.y, point.z].every(Number.isFinite)) fail(`${path}: geometry contains a non-finite vertex.`)
        box.expandByPoint(point)
      }
    }
    return box
  }

  function track(geometry, path) {
    resources.add(geometry)
    stats.generatedVertices += geometry.getAttribute('position')?.count || 0
    if (stats.generatedVertices > vertexLimit) fail(`${path}: generated vertex budget exceeded (${vertexLimit}).`)
    return geometry
  }

  function makePrimitive(primitive, world, path) {
    if (!world.elements.every(Number.isFinite)) fail(`${path}: world transform contains non-finite values.`)
    if (world.determinant() === 0) fail(`${path}: world transform produces degenerate zero-scale geometry.`)
    const type = String(primitive.type || '').toLowerCase()
    const supported = ['cube', 'sphere', 'cylinder', 'cone', 'torus']
    if (!supported.includes(type)) fail(`${path}: unsupported primitive type "${type}".`)
    for (const key of ['w', 'h', 'd', 'r', 't', 'radialSegments', 'tubularSegments', 'widthSegments', 'heightSegments']) {
      if (primitive[key] != null && !Number.isFinite(Number(primitive[key]))) fail(`${path}: primitive.${key} is not finite.`)
    }
    for (const key of type === 'cube' ? ['w', 'h', 'd'] : type === 'torus' ? ['r', 't'] : type === 'sphere' ? ['r'] : ['r', 'h']) {
      if (primitive[key] != null && Number(primitive[key]) <= 0) fail(`${path}: primitive.${key} must be greater than zero.`)
    }
    if (++stats.primitiveCount > primitiveLimit) fail(`${path}: expanded primitive instance budget exceeded (${primitiveLimit}).`)
    // Keep compact axial measurements for EVERY expanded primitive, independently
    // of the four context matrix samples. A torus axis is its plane normal;
    // under shear this requires inverse transpose, not transformDirection(Z).
    if (['cylinder', 'cone', 'torus'].includes(type)) {
      const direction = type === 'torus'
        ? new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().getNormalMatrix(world)).normalize()
        : new THREE.Vector3(0, 1, 0).transformDirection(world)
      const center = new THREE.Vector3().setFromMatrixPosition(world)
      const record = nodes[path]
      if (!record.axisInstances) record.axisInstances = []
      record.axisInstances.push({ center: center.toArray(), direction: direction.toArray() })
    }
    const radial = Math.max(3, Number(primitive.radialSegments ?? (type === 'torus' ? 16 : 32)))
    const tubular = Math.max(3, Number(primitive.tubularSegments ?? 100))
    const width = Math.max(3, Number(primitive.widthSegments ?? 16))
    const height = Math.max(2, Number(primitive.heightSegments ?? 12))
    // Estimate before allocation: procedural segment counts are user/model input.
    const estimatedVertices = type === 'cube' ? 24 : type === 'torus' ? (Math.floor(radial) + 1) * (Math.floor(tubular) + 1) : type === 'sphere' ? (Math.floor(width) + 1) * (Math.floor(height) + 1) : (Math.floor(radial) + 1) * 6
    if (stats.generatedVertices + estimatedVertices > vertexLimit) fail(`${path}: primitive tessellation exceeds vertex budget (${vertexLimit}).`)
    let geometry
    if (type === 'cube') geometry = new THREE.BoxGeometry(primitive.w ?? 1, primitive.h ?? 1, primitive.d ?? 1)
    if (type === 'sphere') geometry = new THREE.SphereGeometry(primitive.r ?? 1, width, height)
    if (type === 'cylinder') geometry = new THREE.CylinderGeometry(primitive.r ?? 1, primitive.r ?? 1, primitive.h ?? 1, radial)
    if (type === 'cone') geometry = new THREE.ConeGeometry(primitive.r ?? 1, primitive.h ?? 1, radial)
    if (type === 'torus') geometry = new THREE.TorusGeometry(primitive.r ?? 1, primitive.t ?? 0.2, radial, tubular)
    const mesh = new THREE.Mesh(track(geometry, path), material)
    applyExactMatrix(mesh, world)
    meshBounds([mesh], path)
    return mesh
  }

  function merge(meshes, operation, path) {
    if (!meshes.length) return []
    let acc = meshes[0]
    for (const operand of meshes.slice(1)) {
      const a = CSG.fromMesh(acc), b = CSG.fromMesh(operand)
      const result = operation === 'subtract' || operation === 'difference' ? a.subtract(b) : operation === 'intersect' || operation === 'intersection' ? a.intersect(b) : a.union(b)
      stats.csgOperations++
      const projectedVertices = result.polygons.reduce((sum, polygon) => sum + Math.max(0, polygon.vertices.length - 2) * 3, 0)
      if (stats.generatedVertices + projectedVertices > vertexLimit) fail(`${path}: CSG result exceeds vertex budget (${vertexLimit}).`)
      if (!projectedVertices) {
        if (BOOLEAN_OPS.has(operation)) fail(`${path}: ${operation} produced empty geometry.`)
        return []
      }
      acc = CSG.toMesh(result, IDENTITY(), material)
      track(acc.geometry, path)
      meshBounds([acc], path)
    }
    return [acc]
  }

  function build(node, parentWorld, path, csgContext = false, depth = 0) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail(`${path}: expected a scene node object.`)
    if (depth > 64) fail(`${path}: hierarchy depth exceeds 64.`)
    if (active.has(node)) fail(`${path}: cyclic scene hierarchy.`)
    active.add(node)
    try {
      const operation = opOf(node)
      if (!SUPPORTED_OPS.has(operation)) fail(`${path}: unsupported operation "${operation}".`)
      validateVector(node.transform?.t, 'transform.t', path)
      validateVector(node.transform?.r, 'transform.r', path)
      validateVector(node.transform?.s, 'transform.s', path)
      if (node.transform?.s?.some(v => Number(v) === 0)) fail(`${path}: zero scale produces degenerate geometry.`)
      if (node.transform?.s?.some(v => Number(v) < 0)) warn(`${path}: negative scale may reverse winding in CSG; inspect the rendered result.`)
      const world = parentWorld.clone().multiply(trs(node.transform))
      const record = entry(node, path, world)
      const kids = Array.isArray(node.children) ? node.children : []
      const forceCSG = csgContext || BOOLEAN_OPS.has(operation)
      let meshes = [], count = 0
      const template = instanceWorld => {
        let list = [], instances = 0
        if (node.primitive) { list.push(makePrimitive(node.primitive, instanceWorld, path)); instances++ }
        for (let i = 0; i < kids.length; i++) {
          const child = build(kids[i], instanceWorld, `${path}.${i}`, forceCSG, depth + 1)
          list.push(...child.meshes)
          instances += child.count
        }
        return { meshes: forceCSG ? merge(list, isRepeat(node) ? 'union' : operation, path) : list, count: instances }
      }
      if (isRepeat(node)) {
        const rep = node.repeat || {}
        for (const key of ['t', 'r', 's']) validateVector(rep[key], `repeat.${key}`, path)
        if (rep.s?.some(v => Number(v) === 0)) fail(`${path}: repeat.s contains zero scale.`)
        if (rep.s?.some(v => Number(v) < 0)) warn(`${path}: repeat interpolation crosses or reverses scale; inspect the rendered result.`)
        const rawCount = Number(rep.count ?? rep.n ?? 1)
        if (!Number.isFinite(rawCount)) fail(`${path}: repeat count is non-finite.`)
        if (rawCount > MAX_REPEAT || rawCount < 1 || !Number.isInteger(rawCount)) warn(`${path}: repeat count is clamped to an integer in [1, ${MAX_REPEAT}], matching the renderer.`)
        if (rep.radius != null && !Number.isFinite(Number(rep.radius))) fail(`${path}: repeat radius is non-finite.`)
        for (const matrix of repeatMatrices(node)) {
          stats.repeatInstances++
          // Empty repeat templates must also be bounded: nested repeats can
          // otherwise expand exponentially before a primitive is encountered.
          if (stats.repeatInstances > primitiveLimit * 4) fail(`${path}: repeat expansion budget exceeded (${primitiveLimit * 4}).`)
          const result = template(world.clone().multiply(matrix))
          meshes.push(...result.meshes)
          count += result.count
        }
        if (forceCSG) meshes = merge(meshes, 'union', path)
      } else {
        const result = template(world)
        meshes = result.meshes
        count = result.count
      }
      const box = meshBounds(meshes, path)
      nodeBoxes.get(path).union(box)
      record.bounds = serializeBox(nodeBoxes.get(path))
      record.primitiveCount += count
      if (BOOLEAN_OPS.has(operation)) warn(`${path}: primitiveCount counts expanded input primitives, not the number of solids surviving CSG.`)
      return { meshes, count }
    } finally { active.delete(node) }
  }

  let bounds = null
  try {
    const result = build(root?.scene || root, IDENTITY(), '0')
    stats.meshCount = result.meshes.length
    stats.vertices = result.meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count, 0)
    bounds = serializeBox(meshBounds(result.meshes, '0'))
    if (!bounds || !stats.primitiveCount) errors.push('0: scene contains no visible supported geometry.')
    else if (bounds.size.some(v => v < 1e-8)) errors.push('0: scene is degenerate along at least one world axis.')
  } catch (error) {
    errors.push(String(error?.message || error))
  } finally {
    for (const geometry of resources) geometry.dispose()
    material.dispose()
  }
  return { ok: errors.length === 0, errors, warnings, bounds, stats, nodes }
}

function nodeAt(scene, path) {
  if (!/^0(?:\.\d+)*$/.test(String(path))) return null
  let node = scene?.scene || scene
  for (const index of String(path).split('.').slice(1)) node = node?.children?.[Number(index)]
  return node || null
}

export function buildEditContext(scene, path = '0') {
  const selectedPath = String(path), root = scene?.scene || scene
  const report = inspectGeometry(root)
  const selected = nodeAt(root, selectedPath)
  const summarize = p => {
    const node = nodeAt(root, p), geometry = report.nodes[p]
    return { path: p, name: node?.name || node?.label || '', type: geometry?.type || node?.primitive?.type || opOf(node), bounds: geometry?.bounds || null, primitiveCount: geometry?.primitiveCount ?? null, instanceCount: geometry?.instanceCount ?? null, ...(geometry?.axisInstances ? { axialInstanceCount: geometry.axisInstances.length, worldAxisSamples: geometry.axisInstances.slice(0, 4) } : {}) }
  }
  const segments = selectedPath.split('.'), ancestorChain = []
  for (let i = 1; i < segments.length; i++) {
    const p = segments.slice(0, i).join('.')
    const node = nodeAt(root, p), geometry = report.nodes[p]
    ancestorChain.push({ ...summarize(p), localTransform: node?.transform || { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, worldMatrices: geometry?.worldMatrices || [], repeated: Boolean(node && isRepeat(node)) })
  }
  const parentPath = segments.slice(0, -1).join('.')
  const siblingPaths = parentPath ? (nodeAt(root, parentPath)?.children || []).map((_, i) => `${parentPath}.${i}`).filter(p => p !== selectedPath) : []
  const selectedBounds = report.nodes[selectedPath]?.bounds || null
  const distance = bounds => bounds && selectedBounds ? Math.hypot(...bounds.center.map((value, i) => value - selectedBounds.center[i])) : Infinity
  const ancestors = new Set(ancestorChain.map(item => item.path))
  const relatedParts = Object.keys(report.nodes)
    .filter(p => p !== selectedPath && !p.startsWith(`${selectedPath}.`) && !ancestors.has(p) && !siblingPaths.includes(p) && report.nodes[p].bounds)
    .sort((a, b) => distance(report.nodes[a].bounds) - distance(report.nodes[b].bounds))
    .slice(0, 8).map(summarize)
  return {
    selectedPath,
    selectedExists: Boolean(selected),
    coordinateSystem: 'Right-handed AML coordinates; Y up; rotations in degrees, intrinsic XYZ Euler; matrices are column-major and world=parent*T*Rx*Ry*Rz*S. Native cylinder/cone centerline Y; torus plane normal Z (inverse-transpose under shear). Bounds are world-space AABBs before the viewport display offset [0,-2,0]. Selected transform values remain in parent-local coordinates. Repeat instances share a template path; listed matrices/axes are samples (at most 4); objective axis checks evaluate every expanded primitive instance.',
    boundsLimitation: 'AABBs describe tessellated extents; alignment/overlap does not prove solid contact, intersection, appearance, or semantic correctness. Primitive counts are expanded operands, not post-CSG solid counts.',
    selectedLocalTransform: selected?.transform || { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    selectedWorldMatrices: report.nodes[selectedPath]?.worldMatrices || [],
    selectedWorldAxisSamples: report.nodes[selectedPath]?.axisInstances?.slice(0, 4) || [],
    selectedBounds,
    ancestorChain,
    siblings: siblingPaths.slice(0, 12).map(summarize),
    omittedSiblings: Math.max(0, siblingPaths.length - 12),
    relatedParts,
    scenePalette: summarizeScenePalette(root, { scopePath: selectedPath, preferredPaths: [...siblingPaths, ...relatedParts.map(part => part.path)] }),
    sceneBounds: report.bounds,
    geometryOk: report.ok,
    geometryErrors: selected ? report.errors.slice(0, 6) : [`${selectedPath}: selected path does not exist.`, ...report.errors.slice(0, 5)],
    geometryWarnings: report.warnings.slice(0, 6)
  }
}

function compare(actual, expected, comparison, tolerance) {
  if (comparison === 'eq') return Math.abs(actual - expected) <= tolerance
  if (comparison === 'lt') return actual < expected - tolerance
  if (comparison === 'le') return actual <= expected + tolerance
  if (comparison === 'gt') return actual > expected + tolerance
  if (comparison === 'ge') return actual >= expected - tolerance
  return false
}

// Explicit correspondence only: equal traversal counts or one shared reference.
// Never silently validate four samples, or guess a nearest counterpart.
function axialPairs(node, other) {
  const a = node.axisInstances, b = other?.axisInstances
  const complete = (record, list) => ['cylinder', 'cone', 'torus'].includes(record?.type)
    && Array.isArray(list) && list.length > 0 && list.length === record.primitiveCount
  if (!complete(node, a) || !complete(other, b)) throw new Error('axis checks require complete cylinder/cone/torus primitive instances at both paths.')
  if (a.length !== b.length && a.length !== 1 && b.length !== 1) throw new Error('axis instance counts differ; use equal counts or a singleton reference.')
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[a.length === 1 ? 0 : i], b[b.length === 1 ? 0 : i]])
}

function axialMeasurement(node, other, check, axis) {
  if (check.comparison !== 'eq' || check.value !== (check.kind === 'axis_distance' ? 0 : 1)) throw new Error('axis checks require eq with value 1 for direction/parallel, or 0 for distance.')
  if (check.kind === 'axis_direction') {
    // Self-pair validates primitive kind and complete instance coverage too.
    return Math.min(...axialPairs(node, node).map(([instance]) => Math.min(1, Math.abs(instance.direction[axis]))))
  }
  const pairs = axialPairs(node, other)
  if (check.kind === 'axis_parallel') return Math.min(...pairs.map(([a, b]) => Math.min(1, Math.abs(new THREE.Vector3(...a.direction).dot(new THREE.Vector3(...b.direction))))))
  return Math.max(...pairs.map(([a, b]) => {
    const delta = new THREE.Vector3(...a.center).sub(new THREE.Vector3(...b.center))
    return Math.max(delta.clone().cross(new THREE.Vector3(...a.direction)).length(), delta.clone().cross(new THREE.Vector3(...b.direction)).length())
  }))
}

export function evaluateChecks(report, checks = []) {
  const errors = [], warnings = [], results = []
  if (!Array.isArray(checks)) return { ok: false, errors: ['checks must be an array.'], warnings, results }
  if (checks.length > 32) return { ok: false, errors: ['At most 32 objective checks are supported.'], warnings, results }
  for (let index = 0; index < checks.length; index++) {
    const check = checks[index] || {}, label = `Check ${index + 1} (${check.kind || 'unknown'} ${check.path || ''})`
    const node = report?.nodes?.[check.path], other = report?.nodes?.[check.otherPath]
    const axis = AXES[check.axis], tolerance = Math.max(0, Number(check.tolerance ?? 0.001))
    let actual, expected = Number(check.value), error
    if (!OBJECTIVE_CHECK_KINDS.includes(check.kind)) error = `${label}: unsupported check kind.`
    else if (!node || !node.bounds) error = `${label}: path has no supported nonempty geometry.`
    else if (!['eq', 'lt', 'le', 'gt', 'ge'].includes(check.comparison)) error = `${label}: unsupported comparison.`
    else if (!Number.isFinite(expected) || !Number.isFinite(tolerance)) error = `${label}: value and tolerance must be finite.`
    else if (['axis_direction', 'axis_parallel'].includes(check.kind) && tolerance > MAX_AXIS_DOT_TOLERANCE) error = `${label}: axis dot tolerance must be at most ${MAX_AXIS_DOT_TOLERANCE}, not an angle in degrees.`
    else if (check.kind !== 'count' && axis == null) error = `${label}: axis must be x, y, or z.`
    else if (['relative_extent', 'align', 'axis_parallel', 'axis_distance'].includes(check.kind) && !other?.bounds) error = `${label}: otherPath has no supported nonempty geometry.`
    else if (check.kind === 'axis_distance' && !hasAxisParallelCheck(checks, check)) error = `${label}: axis_distance requires an axis_parallel check for the same primitive path pair.`
    else {
      if (check.kind.startsWith('axis_')) {
        try { actual = axialMeasurement(node, other, check, axis) }
        catch (cause) { error = `${label}: ${cause.message}` }
      }
      if (check.kind === 'count') {
        actual = node.primitiveCount
        if (report.warnings?.some(warning => warning.includes('CSG'))) warnings.push(`${label}: count refers to expanded input primitive instances; boolean operations may remove their visible surfaces.`)
      }
      if (check.kind === 'extent') actual = node.bounds.size[axis]
      // A value of 1 asks for equal extents; 1.5 asks for 1.5 times the
      // other extent. Use gt value=1 for a strictly larger part.
      if (check.kind === 'relative_extent') {
        if (other.bounds.size[axis] <= 1e-12) error = `${label}: other extent is zero.`
        else actual = node.bounds.size[axis] / other.bounds.size[axis]
      }
      if (check.kind === 'align') actual = node.bounds.center[axis] - other.bounds.center[axis]
    }
    const passed = !error && compare(actual, expected, check.comparison, tolerance)
    const result = { index, ...check, actual: Number.isFinite(actual) ? actual : null, passed, ...(error ? { error } : {}) }
    results.push(result)
    if (!passed) errors.push(error || `${label}: measured ${actual}, expected ${check.comparison} ${expected} (tolerance ${tolerance}).`)
  }
  if (!report?.ok) errors.unshift('Geometry must pass inspection before objective checks can pass.')
  return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)], results }
}
