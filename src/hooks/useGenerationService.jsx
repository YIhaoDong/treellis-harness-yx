import { useCallback, useEffect, useState } from 'react'
import { getGenerationConfig } from '../generation/client.mjs'

export default function useGenerationService() {
  const [config, setConfig] = useState({ ready: false, localKeyAvailable: false })
  const [error, setError] = useState('')
  const reconnect = useCallback(async (signal) => {
    try {
      const next = await getGenerationConfig(signal)
      if (!signal?.aborted) { setConfig(next); setError('') }
    } catch (failure) {
      if (!signal?.aborted) {
        setConfig({ ready: false, localKeyAvailable: false })
        setError(failure.message || 'Start npm run server to enable generation.')
      }
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    reconnect(controller.signal)
    return () => controller.abort()
  }, [reconnect])
  return { ...config, error, reconnect }
}
