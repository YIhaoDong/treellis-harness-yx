// src/components/ParameterPanel.jsx
import React, { useEffect, useMemo, useState } from 'react'
import { DEFAULT_T_RANGE } from '../hooks/useParamRanges'
import {
  DEFAULT_COLOR,
  isValidHexInput,
  getPrimitiveColor,
  collectDescendantPrimitiveColors,
  normalizeHex,
} from '../utils/color'

export default function ParameterPanel(props) {
  const {
    panelPath,
    selectedNode,
    panelSpecs,

    beginEdit,
    endEdit,

    // ✅ 注意：这里必须是 renameNodeAtPath（带 At）
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

    // ✅ Repeat range (PHASE B)
    getRepeatRange,
    updateRepeatRange,
    resetRepeatRange,
    keyForRepeatDraft,
    repeatDraftRef,
    setRepeatDraftTick,
  } = props

  // --- 防呆：一眼看出 props 是否传对（不会影响功能） ---
  useEffect(() => {
    if (panelPath) {
      if (typeof renameNodeAtPath !== 'function') {
        console.warn('[ParameterPanel] renameNodeAtPath prop is not a function:', renameNodeAtPath)
      }
      if (typeof updateNodeColor !== 'function') {
        console.warn('[ParameterPanel] updateNodeColor prop is not a function:', updateNodeColor)
      }
    }
  }, [panelPath, renameNodeAtPath, updateNodeColor])

  // === 颜色状态（从 selectedNode 推导）===
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

  // <input type="color"> 只接受 #RRGGBB
  const toColorInputHex6 = (hex) => {
    const norm = normalizeHex(hex)
    if (!norm) return DEFAULT_COLOR
    if (norm.length === 9) return norm.slice(0, 7)
    return norm
  }

  // ✅ Name：本地 draft（避免 controlled input 光标乱跳）
  const [nameDraft, setNameDraft] = useState('')
  useEffect(() => {
    setNameDraft(selectedNode?.name ?? '')
  }, [panelPath, selectedNode?.name])

  // ✅ Color：本地文本框
  const [colorHexInput, setColorHexInput] = useState('')
  useEffect(() => {
    if (!selectedNode) { setColorHexInput(''); return }
    if (colorState.mode === 'primitive' || colorState.mode === 'solid') {
      setColorHexInput(colorState.color || '')
    } else {
      setColorHexInput('')
    }
  }, [panelPath, selectedNode, colorState.mode, colorState.color])

  const isInvalidColor = colorHexInput && !isValidHexInput(colorHexInput)
  const colorInputId = `color-mixed-${panelPath || 'root'}`

  if (!panelPath) {
    return (
      <div className="panel-body">
        <div className="muted">
          Select a node from the tree to edit its parameters.
          <br />you can click node's description on "Legend"
        </div>
      </div>
    )
  }

  // ✅ 仅用于数值参数：开始编辑时重申高亮
  const beginEditAndHighlight = () => {
    beginEdit?.()
    setHighlightPath?.(panelPath)
  }

  // ✅ 文本/颜色：只高亮，不主动 beginEdit（因为 updateNodeColor/renameNodeAtPath 内部会 beginEdit）
  const highlightOnly = () => {
    setHighlightPath?.(panelPath)
  }

  const commitName = () => {
    if (!selectedNode) return
    if (typeof renameNodeAtPath !== 'function') return
    renameNodeAtPath(panelPath, nameDraft)
    endEdit?.('rename')
  }

  const commitColorFromText = () => {
    if (typeof updateNodeColor !== 'function') return
    const norm = normalizeHex(colorHexInput)
    if (norm) {
      updateNodeColor(
        panelPath,
        norm,
        colorState.mode === 'primitive' ? 'single' : 'subtree'
      )
    }
    endEdit?.('color')
  }

  // ✅ repeat spec -> sig（用于 range key）
  const repeatSigForSpec = (spec) => {
    const p = spec?.path || []
    const k1 = p[1]
    if (k1 === 'count' || k1 === 'n') return 'count'
    if (k1 === 'radius') return 'radius'
    if (k1 === 'angle') return 'angle'
    if (k1 === 't' || k1 === 'r' || k1 === 's') return `${k1}|${p[2]}`
    return String(k1 || 'unknown')
  }

  return (
    <div className="panel-body">
      <div className="path-muted">Path: {panelPath}</div>

      {/* Name */}
      {selectedNode && (
        <div className="param-card">
          <label className="label-strong">Name</label>
          <input
            type="text"
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
            placeholder="Enter node name"
            className="text-input"
          />
          <div className="hint">Tip: Enter to commit, Esc to revert.</div>
        </div>
      )}

      {/* Color */}
      {selectedNode && (
        <div className="param-card">
          <label className="label-strong">
            Color {colorState.mode === 'primitive' ? '(this primitive)' :
              colorState.mode === 'solid' ? '(apply to all descendants)' :
              colorState.mode === 'mixed' ? '(Mixed • pick to apply to all)' : ''}
          </label>

          {colorState.mode === 'none' && (
            <div className="muted">No primitives under this node.</div>
          )}

          {(colorState.mode === 'primitive' || colorState.mode === 'solid') && (
            <>
              <div className="grid-2">
                <input
                  type="text"
                  value={colorHexInput}
                  onChange={(e) => setColorHexInput(e.target.value)}
                  onFocus={highlightOnly}
                  onBlur={commitColorFromText}
                  placeholder="#RRGGBB"
                  className={`text-input ${isInvalidColor ? 'input--error' : ''}`}
                />
                <input
                  type="color"
                  value={toColorInputHex6(colorState.color || DEFAULT_COLOR)}
                  onChange={(e) => {
                    highlightOnly()
                    setColorHexInput(e.target.value)
                    if (typeof updateNodeColor === 'function') {
                      updateNodeColor(
                        panelPath,
                        e.target.value,
                        colorState.mode === 'primitive' ? 'single' : 'subtree'
                      )
                    }
                    endEdit?.('color')
                  }}
                  title="Pick a color"
                  className="color-input"
                />
              </div>
              <div className="hint">Tip: enter hex (e.g. #FFAA00) or use the picker.</div>
            </>
          )}

          {colorState.mode === 'mixed' && (
            <>
              <div className="grid-2">
                <input
                  type="text"
                  value={colorHexInput}
                  onChange={(e) => setColorHexInput(e.target.value)}
                  onFocus={highlightOnly}
                  onBlur={() => {
                    const norm = normalizeHex(colorHexInput)
                    if (norm && typeof updateNodeColor === 'function') updateNodeColor(panelPath, norm, 'subtree')
                    endEdit?.('color')
                  }}
                  placeholder="Mixed"
                  className={`text-input text-input--sm ${isInvalidColor ? 'input--error' : ''}`}
                />
                <label
                  htmlFor={colorInputId}
                  className="btn btn--sm btn--ghost"
                  title="Pick a color to apply to all"
                >
                  Pick color…
                </label>
                <input
                  id={colorInputId}
                  type="color"
                  defaultValue={DEFAULT_COLOR}
                  onChange={(e) => {
                    highlightOnly()
                    setColorHexInput(e.target.value)
                    if (typeof updateNodeColor === 'function') updateNodeColor(panelPath, e.target.value, 'subtree')
                    endEdit?.('color')
                  }}
                  className="hidden-color-input"
                />
              </div>
              <div className="hint">
                Mixed colors detected. Choosing a color will apply to all descendant primitives.
              </div>
            </>
          )}
        </div>
      )}

      {/* 数值参数 */}
      {panelSpecs.length === 0 && (
        <div className="muted">No editable numeric params.</div>
      )}

      {panelSpecs.map((spec, i) => {
        const isTranslate = spec.path[0] === 'transform' && spec.path[1] === 't'
        const isScale = spec.path[0] === 'transform' && spec.path[1] === 's'
        const isPrimNum = spec.path[0] === 'primitive'
        const isRepeat = spec.path[0] === 'repeat'

        const axisIndex = (isTranslate || isScale) ? spec.path[2] : null
        const axisLabel = (isTranslate || isScale) ? 'xyz'[axisIndex] : ''

        // ---- Translate draft ----
        const tRange = isTranslate ? getTranslateRange(panelPath, axisIndex) : null
        const minDraftKey = isTranslate ? keyForDraft(panelPath, axisIndex, 'min') : null
        const maxDraftKey = isTranslate ? keyForDraft(panelPath, axisIndex, 'max') : null
        const minDisplay = isTranslate
          ? (minDraftKey in rangeDraftRef.current ? rangeDraftRef.current[minDraftKey] : String(tRange.min))
          : ''
        const maxDisplay = isTranslate
          ? (maxDraftKey in rangeDraftRef.current ? rangeDraftRef.current[maxDraftKey] : String(tRange.max))
          : ''

        const commitDraft = (kind) => {
          const k = kind === 'min' ? minDraftKey : maxDraftKey
          if (!k) return
          if (!(k in rangeDraftRef.current)) return
          const txt = rangeDraftRef.current[k]
          const num = Number(txt)
          if (Number.isFinite(num)) {
            updateTranslateRange(panelPath, axisIndex, { [kind]: num })
          }
          delete rangeDraftRef.current[k]
          setRangeDraftTick(t => t + 1)
        }
        const cancelDraft = (kind) => {
          const k = kind === 'min' ? minDraftKey : maxDraftKey
          if (!k) return
          delete rangeDraftRef.current[k]
          setRangeDraftTick(t => t + 1)
        }

        // ---- Scale/Primitive max-only ----
        const sMaxKey = isScale ? keyForSMax(panelPath, axisIndex) : null
        const pMaxKey = isPrimNum ? keyForPrimMax(panelPath, spec.path[1]) : null
        const maxOnlyKey = sMaxKey || pMaxKey
        const maxOnlyDisplay = (isScale || isPrimNum)
          ? (maxOnlyKey in paramMaxDraftRef.current ? paramMaxDraftRef.current[maxOnlyKey] : String(spec.max))
          : ''

        const commitMaxOnly = () => {
          if (!maxOnlyKey) return
          if (!(maxOnlyKey in paramMaxDraftRef.current)) return
          const txt = paramMaxDraftRef.current[maxOnlyKey]
          const num = Number(txt)
          if (Number.isFinite(num)) {
            setMaxOverride(maxOnlyKey, num, spec.min, spec.step)
          }
          delete paramMaxDraftRef.current[maxOnlyKey]
          setParamMaxDraftTick(t => t + 1)
        }
        const cancelMaxOnly = () => {
          if (!maxOnlyKey) return
          delete paramMaxDraftRef.current[maxOnlyKey]
          setParamMaxDraftTick(t => t + 1)
        }

        // ✅ Repeat range edit（min/max/step）
        const canRepeatRange =
          isRepeat &&
          typeof updateRepeatRange === 'function' &&
          typeof resetRepeatRange === 'function' &&
          typeof keyForRepeatDraft === 'function' &&
          repeatDraftRef &&
          typeof setRepeatDraftTick === 'function'

        const repSig = canRepeatRange ? repeatSigForSpec(spec) : null
        const repMinKey = canRepeatRange ? keyForRepeatDraft(panelPath, repSig, 'min') : null
        const repMaxKey = canRepeatRange ? keyForRepeatDraft(panelPath, repSig, 'max') : null
        const repStepKey = canRepeatRange ? keyForRepeatDraft(panelPath, repSig, 'step') : null

        const repMinDisplay = canRepeatRange
          ? (repMinKey in repeatDraftRef.current ? repeatDraftRef.current[repMinKey] : String(spec.min))
          : ''
        const repMaxDisplay = canRepeatRange
          ? (repMaxKey in repeatDraftRef.current ? repeatDraftRef.current[repMaxKey] : String(spec.max))
          : ''
        const repStepDisplay = canRepeatRange
          ? (repStepKey in repeatDraftRef.current ? repeatDraftRef.current[repStepKey] : String(spec.step))
          : ''

        const commitRepeatDraft = (kind) => {
          if (!canRepeatRange) return
          const k = kind === 'min' ? repMinKey : (kind === 'max' ? repMaxKey : repStepKey)
          if (!k) return
          if (!(k in repeatDraftRef.current)) return

          const txt = repeatDraftRef.current[k]
          const num = Number(txt)
          if (Number.isFinite(num)) {
            updateRepeatRange(
              panelPath,
              repSig,
              { [kind]: num },
              { min: spec.min, max: spec.max, step: spec.step }
            )
          }
          delete repeatDraftRef.current[k]
          setRepeatDraftTick(t => t + 1)
        }

        const cancelRepeatDraft = (kind) => {
          if (!canRepeatRange) return
          const k = kind === 'min' ? repMinKey : (kind === 'max' ? repMaxKey : repStepKey)
          if (!k) return
          delete repeatDraftRef.current[k]
          setRepeatDraftTick(t => t + 1)
        }

        return (
          <div key={i} className="param-card">
            <div className="param-head">
              <label className="label-strong">{spec.label}</label>
              <input
                type="number"
                value={spec.value}
                onFocus={beginEditAndHighlight}
                onBlur={() => endEdit?.('param-change')}
                onChange={(e) => updateSpecValue(i, Number(e.target.value))}
                step={spec.step}
                min={spec.min}
                max={spec.max}
                className="param-number"
              />
            </div>

            <input
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={spec.value}
              onPointerDown={beginEditAndHighlight}
              onPointerUp={() => endEdit?.('param-change')}
              onBlur={() => endEdit?.('param-change')}
              onChange={(e) => updateSpecValue(i, Number(e.target.value))}
              className="param-slider"
            />

            {isTranslate && (
              <div className="ttcs-row ttcs-row-translate">
                <span className="ttcs-label">Min</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={minDisplay}
                  onChange={(e) => { rangeDraftRef.current[minDraftKey] = e.target.value; setRangeDraftTick(t => t + 1) }}
                  onBlur={() => commitDraft('min')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.currentTarget.blur() }
                    if (e.key === 'Escape') { e.preventDefault(); cancelDraft('min'); e.currentTarget.blur() }
                  }}
                  className="ttcs-input-compact"
                  title={`Translate[${axisLabel}] minimum`}
                  placeholder={String(DEFAULT_T_RANGE.min)}
                />
                <span className="ttcs-label">Max</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={maxDisplay}
                  onChange={(e) => { rangeDraftRef.current[maxDraftKey] = e.target.value; setRangeDraftTick(t => t + 1) }}
                  onBlur={() => commitDraft('max')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.currentTarget.blur() }
                    if (e.key === 'Escape') { e.preventDefault(); cancelDraft('max'); e.currentTarget.blur() }
                  }}
                  className="ttcs-input-compact"
                  title={`Translate[${axisLabel}] maximum`}
                  placeholder={String(DEFAULT_T_RANGE.max)}
                />
                <button
                  onClick={() => resetTranslateRange(panelPath, axisIndex)}
                  className="ttcs-btn-reset"
                  title="Reset to defaults (-10 ~ 10)"
                >
                  Reset
                </button>
              </div>
            )}

            {(isScale || isPrimNum) && (
              <div className="ttcs-row ttcs-row-maxonly">
                <span className="ttcs-label">
                  Max{isScale ? ` [${axisLabel}]` : ''}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={maxOnlyDisplay}
                  onChange={(e) => { paramMaxDraftRef.current[maxOnlyKey] = e.target.value; setParamMaxDraftTick(t => t + 1) }}
                  onBlur={commitMaxOnly}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.currentTarget.blur() }
                    if (e.key === 'Escape') { e.preventDefault(); cancelMaxOnly(); e.currentTarget.blur() }
                  }}
                  className="ttcs-input-compact"
                  title={isScale ? `Scale[${axisLabel}] maximum` : `Max of ${spec.label}`}
                  placeholder={String(spec.max)}
                />
                <button
                  onClick={() => { resetMaxOverride(maxOnlyKey); cancelMaxOnly() }}
                  className="ttcs-btn-reset"
                  title="Reset to default max"
                >
                  Reset
                </button>
              </div>
            )}

            {/* ✅ Repeat Range Editor (PHASE B) */}
            {canRepeatRange && (
              <div className="ttcs-row ttcs-row-translate" style={{ marginTop: 8 }}>
                <span className="ttcs-label">Min</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={repMinDisplay}
                  onChange={(e) => { repeatDraftRef.current[repMinKey] = e.target.value; setRepeatDraftTick(t => t + 1) }}
                  onBlur={() => commitRepeatDraft('min')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') { e.preventDefault(); cancelRepeatDraft('min'); e.currentTarget.blur() }
                  }}
                  className="ttcs-input-compact"
                  title="Repeat minimum"
                />
                <span className="ttcs-label">Max</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={repMaxDisplay}
                  onChange={(e) => { repeatDraftRef.current[repMaxKey] = e.target.value; setRepeatDraftTick(t => t + 1) }}
                  onBlur={() => commitRepeatDraft('max')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') { e.preventDefault(); cancelRepeatDraft('max'); e.currentTarget.blur() }
                  }}
                  className="ttcs-input-compact"
                  title="Repeat maximum"
                />
                <span className="ttcs-label">Step</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={repStepDisplay}
                  onChange={(e) => { repeatDraftRef.current[repStepKey] = e.target.value; setRepeatDraftTick(t => t + 1) }}
                  onBlur={() => commitRepeatDraft('step')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') { e.preventDefault(); cancelRepeatDraft('step'); e.currentTarget.blur() }
                  }}
                  className="ttcs-input-compact"
                  title="Repeat step"
                />
                <button
                  onClick={() => {
                    resetRepeatRange(panelPath, repSig)
                    cancelRepeatDraft('min')
                    cancelRepeatDraft('max')
                    cancelRepeatDraft('step')
                  }}
                  className="ttcs-btn-reset"
                  title="Reset repeat range"
                >
                  Reset
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}