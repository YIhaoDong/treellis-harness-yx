import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as THREE from 'three'
import { inspectGeometry, buildEditContext, evaluateChecks } from '../src/generation/geometry.mjs'

const cube = (w = 1, transform, name) => ({ name, primitive: { type: 'cube', w, h: 1, d: 1 }, ...(transform ? { transform } : {}) })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)

test('primitive meshes yield finite world extents and reject unsupported types', () => {
  const report = inspectGeometry(cube(4, { t: [2, 3, 4], r: [0, 0, 90], s: [1, 2, 1] }))
  assert.equal(report.ok, true, report.errors.join('\n'))
  report.bounds.center.forEach((n, i) => near(n, [2, 3, 4][i]))
  report.bounds.size.forEach((n, i) => near(n, [2, 4, 1][i]))
  assert.equal(report.stats.primitiveCount, 1)
  assert.equal(inspectGeometry({ primitive: { type: 'mesh' } }).ok, false)
  assert.match(inspectGeometry(cube(1, { t: [NaN, 0, 0] })).errors[0], /non-finite/)
  assert.equal(inspectGeometry({}).ok, false)
})

test('all supported primitive types build using real Three.js geometry', () => {
  for (const type of ['cube', 'sphere', 'cone', 'cylinder', 'torus']) {
    const report = inspectGeometry({ primitive: { type } })
    assert.equal(report.ok, true, `${type}: ${report.errors.join('; ')}`)
    assert.ok(report.stats.vertices > 0)
  }
})

test('repeat count, interpolation and child matrix order match pure renderer utility', async () => {
  const source = await fs.readFile(new URL('../src/utils/repeat.jsx', import.meta.url), 'utf8')
  const repeat = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  for (const type of ['linear', 'circular']) {
    const root = { name: 'array', transform: { t: [3, 2, -2], r: [0, 30, 0] }, repeat: { type, count: 4, radius: 3, t: [2, 4, 6], r: [0, 60, 0], s: [2, 3, 4] }, children: [cube(1, { t: [1, 0, 0] })] }
    const report = inspectGeometry(root)
    assert.equal(report.ok, true, report.errors.join('; '))
    assert.equal(report.nodes['0'].primitiveCount, 4)
    assert.equal(report.nodes['0.0'].primitiveCount, 4)
    const make = tf => new THREE.Matrix4().compose(new THREE.Vector3(...(tf.t || [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(tf.r || [0, 0, 0]).map(THREE.MathUtils.degToRad), 'XYZ')), new THREE.Vector3(...(tf.s || [1, 1, 1])))
    repeat.computeRepeatInstances(root).forEach((instance, i) => {
      const expected = make(root.transform).multiply(make(instance)).multiply(make(root.children[0].transform)).toArray()
      report.nodes['0.0'].worldMatrices[i].forEach((value, j) => near(value, expected[j]))
    })
  }
})

test('nested repeat expands primitive counts and clamps like renderer', () => {
  const report = inspectGeometry({ repeat: { count: 3, t: [3, 0, 0] }, children: [{ repeat: { count: 2, t: [0, 4, 0] }, children: [cube()] }] })
  assert.equal(report.ok, true, report.errors.join('; '))
  assert.equal(report.nodes['0'].primitiveCount, 6)
  assert.equal(report.nodes['0.0.0'].primitiveCount, 6)
  near(report.bounds.size[0], 4)
  near(report.bounds.size[1], 5)
  const clamped = inspectGeometry({ repeat: { count: 0 }, children: [cube()] })
  assert.equal(clamped.stats.primitiveCount, 1)
  assert.match(clamped.warnings.join('; '), /clamped/)
})

test('real CSG detects empty subtraction and intersection and accepts nonempty result', () => {
  const subtract = inspectGeometry({ operation: 'subtract', children: [cube(1), cube(4)] })
  assert.equal(subtract.ok, false)
  assert.match(subtract.errors.join('; '), /empty geometry/)
  const intersection = inspectGeometry({ operation: 'intersection', children: [cube(), cube(1, { t: [4, 0, 0] })] })
  assert.equal(intersection.ok, false)
  assert.match(intersection.errors.join('; '), /empty geometry/)
  const cut = inspectGeometry({ operation: 'subtract', children: [cube(4), cube(1, { t: [1, 0, 0] })] })
  assert.equal(cut.ok, true, cut.errors.join('; '))
  assert.equal(cut.stats.csgOperations, 1)
  assert.equal(cut.nodes['0'].primitiveCount, 2)
  near(cut.bounds.size[0], 4)
})

test('repeat templates expand inside CSG with world transforms', () => {
  const report = inspectGeometry({ operation: 'subtract', transform: { t: [2, 0, 0] }, children: [cube(6), { repeat: { count: 2, t: [2, 0, 0] }, transform: { t: [-1, 0, 0] }, children: [cube(0.5)] }] })
  assert.equal(report.ok, true, report.errors.join('; '))
  assert.equal(report.nodes['0.1'].primitiveCount, 2)
  assert.equal(report.nodes['0.1.0'].primitiveCount, 2)
  near(report.bounds.center[0], 2)
  assert.ok(report.stats.csgOperations >= 2)
  assert.match(inspectGeometry({ repeat: { count: 3, s: [-1, 1, 1] }, children: [cube()] }).errors.join('; '), /degenerate/)
})

test('remaining budgets guard expanded instances, unrepresentable tessellation and explicit CSG output limits', () => {
  assert.match(inspectGeometry({ repeat: { count: 4 }, children: [cube()] }, { maxInstances: 2 }).errors.join('; '), /instance budget/)
  assert.match(inspectGeometry({ primitive: { type: 'sphere', widthSegments: 1e9 } }).errors.join('; '), /representation|represented|tessellation/)
  assert.match(inspectGeometry({ operation: 'subtract', children: [cube(4), cube()] }, { maxVertices: 55 }).errors.join('; '), /CSG result exceeds vertex budget/)
})

test('default geometry validation accepts meshes above the former 500000 vertex ceiling', () => {
  const scene = { children: [256, 44].map(count => ({ repeat: { count, t: [20, 0, 0] }, children: [{ primitive: { type: 'torus' } }] })) }
  const report = inspectGeometry(scene)
  assert.equal(report.ok, true, report.errors.join('; '))
  assert.equal(report.stats.primitiveCount, 300)
  assert.equal(report.stats.meshCount, 300)
  assert.equal(report.stats.vertices, 300 * 17 * 101)
  assert.ok(report.stats.vertices > 500000)
  assert.match(inspectGeometry(scene, { maxVertices: 500000 }).errors.join('; '), /vertex budget/)
})

test('cumulative CSG intermediates can exceed 500000 vertices while the final mesh remains compact', () => {
  const scene = { operation: 'subtract', children: [
    { operation: 'union', children: Array.from({ length: 168 }, (_, i) => cube(1, { t: [i * 2, 0, 0] })) },
    cube(1, { t: [-10, 0, 0] })
  ] }
  const report = inspectGeometry(scene)
  assert.equal(report.ok, true, report.errors.join('; '))
  assert.ok(report.stats.generatedVertices > 500000, JSON.stringify(report.stats))
  assert.equal(report.stats.vertices, 168 * 36)
  assert.equal(report.stats.meshCount, 1)
  assert.equal(report.stats.csgOperations, 168)
  near(report.bounds.size[0], 335)
  near(report.bounds.size[1], 1)
  near(report.bounds.size[2], 1)
  assert.match(inspectGeometry(scene, { maxVertices: 500000 }).errors.join('; '), /CSG result exceeds vertex budget/)
})

test('objective checks validate counts, extents, relative extents and alignment', () => {
  const report = inspectGeometry({ children: [cube(4), cube(2, { t: [0, 2, 0] })] })
  const base = { path: '0.0', otherPath: '0.1', axis: 'x', comparison: 'eq', value: 0, tolerance: 0.001 }
  const good = evaluateChecks(report, [
    { ...base, kind: 'count', path: '0', value: 2 },
    { ...base, kind: 'extent', value: 4 },
    { ...base, kind: 'relative_extent', value: 2 },
    { ...base, kind: 'align', value: 0 }
  ])
  assert.equal(good.ok, true, good.errors.join('; '))
  assert.equal(evaluateChecks(report, [{ ...base, kind: 'extent', value: 5 }]).ok, false)
  assert.equal(evaluateChecks(report, [{ ...base, kind: 'extent', path: '0.99' }]).ok, false)
  assert.equal(evaluateChecks(report, [{ ...base, kind: 'extent', comparison: 'invalid' }]).ok, false)
})

test('local edit context includes world matrices and bounded summaries without full scene', () => {
  const root = { name: 'scene', transform: { t: [10, 0, 0] }, children: [{ name: 'assembly', transform: { t: [0, 2, 0] }, children: [cube(2, { t: [3, 0, 0] }, 'selected'), cube(1, { t: [0, 2, 0] }, 'sibling')] }, cube(3, { t: [20, 0, 0] }, 'remote')] }
  const context = buildEditContext(root, '0.0.0')
  assert.equal(context.geometryOk, true)
  assert.equal(context.ancestorChain.length, 2)
  assert.equal(context.siblings[0].name, 'sibling')
  assert.ok(context.relatedParts.some(part => part.name === 'remote'))
  near(context.selectedBounds.center[0], 13)
  near(context.selectedBounds.center[1], 2)
  assert.deepEqual(context.selectedLocalTransform.t, [3, 0, 0])
  assert.equal(context.selectedWorldMatrices[0][12], 13)
  assert.equal('scene' in context, false)
  assert.equal('children' in context, false)
  assert.equal(buildEditContext(root, '0.99').selectedExists, false)
})
