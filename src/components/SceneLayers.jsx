import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getRepeatKey } from '../utils/repeat'
import '../structurePanel.css'

const titleCase = value => String(value || '').replace(/(^|[_\s-])\w/g, match => match.replace(/[_-]/g, ' ').toUpperCase())

export function layerKind(node) {
  const repeat = getRepeatKey(node)
  if (repeat) return repeat === 'repeat_circular' ? 'Circular Repeat' : 'Linear Repeat'
  if (node?.primitive?.type) return titleCase(node.primitive.type)
  const operation = String(node?.operation || '').toLowerCase()
  if (operation === 'difference' || operation === 'subtract') return 'Subtract'
  if (operation === 'intersection' || operation === 'intersect') return 'Intersect'
  return operation && operation !== 'none' ? titleCase(operation) : 'Group'
}

export function flattenSceneLayers(scene, collapsedPaths = new Set()) {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return []
  const rows = []
  const visit = (node, path, depth, position, size) => {
    if (!node || typeof node !== 'object') return
    const children = Array.isArray(node.children) ? node.children : []
    rows.push({ node, path, depth, hasChildren: children.length > 0, position, size })
    if (!collapsedPaths.has(path)) children.forEach((child, index) => visit(child, `${path}.${index}`, depth + 1, index + 1, children.length))
  }
  visit(scene, '0', 0, 1, 1)
  return rows
}

function LayerIcon({ node }) {
  const kind = layerKind(node)
  const group = Array.isArray(node?.children) && node.children.length > 0
  return (
    <svg className={`scene-layer-icon${group ? ' scene-layer-icon--group' : ''}`} viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
      {group ? <><path d="m10 2 8 4-8 4-8-4 8-4Z" /><path d="m2 10 8 4 8-4M2 14l8 4 8-4" /></> :
        kind === 'Sphere' || kind === 'Torus' ? <><circle cx="10" cy="10" r="7" /><ellipse cx="10" cy="10" rx="3" ry="7" /></> :
          <><path d="m10 2 7 4v8l-7 4-7-4V6l7-4Z" /><path d="m3 6 7 4 7-4M10 10v8" /></>}
    </svg>
  )
}

export default function SceneLayers({
  scene, selectedPaths = [], activePath = null, focusPath = null, focusRequestId = 0,
  onFocusDone, onSelect, onHoverPath, onNodePrompt, onAddChild, onDeletePath,
  onBlankClick, loading = false, pathRemap = null,
}) {
  const [collapsedPaths, setCollapsedPaths] = useState(() => new Set())
  useEffect(() => {
    if (pathRemap) setCollapsedPaths(previous => new Set([...previous].map(path => pathRemap[path]).filter(Boolean)))
  }, [pathRemap])
  const [keyboardPath, setKeyboardPath] = useState(null)
  const rows = useMemo(() => flattenSceneLayers(scene, collapsedPaths), [scene, collapsedPaths])
  const selected = useMemo(() => new Set(selectedPaths), [selectedPaths])
  const rowRefs = useRef(new Map())
  const viewportRef = useRef(null)
  const onFocusDoneRef = useRef(onFocusDone)
  onFocusDoneRef.current = onFocusDone
  const tabPath = rows.some(row => row.path === keyboardPath) ? keyboardPath :
    rows.some(row => row.path === activePath) ? activePath : rows[0]?.path

  // A viewport selection must remain discoverable even below a folded group.
  useEffect(() => {
    if (!focusPath || !scene) return
    setCollapsedPaths(previous => {
      const next = new Set(previous)
      for (const path of previous) if (String(focusPath).startsWith(`${path}.`)) next.delete(path)
      return next.size === previous.size ? previous : next
    })
    setKeyboardPath(focusPath)
    const pendingFrame = { current: null }
    const request = requestAnimationFrame(() => {
      const nextFrame = requestAnimationFrame(() => {
        const row = rowRefs.current.get(focusPath)
        const viewport = viewportRef.current
        if (row && viewport) {
          const rowBox = row.getBoundingClientRect()
          const viewportBox = viewport.getBoundingClientRect()
          const top = viewport.scrollTop + rowBox.top - viewportBox.top - (viewport.clientHeight - rowBox.height) / 2
          const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
          viewport.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' })
        }
        onFocusDoneRef.current?.(focusPath, focusRequestId)
      })
      pendingFrame.current = nextFrame
    })
    return () => {
      cancelAnimationFrame(request)
      if (pendingFrame.current != null) cancelAnimationFrame(pendingFrame.current)
    }
  }, [focusPath, focusRequestId, scene])

  useEffect(() => () => onHoverPath?.(null), [onHoverPath])

  const toggle = path => setCollapsedPaths(previous => {
    const next = new Set(previous)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const focusRow = path => {
    if (!path) return
    setKeyboardPath(path)
    rowRefs.current.get(path)?.focus()
  }
  const onKeyDown = (event, row, index) => {
    // Buttons keep their ordinary keyboard activation.
    if (event.target !== event.currentTarget) return
    const { path, hasChildren } = row
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.(path, { shiftKey: event.shiftKey })
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
      focusRow(rows[next]?.path)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusRow((event.key === 'Home' ? rows[0] : rows.at(-1))?.path)
    } else if (event.key === 'ArrowRight' && hasChildren) {
      event.preventDefault()
      if (collapsedPaths.has(path)) toggle(path)
      else focusRow(rows[index + 1]?.path)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (hasChildren && !collapsedPaths.has(path)) toggle(path)
      else if (path !== '0') focusRow(path.slice(0, path.lastIndexOf('.')))
    }
  }

  if (!rows.length) return <div className="scene-layers-empty" role="status">{loading ? 'Loading scene…' : 'No scene yet'}</div>
  return (
    <div className="scene-layers" ref={viewportRef} onClick={event => {
      if (!event.target.closest?.('[data-path]')) onBlankClick?.()
    }}>
      <div className="scene-layers-tree" role="tree" aria-label="Scene layers" aria-multiselectable="true" onMouseLeave={() => onHoverPath?.(null)}>
        {rows.map((row, index) => {
          const { node, path, depth, hasChildren, position, size } = row
          const isSelected = selected.has(path) || (!selectedPaths.length && activePath === path)
          const name = node.name || 'Unnamed part'
          const kind = layerKind(node)
          return (
            <div key={path} ref={element => { if (element) rowRefs.current.set(path, element); else rowRefs.current.delete(path) }}
              className={`scene-layer-row${isSelected ? ' scene-layer-row--selected' : ''}${activePath === path ? ' scene-layer-row--active' : ''}`}
              style={{ '--layer-depth': depth }} role="treeitem" aria-level={depth + 1} aria-posinset={position} aria-setsize={size}
              aria-selected={isSelected} aria-expanded={hasChildren ? !collapsedPaths.has(path) : undefined}
              aria-label={`${name}, ${kind}`} tabIndex={tabPath === path ? 0 : -1} data-path={path}
              onFocus={event => { if (event.target === event.currentTarget) setKeyboardPath(path) }}
              onClick={event => { setKeyboardPath(path); event.currentTarget.focus(); onSelect?.(path, { shiftKey: event.shiftKey }) }}
              onKeyDown={event => onKeyDown(event, row, index)} onMouseEnter={() => onHoverPath?.(path)}>
              {hasChildren ? <button type="button" className="scene-layer-fold" tabIndex={-1}
                aria-label={`${collapsedPaths.has(path) ? 'Expand' : 'Collapse'} ${name}`} onClick={event => { event.stopPropagation(); toggle(path) }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
                  style={{ transform: collapsedPaths.has(path) ? undefined : 'rotate(90deg)' }}><path d="m4 2 4 4-4 4" /></svg>
              </button> : <span className="scene-layer-fold-placeholder" />}
              <LayerIcon node={node} />
              <span className="scene-layer-name" title={name}>{name}</span>
              <span className="scene-layer-kind" title={kind}>{kind}</span>
              <span className="scene-layer-actions">
                {onNodePrompt && <button type="button" tabIndex={-1} title={`AI edit ${name}`} aria-label={`AI edit ${name}`} onClick={event => { event.stopPropagation(); onNodePrompt(path) }}>AI</button>}
                {onAddChild && <button type="button" tabIndex={-1} title={`Add to ${name}`} aria-label={`Add to ${name}`} onClick={event => { event.stopPropagation(); onAddChild(path) }}>+</button>}
                {onDeletePath && path !== '0' && <button type="button" tabIndex={-1} title={`Delete ${name}`} aria-label={`Delete ${name}`} onClick={event => { event.stopPropagation(); onDeletePath(path) }}>×</button>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
