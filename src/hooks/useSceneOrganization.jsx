import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { STATIC_DEMO } from '../staticDemo/mode.mjs'
import { groupSceneNodes, ungroupSceneNode, analyzeGroupingSelection } from '../utils/sceneGrouping.mjs'
import { requestGeneration } from '../generation/client.mjs'
import { elapsedLabel } from '../generation/progressState.mjs'

export default function useSceneOrganization({ scene, selectedPaths, blocked, recordGeneration, enterDraftFromRoot, selectPaths, remapSelection }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [startedAt, setStartedAt] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [pathRemap, setPathRemap] = useState(null)
  const activeRef = useRef(null)
  const sceneRef = useRef(scene)
  const eligibility = useMemo(() => analyzeGroupingSelection(scene, selectedPaths), [scene, selectedPaths])
  useLayoutEffect(() => {
    sceneRef.current = scene
    const active = activeRef.current
    if (active && JSON.stringify(scene) !== active.revision) {
      active.stale = true
      active.controller.abort()
    }
  }, [scene])
  useEffect(() => () => activeRef.current?.controller.abort(), [])
  useEffect(() => {
    if (!busy || startedAt == null) return
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 1000)
    return () => clearInterval(timer)
  }, [busy, startedAt])

  const apply = (reply, tag) => {
    const next = reply.scene || reply.result
    if (!reply.changed || !next) return
    recordGeneration(next, tag, { ...(reply.meta || {}), groups: reply.groups || [] })
    enterDraftFromRoot(next)
    setPathRemap(reply.pathMap)
    if (tag === 'smart-group') remapSelection(reply.pathMap, { scene: next })
    else selectPaths(reply.selectedPaths || [], { scene: next })
  }
  const group = name => {
    if (blocked || busy || !eligibility.canGroup) return false
    try {
      const reply = groupSceneNodes(sceneRef.current, selectedPaths, name)
      apply(reply, 'group'); setError(''); setStatus(`Grouped ${selectedPaths.length} parts.`)
      return true
    } catch (failure) { setError(failure.message); return false }
  }
  const ungroup = () => {
    if (blocked || busy || !eligibility.canUngroup) return
    try {
      const reply = ungroupSceneNode(sceneRef.current, selectedPaths[0])
      apply(reply, 'ungroup'); setError(''); setStatus('Group removed. Part positions kept.')
    } catch (failure) { setError(failure.message) }
  }
  const organize = async ({ scope = '0', effort = 'medium', prompt = '' } = {}) => {
    if (STATIC_DEMO) return
    if (blocked || activeRef.current || !sceneRef.current) return
    const controller = new AbortController()
    const active = { controller, revision: JSON.stringify(sceneRef.current), stale: false }
    activeRef.current = active
    setBusy(true); setError(''); setStatus('Preparing organization…'); setStartedAt(Date.now())
    let apiKey = ''
    try { apiKey = (localStorage.getItem('OPENAI_API_KEY') || '').trim() } catch {}
    try {
      const reply = await requestGeneration({ mode: 'organize', scene: sceneRef.current, scope, effort, prompt }, {
        apiKey, signal: controller.signal,
        onProgress: event => { if (activeRef.current === active) setStatus(event.message || 'Organizing related parts…') },
      })
      if (activeRef.current !== active || controller.signal.aborted) {
        if (active.stale) setError('The scene changed. Your latest edits were kept. Run Smart group again.')
        else if (controller.signal.aborted) setStatus('Organization stopped. Scene kept.')
        return
      }
      if (JSON.stringify(sceneRef.current) !== active.revision) throw new Error('The scene changed. Your latest edits were kept. Run Smart group again.')
      activeRef.current = null
      apply(reply, 'smart-group')
      setStatus(reply.message || (reply.changed ? `Organized ${reply.groups?.length || 0} groups.` : 'No additional groups needed.'))
    } catch (failure) {
      if (active.stale) setError('The scene changed. Your latest edits were kept. Run Smart group again.')
      else if (failure.name === 'AbortError') setStatus('Organization stopped. Scene kept.')
      else setError(failure.message || 'Could not organize the scene. Your scene was kept.')
    } finally {
      if (activeRef.current === active) activeRef.current = null
      setBusy(false)
    }
  }
  return { busy, error, status: busy ? `${status} · ${elapsedLabel(elapsed)}` : status,
    pathRemap, canGroup: eligibility.canGroup && !blocked && !busy,
    canUngroup: eligibility.canUngroup && !blocked && !busy,
    group, ungroup, organize, cancel: () => activeRef.current?.controller.abort() }
}
