// src/hooks/useAddPicker.jsx
import { useCallback, useState } from 'react'
import { getNodeAtPath, deepClone } from '../utils/tree'
import { createPrimitive, createOperation, createRepeat } from '../utils/factories'

const initAddState = {
  open: false,
  path: null,
  mode: 'append',     // 'wrap' | 'append'

  // append mode: 'prim' | 'op' | 'repeat' | 'instance'
  kind: 'prim',

  // wrap mode: wrapperKind: 'op' | 'repeat'
  wrapperKind: 'op',

  // operation
  op: 'union',
  opName: '',

  // primitive
  prim: null,
  primName: '',

  // repeat
  repeatType: 'linear',  // 'linear' | 'circular'
  repeatName: '',

  // ✅ NEW: instance selection (append mode)
  instanceId: null,
}

export default function useAddPicker({
  liveScene,
  setLiveScene,
  beginEdit,
  endEdit,
  setPanelPath,
  setPanelTitle,
  setHighlightPath,
  editDirtyRef,
  editTagRef,

  // ✅ NEW: fetch instance by id
  getLibraryItem,
}) {
  const [addUI, setAddUI] = useState(initAddState)

  const openAddChild = useCallback((path) => {
    if (!liveScene) return
    const target = getNodeAtPath(liveScene, path)
    if (!target) { alert('Path not found.'); return }

    const opKey = String(target.operation || 'group').toLowerCase()
    if (opKey === 'subtract' && Array.isArray(target.children) && target.children.length >= 2) {
      alert('This operation is binary (max 2 operands).')
      return
    }

    // primitive 节点只能 wrap；operation/group 节点 append
    const mode = (target.primitive && !target.operation) ? 'wrap' : 'append'

    setAddUI({
      ...initAddState,
      open: true,
      path,
      mode,
      kind: 'prim',
      wrapperKind: 'op',
      op: 'union',
      repeatType: 'linear',
      repeatName: '',
      instanceId: null,
    })
  }, [liveScene])

  const closeAddUI = useCallback(() => setAddUI(s => ({ ...s, open: false })), [])

  const confirmAdd = useCallback(() => {
    if (!liveScene) return
    const {
      path, mode,
      kind, wrapperKind,
      op, prim, primName, opName,
      repeatType, repeatName,
      instanceId,
    } = addUI

    const parts = String(path).split('.').slice(1).map(n => parseInt(n, 10))
    beginEdit()

    const replaceAtPath = (sceneRoot, targetPath, nextNode) => {
      const p = String(targetPath).split('.').slice(1).map(n => parseInt(n, 10))
      if (p.length === 0) return nextNode
      const clonedRoot = sceneRoot
      let parent = clonedRoot
      for (let i = 0; i < p.length - 1; i++) parent = parent.children[p[i]]
      const idx = p[p.length - 1]
      parent.children.splice(idx, 1, nextNode)
      return clonedRoot
    }

    if (mode === 'wrap') {
      const cloned = deepClone(liveScene)
      let cur = cloned
      for (let i = 0; i < parts.length; i++) cur = cur.children[parts[i]]

      if (wrapperKind === 'repeat') {
        const repNode = createRepeat(repeatType, repeatName)
        repNode.children = [cur]

        const nextRoot = (parts.length === 0)
          ? repNode
          : replaceAtPath(cloned, path, repNode)

        setLiveScene(nextRoot)

        const finalPath = String(path)
        setPanelPath(finalPath)
        setPanelTitle(repNode.name || 'Repeat')
        setHighlightPath(finalPath)
      } else {
        const chosenPrimType = prim || 'cube'
        const newPrim = createPrimitive(chosenPrimType, primName)

        const wrapper = createOperation(op || 'union', opName)
        if (!Array.isArray(wrapper.children)) wrapper.children = []
        wrapper.children = [cur, newPrim]

        if (parts.length === 0) {
          setLiveScene(wrapper)
          const newChildPath = '0.1'
          setPanelPath(newChildPath)
          setPanelTitle(newPrim.name || 'Primitive')
          setHighlightPath(newChildPath)
        } else {
          const nextRoot = replaceAtPath(cloned, path, wrapper)
          setLiveScene(nextRoot)
          const newChildPath = `${path}.1`
          setPanelPath(newChildPath)
          setPanelTitle(newPrim.name || 'Primitive')
          setHighlightPath(newChildPath)
        }
      }
    } else {
      // append
      const cloned = deepClone(liveScene)
      let cur = cloned
      for (let i = 0; i < parts.length; i++) cur = cur.children[parts[i]]

      const opKeyNow = String(cur.operation || 'group').toLowerCase()
      if (opKeyNow === 'subtract' && Array.isArray(cur.children) && cur.children.length >= 2) {
        endEdit(); alert('This operation is binary (max 2 operands).'); closeAddUI(); return
      }

      if (!Array.isArray(cur.children)) cur.children = []

      let newNode = null

      if (kind === 'instance') {
        const it = (typeof getLibraryItem === 'function') ? getLibraryItem(instanceId) : null
        if (!it || !it.subtree) {
          endEdit()
          alert('Instance not found. Please re-open Add dialog and pick again.')
          closeAddUI()
          return
        }
        newNode = deepClone(it.subtree)
        // ✅ 用 Library 名称覆盖根节点名称（更符合用户预期）
        if (it.name) newNode.name = String(it.name)
        if (!newNode.name) newNode.name = 'Instance'
      } else if (kind === 'op') {
        newNode = createOperation(op || 'union', opName)
        if (!Array.isArray(newNode.children)) newNode.children = []
      } else if (kind === 'repeat') {
        newNode = createRepeat(repeatType, repeatName)
        if (!Array.isArray(newNode.children)) newNode.children = []
      } else {
        const chosenPrimType = prim || 'cube'
        newNode = createPrimitive(chosenPrimType, primName)
      }

      cur.children.push(newNode)
      setLiveScene(cloned)

      const newChildPath = `${path}.${cur.children.length - 1}`
      setPanelPath(newChildPath)

      const prettyOp = (k) => k === 'subtract' ? 'Subtract' : (k === 'intersection' ? 'Intersect' : 'Union')
      const title =
        (kind === 'op') ? (newNode.name || prettyOp(String(op || 'union'))) :
        (kind === 'repeat') ? (newNode.name || 'Repeat') :
        (kind === 'instance') ? (newNode.name || 'Instance') :
        (newNode.name || 'Primitive')

      setPanelTitle(title)
      setHighlightPath(newChildPath)
    }

    if (editDirtyRef) editDirtyRef.current = true
    if (editTagRef) editTagRef.current = 'add'
    endEdit('add')
    closeAddUI()
  }, [
    addUI, liveScene,
    beginEdit, endEdit,
    setLiveScene, setPanelPath, setPanelTitle, setHighlightPath,
    editDirtyRef, editTagRef,
    closeAddUI,
    getLibraryItem,
  ])

  return {
    addUI,
    setAddUI,
    openAddChild,
    closeAddUI,
    confirmAdd,
  }
}