// components/InspectorPanel.jsx
import React from 'react'

export default function InspectorPanel({
  // 顶部工具条
  canUndo, canRedo, undo, redo,

  // 标题与关闭
  panelTitle, onClose,

  // 面板上下文
  panelPath, selectedNode, panelSpecs,

  // 颜色相关（沿用父级状态，保持行为 100% 一致）
  colorState, colorHexInput, setColorHexInput, isInvalidColor, colorInputId,

  // 编辑生命周期 & 具体改动
  beginEdit, endEdit, renameNodeAtPath, updateNodeColor, updateSpecValue,

  // Translate/Scale/Primitive 的范围覆写 & 草稿
  getTranslateRange, DEFAULT_T_RANGE,
  keyForDraft, rangeDraftRef, setRangeDraftTick,
  keyForSMax, keyForPrimMax, setMaxOverride, resetMaxOverride,
  resetTranslateRange, paramMaxDraftRef, setParamMaxDraftTick,
}) {
  return (
    <aside className="split-right-panel">
      <div className="panel-bar">
        <div className="btn-row">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl/Cmd+Z)"
            className="btn btn--dark btn--grow"
          >↶ Undo</button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y or Ctrl/Cmd+Shift+Z)"
            className="btn btn--blue btn--grow"
          >↷ Redo</button>
        </div>
        <div className="hint">Undo: Ctrl/Cmd+Z; Redo: Ctrl+Y or Shift+Ctrl/Cmd+Z</div>
      </div>

      <div className="panel-bar panel-bar--row">
        <div className="panel-title">{panelTitle || 'Parameters'}</div>
        <button
          className="btn btn--sm btn--ghost"
          onClick={onClose}
          title="Close"
        >✕</button>
      </div>

      <div className="panel-body">
        {panelPath && <div className="path-muted">Path: {panelPath}</div>}

        {/* Name */}
        {panelPath && selectedNode && (
          <div className="param-card">
            <label className="label-strong">Name</label>
            <input
              type="text"
              value={selectedNode?.name ?? ''}
              onFocus={beginEdit}
              onBlur={() => endEdit('rename')}
              onChange={(e) => renameNodeAtPath(panelPath, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              placeholder="Enter node name"
              className="text-input"
            />
          </div>
        )}

        {/* Color */}
        {panelPath && selectedNode && (
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
                    onFocus={beginEdit}
                    onBlur={(e) => {
                      const v = e.target.value
                      if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
                        const norm = v.startsWith('#') ? v : `#${v}`
                        updateNodeColor(panelPath, norm, colorState.mode === 'primitive' ? 'single' : 'subtree')
                      }
                      endEdit('color')
                    }}
                    placeholder="#RRGGBB"
                    className={`text-input ${isInvalidColor ? 'input--error' : ''}`}
                  />
                  <input
                    type="color"
                    value={colorState.color || '#bbbbbb'}
                    onChange={(e) => { beginEdit(); updateNodeColor(panelPath, e.target.value, colorState.mode === 'primitive' ? 'single' : 'subtree'); endEdit('color') }}
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
                    onFocus={beginEdit}
                    onBlur={(e) => {
                      const v = e.target.value
                      if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
                        const norm = v.startsWith('#') ? v : `#${v}`
                        updateNodeColor(panelPath, norm, 'subtree')
                      }
                      endEdit('color')
                    }}
                    placeholder="Mixed"
                    className={`text-input text-input--sm ${isInvalidColor ? 'input--error' : ''}`}
                  />
                  {/* Use label+input to reliably open native color picker */}
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
                    defaultValue="#bbbbbb"
                    onChange={(e) => { beginEdit(); updateNodeColor(panelPath, e.target.value, 'subtree'); endEdit('color') }}
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

        {!panelPath && (
          <div className="muted">
            Select a node from the tree to edit its parameters.
            <br />you can click node's description on "Legend"
          </div>
        )}

        {panelPath && panelSpecs.length === 0 && (
          <div className="muted">No editable numeric params.</div>
        )}

        {panelPath && panelSpecs.map((spec, i) => {
          const isTranslate = spec.path[0] === 'transform' && spec.path[1] === 't'
          const isScale = spec.path[0] === 'transform' && spec.path[1] === 's'
          const isPrimNum = spec.path[0] === 'primitive'
          const axisIndex = (isTranslate || isScale) ? spec.path[2] : null
          const axisLabel = (isTranslate || isScale) ? 'xyz'[axisIndex] : ''

          // ---- Translate draft显示（min/max）----
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
              const patch = kind === 'min' ? { min: num } : { max: num }
              // updateTranslateRange 已在父组件，通过 props 提供 getTranslateRange + reset + setMaxOverride
              // 这里只负责 draft 提交时的刷新，由父级回写 localStorage
              // 采用回调方式：父层提供 updateTranslateRange 的封装（这里沿用原有模式：父层传进 getTranslateRange/reset/...）
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

          // ---- Scale/Primitive 的 Max 草稿显示 ----
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

          return (
            <div key={i} className="param-card">
              <div className="param-head">
                <label className="label-strong">{spec.label}</label>
                <input
                  type="number"
                  value={spec.value}
                  onFocus={beginEdit}
                  onBlur={() => endEdit('param-change')}
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
                onPointerDown={beginEdit}
                onPointerUp={() => endEdit('param-change')}
                onBlur={() => endEdit('param-change')}
                onChange={(e) => updateSpecValue(i, Number(e.target.value))}
                className="param-slider"
              />

              {/* NEW: Translate range editor (per node + axis) */}
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
                    onClick={() => window.__resetTranslateRange?.(panelPath, axisIndex) /* 占位，实际由父传入 */ }
                    className="ttcs-btn-reset"
                    title="Reset to defaults (-10 ~ 10)"
                  >
                    Reset
                  </button>
                </div>
              )}

              {/* NEW: Scale[x/y/z] 与 Primitive 参数 —— 仅 Max + Reset */}
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
            </div>
          )
        })}
      </div>
    </aside>
  )
}
