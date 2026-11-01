import { Worker } from 'node:worker_threads'
export function runGeometryTask(data, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'))
    const worker = new Worker(new URL('./geometryWorker.mjs', import.meta.url), { workerData: data })
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      error ? reject(error) : resolve(value)
    }
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'))
    // Complex CSG may take longer than a fixed deadline. Stop remains immediate
    // because computation is isolated in this worker and abort terminates it.
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', (message) => finish(message.error ? new Error(message.error) : null, message.result))
    worker.once('error', (error) => finish(error))
    worker.once('exit', (code) => { if (!settled) finish(new Error(`Geometry checker stopped (${code}).`)) })
  })
}
