import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { applyGenerationEnvelope, createResponseFormat, validateAML } from '../src/generation/amlContract.mjs'
import { runGeneration } from '../src/generation/pipeline.mjs'
import { ASSET_NAMES } from '../src/generation/config.mjs'

// Captured from the frozen v1 public contract, without cases or model outputs.
const baseline = JSON.parse(await readFile(new URL('./fixtures/baseline-response-format.json', import.meta.url), 'utf8'))
const clone = value => JSON.parse(JSON.stringify(value))
const helpers = new Set(['vector', 'transform', 'material'])
const dimensions = { cube: ['w', 'h', 'd'], sphere: ['r'], cylinder: ['r', 'h'], torus: ['r', 't'], cone: ['r', 'h'] }
const pathSchema = { type: 'string', pattern: '^0(?:\\.(?:0|[1-9]\\d*))*$' }
function removeDeclaredConstraints(format) {
  const result = clone(format)
  for (const [kind, fields] of Object.entries(dimensions)) for (const field of fields) {
    assert.deepEqual(result.schema.$defs[kind].properties.primitive.properties[field], { type: 'number', exclusiveMinimum: 0 })
    delete result.schema.$defs[kind].properties.primitive.properties[field].exclusiveMinimum
  }
  assert.deepEqual(result.schema.properties.checks.items.properties.path, pathSchema)
  assert.deepEqual(result.schema.properties.checks.items.properties.otherPath, { anyOf: [{ type: 'string', enum: [''] }, pathSchema] })
  result.schema.properties.checks.items.properties.path = { type: 'string' }
  result.schema.properties.checks.items.properties.otherPath = { type: 'string' }
  return result
}
function expandHelpers(value, defs) {
  if (Array.isArray(value)) return value.map(item => expandHelpers(item, defs))
  if (!value || typeof value !== 'object') return value
  const name = value.$ref?.replace('#/$defs/', '')
  if (helpers.has(name)) return expandHelpers(defs[name], defs)
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$defs').map(([key, item]) => [key, expandHelpers(item, defs)]))
}
function expanded(format) {
  const result = expandHelpers(format, format.schema.$defs)
  result.schema.$defs = Object.fromEntries(Object.entries(format.schema.$defs).filter(([name]) => !helpers.has(name)).map(([name, def]) => [name, expandHelpers(def, format.schema.$defs)]))
  return result
}

// A small independent evaluator for the JSON Schema subset in these contracts.
function matches(value, schema, defs = {}) {
  if (schema.$ref) return matches(value, defs[schema.$ref.slice('#/$defs/'.length)], defs)
  if (schema.anyOf) return schema.anyOf.some(branch => matches(value, branch, defs))
  if (schema.enum && !schema.enum.includes(value)) return false
  if (schema.type === 'null') return value === null
  if (schema.type === 'number' || schema.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value)) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum) && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum)
  if (schema.type === 'string') return typeof value === 'string' && (!schema.pattern || new RegExp(schema.pattern).test(value))
  if (schema.type === 'array') return Array.isArray(value) && (schema.minItems === undefined || value.length >= schema.minItems) && (schema.maxItems === undefined || value.length <= schema.maxItems) && value.every(item => matches(item, schema.items, defs))
  if (schema.type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value) && schema.required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => schema.properties[key] ? matches(value[key], schema.properties[key], defs) : schema.additionalProperties !== false)
  throw new Error(`Unhandled schema type ${schema.type}`)
}
const envelope = extra => ({ action: 'patch', replacement: null, patches: [{ path: '/primitive/w', value: 2 }], message: 'Updated.', suggestions: [], plan: [], checks: [], ...extra })
const wireNode = kind => ({ name: kind, transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, primitive: null, operation: null, repeat: null, children: null })

test('factoring alone expands exactly to frozen v1 after separately accounting for declared validator-aligned constraints', () => {
  for (const mode of ['create', 'edit', 'node']) {
    const expected = clone(baseline)
    if (mode === 'create') expected.schema.properties.action.enum = ['replace', 'clarify']
    for (const allowStructure of [undefined, true, ...(mode === 'create' ? [false] : [])]) {
      const actual = createResponseFormat(mode, { allowStructure })
      assert.deepEqual(expanded(removeDeclaredConstraints(actual)), expected)
      assert.ok(JSON.stringify(actual).length < JSON.stringify(expected).length)
    }
  }
})

test('factored branches accept all seven node kinds and reject malformed vector, color, bounds and extra fields', () => {
  const format = createResponseFormat('create'), { schema } = format
  const accepts = value => matches(value, schema, schema.$defs)
  const leaves = Object.entries({ cube: { w: 1, h: 2, d: 3 }, sphere: { r: 1 }, cylinder: { r: 1, h: 2 }, torus: { r: 1, t: 0.2 }, cone: { r: 1, h: 2 } }).map(([kind, dimensions]) => ({ ...wireNode(kind), primitive: { type: kind, ...dimensions, material: { color: '#aAbBcC' } } }))
  const nodes = [...leaves, { ...wireNode('operation'), operation: 'subtract', children: leaves.slice(0, 2) }, { ...wireNode('repeat'), repeat: { type: 'circular', count: 4, t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], radius: 2 }, children: [leaves[0]] }]
  for (const node of nodes) {
    const good = envelope({ action: 'replace', replacement: node, patches: [] })
    assert.equal(accepts(good), true, node.name)
    const badVector = clone(good); badVector.replacement.transform.t = [0, 0]
    assert.equal(accepts(badVector), false)
    const extraField = clone(good); extraField.replacement.invented = true
    assert.equal(accepts(extraField), false)
  }
  const invalidColor = envelope({ action: 'replace', replacement: { ...leaves[0], primitive: { ...leaves[0].primitive, material: { color: 'red' } } }, patches: [] })
  assert.equal(accepts(invalidColor), false)
  for (const count of [0, 65, 1.5]) assert.equal(accepts(envelope({ action: 'replace', replacement: { ...nodes.at(-1), repeat: { ...nodes.at(-1).repeat, count } }, patches: [] })), false)
})

test('patch-only schemas change only the already-forbidden action/replacement branches', () => {
  for (const mode of ['edit', 'node']) {
    const { schema } = createResponseFormat(mode, { allowStructure: false })
    const expected = clone(baseline.schema)
    expected.properties.action.enum = ['patch', 'clarify']
    expected.properties.replacement = { type: 'null' }
    expected.properties.checks.items.properties.path = pathSchema
    expected.properties.checks.items.properties.otherPath = { anyOf: [{ type: 'string', enum: [''] }, pathSchema] }
    delete expected.$defs
    assert.deepEqual(schema, expected)
    assert.equal(matches(envelope(), schema), true)
    assert.equal(matches(envelope({ patches: [{ path: '/transform/t', value: [1, 2, 3] }] }), schema), true)
    assert.equal(matches(envelope({ action: 'clarify', patches: [], suggestions: [{ label: 'Set width to 2', instruction: 'Set only the selected width to 2.', path: '0' }] }), schema), true)
    assert.equal(matches(envelope({ action: 'replace' }), schema), false)
    assert.equal(matches(envelope({ replacement: {} }), schema), false)
    assert.equal(matches(envelope({ patches: [{ path: '/transform/t', value: [1, 2] }] }), schema), false)
    assert.equal(matches(envelope({ checks: [{ kind: 'unknown', path: '0', otherPath: '', axis: 'x', comparison: 'eq', value: 1, tolerance: 0.01 }] }), schema), false)
  }
})

test('positive-dimension schema constraints match runtime validity without an epsilon or bounds on coordinates', () => {
  const { schema } = createResponseFormat('create')
  for (const [kind, fields] of Object.entries(dimensions)) for (const field of fields) for (const value of [Number.MIN_VALUE, 0.000001, 1, 0, -Number.MIN_VALUE, -1]) {
    const primitive = { type: kind, ...Object.fromEntries(fields.map(key => [key, 1])), [field]: value }
    const hostAccepts = validateAML({ name: 'Dimension', primitive }).ok
    const wire = { ...wireNode(kind), primitive: { ...primitive, material: null } }
    assert.equal(matches(envelope({ action: 'replace', replacement: wire, patches: [] }), schema, schema.$defs), hostAccepts, `${kind}.${field}=${value}`)
  }
  const transformed = { ...wireNode('cube'), transform: { t: [-1, 0, 2], r: [0, -90, 0], s: [1, 1, 1] }, primitive: { type: 'cube', w: 1, h: 1, d: 1, material: null } }
  assert.equal(matches(envelope({ action: 'replace', replacement: transformed, patches: [], checks: [{ kind: 'align', path: '0', otherPath: '0', axis: 'x', comparison: 'eq', value: -1, tolerance: 0 }] }), schema, schema.$defs), true)
  assert.deepEqual(schema.$defs.vector.items, { type: 'number' })
  assert.deepEqual(schema.$defs.repeat.properties.repeat.properties.radius, { anyOf: [{ type: 'number' }, { type: 'null' }] })
})

test('check path schema matches the existing runtime grammar including empty unused otherPath', () => {
  const scene = { name: 'Cube', primitive: { type: 'cube', w: 1, h: 1, d: 1 } }
  const { schema } = createResponseFormat('edit', { allowStructure: false })
  for (const field of ['path', 'otherPath']) for (const path of ['0', '0.0', '0.12.0', '', '0.00', '0.-1', '0.2 see', '0.2 feet', '/children/0', ' 0', '0\n']) {
    const check = { kind: 'count', path: '0', otherPath: '', axis: 'x', comparison: 'eq', value: 1, tolerance: 0, [field]: path }
    const value = envelope({ patches: [], checks: [check] })
    let hostAccepts = true
    try { applyGenerationEnvelope(value, { mode: 'edit', scene }) } catch { hostAccepts = false }
    assert.equal(matches(value, schema), hostAccepts, `${field}=${JSON.stringify(path)}`)
  }
  const relative = envelope({ patches: [], checks: [{ kind: 'relative_extent', path: '0', otherPath: '', axis: 'x', comparison: 'eq', value: 1, tolerance: 0 }] })
  // Kind-specific nonempty-otherPath and scene existence remain runtime checks.
  assert.throws(() => applyGenerationEnvelope(relative, { mode: 'edit', scene }), /needs otherPath/)
})

test('the pipeline reuses its existing latest-instruction structural gate in English, Chinese and follow-ups', async () => {
  const assets = Object.fromEntries(await Promise.all(ASSET_NAMES.map(async name => [name, await readFile(new URL(`../public/prompts/${name}.txt`, import.meta.url), 'utf8')])))
  const scene = { name: 'Block', primitive: { type: 'cube', w: 1, h: 1, d: 1 } }
  const routes = [
    ['Set width to 2.', false], ['Check that width already equals 1.', false], ['What is this part?', false], ['把宽度设为2，其他不变。', false],
    ['Add a small collar.', true], ['Remove only the guard.', true], ['Convert it into a cone.', true], ['Make this into a sphere.', true], ['Refine this part.', true],
    ['删除这个支架。', true], ['把它改成圆锥。', true], ['添加一个小环。', true],
  ]
  for (const mode of ['edit', 'node']) for (const [prompt, structural] of routes) {
    let captured
    await assert.rejects(runGeneration({ mode, scene, path: '0', prompt, effort: 'max', conversation: [{ role: 'user', content: 'Add a ring or set width to 2?' }, { role: 'assistant', content: 'Choose one operation.' }] }, {
      apiKey: 'mock-key', loadAssets: async () => assets, maxRepairs: 0, buildEditContext: async () => ({}),
      fetchImpl: async (_url, init) => {
        captured = JSON.parse(init.body)
        return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(envelope({ action: 'clarify', patches: [], message: 'Please choose the intended outcome.' })) }), { headers: { 'Content-Type': 'application/json' } })
      },
    }), { code: 'CLARIFICATION' })
    assert.deepEqual(captured.text.format.schema.properties.action.enum, structural ? ['patch', 'replace', 'clarify'] : ['patch', 'clarify'], `${mode}: ${prompt}`)
    assert.equal(captured.model, 'gpt-6.1-sol')
    assert.equal(captured.reasoning.effort, 'max')
    assert.equal(captured.max_output_tokens, 128000)
  }
})
