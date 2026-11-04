// src/components/ParameterPanel.jsx
// Edit the selected part: its name and color, then compact groups of sliders
// (Shape, Repeat, Position, Rotation, Scale). Each value can be typed, dragged on
// the slider, or scrubbed by dragging its label. Slider ranges are tucked behind
// a per-group "Range" toggle, since most people never need to change them.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_T_RANGE } from '../hooks/useParamRanges'
import {
  DEFAULT_COLOR,
  isValidHexInput,
  getPrimitiveColor,
  collectDescendantPrimitiveColors,
  normalizeHex,
} from '../utils/color'
import { getRepeatKey } from '../utils/repeat'

const AXES = ['X', 'Y', 'Z']
const PRIM_LABELS = {
  w: 'Width', h: 'Height', d: 'Depth', r: 'Radius', R: 'Radius', t: 'Thickness',
  radialSegments: 'Smoothness', tubularSegments: 'Ring smoothness',
  widthSegments: 'Smoothness (around)', heightSegments: 'Smoothness (up)',
}
const TYPE_NAMES = { cube: 'Cube', box: 'Cube', sphere: 'Sphere', cylinder: 'Cylinder', torus: 'Torus', cone: 'Cone' }
const OP_NAMES = { union: 'Union', subtract: 'Subtract', difference: 'Subtract', intersection: 'Intersect', intersect: 'Intersect', group: 'Group' }

const decimalsOf = (step) => {
  const text = String(step)
  return text.includes('.') ? text.split('.')[1].length : 0
}
const roundTo = (value, step) => {
  const d = Math.min(6, decimalsOf(step || 1))
  return Number(Number(value).toFixed(d))
}

export function describeNode(node) {
  if (!node) return ''
  const repeat = getRepeatKey(node)
  const count = Array.isArray(node.children) ? node.children.length : 0
  const parts = count ? ` · ${count} part${count === 1 ? '' : 's'}` : ''
  if (repeat) return `${repeat === 'repeat_circular' ? 'Circular repeat' : 'Linear repeat'}${parts}`
  if (node.primitive && !node.operation) return TYPE_NAMES[String(node.primitive.type || '').toLowerCase()] || 'Shape'
  return `${OP_NAMES[String(node.operation || 'group').toLowerCase()] || 'Group'}${parts}`
}

// Which section a slider belongs to, and its short row label.
function placeSpec(spec) {
  const [p0, p1, p2] = spec.path || []
  if (p0 === 'transform') {
    const section = p1 === 't' ? 'position' : p1 === 'r' ? 'rotation' : 'scale'
    return { section, label: AXES[p2] || '', axis: p2 }
  }
  if (p0 === 'primitive') return { section: 'shape', label: PRIM_LABELS[p1] || p1 }
  if (p0 === 'repeat') {
    if (p1 === 'count' || p1 === 'n') return { section: 'repeat', label: 'Copies' }
    if (p1 === 'radius') return { section: 'repeat', label: 'Radius' }
    if (p1 === 'angle') return { section: 'repeat', label: 'Sweep°' }
    const group = p1 === 't' ? 'Step' : p1 === 'r' ? 'Turn°' : 'Scale'
    return { section: 'repeat', label: `${group} ${AXES[p2] || ''}`, axis: p2 }
  }
  return { section: 'shape', label: spec.label }
}

const SECTIONS = [
  { key: 'shape', title: 'Shape' },
  { key: 'repeat', title: 'Repeat', hint: 'How many copies, and how each copy moves from the last.' },
  { key: 'position', title: 'Position' },
  { key: 'rotation', title: 'Rotation', unit: '°' },
  { key: 'scale', title: 'Scale' },
]

// Drag a row's label left or right to change its value.
function ScrubLabel({ label, axis, spec, onStart, onChange, onEnd }) {
  const drag = useRef(null)
  const range = Number(spec.max) - Number(spec.min)
  const perPixel = Number.isFinite(range) && range > 0 ? Math.max(Number(spec.step) || 0.01, range / 300) : (Number(spec.step) || 0.1)
  return (
    <span
      className={`param-row__label${axis != null ? ` param-row__label--axis param-row__label--${'xyz'[axis]}` : ''}`}
      title="Drag left or right to adjust"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        drag.current = { x: event.clientX, value: Number(spec.value) || 0 }
        onStart()
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        const next = drag.current.value + (event.clientX - drag.current.x) * perPixel
        onChange(roundTo(Math.min(spec.max, Math.max(spec.min, next)), spec.step))
      }}
      onPointerUp={() => { if (drag.current) { drag.current = null; onEnd() } }}
      onPointerCancel={() => { if (drag.current) { drag.current = null; onEnd() } }}
    >{label}</span>
  )
}

export default function ParameterPanel(props) {
  const {
    panelPath,
    selectedNode,
    panelSpecs,
    selectionCount = 0,

    beginEdit,
    endEdit,

    renameNodeAtPath,
    updateNodeColor,
    updateSpecValue,

    setHighlightPath,

    // Translate range
    getTranslateRange,
    updateTranslateRange,
    resetTranslateRange,
    keyForDraft,
    rangeDraftRef,
    setRangeDraftTick,

    // Max-only
    keyForSMax,
    keyForPrimMax,
    paramMaxDraftRef,
    setParamMaxDraftTick,
    setMaxOverride,
    resetMaxOverride,

    // Repeat range
    updateRepeatRange,
    resetRepeatRange,
    keyForRepeatDraft,
    repeatDraftRef,
    setRepeatDraftTick,
  } = props

  const [rangeOpen, setRangeOpen] = useState({})

  const colorState = useMemo(() => {
    if (!selectedNode) return { mode: 'none', color: null, setSize: 0 }
    if (selectedNode.primitive && !selectedNode.operation) {
      return { mode: 'primitive', color: getPrimitiveColor(selectedNode), setSize: 1 }
    }
    const set = collectDescendantPrimitiveColors(selectedNode)
    if (set.size === 0) return { mode: 'none', color: null, setSize: 0 }
    if (set.size === 1) return { mode: 'solid', color: [...set][0], setSize: 1 }
    return { mode: 'mixed', color: null, setSize: set.size }
  }, [selectedNode])

  // <input type="color"> only accepts #RRGGBB
  const toColorInputHex6 = (hex) => {
    const norm = normalizeHex(hex)
    if (!norm) return DEFAULT_COLOR
    if (norm.length === 9) return norm.slice(0, 7)
    return norm
  }

  // Name: a local draft so typing doesn't fight the scene updates
  const [nameDraft, setNameDraft] = useState('')
  useEffect(() => {
    setNameDraft(selectedNode?.name ?? '')
  }, [panelPath, selectedNode?.name])

  const [colorHexInput, setColorHexInput] = useState('')
  useEffect(() => {
    if (!selectedNode) { setColorHexInput(''); return }
    if (colorState.mode === 'primitive' || colorState.mode === 'solid') {
      setColorHexInput(colorState.color || '')
    } else {
      setColorHexInput('')
    }
  }, [panelPath, selectedNode, colorState.mode, colorState.color])

  if (!panelPath) {
    return (
      <div className="panel-body">
        <div className="param-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
          </svg>
          <div className="param-empty__title">{selectionCount > 1 ? `${selectionCount} parts selected` : 'Nothing selected'}</div>
          <p>{selectionCount > 1
            ? 'Select a single part to edit its size, position and color.'
            : 'Click a part in the tree or on the model to edit its size, position and color.'}</p>
        </div>
      </div>
    )
  }

  const isInvalidColor = colorHexInput && !isValidHexInput(colorHexInput)
  const colorScope = colorState.mode === 'primitive' ? 'single' : 'subtree'
  const beginEditAndHighlight = () => { beginEdit?.(); setHighlightPath?.(panelPath) }
  const highlightOnly = () => setHighlightPath?.(panelPath)

  const commitName = () => {
    if (!selectedNode || typeof renameNodeAtPath !== 'function') return
    if ((nameDraft || '').trim() === (selectedNode.name || '')) return
    renameNodeAtPath(panelPath, nameDraft)
    endEdit?.('rename')
  }

  const applyColor = (value) => {
    const norm = normalizeHex(value)
    if (norm && typeof updateNodeColor === 'function') updateNodeColor(panelPath, norm, colorScope)
    endEdit?.('color')
  }

  // ---------- range editors (unchanged behaviour, now shown on demand) ----------
  const repeatSigForSpec = (spec) => {
    const p = spec?.path || []
    const k1 = p[1]
    if (k1 === 'count' || k1 === 'n') return 'count'
    if (k1 === 'radius') return 'radius'
    if (k1 === 'angle') return 'angle'
    if (k1 === 't' || k1 === 'r' || k1 === 's') return `${k1}|${p[2]}`
    return String(k1 || 'unknown')
  }

  const draftInput = ({ value, onDraft, onCommit, onCancel, label, placeholder }) => (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); e.currentTarget.blur() }
      }}
      className="param-range__input"
      aria-label={label}
      title={label}
      placeholder={placeholder}
    />
  )

  const rangeEditorFor = (spec, rowLabel) => {
    const isTranslate = spec.path[0] === 'transform' && spec.path[1] === 't'
    const isScale = spec.path[0] === 'transform' && spec.path[1] === 's'
    const isPrimNum = spec.path[0] === 'primitive'
    const isRepeat = spec.path[0] === 'repeat' && typeof updateRepeatRange === 'function' && repeatDraftRef

    if (isTranslate) {
      const axis = spec.path[2]
      const tRange = getTranslateRange(panelPath, axis)
      const keys = { min: keyForDraft(panelPath, axis, 'min'), max: keyForDraft(panelPath, axis, 'max') }
      const shown = kind => keys[kind] in rangeDraftRef.current ? rangeDraftRef.current[keys[kind]] : String(tRange[kind])
      const draft = kind => v => { rangeDraftRef.current[keys[kind]] = v; setRangeDraftTick(t => t + 1) }
      const cancel = kind => () => { delete rangeDraftRef.current[keys[kind]]; setRangeDraftTick(t => t + 1) }
      const commit = kind => () => {
        if (!(keys[kind] in rangeDraftRef.current)) return
        const num = Number(rangeDraftRef.current[keys[kind]])
        if (Number.isFinite(num)) updateTranslateRange(panelPath, axis, { [kind]: num })
        cancel(kind)()
      }
      return (
        <div className="param-range" key={`range-${spec.path.join('.')}`}>
          <span className="param-range__label">{rowLabel}</span>
          {draftInput({ value: shown('min'), onDraft: draft('min'), onCommit: commit('min'), onCancel: cancel('min'), label: `${rowLabel} minimum`, placeholder: String(DEFAULT_T_RANGE.min) })}
          <span className="param-range__dash">to</span>
          {draftInput({ value: shown('max'), onDraft: draft('max'), onCommit: commit('max'), onCancel: cancel('max'), label: `${rowLabel} maximum`, placeholder: String(DEFAULT_T_RANGE.max) })}
          <button type="button" className="param-range__reset" onClick={() => resetTranslateRange(panelPath, axis)} title={`Reset to ${DEFAULT_T_RANGE.min} to ${DEFAULT_T_RANGE.max}`}>Reset</button>
        </div>
      )
    }

    if (isScale || isPrimNum) {
      const key = isScale ? keyForSMax(panelPath, spec.path[2]) : keyForPrimMax(panelPath, spec.path[1])
      const shown = key in paramMaxDraftRef.current ? paramMaxDraftRef.current[key] : String(spec.max)
      const cancel = () => { delete paramMaxDraftRef.current[key]; setParamMaxDraftTick(t => t + 1) }
      const commit = () => {
        if (!(key in paramMaxDraftRef.current)) return
        const num = Number(paramMaxDraftRef.current[key])
        if (Number.isFinite(num)) setMaxOverride(key, num, spec.min, spec.step)
        cancel()
      }
      return (
        <div className="param-range" key={`range-${spec.path.join('.')}`}>
          <span className="param-range__label">{rowLabel}</span>
          <span className="param-range__fixed">{spec.min}</span>
          <span className="param-range__dash">to</span>
          {draftInput({ value: shown, onDraft: v => { paramMaxDraftRef.current[key] = v; setParamMaxDraftTick(t => t + 1) }, onCommit: commit, onCancel: cancel, label: `${rowLabel} maximum`, placeholder: String(spec.max) })}
          <button type="button" className="param-range__reset" onClick={() => { resetMaxOverride(key); cancel() }} title="Reset to the default maximum">Reset</button>
        </div>
      )
    }

    if (isRepeat) {
      const sig = repeatSigForSpec(spec)
      const keys = { min: keyForRepeatDraft(panelPath, sig, 'min'), max: keyForRepeatDraft(panelPath, sig, 'max'), step: keyForRepeatDraft(panelPath, sig, 'step') }
      const shown = kind => keys[kind] in repeatDraftRef.current ? repeatDraftRef.current[keys[kind]] : String(spec[kind])
      const draft = kind => v => { repeatDraftRef.current[keys[kind]] = v; setRepeatDraftTick(t => t + 1) }
      const cancel = kind => () => { delete repeatDraftRef.current[keys[kind]]; setRepeatDraftTick(t => t + 1) }
      const commit = kind => () => {
        if (!(keys[kind] in repeatDraftRef.current)) return
        const num = Number(repeatDraftRef.current[keys[kind]])
        if (Number.isFinite(num)) updateRepeatRange(panelPath, sig, { [kind]: num }, { min: spec.min, max: spec.max, step: spec.step })
        cancel(kind)()
      }
      return (
        <div className="param-range param-range--repeat" key={`range-${spec.path.join('.')}`}>
          <span className="param-range__label">{rowLabel}</span>
          {draftInput({ value: shown('min'), onDraft: draft('min'), onCommit: commit('min'), onCancel: cancel('min'), label: `${rowLabel} minimum` })}
          <span className="param-range__dash">to</span>
          {draftInput({ value: shown('max'), onDraft: draft('max'), onCommit: commit('max'), onCancel: cancel('max'), label: `${rowLabel} maximum` })}
          <span className="param-range__dash">by</span>
          {draftInput({ value: shown('step'), onDraft: draft('step'), onCommit: commit('step'), onCancel: cancel('step'), label: `${rowLabel} step` })}
          <button type="button" className="param-range__reset" onClick={() => {
            resetRepeatRange(panelPath, sig)
            cancel('min')(); cancel('max')(); cancel('step')()
          }} title="Reset this range">Reset</button>
        </div>
      )
    }
    return null
  }

  // ---------- rows ----------
  const rows = panelSpecs.map((spec, index) => ({ spec, index, ...placeSpec(spec) }))
  const setValue = (index, value) => { if (Number.isFinite(value)) updateSpecValue(index, value) }

  const renderRow = ({ spec, index, label, axis, section }) => (
    <div className={`param-row${['position', 'rotation', 'scale'].includes(section) ? ' param-row--axis' : ''}`} key={spec.path.join('.')}>
      <ScrubLabel label={label} axis={axis} spec={spec}
        onStart={beginEditAndHighlight}
        onChange={value => setValue(index, value)}
        onEnd={() => endEdit?.('param-change')} />
      <input
        type="range"
        aria-label={`${spec.label}`}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={spec.value}
        onPointerDown={beginEditAndHighlight}
        onPointerUp={() => endEdit?.('param-change')}
        onKeyDown={beginEditAndHighlight}
        onBlur={() => endEdit?.('param-change')}
        onChange={(e) => setValue(index, Number(e.target.value))}
        className="param-slider"
      />
      <input
        type="number"
        aria-label={`${spec.label} value`}
        value={spec.value}
        onFocus={beginEditAndHighlight}
        onBlur={() => endEdit?.('param-change')}
        onChange={(e) => { if (e.target.value !== '' && e.target.value !== '-') setValue(index, Number(e.target.value)) }}
        step={spec.step}
        className="param-number"
      />
    </div>
  )

  return (
    <div className="panel-body">
      {selectedNode && (
        <div className="param-identity">
          <input
            type="text"
            className="param-identity__name"
            aria-label="Name"
            value={nameDraft}
            onFocus={highlightOnly}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.preventDefault()
                setNameDraft(selectedNode?.name ?? '')
                e.currentTarget.blur()
              }
            }}
            placeholder="Name this part"
            title="Rename: type, then press Enter"
          />
          <div className="param-identity__type">{describeNode(selectedNode)}</div>
        </div>
      )}

      {selectedNode && colorState.mode !== 'none' && (
        <section className="param-section">
          <div className="param-section__head"><h3>Color</h3>
            {colorState.mode !== 'primitive' && <span className="param-section__note">{colorState.mode === 'mixed' ? `${colorState.setSize} colors` : 'All parts'}</span>}
          </div>
          <div className="param-color">
            <label className="param-color__swatch" data-mixed={colorState.mode === 'mixed'}
              style={{ '--swatch': colorState.mode === 'mixed' ? undefined : toColorInputHex6(colorState.color || DEFAULT_COLOR) }}
              title={colorState.mode === 'mixed' ? 'Pick one color for every part inside' : 'Pick a color'}>
              <input
                type="color"
                aria-label="Pick a color"
                value={colorState.mode === 'mixed' ? DEFAULT_COLOR : toColorInputHex6(colorState.color || DEFAULT_COLOR)}
                onChange={(e) => {
                  highlightOnly()
                  setColorHexInput(e.target.value)
                  if (typeof updateNodeColor === 'function') updateNodeColor(panelPath, e.target.value, colorScope)
                  endEdit?.('color')
                }}
              />
            </label>
            <input
              type="text"
              aria-label="Color hex code"
              value={colorHexInput}
              onChange={(e) => setColorHexInput(e.target.value)}
              onFocus={highlightOnly}
              onBlur={() => applyColor(colorHexInput)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              placeholder={colorState.mode === 'mixed' ? 'Mixed' : '#RRGGBB'}
              className={`param-color__hex${isInvalidColor ? ' input--error' : ''}`}
              spellCheck={false}
            />
          </div>
          {colorState.mode === 'mixed' && <p className="param-section__hint">Picking a color paints every part inside it.</p>}
        </section>
      )}

      {panelSpecs.length === 0 && <p className="param-section__hint">This part has no adjustable values.</p>}

      {SECTIONS.map(section => {
        const sectionRows = rows.filter(row => row.section === section.key)
        if (!sectionRows.length) return null
        const open = !!rangeOpen[section.key]
        const editors = open ? sectionRows.map(row => rangeEditorFor(row.spec, row.label)).filter(Boolean) : []
        const hasRanges = sectionRows.some(row => ['t', 's'].includes(row.spec.path[1]) && row.spec.path[0] === 'transform'
          || row.spec.path[0] === 'primitive' || row.spec.path[0] === 'repeat')
        return (
          <section className="param-section" key={section.key}>
            <div className="param-section__head">
              <h3>{section.title}</h3>
              {hasRanges && (
                <button type="button" className="param-section__toggle" aria-expanded={open}
                  onClick={() => setRangeOpen(state => ({ ...state, [section.key]: !open }))}
                  title="Change how far the sliders go">
                  {open ? 'Done' : 'Range'}
                </button>
              )}
            </div>
            {section.hint && <p className="param-section__hint">{section.hint}</p>}
            {sectionRows.map(renderRow)}
            {open && editors.length > 0 && (
              <div className="param-ranges">
                <p className="param-section__hint">Slider limits for this part. Typed values can go beyond them.</p>
                {editors}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
