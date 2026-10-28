// StructureTree.jsx — Outline Shapes + Soft Cards + Visual Grammar Legend
// + Repeat nodes (Linear / Circular): special kind + palette + legend items
// + Instance Library (copy-based): Library panel + Instantiate button on nodes

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Tree from 'react-d3-tree'
import { getRepeatKey } from '../utils/repeat'
import InstanceLibrary from './InstanceLibrary'
import { animateTreeViewport, centerTreeViewport, expandTreeAncestors, sameTreeViewport, visibleTreeData } from '../utils/treeFocus.mjs'

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// 让 Sphere / Torus 背景图形更大一点（文字区域不变）
const KIND_EXTRA_SCALE = {
  sphere: 1.35,
  torus: 1.35,
  // repeat 的背景也稍微放大一点，视觉更“粗”
  repeat_linear: 1.18,
  repeat_circular: 1.18,
}

// Torus 圆环几何参数（可按需微调）
const TORUS_OUTER_MARGIN = 6
const TORUS_HOLE_RATIO = 0.62
const TORUS_MIN_RING = 18

/* =========================
   Node kind detection
   ========================= */

function typeAndKind(node) {
  // 1) Repeat 优先（repeat 不是 boolean op，也不是 primitive）
  const repeatKey = getRepeatKey(node)
  if (repeatKey) {
    const label = repeatKey === 'repeat_circular' ? 'Circular Repeat' : 'Linear Repeat'
    return { label, opKey: null, primKey: null, repeatKey }
  }

  // 2) Operation / Primitive
  const op = node?.operation && String(node.operation).toLowerCase()
  const prim = node?.primitive?.type && String(node.primitive.type).toLowerCase()

  const buildSubtractHint = (n) => {
    const explicit = (typeof n?.operandsHint === 'string') ? n.operandsHint.trim() : ''
    if (explicit) return explicit
    const kids = Array.isArray(n?.children) ? n.children : []
    const names = kids.map(k => (k?.name ?? '').trim()).filter(Boolean)
    if (names.length >= 2) return `${names[0]} \u2212 ${names.slice(1).join(' \u2212 ')}`
    if (names.length === 1) return `${names[0]} \u2212 ?`
    return ''
  }
  const buildIntersectHint = (n) => {
    const kids = Array.isArray(n?.children) ? n.children : []
    const a = (kids[0]?.name ?? '').trim()
    const b = (kids[1]?.name ?? '').trim()
    return (a && b) ? `${a} \u2229 ${b}` : ''
  }

  if (op && op !== 'none' && !prim) {
    let label = capitalize(op)
    if (op === 'subtract' || op === 'difference') {
      const hint = buildSubtractHint(node)
      if (hint) label = `Subtract (${hint})`
    } else if (op === 'intersection' || op === 'intersect') {
      const hint = buildIntersectHint(node)
      if (hint) label = `Intersect (${hint})`
    }
    return { label, opKey: op, primKey: null, repeatKey: null }
  }

  if (prim) return { label: capitalize(prim), opKey: null, primKey: prim, repeatKey: null }
  return { label: 'Group', opKey: null, primKey: null, repeatKey: null }
}

function toTree(node, path = '0') {
  const { label, opKey, primKey, repeatKey } = typeAndKind(node)
  const out = {
    name: node?.name || 'Node',
    _typeLabel: label,
    _opKey: opKey || null,
    _primKey: primKey || null,
    _repeatKey: repeatKey || null,
    _path: path,
  }
  if (Array.isArray(node?.children) && node.children.length) {
    out.children = node.children.map((c, i) => toTree(c, `${path}.${i}`))
  }
  return out
}

const NODE_W = 240
const NODE_H = 130

function getScaleForDepth(depth) {
  const d = Math.max(0, Math.min(depth, 4))
  switch (d) {
    case 0: return 2
    case 1: return 1.15
    case 2: return 0.95
    case 3: return 0.8
    case 4: return 0.7
    default: return 1
  }
}
const MAX_SCALE = getScaleForDepth(0)

function getNodeAtPath(root, path) {
  const parts = String(path).split('.').slice(1).map((s) => parseInt(s, 10))
  let node = root
  for (const idx of parts) {
    if (!node?.children || !node.children[idx]) return null
    node = node.children[idx]
  }
  return node
}

/* ===== palette ===== */
const opFill = {
  union: '#fee8ff',
  subtract: '#ecf7ff',
  intersection: '#fff6ec',
}
const primFill = {
  cube: '#eceeff',
  sphere: '#f3fff2',
  cylinder: '#e8ffe6',
  torus: '#fff4e1',
  cone: '#fff6ec',
}
const repeatFill = {
  repeat_linear: '#ecf7ff',     // 线性：偏蓝
  repeat_circular: '#ffebfd',   // 圆周：偏粉
}
const defaultFill = '#f1f5f9'

function shapeKindFor(opKey, primKey, repeatKey) {
  if (repeatKey) {
    if (repeatKey === 'repeat_circular') return 'donut'
    return 'capsule'
  }

  if (opKey) {
    const op = String(opKey).toLowerCase()
    if (op === 'union') return 'hex'
    if (op === 'subtract' || op === 'difference') return 'oct'
    if (op === 'intersect' || op === 'intersection') return 'oct'
    return 'hex'
  }
  if (primKey) {
    const p = String(primKey).toLowerCase()
    if (p === 'cube' || p === 'box') return 'rectRounded'
    if (p === 'sphere') return 'circle'
    if (p === 'cylinder') return 'capsule'
    if (p === 'torus') return 'donut'
    if (p === 'cone') return 'triangle'
    return 'rectRounded'
  }
  return 'rectRounded'
}

function fillFor(opKey, primKey, repeatKey) {
  return (repeatKey && repeatFill[repeatKey]) ||
    (opKey && opFill[opKey]) ||
    (primKey && primFill[primKey]) ||
    defaultFill
}

function polygonPoints(sides, rx, ry) {
  const pts = []
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2
    pts.push(`${(Math.cos(a) * rx).toFixed(1)},${(Math.sin(a) * ry).toFixed(1)}`)
  }
  return pts.join(' ')
}

/* ===== Icons map (served from /public/icons) ===== */
const ICONS = {
  union: '/icons/union.svg',
  subtract: '/icons/difference.svg',
  difference: '/icons/difference.svg',
  intersect: '/icons/intersection.svg',
  intersection: '/icons/intersection.svg',
  cube: '/icons/cube.svg',
  sphere: '/icons/sphere.svg',
  cylinder: '/icons/cylinder.svg',
  torus: '/icons/torus.svg',
  cone: '/icons/cone.svg',
  // repeat_linear: '/icons/repeat-linear.svg',
}
function iconSrcFor(opKey, primKey, repeatKey) {
  if (repeatKey) return ICONS[repeatKey] || null
  if (opKey && ICONS[opKey]) return ICONS[opKey]
  if (primKey && ICONS[primKey]) return ICONS[primKey]
  return null
}

/* ===== Legend ===== */
function LegendIcon({ shape = 'hex', fill = '#f1f5f9', stroke = '#7b8794' }) {
  const W = 56, H = 36
  const halfW = W / 2, halfH = H / 2
  const sw = 2
  return (
    <svg width="56" height="36" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {shape === 'rectRounded' && (
        <rect x="1" y="1" width={W - 2} height={H - 2} rx="9" ry="9" fill={fill} stroke={stroke} strokeWidth={sw} />
      )}
      {shape === 'diamond' && (
        <polygon points={`${halfW},2 ${W - 2},${halfH} ${halfW},${H - 2} 2,${halfH}`} fill={fill} stroke={stroke} strokeWidth={sw} />
      )}
      {shape === 'hex' && (
        <polygon
          points={polygonPoints(6, halfW - 3, halfH - 3)}
          transform={`translate(${halfW},${halfH})`}
          fill={fill} stroke={stroke} strokeWidth={sw} />
      )}
      {shape === 'oct' && (
        <polygon
          points={polygonPoints(8, halfW - 3, halfH - 3)}
          transform={`translate(${halfW},${halfH})`}
          fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray="6 4" />
      )}
      {shape === 'triangle' && (
        <polygon points={`${halfW},2 ${W - 2},${H - 2} 2,${H - 2}`} fill={fill} stroke={stroke} strokeWidth={sw} />
      )}
      {shape === 'capsule' && (
        <rect x="1" y="5" width={W - 2} height={H - 10} rx={(H - 10) / 2} ry={(H - 10) / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
      )}
      {shape === 'circle' && (
        <ellipse cx={halfW} cy={halfH} rx={halfH - 3} ry={halfH - 3} fill={fill} stroke={stroke} strokeWidth={sw} />
      )}
      {shape === 'donut' && (
        <>
          <ellipse cx={halfW} cy={halfH} rx={halfH - 5} ry={halfH - 5} fill="none" stroke={fill} strokeWidth="10" />
          <ellipse cx={halfW} cy={halfH} rx={halfH - 3} ry={halfH - 3} fill="none" stroke={stroke} strokeWidth={sw} />
        </>
      )}
    </svg>
  )
}

function LegendPanel() {
  const STORAGE_KEY = 'ttcs.legend.open'
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== '0' } catch { return true }
  })
  const toggle = () => {
    setOpen(v => {
      const nv = !v
      try { localStorage.setItem(STORAGE_KEY, nv ? '1' : '0') } catch { }
      return nv
    })
  }

  const items = [
    { k: 'repeat_linear', title: 'Linear Repeat', sub: 'Array along a line', shape: 'capsule', fill: repeatFill.repeat_linear, icon: null },
    { k: 'repeat_circular', title: 'Circular Repeat', sub: 'Array on a ring', shape: 'donut', fill: repeatFill.repeat_circular, icon: null },

    { k: 'union', title: 'Union', sub: 'Group parts into one', shape: 'hex', fill: opFill.union, icon: ICONS.union },
    { k: 'subtract', title: 'Subtract', sub: 'Remove B from A', shape: 'oct', fill: opFill.subtract, icon: ICONS.difference },
    { k: 'intersection', title: 'Intersect', sub: 'Keep only overlap', shape: 'oct', fill: opFill.intersection, icon: ICONS.intersection },

    { k: 'cube', title: 'Cube', sub: 'Basic box', shape: 'rectRounded', fill: primFill.cube, icon: ICONS.cube },
    { k: 'sphere', title: 'Sphere', sub: 'Round ball', shape: 'circle', fill: primFill.sphere, icon: ICONS.sphere },
    { k: 'cylinder', title: 'Cylinder', sub: 'Tube-like', shape: 'capsule', fill: primFill.cylinder, icon: ICONS.cylinder },
    { k: 'torus', title: 'Torus', sub: 'Donut ring', shape: 'donut', fill: primFill.torus, icon: ICONS.torus },
    { k: 'cone', title: 'Cone', sub: 'Tapered', shape: 'triangle', fill: primFill.cone, icon: ICONS.cone },
  ]

  return (
    <div className="ttcs-legend" role="region" aria-label="Visual Grammar">
      <button className="ttcs-legend__toggle" onClick={toggle} aria-expanded={open}>
        {open ? '✕' : '☰'} <span className="ttcs-legend__toggle-text">{open ? 'Legend' : 'Legend'}</span>
      </button>
      {open && (
        <div className="ttcs-legend__panel">
          <div className="ttcs-legend__title">Visual Grammar</div>
          <div className="ttcs-legend__grid">
            {items.map(it => (
              <div className="ttcs-legend__item" key={it.k}>
                <LegendIcon shape={it.shape} fill={it.fill} />
                <div className="ttcs-legend__meta">
                  <div className="ttcs-legend__name">
                    {it.title}
                    {it.icon && <img className="ttcs-legend__chip" src={it.icon} alt="" aria-hidden="true" />}
                  </div>
                  <div className="ttcs-legend__sub">{it.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* =============================== */

export default function StructureTree({
  url = '/scene.json',
  scene = null,
  onHoverPath,
  onBlankClick,
  onSceneChange,
  onOpenPanel,
  onDeletePath,
  onAddChild,
  onNodePrompt,

  // ✅ 复制/粘贴
  onCopyPath,
  onPasteAsUnion,
  hasClipboard = false,

  // ✅ Instance Library (copy-based)
  libraryItems = [],
  onPickLibraryItem,
  onRemoveLibraryItem,
  onRenameLibraryItem,
  onInstantiate, // (path, name) => void

  activePath = null,
  focusPath = null,
  focusRequestId = 0,
  onFocusDone,
}) {
  const containerRef = useRef(null)
  const treeRef = useRef(null)
  const [dim, setDim] = useState({ w: 0, h: 0 })
  const dimensionsRef = useRef({ w: 0, h: 0 })
  const [treeViewport, setTreeViewport] = useState({ translate: { x: 0, y: 96 }, zoom: 1 })
  const treeViewportRef = useRef(treeViewport)
  const [sceneObj, setSceneObj] = useState(null)
  const [rawTree, setRawTree] = useState(null)
  const [error, setError] = useState(null)
  const [collapsedPaths, setCollapsedPaths] = useState(() => new Set())

  const nodeRefs = useRef(new Map())
  const focusFlashRef = useRef(null)
  const cancelTreeFocusRef = useRef(null)

  const updateTreeViewport = useCallback(({ translate, zoom }) => {
    if (!translate || ![translate.x, translate.y, zoom].every(Number.isFinite) || zoom <= 0) return
    const next = { translate: { x: translate.x, y: translate.y }, zoom }
    treeViewportRef.current = next
    setTreeViewport(previous => sameTreeViewport(previous, next) ? previous : next)
  }, [])

  useEffect(() => () => {
    if (focusFlashRef.current) {
      clearTimeout(focusFlashRef.current.timer)
      focusFlashRef.current.node.classList.remove('ttcs-node--flash')
    }
  }, [])

  // ✅ hover 节点（只在 hover 时显示 Copy/Paste）
  const [hoveredPath, setHoveredPath] = useState(null)

  const hoverPathRef = useRef(null)
  const dispatchHover = useCallback((next) => {
    if (hoverPathRef.current === next) return
    hoverPathRef.current = next
    if (typeof onHoverPath === 'function') onHoverPath(next)
  }, [onHoverPath])
  useEffect(() => {
    return () => {
      if (hoverPathRef.current != null && typeof onHoverPath === 'function') {
        onHoverPath(null)
      }
      hoverPathRef.current = null
    }
  }, [onHoverPath])

  const shouldFetch = useMemo(() => {
    const okUrl = typeof url === 'string' && url.trim().length > 0
    return okUrl && !scene
  }, [url, scene])

  useEffect(() => {
    const onResize = () => {
      const box = containerRef.current
      if (!box) return
      const next = { w: box.clientWidth, h: box.clientHeight }
      const previous = dimensionsRef.current
      if (previous.w === next.w && previous.h === next.h) return
      cancelTreeFocusRef.current?.()
      dimensionsRef.current = next
      setDim(next)
      if (previous.w !== next.w) {
        const current = treeViewportRef.current
        updateTreeViewport({ ...current, translate: {
          ...current.translate,
          x: previous.w ? current.translate.x + (next.w - previous.w) / 2 : next.w / 2,
        } })
      }
    }
    onResize()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
    if (containerRef.current) observer?.observe(containerRef.current)
    window.addEventListener('resize', onResize)
    return () => { observer?.disconnect(); window.removeEventListener('resize', onResize) }
  }, [updateTreeViewport])

  useEffect(() => {
    let active = true
    if (!shouldFetch) {
      setError(null)
      return () => { active = false }
    }
    ; (async () => {
      try {
        setError(null)
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const ct = res.headers.get('content-type') || ''
        if (!ct.includes('application/json')) {
          const head = (await res.clone().text()).slice(0, 80)
          throw new Error(`Not JSON (content-type=${ct}); head="${head}"`)
        }
        const json = await res.json()
        const root = json.scene || json
        const data = toTree(root, '0')
        if (active) {
          setSceneObj(root)
          setRawTree(data)
          setCollapsedPaths(new Set())
          onSceneChange && onSceneChange(root)
        }
      } catch (e) {
        if (active) setError(String(e))
        console.error('Failed to load scene.json:', e)
      }
    })()
    return () => { active = false }
  }, [shouldFetch, url, onSceneChange])

  useEffect(() => {
    if (!scene) return
    try {
      const data = toTree(scene, '0')
      setSceneObj(scene)
      setRawTree(data)
      setCollapsedPaths(new Set())
    } catch (e) {
      console.error('Failed to apply external scene:', e)
    }
  }, [scene])

  const data = useMemo(() => {
    if (!rawTree) return null
    return visibleTreeData(rawTree, collapsedPaths)
  }, [rawTree, collapsedPaths])
  const treeData = useMemo(() => data ? [data] : [], [data])

  const toggleCollapse = useCallback((path) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const requestOpenPanel = useCallback((path, fallbackName, isPrimitive) => {
    if (!sceneObj) return
    const node = getNodeAtPath(sceneObj, path)
    if (!node) return

    const repKey = getRepeatKey(node)
    const title =
      fallbackName ||
      (repKey ? 'Repeat' : (isPrimitive ? 'Primitive' : 'Operation'))

    if (typeof onOpenPanel === 'function') onOpenPanel({ path, title })
  }, [sceneObj, onOpenPanel])

  const renderNode = useCallback(({ nodeDatum }) => {
    const name = nodeDatum?.name || 'Node'
    const typeLabel = nodeDatum?._typeLabel || ''
    const opKey = nodeDatum?._opKey || null
    const primKey = nodeDatum?._primKey || null
    const repeatKey = nodeDatum?._repeatKey || null
    const path = nodeDatum?._path

    const depth = Math.max(0, (String(path).split('.').length - 1))
    const depthClamped = Math.min(depth, 4)

    const baseScale = getScaleForDepth(depthClamped)
    const extraKey = repeatKey ? repeatKey : (primKey ? String(primKey).toLowerCase() : null)
    const extra = extraKey && KIND_EXTRA_SCALE[extraKey] ? KIND_EXTRA_SCALE[extraKey] : 1
    const scale = baseScale * extra

    const fill = fillFor(opKey, primKey, repeatKey)
    const kind = shapeKindFor(opKey, primKey, repeatKey)
    const iconSrc = iconSrcFor(opKey, primKey, repeatKey)
    const isActive = activePath && String(activePath) === String(path)

    const onCardClick = (e) => {
      e.stopPropagation()
      if (e.altKey) toggleCollapse(path)
      else requestOpenPanel(path, name, !!primKey)
    }

    const onEnter = () => { setHoveredPath(path); dispatchHover(path) }
    const onLeave = () => { setHoveredPath(null); dispatchHover(null) }

    const onKeyDown = (e) => {
      const isActivate = e.key === 'Enter' || e.key === ' '
      if (!isActivate) return
      e.preventDefault()
      if (e.altKey) toggleCollapse(path)
      else requestOpenPanel(path, name, !!primKey)
    }

    // actions
    const onDeleteClick = (e) => {
      e.stopPropagation()
      if (String(path) === '0') return
      const ok = window.confirm('是否要删除该节点？\nDelete this node?')
      if (!ok) return
      if (typeof onDeletePath === 'function') onDeletePath(path)
    }
    const onAddClick = (e) => {
      e.stopPropagation()
      if (typeof onAddChild === 'function') onAddChild(path)
    }
    const onAiClick = (e) => {
      e.stopPropagation()
      if (typeof onNodePrompt === 'function') onNodePrompt(path)
    }

    // ✅ instantiate (copy to library)
    const onInstantiateClick = (e) => {
      e.stopPropagation()
      if (typeof onInstantiate !== 'function') return
      const defaultName = String(name || 'Instance')
      const nm = window.prompt('Instance name / 实例名称', defaultName)
      if (nm == null) return
      const finalName = String(nm).trim() || defaultName
      onInstantiate(path, finalName)
    }

    // copy/paste
    const onCopyClick = (e) => {
      e.stopPropagation()
      if (typeof onCopyPath === 'function') onCopyPath(path)
    }
    const onPasteClick = (e) => {
      e.stopPropagation()
      if (typeof onPasteAsUnion === 'function') onPasteAsUnion(path)
    }

    const CARD_W = 220, CARD_H = 115
    const foScale = getScaleForDepth(depthClamped)
    const w = CARD_W * foScale
    const h = CARD_H * foScale
    const x = -w / 2
    const y = -h / 2

    const halfW = NODE_W / 2, halfH = NODE_H / 2
    const strokeW = 2.5

    const ShapeBg = () => (
      <g
        className="ttcs-node__bgwrap"
        transform={`scale(${scale},${scale}) translate(${-halfW},${-halfH})`}
        style={{ pointerEvents: 'visiblePainted' }}
      >
        <rect x="0" y="0" width={NODE_W} height={NODE_H} fill="#000" opacity="0" pointerEvents="all" />
        {kind === 'rectRounded' && (
          <rect className="ttcs-node__bg" x="0" y="0" width={NODE_W} height={NODE_H} rx="16" ry="16"
            fill={fill} fillOpacity={1} stroke="var(--node-stroke, #7b8794)" strokeWidth={strokeW} />
        )}
        {kind === 'diamond' && (
          <polygon className="ttcs-node__bg"
            points={`${halfW},0 ${NODE_W},${halfH} ${halfW},${NODE_H} 0,${halfH}`}
            fill={fill} fillOpacity={1} stroke="var(--node-stroke, #7b8794)" strokeWidth={strokeW} />
        )}
        {kind === 'hex' && (
          <polygon className="ttcs-node__bg"
            points={polygonPoints(6, halfW, halfH)}
            transform={`translate(${halfW},${halfH})`}
            fill={fill} fillOpacity={1} stroke="var(--node-stroke, #7b8794)" strokeWidth={strokeW} />
        )}
        {kind === 'oct' && (
          <polygon className="ttcs-node__bg ttcs-node__bg--dash"
            points={polygonPoints(8, halfW, halfH)}
            transform={`translate(${halfW},${halfH})`}
            fill={fill} fillOpacity={1} stroke="var(--node-stroke, #7b8794)" strokeWidth={strokeW} />
        )}
        {kind === 'triangle' && (
          <polygon className="ttcs-node__bg"
            points={`${halfW},0 ${NODE_W},${NODE_H} 0,${NODE_H}`}
            fill={fill} fillOpacity={1} stroke="var(--node-stroke, #7b8794)" strokeWidth={strokeW} />
        )}
        {kind === 'capsule' && (
          <rect className="ttcs-node__bg"
            x="0" y="0" width={NODE_W} height={NODE_H} rx={NODE_H / 2} ry={NODE_H / 2}
            fill={fill} fillOpacity={1} stroke="var(--node-stroke, #7b8794)" strokeWidth={strokeW} />
        )}
        {kind === 'circle' && (
          <ellipse className="ttcs-node__bg"
            cx={halfW} cy={halfH} rx={Math.min(halfW, halfH) - 3} ry={Math.min(halfW, halfH) - 3}
            fill={fill} fillOpacity={1} stroke="var(--node-stroke, #7b8794)" strokeWidth={strokeW} />
        )}
        {kind === 'donut' && (() => {
          const R = Math.min(halfW, halfH)
          const outerR = R - TORUS_OUTER_MARGIN
          const holeR = Math.max(outerR * TORUS_HOLE_RATIO, outerR - TORUS_MIN_RING)
          const ringWidth = Math.max(outerR - holeR, 12)
          const ringRadius = (outerR + holeR) / 2
          return (
            <>
              <ellipse className="ttcs-donut-cover" cx={halfW} cy={halfH} rx={holeR} ry={holeR}
                fill="#fff" fillOpacity="0.98" pointerEvents="none" />
              <ellipse className="ttcs-node__bg ttcs-donut-ring" cx={halfW} cy={halfH} rx={ringRadius} ry={ringRadius}
                fill="none" stroke={fill} strokeOpacity="0.95" strokeWidth={ringWidth} />
              <ellipse className="ttcs-donut-outline" cx={halfW} cy={halfH} rx={outerR} ry={outerR}
                fill="none" stroke="var(--node-stroke, #7b8794)" strokeWidth={strokeW} />
            </>
          )
        })()}
      </g>
    )

    const nodeClass =
      `ttcs-node ${repeatKey ? 'ttcs-kind-repeat ttcs-repeat--' + repeatKey : ''} ` +
      `${opKey ? 'ttcs-kind-op ttcs-op--' + opKey : ''} ` +
      `${primKey ? 'ttcs-kind-prim ttcs-prim--' + primKey : ''} ` +
      `ttcs-depth-${depthClamped}` +
      (isActive ? ' ttcs-node--active' : '')

    const showCopyBar = hoveredPath && String(hoveredPath) === String(path)

    return (
      <g
        className={nodeClass}
        data-depth={depth}
        data-path={path}
        ref={(el) => {
          const key = String(path)
          if (el) nodeRefs.current.set(key, el)
          else nodeRefs.current.delete(key)
        }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{ ['--node-stroke']: '#7b8794' }}
      >
        <ShapeBg />
        <foreignObject x={x} y={y} width={w} height={h}>
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
              position: 'relative'
            }}
          >
            <div
              className={`ttcs-tree-card ttcs-depth-${depthClamped}`}
              data-depth={depth}
              onClick={onCardClick}
              role="button"
              aria-label={`Open ${name} parameters`}
              tabIndex={0}
              onKeyDown={onKeyDown}
              style={{
                display: 'grid',
                gridTemplateColumns: 'var(--accent-w, 12px) 1fr',
                ['--card-scale']: getScaleForDepth(depthClamped),
                ['--accent-color']: fill,
                pointerEvents: 'auto',
                position: 'relative',
                cursor: 'pointer',
                background: 'transparent',
                border: 0,
                boxShadow: 'none'
              }}
            >
              <div
                className="ttcs-tree-card__accent"
                style={{ background: fill, cursor: 'pointer', opacity: 0.35 }}
                onClick={(e) => { e.stopPropagation(); toggleCollapse(path) }}
                title="Alt/Option + Click card to collapse/expand; Click this bar to collapse/expand"
              />
              <div className="ttcs-tree-card__content" style={{ gridColumn: 2 }}>
                <div className="ttcs-tree-card__title">{name}</div>
                <div className="ttcs-tree-sub">{typeLabel}</div>
              </div>

              {iconSrc && (
                <div className="ttcs-chip" aria-hidden="true">
                  <img className="ttcs-chip__img" src={iconSrc} alt="" />
                </div>
              )}

              <div
                className="ttcs-nodebtn-stack"
                role="toolbar"
                aria-label="Node actions"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="ttcs-nodebtn ttcs-nodebtn--del"
                  onClick={onDeleteClick}
                  title="Delete"
                  aria-label="Delete node"
                  disabled={String(path) === '0'}
                >✕</button>

                <button
                  className="ttcs-nodebtn ttcs-nodebtn--add"
                  onClick={onAddClick}
                  title="Add child"
                  aria-label="Add child node"
                >＋</button>

                <button
                  className="ttcs-nodebtn ttcs-nodebtn--ai"
                  onClick={onAiClick}
                  title="AI prompt (edit this node)"
                  aria-label="AI prompt this node"
                >💬</button>
              </div>

              {(onCopyPath || onPasteAsUnion || onInstantiate) && (
                <div
                  className="ttcs-nodebtn-bottomright"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    left: 6,
                    bottom: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    opacity: showCopyBar ? 1 : 0,
                    transition: 'opacity 120ms ease',
                    pointerEvents: showCopyBar ? 'auto' : 'none',
                    zIndex: 10,
                  }}
                  role="toolbar"
                  aria-label="Instance / Copy / Paste"
                >
                  {/* ✅ Instantiate (top) */}
                  {onInstantiate && (
                    <button
                      className="ttcs-nodebtn ttcs-nodebtn--inst"
                      title="Instantiate (save subtree to Library) / 实例化（存入Library）"
                      aria-label="Instantiate"
                      onClick={onInstantiateClick}
                    >
                      ⧉
                    </button>
                  )}

                  {/* Paste */}
                  {onPasteAsUnion && (
                    <button
                      className="ttcs-nodebtn ttcs-nodebtn--paste"
                      title="Paste as Union"
                      aria-label="Paste as Union"
                      onClick={onPasteClick}
                      disabled={!hasClipboard}
                    >
                      📥
                    </button>
                  )}

                  {/* Copy */}
                  {onCopyPath && (
                    <button
                      className="ttcs-nodebtn ttcs-nodebtn--copy"
                      title="Copy subtree"
                      aria-label="Copy subtree"
                      onClick={onCopyClick}
                    >
                      🗐
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </foreignObject>
      </g>
    )
  }, [
    activePath,
    dispatchHover,
    onAddChild,
    onDeletePath,
    onNodePrompt,
    requestOpenPanel,
    toggleCollapse,
    onCopyPath,
    onPasteAsUnion,
    hasClipboard,
    hoveredPath,
    onInstantiate,
  ])

  // Programmatic focus from 3D click
  useEffect(() => {
    if (!focusPath || !rawTree) return
    const path = String(focusPath)
    if (!/^0(?:\.(?:0|[1-9]\d*))*$/.test(path) || !getNodeAtPath(rawTree, path)) {
      onFocusDone?.(focusPath, focusRequestId)
      return
    }
    setCollapsedPaths(previous => expandTreeAncestors(previous, path))

    let frame = null
    let stopAnimation = null
    let cancelled = false
    let attempts = 0
    const deadline = performance.now() + 750
    const finish = () => {
      if (!cancelled) onFocusDone?.(focusPath, focusRequestId)
    }
    const interrupt = () => {
      if (cancelled) return
      cancelled = true
      if (frame != null) cancelAnimationFrame(frame)
      stopAnimation?.()
      onFocusDone?.(focusPath, focusRequestId)
    }
    cancelTreeFocusRef.current = interrupt
    const box = containerRef.current
    const interruptionEvents = ['pointerdown', 'wheel', 'touchstart', 'keydown', 'scroll']
    interruptionEvents.forEach(type => box?.addEventListener(type, interrupt, { capture: true, passive: true }))
    const tryCenter = () => {
      if (cancelled) return
      const box = containerRef.current
      const inner = nodeRefs.current.get(path)
      const group = box?.querySelector('.rd3t-g')
      const svg = box?.querySelector('svg.rd3t-svg')
      if (!box || !inner?.isConnected || !group || !svg || !box.clientWidth || !box.clientHeight) {
        if (++attempts < 30 && performance.now() < deadline) frame = requestAnimationFrame(tryCenter)
        else finish()
        return
      }

      const boxRect = box.getBoundingClientRect()
      const boxScaleX = box.offsetWidth ? boxRect.width / box.offsetWidth : 1
      const boxScaleY = box.offsetHeight ? boxRect.height / box.offsetHeight : 1
      // A node's D3 host may also contain action controls. Measure its centered
      // card/shape instead, including leaf nodes, and use the visible scrollport.
      const nodeRect = (inner.querySelector('.ttcs-node__bgwrap') || inner).getBoundingClientRect()
      const matrix = group.transform?.baseVal?.consolidate()?.matrix
      const current = matrix ? {
        translate: { x: matrix.e, y: matrix.f }, zoom: Math.hypot(matrix.a, matrix.b),
      } : treeViewportRef.current
      const screenMatrix = svg.getScreenCTM?.()
      const next = centerTreeViewport(current, nodeRect, {
        left: boxRect.left + box.clientLeft * boxScaleX,
        top: boxRect.top + box.clientTop * boxScaleY,
        width: box.clientWidth * boxScaleX,
        height: box.clientHeight * boxScaleY,
      }, {
        x: screenMatrix ? Math.hypot(screenMatrix.a, screenMatrix.b) : 1,
        y: screenMatrix ? Math.hypot(screenMatrix.c, screenMatrix.d) : 1,
      })
      const revealTarget = () => {
        if (cancelled) return
        if (focusFlashRef.current) {
          clearTimeout(focusFlashRef.current.timer)
          focusFlashRef.current.node.classList.remove('ttcs-node--flash')
        }
        inner.classList.add('ttcs-node--flash')
        focusFlashRef.current = { node: inner, timer: setTimeout(() => {
          inner.classList.remove('ttcs-node--flash')
          focusFlashRef.current = null
        }, 1100) }
        finish()
      }
      if (!next) { finish(); return }
      stopAnimation = animateTreeViewport(current, next, {
        onUpdate: updateTreeViewport,
        onComplete: revealTarget,
        reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
      })
    }
    // Wait for ancestors to expand and for react-d3-tree to commit node transforms.
    frame = requestAnimationFrame(tryCenter)
    return () => {
      cancelled = true
      if (frame != null) cancelAnimationFrame(frame)
      stopAnimation?.()
      interruptionEvents.forEach(type => box?.removeEventListener(type, interrupt, true))
      if (cancelTreeFocusRef.current === interrupt) cancelTreeFocusRef.current = null
    }
  }, [focusPath, focusRequestId, rawTree, onFocusDone, updateTreeViewport])

  return (
    <div
      ref={containerRef}
      className="ttcs-tree"
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'auto' }}
      onClick={(e) => {
        const host = e.target?.closest ? e.target.closest('.rd3t-node, .rd3t-leaf-node') : null
        if (!host && typeof onBlankClick === 'function') onBlankClick()
      }}
    >
      {shouldFetch && error && <div style={{ color: '#b91c1c', padding: 8 }}>Load error: {error}</div>}
      {shouldFetch && !error && !data && <div style={{ color: '#64748b', padding: 8 }}>Loading scene.json…</div>}

      <div className="ttcs-overlays">
        <LegendPanel />

        <InstanceLibrary
          stacked
          items={libraryItems}
          onPick={(id) => { if (typeof onPickLibraryItem === 'function') onPickLibraryItem(id) }}
          onRemove={onRemoveLibraryItem}
          onRename={onRenameLibraryItem}
        />
      </div>

      {data && dim.w > 0 && (
        <Tree
          ref={treeRef}
          data={treeData}
          orientation="vertical"
          pathFunc="diagonal"
          translate={treeViewport.translate}
          zoom={treeViewport.zoom}
          onUpdate={updateTreeViewport}
          depthFactor={250}
          separation={{ siblings: 1.1, nonSiblings: 1.5 }}
          nodeSize={{ x: NODE_W + 30, y: NODE_H + 40 }}
          renderCustomNodeElement={renderNode}
          allowForeignObjects
          collapsible={false}
          transitionDuration={200}
          centerNodeOnClick={true}
        />
      )}
    </div>
  )
}
