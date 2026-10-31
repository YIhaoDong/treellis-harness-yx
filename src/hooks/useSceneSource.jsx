// src/hooks/useSceneSource.jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { STATIC_DEMO } from '../staticDemo/mode.mjs'
import { createInitialScene } from '../staticDemo/initialScene.mjs'

/**
 * 管理场景来源（远端 /scene.json 与本地 blob 草稿）：
 * - sceneUrl / isDraft / reloadKey
 * - enterDraftFromRoot(root): 进入草稿模式并设置 blob URL
 * - refresh(): 刷新左侧树和渲染器（非草稿时会回到最新的 /scene.json）
 * - acceptTreeChangeRef：仅允许首次外部树变更
 * - 内置轮询：当非草稿且不在编辑态时，检测 /scene.json 是否变化并触发重载
 */
export default function useSceneSource({
  setLiveScene,
  editingRef,            // 来自 useEditHistory，用于编辑中暂停轮询
  pollIntervalMs = 1500, // 轮询间隔
}) {
  const [sceneUrl, setSceneUrl] = useState('/scene.json?ts=' + Date.now())
  const [isDraft, setIsDraft] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const blobUrlRef = useRef(null)
  const lastSceneTextRef = useRef(null)
  const acceptTreeChangeRef = useRef(true)
  const draftModeRef = useRef(false)

  // 进入草稿：用 root 生成 blob URL，并切换为草稿模式
  const enterDraftFromRoot = useCallback((root) => {
    if (!root) return
    draftModeRef.current = true
    setLiveScene(root)
    if (STATIC_DEMO) {
      setIsDraft(true)
      acceptTreeChangeRef.current = false
      return
    }
    const wrapped = { scene: root }
    const blob = new Blob([JSON.stringify(wrapped, null, 2)], { type: 'application/json' })
    const blobUrl = URL.createObjectURL(blob)
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    blobUrlRef.current = blobUrl
    setSceneUrl(blobUrl)
    setIsDraft(true)
    acceptTreeChangeRef.current = false
  }, [setLiveScene])

  // 刷新（按钮使用）
  const refresh = useCallback(() => {
    if (STATIC_DEMO) {
      setLiveScene(createInitialScene())
      draftModeRef.current = false
      setIsDraft(false)
      acceptTreeChangeRef.current = false
      setReloadKey(k => k + 1)
      return
    }
    if (!isDraft) {
      lastSceneTextRef.current = null
      setLiveScene(null)
      acceptTreeChangeRef.current = true
      setSceneUrl('/scene.json?ts=' + Date.now())
    }
    setReloadKey(k => k + 1)
  }, [isDraft, setLiveScene])

  // 轮询 /scene.json（仅在非草稿时生效；编辑中暂停）
  useEffect(() => {
    if (STATIC_DEMO || isDraft) return
    let stopped = false
    let timer = null
    const check = async () => {
      if (stopped || draftModeRef.current) return
      if (editingRef?.current) { timer = setTimeout(check, pollIntervalMs); return }
      try {
        const res = await fetch('/scene.json?ts=' + Date.now(), { cache: 'no-store' })
        if (res.ok) {
          const text = await res.text()
          // A request started before a library load must not replace its draft.
          if (stopped || draftModeRef.current) return
          if (lastSceneTextRef.current == null) {
            lastSceneTextRef.current = text
          } else if (text !== lastSceneTextRef.current) {
            lastSceneTextRef.current = text
            setLiveScene(null)
            acceptTreeChangeRef.current = true
            setSceneUrl('/scene.json?ts=' + Date.now())
            setReloadKey(k => k + 1)
          }
        }
      } catch {}
      if (!stopped && !draftModeRef.current) timer = setTimeout(check, pollIntervalMs)
    }
    check()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [isDraft, pollIntervalMs, editingRef, setLiveScene])

  // 卸载时回收 blob
  useEffect(() => {
    return () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current) }
  }, [])

  return {
    sceneUrl,
    isDraft,
    reloadKey,
    enterDraftFromRoot,
    refresh,
    acceptTreeChangeRef,
  }
}
