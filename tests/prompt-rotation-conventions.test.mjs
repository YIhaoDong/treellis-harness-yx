import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { inspectGeometry, evaluateChecks } from '../src/generation/geometry.mjs'
import { validateAML } from '../src/generation/amlContract.mjs'

const examples = JSON.parse(fs.readFileSync(new URL('../public/prompts/jsonCase.txt', import.meta.url), 'utf8')).examples
const coaxial = examples.find(example => example.tags.includes('coaxial'))
const check = (kind, path, otherPath = '', axis = 'x') => ({ kind, path, otherPath, axis, comparison: 'eq', value: kind === 'axis_distance' ? 0 : 1, tolerance: kind === 'axis_distance' ? 0.01 : 0.0015 })

test('all shipped prompt examples remain valid AML and nonempty geometry', () => {
  assert.ok(coaxial, 'a native-axis mating example must be present')
  for (const example of examples) {
    assert.equal(validateAML(example.aml).ok, true, example.description)
    assert.equal(inspectGeometry(example.aml).ok, true, example.description)
  }
})

test('the shipped cylinder/torus example proves a coaxial world-Z interface', () => {
  const report = inspectGeometry(coaxial.aml)
  const result = evaluateChecks(report, [check('axis_direction', '0.0', '', 'z'), check('axis_direction', '0.1', '', 'z'), check('axis_parallel', '0.0', '0.1'), check('axis_distance', '0.0', '0.1')])
  assert.equal(result.ok, true, result.errors.join('\n'))
})

test('copying equal Euler rotations between cylinder and torus is not coaxial', () => {
  const wrong = structuredClone(coaxial.aml)
  for (const child of wrong.children) child.transform = { r: [0, 0, 90] }
  const result = evaluateChecks(inspectGeometry(wrong), [check('axis_parallel', '0.0', '0.1')])
  assert.equal(result.ok, false)
  assert.ok(result.results[0].actual < 1e-8)
})

test('the documented intrinsic XYZ compound rotation maps cylinder Y to world Z', () => {
  const scene = { name: 'Compound rotation example', primitive: { type: 'cylinder', r: 0.5, h: 2 }, transform: { r: [90, 90, 0] } }
  const report = inspectGeometry(scene)
  assert.equal(evaluateChecks(report, [check('axis_direction', '0', '', 'z')]).ok, true)
  assert.equal(evaluateChecks(report, [check('axis_direction', '0', '', 'x')]).ok, false)
})
