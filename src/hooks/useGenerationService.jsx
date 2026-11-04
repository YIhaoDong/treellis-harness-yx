import { useCallback, useEffect, useState } from 'react'
import { getGenerationConfig } from '../generation/client.mjs'

// A network failure (TypeError from fetch) means the server could not be reached at all.
const unreachable = "Can't reach the generation server. Check your connection, then retry."

export default function useGenerationService() {
  const [config, setConfig] = useState({ ready: false, localKeyAvailable: false })
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(true)
  const reconnect = useCallback(async (signal) => {
    setConnecting(true); setError('')
    try {
      const next = await getGenerationConfig(signal)
      if (!signal?.aborted) { setConfig(next); setError('') }
    } catch (failure) {
      if (!signal?.aborted) {
        setConfig({ ready: false, localKeyAvailable: false })
        setError(failure?.name === 'TypeError' ? unreachable : failure.message || 'Start npm run server to enable generation.')
      }
    } finally {
      if (!signal?.aborted) setConnecting(false)
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    reconnect(controller.signal)
    return () => controller.abort()
  }, [reconnect])
  return { ...config, error, connecting, reconnect }
}
