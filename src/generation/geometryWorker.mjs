import { parentPort, workerData } from 'node:worker_threads'
import { inspectGeometry, buildEditContext } from './geometry.mjs'
try {
  const result = workerData.type === 'context' ? buildEditContext(workerData.scene, workerData.path) : inspectGeometry(workerData.root)
  parentPort.postMessage({ result })
} catch (error) { parentPort.postMessage({ error: String(error.message || error) }) }
