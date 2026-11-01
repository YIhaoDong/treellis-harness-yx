import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Matrix4, Vector3, Quaternion, Euler, MathUtils } from 'three'
import { groupSceneNodes, ungroupSceneNode, analyzeGroupingSelection, applyGroupingPlan, groupingSynopsis } from '../src/utils/sceneGrouping.mjs'

const sphere = (name, x = 0) => ({ name, uid: `id-${name}`, primitive: { type: 'sphere', r: 0.2, material: { color: '#aabbcc', roughness: 0.6 } }, transform: { t: [x, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } })
const union = (name, children) => ({ name, operation: 'union', children })
const scene = () => union('Propeller Assembly', [sphere('Backplate'), sphere('Blade A', -1), sphere('Spinner'), sphere('Blade B', 1), sphere('Hub')])
const clone = value => JSON.parse(JSON.stringify(value))
const trs = tf => new Matrix4().compose(new Vector3(...(tf?.t || [0, 0, 0])), new Quaternion().setFromEuler(new Euler(...(tf?.r || [0, 0, 0]).map(MathUtils.degToRad), 'XYZ')), new Vector3(...(tf?.s || [1, 1, 1])))
function frames(root) {
  const result = new Map()
  function visit(node, path, parent) {
    const world = parent.clone().multiply(trs(node.transform))
    result.set(path, { node, world })
    ;(node.children || []).forEach((child, i) => visit(child, `${path}.${i}`, world))
  }
  visit(root, '0', new Matrix4()); return result
}
function sameFrames(before, result, removed = []) {
  const original = frames(before), after = frames(result.scene)
  for (const [path, old] of original) {
    if (removed.includes(path)) continue
    const current = after.get(result.pathMap[path])
    assert.ok(current, `map for ${path}`)
    for (let i = 0; i < 16; i++) assert.ok(Math.abs(current.world.elements[i] - old.world.elements[i]) < 1e-8, `matrix ${path}/${i}`)
    assert.deepEqual(current.node.primitive, old.node.primitive)
    assert.equal(current.node.uid, old.node.uid)
  }
}

test('Blade siblings group in original order at first member; all paths and descendants remap', () => {
  const input = scene(), before = clone(input)
  const result = groupSceneNodes(input, ['0.3', '0.1'], 'Blades')
  assert.deepEqual(input, before)
  assert.deepEqual(result.scene.children.map(node => node.name), ['Backplate', 'Blades', 'Spinner', 'Hub'])
  assert.deepEqual(result.scene.children[1].children, [before.children[1], before.children[3]])
  assert.deepEqual(result.pathMap, { '0': '0', '0.0': '0.0', '0.1': '0.1.0', '0.2': '0.2', '0.3': '0.1.1', '0.4': '0.3' })
  assert.deepEqual(result.selectedPaths, ['0.1'])
  sameFrames(before, result)
  const ungrouped = ungroupSceneNode(result.scene, '0.1')
  assert.deepEqual(ungrouped.scene.children.map(node => node.name), ['Backplate', 'Blade A', 'Blade B', 'Spinner', 'Hub'])
  sameFrames(result.scene, ungrouped, ['0.1'])
})

test('struts and wire subtrees get useful separate groups while preserving every metadata field', () => {
  const input = union('Wings', [sphere('Strut FL'), sphere('Strut FR'), sphere('Cabane L'), sphere('Cabane R'), union('Wires', [sphere('Wire A'), sphere('Wire B')])])
  input.children[4].uid = 'wires-id'
  const result = applyGroupingPlan(input, { groups: [{ name: 'Wing Struts', members: ['0.0', '0.1'] }, { name: 'Cabane', members: ['0.2', '0.3'] }] })
  assert.deepEqual(result.scene.children.map(node => node.name), ['Wing Struts', 'Cabane', 'Wires'])
  assert.equal(result.pathMap['0.4.1'], '0.2.1')
  sameFrames(input, result)
})

test('scoped plans allow siblings inside scope but reject crossing scope, duplicate and overlapping members', () => {
  const input = union('Root', [scene(), scene()]), before = clone(input)
  assert.equal(applyGroupingPlan(input, { groups: [{ name: 'Blades', members: ['0.0.1', '0.0.3'] }] }, '0.0').groups.length, 1)
  for (const [groups, scope] of [
    [[{ name: 'Cross scope', members: ['0.1.1', '0.1.3'] }], '0.0'],
    [[{ name: 'Duplicate', members: ['0.0.1', '0.0.1'] }], '0'],
    [[{ name: 'Parents', members: ['0.0', '0.1'] }, { name: 'Blades', members: ['0.0.1', '0.0.3'] }], '0'],
    [[{ name: 'Different parents', members: ['0.0.1', '0.1.3'] }], '0'],
  ]) assert.throws(() => applyGroupingPlan(input, { groups }, scope))
  assert.deepEqual(input, before)
})

test('Boolean and Repeat subtrees move atomically but their internal scopes are protected', () => {
  const boolean = { name: 'Cut', operation: 'subtract', children: [union('Solids', [sphere('A'), sphere('B')]), sphere('Hole')] }
  const repeat = { name: 'Row', repeat: { type: 'linear', count: 3, t: [2, 0, 0] }, children: [union('Template', [sphere('C'), sphere('D')])] }
  const input = union('Root', [boolean, repeat, sphere('Other')])
  const result = groupSceneNodes(input, ['0.0', '0.1'], 'Assemblies')
  sameFrames(input, result)
  for (const paths of [['0.0.0.0', '0.0.0.1'], ['0.1.0.0', '0.1.0.1'], ['0.0.0', '0.0.1']]) {
    assert.throws(() => groupSceneNodes(input, paths), { code: 'UNSAFE_SCOPE' })
    assert.equal(analyzeGroupingSelection(input, paths).canGroup, false)
  }
  assert.deepEqual(groupingSynopsis(input).parents.map(parent => parent.path), ['0'])
  assert.throws(() => ungroupSceneNode(input, '0.0'), { code: 'UNSAFE_SCOPE' })
})

test('transformed Union ungroup composes parent-local TRS without moving descendants', () => {
  const group = union('Blades', [sphere('A', -1), union('B assembly', [sphere('B', 1)])])
  group.transform = { t: [3, -2, 1], r: [40, 30, 20], s: [2, 2, 2] }
  group.children[0].transform.extraMeta = 'preserved'
  const input = union('Root', [sphere('Hub'), group]), before = clone(input)
  input.transform = { t: [-4, 6, 2], r: [5, 10, 15], s: [1, 2, 3] }
  const result = ungroupSceneNode(input, '0.1')
  assert.deepEqual(input.children[1], before.children[1])
  assert.equal(result.scene.children[1].transform.extraMeta, 'preserved')
  assert.equal(result.pathMap['0.1'], '0')
  sameFrames(input, result, ['0.1'])
})

test('nonrepresentable shear is rejected atomically', () => {
  const group = union('Sheared', [sphere('A'), sphere('B')])
  group.transform = { s: [2, 1, 1] }; group.children[0].transform.r = [0, 0, 45]
  const input = union('Root', [group]), before = clone(input)
  assert.throws(() => ungroupSceneNode(input, '0.0'), { code: 'NON_TRS_TRANSFORM' })
  assert.deepEqual(input, before)
})

test('identity group/ungroup preserves child TRS JSON exactly, including absent transforms', () => {
  const input = scene(); delete input.children[1].transform
  const grouped = groupSceneNodes(input, ['0.1', '0.3'])
  const ungrouped = ungroupSceneNode(grouped.scene, '0.1')
  assert.deepEqual(ungrouped.scene.children[1], input.children[1])
  assert.deepEqual(ungrouped.scene.children[2], input.children[3])
})

test('empty plan is an identity no-op, invalid geometry and invalid plan fields are rejected', () => {
  const input = scene(), result = applyGroupingPlan(input, { groups: [], message: 'Already organized.' })
  assert.equal(result.scene, input); assert.equal(result.changed, false)
  assert.deepEqual(result.pathMap, Object.fromEntries([...frames(input).keys()].map(path => [path, path])))
  for (const plan of [null, [], {}, { groups: [], scene: input }, { groups: [{ name: 'Bad', members: ['0.1', '0.3'], transform: {} }] }, { groups: [{ name: ' ', members: ['0.1', '0.3'] }] }, { groups: [{ name: 'Bad', members: ['0.1', '0.99'] }] }]) assert.throws(() => applyGroupingPlan(input, plan))
  const invalid = scene(); invalid.children[1].primitive.r = -1
  assert.throws(() => groupSceneNodes(invalid, ['0.1', '0.3']), { code: 'INVALID_SCENE' })
  assert.throws(() => groupSceneNodes(input, ['0', '0.1']))
  assert.throws(() => ungroupSceneNode(input, '0'))
  assert.throws(() => ungroupSceneNode(input, '0.1'))
  assert.equal(analyzeGroupingSelection(input, ['0.1', '0.3']).canGroup, true)
  assert.equal(analyzeGroupingSelection(union('Root', [input]), ['0.0']).canUngroup, true)
})

test('regrouping respects AML node and depth budgets', () => {
  const leaves = Array.from({ length: 128 }, (_, i) => sphere(`A${i}`))
  const input = union('Root', [union('A', leaves), union('B', leaves.slice(0, 127)), union('C', leaves.slice(0, 127)), union('D', leaves.slice(0, 125))])
  // 1 root + 4 groups + 507 leaves = 512, so another wrapper is rejected.
  assert.equal(frames(input).size, 512)
  assert.throws(() => groupSceneNodes(input, ['0.0.0', '0.0.1']), { code: 'INVALID_SCENE' })
  let deep = union('Deep', [sphere('A'), sphere('B')]), path = '0'
  for (let i = 0; i < 30; i++) { deep = union(`Level ${i}`, [deep]); path += '.0' }
  assert.equal(frames(deep).size, 33)
  assert.throws(() => groupSceneNodes(deep, [`${path}.0`, `${path}.1`]), { code: 'INVALID_SCENE' })
})

test('shipped aircraft Blade and strut groups preserve all descendants and world matrices', () => {
  // The public scene is user-editable; regress against the frozen shipped aircraft.
  const input = JSON.parse(fs.readFileSync(new URL('./fixtures/default-aircraft.json', import.meta.url), 'utf8')).scene
  let bladePaths, strutPaths
  for (const [path, { node }] of frames(input)) {
    const blades = (node.children || []).map((child, i) => /Blade [AB]/.test(child.name || '') ? `${path}.${i}` : null).filter(Boolean)
    const struts = (node.children || []).map((child, i) => /^Strut [FR][LR]$/.test(child.name || '') ? `${path}.${i}` : null).filter(Boolean)
    if (blades.length === 2) bladePaths = blades
    if (struts.length >= 2) strutPaths = struts
  }
  assert.ok(bladePaths); assert.ok(strutPaths)
  sameFrames(input, groupSceneNodes(input, bladePaths, 'Blades'))
  sameFrames(input, groupSceneNodes(input, strutPaths, 'Wing Struts'))
})
