import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/PromptControls.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { GenerationProgress } = module.exports
const plan = ['细化机翼', '细化发动机', '细化座舱']
const progress = {
  strategy: 'staged', phase: 'parts', planReady: true, plan,
  completedSteps: 1, totalSteps: 3, step: 2, title: plan[1], stage: 'part',
  startedAt: 1000, finishedAt: 26000,
}
const render = (state = progress, props = {}) => renderToStaticMarkup(React.createElement(GenerationProgress, {
  progress: state, busy: true, ...props,
}))

test('the rendered count distinguishes checked completion from the currently running task', () => {
  const html = render()
  assert.match(html, /Completed 1\/3 tasks/)
  assert.doesNotMatch(html, /Completed 2\/3 tasks/)
  assert.match(html, /Elapsed 00:25/)
  assert.match(html, /Refining · 细化发动机/)
  assert.match(html, /data-status="completed"[^>]*>.*?细化机翼.*?Completed<\/span>/)
  assert.match(html, /data-status="active" aria-current="step"[^>]*>.*?细化发动机.*?In progress<\/span>/)
  assert.match(html, /data-status="pending"[^>]*>.*?细化座舱.*?Pending<\/span>/)
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1)
})

test('Stop retains every task and the completed count while marking the unfinished task paused', () => {
  const html = render({ ...progress, stage: 'stopped' }, { busy: false, canResume: true, onResume() {} })
  assert.match(html, /Completed 1\/3 tasks/)
  for (const title of plan) assert.ok(html.includes(title))
  assert.match(html, /data-status="paused"[^>]*>.*?细化发动机.*?Paused<\/span>/)
  assert.doesNotMatch(html, /aria-current="step"/)
  assert.match(html, /Continue remaining/)
  assert.match(html, /Checked results kept/)
})

test('final completion shows the full denominator and no active or pending task', () => {
  const html = render({ ...progress, stage: 'complete', completedSteps: 3, step: 3 }, { busy: false })
  assert.match(html, /Completed 3\/3 tasks/)
  assert.equal((html.match(/data-status="completed"/g) || []).length, 3)
  assert.doesNotMatch(html, /data-status="(?:active|pending|paused)"/)
})

test('planning and a completed coarse base do not invent a final task denominator', () => {
  const planning = render({ strategy: 'staged', stage: 'planning', phase: 'plan', planReady: false, completedSteps: 0, totalSteps: 0 })
  assert.match(planning, /Completed 0 tasks · Total pending/)
  assert.doesNotMatch(planning, /0\/0 tasks/)
  const base = render({ ...progress, stage: 'planning', phase: 'plan', planReady: false,
    plan: ['Base assembly'], step: 1, completedSteps: 1, totalSteps: 1, title: 'Base assembly' })
  assert.match(base, /Completed 1 task · Total pending/)
  assert.match(base, /Base assembly/)
  assert.doesNotMatch(base, /Completed 1\/1 tasks/)
})

test('single-pass progress does not introduce a fictional task list', () => {
  const html = render({ stage: 'thinking', startedAt: 1000, finishedAt: 26000 })
  assert.match(html, /Thinking/)
  assert.doesNotMatch(html, /Generation tasks|Completed .*tasks|Total pending/)
})
