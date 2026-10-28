import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('back-to-back generation checkpoints each undo to their immediate predecessor before React renders', async () => {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../src/hooks/useEditHistory.jsx', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
  })
  const exports = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), exports, exports.exports)
  const useEditHistory = exports.exports.default
  const original = { name: 'Aircraft', wings: 1, engine: 1 }
  const wings = { ...original, wings: 2 }
  const engine = { ...wings, engine: 2 }
  const applied = []
  let history
  function Capture() {
    history = useEditHistory({ liveScene: original, setLiveScene: scene => applied.push(structuredClone(scene)) })
    return null
  }
  renderToStaticMarkup(React.createElement(Capture))
  history.recordGeneration(wings, 'prompt', { step: 1 })
  history.recordGeneration(engine, 'prompt', { step: 2 })
  assert.deepEqual(history.snapshotsRef.current.map(s => s.scene), [wings, engine])
  history.undo()
  history.undo()
  history.redo()
  history.redo()
  assert.deepEqual(applied, [wings, original, wings, engine])
  assert.deepEqual(original, { name: 'Aircraft', wings: 1, engine: 1 })
})
