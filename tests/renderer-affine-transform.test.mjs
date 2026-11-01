import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as THREE from 'three'
import { CSG } from 'three-csg-ts'
import { applyExactMatrix, withViewportOffset, VIEWPORT_SCENE_OFFSET } from '../src/utils/sceneTransforms.mjs'
import { inspectGeometry } from '../src/generation/geometry.mjs'

// Execute the actual production builders without mounting React or a WebGL canvas.
const source = (await fs.readFile(new URL('../src/components/ThreeSceneFromJSON.jsx', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const repeatSource = await fs.readFile(new URL('../src/utils/repeat.jsx', import.meta.url), 'utf8')
const repeat = await import(`data:text/javascript;base64,${Buffer.from(repeatSource).toString('base64')}`)
const helpers = source.slice(source.indexOf('/* ========== helpers'), source.indexOf('/* ======= Global Raycaster'))
const renderer = new Function('THREE', 'CSG', 'isRepeatNode', 'computeRepeatInstances', 'applyExactMatrix', `${helpers}\nreturn { makePrimitive, buildVisualScene, buildGhostAndIndex, unionMeshes }`)(THREE, CSG, repeat.isRepeatNode, repeat.computeRepeatInstances, applyExactMatrix)
const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`)
const nearArray = (a, b, tolerance = 1e-10) => { assert.equal(a.length, b.length); a.forEach((value, i) => near(value, b[i], tolerance)) }
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const mul = (a, b) => Array.from({ length: 16 }, (_, i) => { const row = i % 4, col = Math.floor(i / 4); let value = 0; for (let k = 0; k < 4; k++) value += a[k * 4 + row] * b[col * 4 + k]; return value })
// Independent elementary matrix reference: no Three Euler, Quaternion or compose.
function referenceTRS(tf = {}) {
  const [tx, ty, tz] = tf.t || [0, 0, 0], [rx, ry, rz] = (tf.r || [0, 0, 0]).map(value => value * Math.PI / 180), [sx, sy, sz] = tf.s || [1, 1, 1]
  const cx = Math.cos(rx), x = Math.sin(rx), cy = Math.cos(ry), y = Math.sin(ry), cz = Math.cos(rz), z = Math.sin(rz)
  const T = identity(); T[12] = tx; T[13] = ty; T[14] = tz
  const X = [1, 0, 0, 0, 0, cx, x, 0, 0, -x, cx, 0, 0, 0, 0, 1]
  const Y = [cy, 0, -y, 0, 0, 1, 0, 0, y, 0, cy, 0, 0, 0, 0, 1]
  const Z = [cz, z, 0, 0, -z, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  return mul(mul(mul(mul(T, X), Y), Z), [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1])
}
function referenceInstances(node) {
  if (!node.repeat) return [identity()]
  const rep = node.repeat, n = rep.count
  return Array.from({ length: n }, (_, i) => {
    const f = n === 1 ? 0 : i / (n - 1), t = (rep.t || [0, 0, 0]).map(value => value * f)
    if (rep.type === 'circular') { t[0] += rep.radius * Math.cos(i * 2 * Math.PI / n); t[2] += rep.radius * Math.sin(i * 2 * Math.PI / n) }
    return referenceTRS({ t, r: (rep.r || [0, 0, 0]).map(value => value * f), s: (rep.s || [1, 1, 1]).map(value => 1 + (value - 1) * f) })
  })
}
function expectedMeshes(node, parent = identity(), path = '0', result = []) {
  const base = mul(parent, referenceTRS(node.transform))
  for (const instance of referenceInstances(node)) {
    const world = mul(base, instance)
    if (node.primitive) result.push({ path, world, primitive: node.primitive })
    for (let i = 0; i < (node.children || []).length; i++) expectedMeshes(node.children[i], world, `${path}.${i}`, result)
  }
  return result
}
function actualMeshes(object) {
  object.updateMatrixWorld(true)
  const out = []; object.traverse(node => { if (node.isMesh) out.push(node) }); return out
}
function compareScene(scene, { sampleLimit = 4 } = {}) {
  const visual = renderer.buildVisualScene(scene), ghosts = renderer.buildGhostAndIndex(scene).ghostGroup
  const expected = expectedMeshes(scene), actual = actualMeshes(visual), ghostMeshes = actualMeshes(ghosts), report = inspectGeometry(scene)
  assert.equal(report.ok, true, report.errors.join('; '))
  assert.equal(actual.length, expected.length); assert.equal(ghostMeshes.length, expected.length)
  const seen = new Map()
  for (const item of expected) {
    const i = seen.get(item.path) || 0; seen.set(item.path, i + 1)
    const mesh = actual.filter(node => node.userData.path === item.path)[i], ghost = ghostMeshes.filter(node => node.userData.path === item.path)[i]
    nearArray(mesh.matrixWorld.toArray(), item.world)
    nearArray(ghost.matrixWorld.toArray(), item.world)
    assert.equal(mesh.matrixAutoUpdate, false); assert.equal(ghost.matrixAutoUpdate, false)
    if (i < sampleLimit) nearArray(report.nodes[item.path].worldMatrices[i], item.world)
  }
  // Rendering can update the matrix repeatedly; it must not gradually replace shear.
  visual.updateMatrixWorld(true); visual.updateMatrixWorld(true)
  for (let i = 0; i < actual.length; i++) nearArray(actual[i].matrixWorld.toArray(), expected[i].world)
  return { visual, actual, expected, ghosts, report }
}
const box = (transform = {}, w = 2, h = 3, d = 5) => ({ primitive: { type: 'cube', w, h, d }, transform })
const torus = (transform = {}) => ({ primitive: { type: 'torus', r: 1.7, t: 0.17 }, transform })
const parent = { t: [1.3, -2.1, 3.2], r: [19, -33, 71], s: [2.2, 0.7, 1.3] }
const vector = (matrix, local) => new THREE.Vector3(...local).transformDirection(new THREE.Matrix4().fromArray(matrix))

test('native primitive axes and constructor default rotation remain unchanged', () => {
  for (const [primitive, dimensions] of [
    [{ type: 'cube', w: 2, h: 3, d: 5 }, [2, 3, 5]],
    [{ type: 'cylinder', r: 0.4, h: 6 }, [0.8, 6, 0.8]],
    [{ type: 'cone', r: 0.4, h: 6 }, [0.8, 6, 0.8]],
    [{ type: 'torus', r: 1.7, t: 0.17 }, [3.74, 3.74, 0.34]],
  ]) {
    const mesh = renderer.makePrimitive(primitive), bounds = new THREE.Box3().setFromObject(mesh)
    nearArray(bounds.getSize(new THREE.Vector3()).toArray(), dimensions, 1e-6)
    nearArray(mesh.quaternion.toArray(), [0, 0, 0, 1])
  }
})

test('nested combined XYZ rotations use parent*local, including asymmetric leaf scale', () => {
  compareScene({ operation: 'union', transform: { ...parent, s: [1.2, 1.2, 1.2] }, children: [{ operation: 'union', transform: { t: [-0.2, 0.5, 1.7], r: [-44, 17, 29] }, children: [box({ t: [0.1, 0.3, -0.5], r: [13, 47, -11], s: [0.7, 1.4, 0.9] }), torus({ t: [3, 1, 2], r: [27, 18, 53] })] }] })
})

test('visible and ghost meshes preserve full inherited shear after render updates', () => {
  compareScene({ operation: 'union', transform: parent, children: [box({ t: [0.4, -0.2, 1.1], r: [33, -28, 61] }), torus({ t: [3, 0, 2], r: [41, 27, -32] })] })
})

for (const type of ['linear', 'circular']) test(`${type} repeat preserves parent*node*instance*child affine order`, () => {
  compareScene({ operation: 'union', transform: parent, children: [{ repeat: { type, count: 4, radius: type === 'circular' ? 2.3 : null, t: [2, -0.4, 3.1], r: [31, -22, 59], s: [1.2, 0.8, 1.4] }, transform: { t: [0.2, -0.3, 0.8], r: [-14, 26, 33] }, children: [torus({ t: [0.7, 0.2, -0.9], r: [23, 37, -41] })] }] })
})

test('nested repeats verify every actual instance beyond validator matrix sampling', () => {
  const { actual, report } = compareScene({ operation: 'union', transform: parent, children: [{ repeat: { type: 'linear', count: 2, t: [4, 0, 0], r: [14, 27, 39] }, children: [{ repeat: { type: 'circular', count: 3, radius: 1.6, r: [-17, 29, 34] }, transform: { r: [21, -41, 11] }, children: [box({ t: [0.3, -0.2, 0.5], r: [31, 17, 61] })] }] }] })
  assert.equal(actual.length, 6)
  assert.equal(report.nodes['0.0.0.0'].instanceCount, 6)
  assert.equal(report.nodes['0.0.0.0'].worldMatrices.length, 4)
})

test('torus plane normal follows inverse transpose, not a forward axis under shear', () => {
  const { actual, expected } = compareScene({ operation: 'union', transform: parent, children: [torus({ r: [41, 27, -32] })] })
  const world = expected[0].world
  const independentPlane = vector(world, [1, 0, 0]).cross(vector(world, [0, 1, 0])).normalize()
  const renderedPlane = new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().getNormalMatrix(actual[0].matrixWorld)).normalize()
  near(Math.abs(independentPlane.dot(renderedPlane)), 1)
  assert.ok(Math.abs(renderedPlane.dot(vector(world, [0, 0, 1]))) < 0.9, 'Fixture must distinguish a plane normal from the transformed Z direction')
})

test('display offset appends to AML translation for single, collapsed and grouped roots', () => {
  for (const scene of [box({ t: [3, 4, 5], r: [17, 31, 47] }), { operation: 'union', transform: { t: [1, 2, 3] }, children: [box({ t: [3, 4, 5], r: [17, 31, 47] })] }, { operation: 'union', children: [box({ t: [3, 4, 5] }), torus({ t: [-3, 1, 2] })] }]) {
    const visual = renderer.buildVisualScene(scene), expected = expectedMeshes(scene), wrapper = withViewportOffset(visual)
    assert.equal(wrapper.isGroup, true); assert.equal(wrapper.children[0], visual)
    const actual = actualMeshes(wrapper)
    for (let i = 0; i < actual.length; i++) nearArray(actual[i].matrixWorld.toArray(), mul(referenceTRS({ t: VIEWPORT_SCENE_OFFSET }), expected[i].world))
  }
  assert.equal(withViewportOffset(null), null)
})

test('production buildFrom wires the display parent into visible and ghost objects', () => {
  const start = source.indexOf('const buildFrom = (sourceScene) => {'), end = source.indexOf('\n    }\n\n    if (scene)', start)
  assert.ok(start >= 0 && end > start, 'Production scene-loading closure must be located')
  const body = source.slice(start, end + '\n    }'.length)
  const buildFrom = new Function('sourceScene', 'buildVisualScene', 'buildGhostAndIndex', 'THREE', 'withViewportOffset', 'mergedRef', 'ghostRef', 'indexRef', 'pickablesRef', 'collectPickables', 'active', 'setSceneObj', 'setUnionMesh', `${body}\nreturn buildFrom(sourceScene)`)
  for (const scene of [box({ t: [3, 4, 5], r: [17, 31, 47] }), { operation: 'union', transform: parent, children: [box({ t: [0.4, -0.2, 1.1], r: [33, -28, 61] })] }]) {
    const mergedRef = {}, ghostRef = {}, indexRef = {}, pickablesRef = {}
    buildFrom(scene, renderer.buildVisualScene, renderer.buildGhostAndIndex, THREE, withViewportOffset, mergedRef, ghostRef, indexRef, pickablesRef, object => actualMeshes(object), true, () => {}, () => {})
    const expected = expectedMeshes(scene).map(item => mul(referenceTRS({ t: VIEWPORT_SCENE_OFFSET }), item.world))
    for (const rendered of [mergedRef.current, ghostRef.current]) {
      assert.equal(rendered.isGroup, true)
      actualMeshes(rendered).forEach((mesh, i) => nearArray(mesh.matrixWorld.toArray(), expected[i]))
    }
    assert.equal(indexRef.current.get('0').meshes.length, 1)
    assert.equal(pickablesRef.current.length, 1)
  }
})

test('CSG keeps combined ancestor affine transforms baked once and offset outside the result', () => {
  const child = { t: [0.4, -0.2, 1.1], r: [33, -28, 61] }
  const scene = { operation: 'union', transform: parent, children: [{ operation: 'subtract', transform: child, children: [box({}, 4, 3, 2), box({ t: [1, 0, 0] }, 2, 5, 4)] }] }
  const visual = renderer.buildVisualScene(scene), displayed = withViewportOffset(visual), actual = new THREE.Box3().setFromObject(displayed)
  const remaining = renderer.makePrimitive({ type: 'cube', w: 2, h: 3, d: 2 })
  const expected = mul(mul(mul(referenceTRS({ t: VIEWPORT_SCENE_OFFSET }), referenceTRS(parent)), referenceTRS(child)), referenceTRS({ t: [-1, 0, 0] }))
  applyExactMatrix(remaining, new THREE.Matrix4().fromArray(expected))
  const correct = new THREE.Box3().setFromObject(remaining)
  nearArray(actual.min.toArray(), correct.min.toArray(), 1e-6); nearArray(actual.max.toArray(), correct.max.toArray(), 1e-6)
  assert.equal(visual.matrixAutoUpdate, false)
  const report = inspectGeometry(scene)
  assert.equal(report.ok, true, report.errors.join('; '))
  nearArray(report.bounds.min.map((value, i) => value + VIEWPORT_SCENE_OFFSET[i]), actual.min.toArray(), 1e-6)
  nearArray(report.bounds.max.map((value, i) => value + VIEWPORT_SCENE_OFFSET[i]), actual.max.toArray(), 1e-6)
})

test('union highlight clones preserve sheared input matrices and share the display offset', () => {
  const scene = { operation: 'union', transform: parent, children: [box({ t: [-4, 0, 0], r: [33, -28, 61] }, 1, 1.5, 2), box({ t: [4, 0, 0], r: [23, 42, -17] }, 1.2, 0.8, 1.4)] }
  const { ghostGroup, index } = renderer.buildGhostAndIndex(scene), ghosts = index.get('0').meshes
  ghostGroup.updateMatrixWorld(true)
  const matrices = ghosts.map(mesh => mesh.matrix.toArray())
  const overlay = renderer.unionMeshes(ghosts), displayed = withViewportOffset(overlay)
  const actualBounds = new THREE.Box3().setFromObject(displayed), visualBounds = new THREE.Box3().setFromObject(withViewportOffset(renderer.buildVisualScene(scene)))
  nearArray(actualBounds.min.toArray(), visualBounds.min.toArray(), 1e-6); nearArray(actualBounds.max.toArray(), visualBounds.max.toArray(), 1e-6)
  ghosts.forEach((mesh, i) => nearArray(mesh.matrix.toArray(), matrices[i]))
  assert.equal(overlay.matrixAutoUpdate, false)
})

test('production union-highlight effect applies the display parent once', () => {
  const start = source.indexOf('  // highlight update'), effectStart = source.indexOf('useEffect(() => {', start) + 'useEffect(() => {'.length, end = source.indexOf('  }, [sceneObj, highlightPath, highlightPaths, unionHighlight, debug])', effectStart)
  assert.ok(start >= 0 && effectStart > start && end > effectStart)
  const runEffect = new Function('sceneObj', 'highlightPath', 'unionHighlight', 'debug', 'ghostRef', 'indexRef', 'setUnionMesh', 'unionMeshes', 'withViewportOffset', 'highlightPaths', source.slice(effectStart, end))
  const scene = { operation: 'union', transform: parent, children: [box({ t: [-4, 0, 0], r: [33, -28, 61] }, 1, 1.5, 2), box({ t: [4, 0, 0], r: [23, 42, -17] }, 1.2, 0.8, 1.4)] }
  const { ghostGroup, index } = renderer.buildGhostAndIndex(scene), ghostRef = { current: withViewportOffset(ghostGroup) }, indexRef = { current: index }
  let overlay
  runEffect(scene, '0', true, false, ghostRef, indexRef, value => { overlay = value }, renderer.unionMeshes, withViewportOffset)
  assert.equal(overlay.isGroup, true)
  const actual = new THREE.Box3().setFromObject(overlay), expected = new THREE.Box3().setFromObject(withViewportOffset(renderer.buildVisualScene(scene)))
  nearArray(actual.min.toArray(), expected.min.toArray(), 1e-6); nearArray(actual.max.toArray(), expected.max.toArray(), 1e-6)
})

test('multi-selection highlights the union of selected subtree meshes, deduplicating ancestor overlap', () => {
  const start = source.indexOf('  // highlight update'), effectStart = source.indexOf('useEffect(() => {', start) + 'useEffect(() => {'.length, end = source.indexOf('  }, [sceneObj, highlightPath, highlightPaths, unionHighlight, debug])', effectStart)
  assert.ok(start >= 0 && end > effectStart)
  const runEffect = new Function('sceneObj', 'highlightPath', 'unionHighlight', 'debug', 'ghostRef', 'indexRef', 'setUnionMesh', 'unionMeshes', 'withViewportOffset', 'highlightPaths', source.slice(effectStart, end))
  const scene = { operation: 'union', children: [{ operation: 'union', children: [box(), box({ t: [2, 0, 0] })] }, box({ t: [-2, 0, 0] })] }
  const { ghostGroup, index } = renderer.buildGhostAndIndex(scene)
  const ghostRef = { current: withViewportOffset(ghostGroup) }, indexRef = { current: index }
  const visible = () => [...index.get('0').meshes].filter(mesh => mesh.visible)
  runEffect(scene, '0.1', false, false, ghostRef, indexRef, () => {}, renderer.unionMeshes, withViewportOffset, ['0.0', '0.0.0'])
  assert.deepEqual(visible(), index.get('0.0').meshes)
  let unionInputs
  runEffect(scene, null, true, false, ghostRef, indexRef, () => {}, meshes => { unionInputs = meshes; return null }, withViewportOffset, ['0', '0.0', '0.0.0'])
  assert.equal(unionInputs.length, 3)
  assert.equal(new Set(unionInputs).size, 3)
  assert.deepEqual(visible(), [])
  runEffect(scene, '0.1', false, false, ghostRef, indexRef, () => {}, renderer.unionMeshes, withViewportOffset, [])
  assert.deepEqual(visible(), [], 'an explicit empty highlight set overrides the legacy path')
  runEffect(scene, '0.1', false, false, ghostRef, indexRef, () => {}, renderer.unionMeshes, withViewportOffset)
  assert.deepEqual(visible(), index.get('0.1').meshes, 'legacy single-path calls remain supported')
})

test('ray picking hits the correct sheared world face and preserves the AML path', () => {
  const scene = { operation: 'union', transform: parent, children: [box({ t: [0.4, -0.2, 1.1], r: [33, -28, 61] })] }
  const visual = withViewportOffset(renderer.buildVisualScene(scene)); visual.updateMatrixWorld(true)
  const expected = mul(referenceTRS({ t: VIEWPORT_SCENE_OFFSET }), expectedMeshes(scene)[0].world), matrix = new THREE.Matrix4().fromArray(expected)
  const faceCenter = new THREE.Vector3(0, 0, 2.5).applyMatrix4(matrix), outward = new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix)).normalize()
  const ray = new THREE.Raycaster(faceCenter.clone().addScaledVector(outward, 20), outward.clone().negate())
  const hits = ray.intersectObject(visual, true)
  assert.ok(hits.length > 0)
  assert.equal(hits[0].object.userData.path, '0.0')
  near(hits[0].point.distanceTo(faceCenter), 0, 1e-8)
  const hitNormal = hits[0].face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hits[0].object.matrixWorld)).normalize()
  near(hitNormal.dot(outward), 1)
})
