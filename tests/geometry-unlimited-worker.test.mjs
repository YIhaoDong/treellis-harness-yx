import test from 'node:test'
import assert from 'node:assert/strict'
import { runGeometryTask } from '../src/generation/geometryRunner.mjs'

test('real geometry worker accepts a mesh scene exceeding the former vertex ceiling', async () => {
  const root = { children: [256, 44].map(count => ({ repeat: { count, t: [20, 0, 0] }, children: [{ primitive: { type: 'torus' } }] })) }
  const report = await runGeometryTask({ type: 'inspect', root })
  assert.equal(report.ok, true, report.errors.join('; '))
  assert.equal(report.stats.vertices, 515100)
  assert.equal(report.stats.primitiveCount, 300)
})

test('pre-cancelled geometry tasks reject immediately', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runGeometryTask({ type: 'inspect', root: { primitive: { type: 'cube' } } }, controller.signal), { name: 'AbortError' })
})

test('advancing the clock does not impose a geometry completion deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = runGeometryTask({ type: 'inspect', root: { primitive: { type: 'cube' } } })
  context.mock.timers.tick(10 * 60 * 1000)
  const report = await pending
  assert.equal(report.ok, true, report.errors.join('; '))
})

test('a running CSG worker remains cancellable without a fixed completion deadline', { timeout: 5000 }, async () => {
  const controller = new AbortController()
  const root = { operation: 'subtract', children: [
    { children: Array.from({ length: 600 }, (_, i) => ({ primitive: { type: 'cube' }, transform: { t: [i * 2, 0, 0] } })) },
    { primitive: { type: 'cube' }, transform: { t: [-10, 0, 0] } }
  ] }
  const pending = runGeometryTask({ type: 'inspect', root }, controller.signal)
  const abortTimer = setTimeout(() => controller.abort(), 100)
  try {
    await assert.rejects(pending, { name: 'AbortError' })
  } finally {
    clearTimeout(abortTimer)
    controller.abort()
  }
  const subsequent = await runGeometryTask({ type: 'inspect', root: { primitive: { type: 'cube' } } })
  assert.equal(subsequent.ok, true, subsequent.errors.join('; '))
})
