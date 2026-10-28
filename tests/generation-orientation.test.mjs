import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { inspectGeometry, evaluateChecks } from '../src/generation/geometry.mjs'
import { createResponseFormat, applyGenerationEnvelope } from '../src/generation/amlContract.mjs'
import { runGeneration } from '../src/generation/pipeline.mjs'
import { ASSET_NAMES } from '../src/generation/config.mjs'

const axial = (type, r = [0, 0, 0], t = [0, 0, 0]) => ({ name: type, primitive: type === 'torus' ? { type, r: 1, t: .15 } : { type, r: .3, h: 2 }, transform: { r, t, s: [1, 1, 1] } })
const group = (children, transform) => ({ name: 'assembly', operation: 'union', children, ...(transform ? { transform } : {}) })
const check = (kind, path = '0.0', otherPath = '0.1', extra = {}) => ({ kind, path, otherPath, axis: 'x', comparison: 'eq', value: kind === 'axis_distance' ? 0 : 1, tolerance: 1e-6, ...extra })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

test('copying cylinder Euler to torus fails, native-axis correction passes', () => {
  const scene = group([axial('cylinder', [0, 0, 90]), axial('torus', [0, 0, 90])])
  const checks = [check('axis_parallel'), check('axis_distance'), check('axis_direction')]
  let report = evaluateChecks(inspectGeometry(scene), checks)
  assert.equal(report.ok, false)
  assert.equal(report.results[0].actual, 0)
  scene.children[1].transform.r = [0, 90, 0]
  report = evaluateChecks(inspectGeometry(scene), checks)
  assert.equal(report.ok, true, report.errors.join('; '))
})

test('opposite axial directions are equivalent and concentric centers may differ along axis', () => {
  const report = inspectGeometry(group([axial('cone', [0, 0, -90], [3, 0, 0]), axial('torus', [0, -90, 0], [-2, 0, 0])]))
  const result = evaluateChecks(report, [check('axis_parallel'), check('axis_distance')])
  assert.equal(result.ok, true, result.errors.join('; '))
  near(result.results[1].actual, 0)
})

test('parallel but offset axes fail distance, intersecting perpendicular axes fail parallel', () => {
  const scene = group([axial('cylinder'), axial('torus', [90, 0, 0], [1, 0, 0])])
  const checks = [check('axis_parallel'), check('axis_distance')]
  let result = evaluateChecks(inspectGeometry(scene), checks)
  assert.equal(result.results[0].passed, true)
  near(result.results[1].actual, 1)
  scene.children[1] = axial('torus')
  result = evaluateChecks(inspectGeometry(scene), checks)
  assert.equal(result.results[0].passed, false)
  assert.equal(result.results[1].passed, true)
  assert.equal(result.ok, false)
})

test('torus axis uses true transformed plane normal under parent shear', () => {
  const parent = new THREE.Matrix4().makeScale(2, 1, 3)
  const local = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.3, .6, .8, 'XYZ'))
  const world = parent.clone().multiply(local)
  const scene = group([axial('torus', [.3, .6, .8].map(THREE.MathUtils.radToDeg))], { s: [2, 1, 3] })
  const report = inspectGeometry(scene)
  assert.equal(report.ok, true, report.errors.join('; '))
  const measured = new THREE.Vector3(...report.nodes['0.0'].axisInstances[0].direction)
  const tangentX = new THREE.Vector3(1, 0, 0).transformDirection(world)
  const tangentY = new THREE.Vector3(0, 1, 0).transformDirection(world)
  const independentNormal = tangentX.cross(tangentY).normalize()
  near(Math.abs(measured.dot(independentNormal)), 1)
  assert.ok(Math.abs(measured.dot(new THREE.Vector3(0, 0, 1).transformDirection(world))) < .99)
})

test('checks evaluate all repeat instances, including failing instances beyond four matrix samples', () => {
  const scene = { name: 'array', repeat: { type: 'linear', count: 6, r: [0, 0, 10], t: [0, 0, 0], s: [1, 1, 1] }, children: [axial('cylinder')] }
  const report = inspectGeometry(scene)
  assert.equal(report.nodes['0.0'].worldMatrices.length, 4)
  assert.equal(report.nodes['0.0'].axisInstances.length, 6)
  const result = evaluateChecks(report, [check('axis_direction', '0.0', '', { axis: 'y', tolerance: .007 })])
  assert.equal(result.ok, false)
  near(result.results[0].actual, Math.cos(THREE.MathUtils.degToRad(10)))
  for (const sample of report.nodes['0.0'].axisInstances.slice(0, 4)) assert.ok(Math.abs(sample.direction[1] - 1) < .007)
})

test('circular container rotation determines ring plane, repeat.r only orients templates', () => {
  const scene = group([axial('torus'), { name: 'bolts', transform: { r: [90, 0, 0] }, repeat: { type: 'circular', count: 8, radius: 1 }, children: [axial('cylinder')] }])
  const report = inspectGeometry(scene)
  const result = evaluateChecks(report, [check('axis_parallel', '0.1.0', '0.0'), check('axis_direction', '0.1.0', '', { axis: 'z' })])
  assert.equal(result.ok, true, result.errors.join('; '))
  for (const instance of report.nodes['0.1.0'].axisInstances) near(instance.center[2], 0)
})

test('equal repeat counts pair by traversal order, singleton broadcasts, mismatched counts fail', () => {
  const array = (count, child) => ({ repeat: { type: 'linear', count, t: [4, 0, 0] }, children: [child] })
  const scene = group([array(3, axial('cylinder')), array(3, axial('torus', [90, 0, 0]))])
  const checks = [check('axis_parallel', '0.0.0', '0.1.0'), check('axis_distance', '0.0.0', '0.1.0')]
  assert.equal(evaluateChecks(inspectGeometry(scene), checks).ok, true)
  scene.children[1].repeat.count = 2
  let result = evaluateChecks(inspectGeometry(scene), checks)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('; '), /counts differ/)
  scene.children[1] = axial('torus', [90, 0, 0])
  result = evaluateChecks(inspectGeometry(scene), [check('axis_parallel', '0.0.0', '0.1')])
  assert.equal(result.ok, true, result.errors.join('; '))
})

test('unsupported group/sphere and incomplete axis records cannot pass', () => {
  const scene = group([axial('cylinder'), axial('torus', [90, 0, 0])])
  const report = inspectGeometry(scene)
  assert.equal(evaluateChecks(report, [check('axis_direction', '0')]).ok, false)
  report.nodes['0.0'].axisInstances = []
  assert.equal(evaluateChecks(report, [check('axis_parallel')]).ok, false)
  const sphere = inspectGeometry({ primitive: { type: 'sphere', r: 1 } })
  assert.equal(evaluateChecks(sphere, [check('axis_direction', '0')]).ok, false)
})

test('strict schema accepts axis check enums and rejects noncanonical comparison/value', () => {
  const schemaKinds = createResponseFormat().schema.properties.checks.items.properties.kind.enum
  assert.ok(schemaKinds.includes('axis_parallel'))
  const scene = group([axial('cylinder'), axial('torus', [90, 0, 0])])
  const envelope = { action: 'patch', replacement: null, patches: [], message: 'Verified', plan: [], checks: [check('axis_parallel')] }
  assert.equal(applyGenerationEnvelope(envelope, { mode: 'edit', scene }).action, 'patch')
  envelope.checks[0].comparison = 'ge'
  assert.throws(() => applyGenerationEnvelope(envelope, { mode: 'edit', scene }), /Axis checks/)
  assert.equal(evaluateChecks(inspectGeometry(scene), envelope.checks).ok, false)
})

test('distance alone cannot certify coaxiality without a parallel-axis constraint', () => {
  const scene = group([axial('cylinder'), axial('torus')])
  const checks = [check('axis_distance')]
  const result = evaluateChecks(inspectGeometry(scene), checks)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('; '), /requires an axis_parallel/)
  assert.throws(() => applyGenerationEnvelope({ action: 'patch', replacement: null, patches: [], message: 'verified', plan: [], checks }, { mode: 'edit', scene }), /requires an axis_parallel/)
})

test('degree-like tolerance cannot make perpendicular axes pass alignment or coaxiality', () => {
  const scene = group([axial('cylinder'), axial('torus')])
  const geometry = inspectGeometry(scene)
  for (const tolerance of [.02, .5, 1, 3]) {
    const checks = [check('axis_parallel', '0.0', '0.1', { tolerance }), check('axis_distance')]
    const result = evaluateChecks(geometry, checks)
    assert.equal(result.ok, false)
    assert.match(result.errors.join('; '), /tolerance must be at most/)
    assert.throws(() => applyGenerationEnvelope({ action: 'patch', replacement: null, patches: [], message: 'verified', plan: [], checks }, { mode: 'edit', scene }), /Axis dot tolerance/)
    const direction = evaluateChecks(geometry, [check('axis_direction', '0.0', '', { tolerance })])
    assert.equal(direction.ok, false)
  }
})

test('malformed companion checks return diagnostics instead of throwing', () => {
  const geometry = inspectGeometry(group([axial('cylinder'), axial('torus')]))
  const result = evaluateChecks(geometry, [check('axis_distance'), null])
  assert.equal(result.ok, false)
  assert.equal(result.results.length, 2)
  assert.match(result.errors.join('; '), /axis_parallel/)
})

test('rotation failure triggers repair and frozen axis checks cannot be dropped on retry', async () => {
  const scene = group([axial('cylinder', [0, 0, 90]), axial('torus', [0, 0, 90])])
  const create = checks => ({ action: 'replace', replacement: structuredClone(scene), patches: [], message: 'Assembly', plan: [], checks })
  const first = create([check('axis_parallel'), check('axis_distance')])
  const second = create([]) // Attempt to drop checks while leaving the wrong axis.
  const third = create([])
  third.replacement.children[1].transform.r = [0, 90, 0]
  const responses = [first, second, third], calls = []
  const assets = Object.fromEntries(await Promise.all(ASSET_NAMES.map(async name => [name, await readFile(new URL(`../public/prompts/${name}.txt`, import.meta.url), 'utf8')])))
  const output = await runGeneration({ mode: 'create', prompt: 'Generate a coaxial cylinder and torus assembly along X.', effort: 'max' }, {
    apiKey: 'mock-axis-test-key', loadAssets: async () => assets, inspectGeometry: async scene => inspectGeometry(scene),
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(responses[calls.length - 1]) }), { headers: { 'Content-Type': 'application/json' } })
    }
  })
  assert.equal(calls.length, 3)
  assert.deepEqual(output.meta.framework.attempts.map(item => item.passed), [false, false, true])
  assert.equal(output.meta.framework.checks.length, 2)
  assert.ok(output.meta.framework.checks.every(item => item.passed))
  assert.ok(calls.every(call => call.reasoning.effort === 'max'))
  assert.match(JSON.stringify(calls[1].input), /axis_parallel|measured 0/)
})
