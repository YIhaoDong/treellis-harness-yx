// src/hooks/useClipboard.jsx
// 全局剪贴板（内存态，模块级单例）

import { useState, useCallback } from 'react'
import { deepClone } from '../utils/tree'

let _CLIPBOARD = null

export default function useClipboard() {
  const [rev, setRev] = useState(0)

  const setClipboard = useCallback((subtree, sourcePath = null) => {
    if (!subtree) return
    _CLIPBOARD = {
      subtree: deepClone(subtree),
      sourcePath: sourcePath != null ? String(sourcePath) : null,
      capturedAt: Date.now(),
    }
    setRev(n => n + 1)
  }, [])

  const clearClipboard = useCallback(() => {
    _CLIPBOARD = null
    setRev(n => n + 1)
  }, [])

  const getClipboard = useCallback(() => _CLIPBOARD, [rev])
  const hasClipboard = !!_CLIPBOARD

  return { hasClipboard, getClipboard, setClipboard, clearClipboard }
}
