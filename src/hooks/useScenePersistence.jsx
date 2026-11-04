// src/hooks/useScenePersistence.jsx
// Keeps the visitor's work in this browser. The scene is saved shortly after every
// change and restored on the next visit, so a reload or a closed tab loses nothing.
// The untouched example scene is never stored: it should keep tracking the server.
import { useCallback, useEffect, useRef, useState } from 'react'

export const SCENE_STORAGE_KEY = 'treellis.scene.v1'
const SAVE_DELAY_MS = 500

export function loadSavedScene(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(SCENE_STORAGE_KEY) || 'null')
    return saved?.scene && typeof saved.scene === 'object' ? saved : null
  } catch {
    return null
  }
}

export function clearSavedScene(storage = globalThis.localStorage) {
  try { storage?.removeItem(SCENE_STORAGE_KEY) } catch {}
}

// status: 'example' (nothing changed yet) | 'saving' | 'saved' | 'error'
// `restoredScene` is the scene object restored from storage, if any.
export default function useScenePersistence({ scene, enabled = true, restoredScene, restoredAt = null }) {
  const [status, setStatus] = useState(restoredScene ? 'saved' : 'example')
  const [savedAt, setSavedAt] = useState(restoredAt)
  // The scene as it was loaded; saving starts with the first change after it.
  const pristineRef = useRef(restoredScene || undefined)
  const timerRef = useRef(null)
  const pendingRef = useRef(null)

  const write = useCallback((value) => {
    try {
      const at = Date.now()
      localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify({ scene: value, savedAt: at }))
      setSavedAt(at)
      setStatus('saved')
      return true
    } catch {
      setStatus('error')
      return false
    }
  }, [])

  // The next scene loaded from the server is the baseline, not an edit.
  const markPristine = useCallback((value = undefined) => {
    clearTimeout(timerRef.current)
    pendingRef.current = null
    pristineRef.current = value
    setStatus('example')
  }, [])

  useEffect(() => {
    if (!enabled || !scene) return
    if (pristineRef.current === undefined) { pristineRef.current = scene; return }
    if (scene === pristineRef.current) return
    pendingRef.current = scene
    setStatus('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      pendingRef.current = null
      write(scene)
    }, SAVE_DELAY_MS)
  }, [scene, enabled, write])

  // Save straight away when the page is closing; warn only if saving is impossible.
  useEffect(() => {
    if (!enabled) return
    const onBeforeUnload = (event) => {
      if (pendingRef.current && write(pendingRef.current)) pendingRef.current = null
      if (status === 'error') { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [enabled, status, write])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return { status, savedAt, markPristine }
}
