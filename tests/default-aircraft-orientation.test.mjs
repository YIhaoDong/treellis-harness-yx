import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from 'three'

// Geometric regression for the shipped aircraft asset, independent of Euler
// spellings. A torus and a cylinder with identical r values have different axes.
// Freeze the shipped fixture: public/scene.json also stores the user's working scene.
const scene = JSON.parse(fs.readFileSync(new URL('./fixtures/default-aircraft.json', import.meta.url))).scene
const repeatSource = fs.readFileSync(new URL('../src/utils/repeat.jsx', import.meta.url), 'utf8')
const { computeRepeatInstances, isRepeatNode } = await import(`data:text/javascript;base64,${Buffer.from(repeatSource).toString('base64')}`)
const frames = new Map(), primitives = new Map()
const trs = (t = {}) => new THREE.Matrix4().compose(new THREE.Vector3(...(t.t || [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(t.r || [0, 0, 0]).map(THREE.MathUtils.degToRad), 'XYZ')), new THREE.Vector3(...(t.s || [1, 1, 1])))
const col = (m, i) => new THREE.Vector3().setFromMatrixColumn(m, i)
const axis = (m, i) => col(m, i).normalize()
const ringNormal = m => new THREE.Vector3().crossVectors(col(m, 0), col(m, 1)).normalize()
const center = m => new THREE.Vector3().setFromMatrixPosition(m)
const parallel = (actual, expected, description) => assert.ok(Math.abs(actual.dot(expected)) > 1 - 1e-10, `${description}: ${actual.toArray()} vs ${expected.toArray()}`)
const close = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) < epsilon, `${a} vs ${b}`)
const add = (map, path, entry) => { if (!map.has(path)) map.set(path, []); map.get(path).push(entry) }
function walk(node, path = '0', parent = new THREE.Matrix4(), repeated = []) {
  const world = parent.clone().multiply(trs(node.transform))
  add(frames, path, { node, world, repeated })
  const template = (m, instances) => {
    if (node.primitive) add(primitives, path, { node, world: m, repeated: instances })
    ;(node.children || []).forEach((child, i) => walk(child, `${path}.${i}`, m, instances))
  }
  if (isRepeatNode(node)) computeRepeatInstances(node).forEach((instance, i) => template(world.clone().multiply(trs(instance)), [...repeated, { path, i }]))
  else template(world, repeated)
}
walk(scene)
const first = path => (primitives.get(path) || frames.get(path))[0]
const root = frames.get('0')[0].world, forward = axis(root, 0), up = axis(root, 1), span = axis(root, 2)

test('native round primitives retain distinct axis conventions', () => {
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 3, 32), torus = new THREE.TorusGeometry(2, 0.2, 16, 100)
  cylinder.computeBoundingBox(); torus.computeBoundingBox()
  const c = cylinder.boundingBox.getSize(new THREE.Vector3()), t = torus.boundingBox.getSize(new THREE.Vector3())
  close(c.y, 3); close(c.x, 1); close(c.z, 1)
  close(t.z, 0.4, 1e-6); assert.ok(t.x > 4.3 && t.y > 4.3)
  cylinder.dispose(); torus.dispose()
})

test('all longitudinal cowling, panel, gun and propeller rings are coaxial', () => {
  const pairs = [['0.0.2', '0.0.1'], ['0.0.3', '0.0.1'], ['0.0.5.0', '0.0.0.0.0'], ['0.0.10.2.0', '0.0.10.1.0'], ['0.3.4', '0.3.0']]
  let checked = 0
  for (const [ringPath, shaftPath] of pairs) for (const ring of primitives.get(ringPath)) {
    const refs = primitives.get(shaftPath)
    const shaft = refs.reduce((a, b) => center(b.world).distanceToSquared(center(ring.world)) < center(a.world).distanceToSquared(center(ring.world)) ? b : a)
    const a = axis(shaft.world, 1), delta = center(ring.world).sub(center(shaft.world))
    parallel(ringNormal(ring.world), a, ringPath)
    close(delta.addScaledVector(a, -delta.dot(a)).length(), 0)
    checked++
  }
  assert.equal(checked, 20)
})

test('elliptical panel joints follow the fuselage cross-section rather than stretching their normal', () => {
  const ring = first('0.0.5.0'), fuselage = first('0.0.0.0.0')
  const fuselageVerticalRadius = fuselage.node.primitive.r * col(fuselage.world, 0).length()
  const fuselageLateralRadius = fuselage.node.primitive.r * col(fuselage.world, 2).length()
  parallel(axis(ring.world, 0), up, 'joint vertical semiaxis')
  parallel(axis(ring.world, 1), span, 'joint lateral semiaxis')
  assert.ok(Math.abs(ring.node.primitive.r * col(ring.world, 0).length() - fuselageVerticalRadius) < 0.01)
  assert.ok(Math.abs(ring.node.primitive.r * col(ring.world, 1).length() - fuselageLateralRadius) < 0.01)
  close(col(ring.world, 2).length(), 1)
})

test('cockpit coaming follows the tilted recess plane and both ellipse semiaxes', () => {
  const ring = first('0.0.9.0'), recess = first('0.0.0.1')
  parallel(ringNormal(ring.world), axis(recess.world, 1), 'coaming opening normal')
  parallel(axis(ring.world, 0), axis(recess.world, 0), 'coaming longitudinal ellipse axis')
  parallel(axis(ring.world, 1), axis(recess.world, 2), 'coaming lateral ellipse axis')
  close(ring.node.primitive.r * col(ring.world, 0).length(), 0.9295)
  close(ring.node.primitive.r * col(ring.world, 1).length(), 0.5915)
  assert.ok(Math.abs(center(ring.world).sub(center(recess.world)).dot(axis(recess.world, 1))) < 0.021)
})

test('windscreen frame is a frontal upper arch with the intended vertical flattening', () => {
  const ring = first('0.0.9.8.0'), screen = first('0.0.9.7.0'), trim = first('0.0.9.8.1')
  parallel(ringNormal(ring.world), forward, 'windscreen frontal normal')
  parallel(axis(ring.world, 0), up, 'windscreen short vertical radius')
  parallel(axis(ring.world, 1), span, 'windscreen lateral radius')
  close(center(ring.world).distanceTo(center(screen.world)), 0)
  close(ring.node.primitive.r * col(ring.world, 0).length(), 0.6006)
  close(ring.node.primitive.r * col(ring.world, 1).length(), 0.66)
  const trimBottom = center(trim.world).addScaledVector(axis(trim.world, 1), -trim.node.primitive.h / 2)
  close(trimBottom.sub(center(ring.world)).dot(up), 0)
})

test('both tire torus planes, wheel cylinders, hubs, caps and tread circles share the axle', () => {
  for (const tire of primitives.get('0.4.5.0')) {
    parallel(ringNormal(tire.world), span, 'tire plane')
    const nearest = [...primitives.get('0.4.3'), ...primitives.get('0.4.4')].sort((a, b) => center(a.world).distanceToSquared(center(tire.world)) - center(b.world).distanceToSquared(center(tire.world)))[0]
    close(center(tire.world).distanceTo(center(nearest.world)), 0)
    parallel(ringNormal(tire.world), axis(nearest.world, 1), 'tire/wheel axis')
  }
  for (const path of ['0.4.0', '0.4.3', '0.4.4', '0.4.6.0', '0.4.6.1', '0.4.6.2.0']) for (const e of primitives.get(path)) parallel(axis(e.world, 1), span, path)
  for (const e of frames.get('0.4.5.1')) parallel(axis(e.world, 1), span, 'native-Y tread repeat frame')
  const treads = primitives.get('0.4.5.1.0')
  assert.equal(treads.length, 40)
  for (const tread of treads) {
    const outerIndex = tread.repeated.find(e => e.path === '0.4.5').i
    const repeat = frames.get('0.4.5.1')[outerIndex]
    const radial = center(tread.world).sub(center(repeat.world))
    close(radial.length(), 0.99)
    close(radial.dot(span), 0)
    parallel(axis(tread.world, 0), radial.normalize(), 'tread rib radial orientation')
  }
})

test('correct cylinder, repeat, wingtip, leading-edge and instrument orientations remain correct', () => {
  for (const path of ['0.0.7.0.0.0', '0.0.7.0.0.1', '0.1.0.1', '0.1.1.2', '0.2.2']) for (const e of primitives.get(path)) parallel(axis(e.world, 1), span, path)
  for (const path of ['0.1.0.0.1.0', '0.1.1.0.1.0', '0.1.0.5.0', '0.1.0.5.1', '0.1.0.5.2', '0.2.3.0']) for (const e of primitives.get(path)) parallel(axis(e.world, 1), up, path)
  for (const e of primitives.get('0.0.9.5.0')) parallel(axis(e.world, 1), forward, 'instrument dial')
  parallel(axis(frames.get('0.0.4')[0].world, 1), forward, 'cowling bolt circle')
  for (const path of ['0.1.0.0.0', '0.1.1.0.0']) {
    const e = first(path)
    parallel(axis(e.world, 0), span, `${path} wing span`)
    parallel(axis(e.world, 1), up, `${path} wing normal`)
    parallel(axis(e.world, 2), forward, `${path} wing chord`)
  }
})

test('the existing aircraft bank, control-stick lean, assembly topology and repeat multiplicity are retained', () => {
  assert.equal(scene.name, 'Toy Biplane (Stylized)')
  assert.deepEqual(scene.transform.r, [0, 0, -13])
  close(THREE.MathUtils.radToDeg(Math.acos(Math.abs(axis(first('0.0.9.6').world, 1).dot(up)))), 12)
  assert.equal(frames.size, 128)
  assert.equal(primitives.size, 81)
  assert.equal([...primitives.values()].reduce((count, entries) => count + entries.length, 0), 265)
  assert.equal([...primitives.values()].filter(entries => entries[0].node.primitive.type === 'torus').reduce((count, entries) => count + entries.length, 0), 24)
})
