// src/components/AddNodePicker.jsx
import React from 'react'

export default function AddNodePicker({ state, setState, onCancel, onConfirm, libraryItems = [] }) {
  const {
    mode,
    kind = 'prim',
    wrapperKind = 'op',

    op,
    prim,
    primName,
    opName,

    repeatType = 'linear',
    repeatName = '',

    // ✅ NEW
    instanceId = null,
  } = state

  const opOptions = [
    { k: 'union', title: 'Union', icon: '/icons/union.svg' },
    { k: 'subtract', title: 'Subtract', icon: '/icons/difference.svg' },
    { k: 'intersection', title: 'Intersect', icon: '/icons/intersection.svg' },
  ]
  const primOptions = [
    { k: 'cube', title: 'Cube', icon: '/icons/cube.svg' },
    { k: 'sphere', title: 'Sphere', icon: '/icons/sphere.svg' },
    { k: 'cylinder', title: 'Cylinder', icon: '/icons/cylinder.svg' },
    { k: 'torus', title: 'Torus', icon: '/icons/torus.svg' },
    { k: 'cone', title: 'Cone', icon: '/icons/cone.svg' },
  ]

  const repeatOptions = [
    { k: 'linear', title: 'Linear Repeat', sub: 'Array along a line' },
    { k: 'circular', title: 'Circular Repeat', sub: 'Array on a ring' },
  ]

  const Seg = ({ value, current, onClick, children }) => (
    <button
      onClick={onClick}
      className="ttcs-seg"
      style={{
        padding: '6px 12px',
        borderRadius: 10,
        border: value === current ? '2px solid #2563eb' : '1px solid #e5e7eb',
        background: value === current ? '#eff6ff' : '#fff',
        cursor: 'pointer',
        fontWeight: 700
      }}
    >
      {children}
    </button>
  )

  const Card = ({ selected, onClick, icon, title, sub, fallbackText = 'R' }) => (
    <button
      onClick={onClick}
      style={{
        width: 132, height: 96,
        borderRadius: 12,
        border: selected ? '2px solid #2563eb' : '1px solid #e5e7eb',
        background: selected ? '#eff6ff' : '#fff',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 6,
        boxShadow: selected ? '0 4px 12px rgba(37,99,235,0.12)' : '0 2px 6px rgba(0,0,0,0.06)',
        padding: 10,
      }}
    >
      {icon ? (
        <img src={icon} alt="" style={{ width: 32, height: 32 }} />
      ) : (
        <div
          aria-hidden
          style={{
            width: 32, height: 32,
            borderRadius: 10,
            border: '2px solid #94a3b8',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 900,
            color: '#475569',
            fontSize: 18,
          }}
        >
          {fallbackText}
        </div>
      )}
      <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', lineHeight: 1.1, textAlign: 'center' }}>
        {title}
      </div>
      {sub ? <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.1, textAlign: 'center' }}>{sub}</div> : null}
    </button>
  )

  const pickOp = (k) => {
    const defaultName = k === 'subtract' ? 'Subtract' : (k === 'intersection' ? 'Intersect' : 'Union')
    setState(s => ({ ...s, op: k, opName: s.opName || defaultName }))
  }
  const pickPrim = (k) => {
    const defaultName =
      k === 'cube' ? 'New Cube' :
      k === 'sphere' ? 'New Sphere' :
      k === 'cylinder' ? 'New Cylinder' :
      k === 'torus' ? 'New Torus' :
      k === 'cone' ? 'New Cone' : 'New Primitive'
    setState(s => ({ ...s, prim: k, primName: s.primName || defaultName }))
  }
  const pickRepeat = (k) => {
    const defaultName = k === 'circular' ? 'Circular Repeat' : 'Linear Repeat'
    setState(s => ({ ...s, repeatType: k, repeatName: s.repeatName || defaultName }))
  }

  // ✅ confirm disabled
  const confirmDisabled =
    mode === 'wrap'
      ? (wrapperKind === 'repeat' ? false : !prim)
      : (
        kind === 'repeat' ? false :
        (kind === 'prim' ? !prim :
          (kind === 'op' ? !op :
            (kind === 'instance' ? !instanceId : true)))
      )

  const orderedLib = Array.isArray(libraryItems) ? [...libraryItems] : []
  // newest first (already ordered in hook, but do again safely)
  orderedLib.sort((a, b) => (Number(b?.createdAt || 0) - Number(a?.createdAt || 0)))

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 740,
          maxWidth: '95vw',
          maxHeight: '85vh',
          background: '#fff',
          borderRadius: 16,
          border: '1px solid #e5e7eb',
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
          padding: 18,
          overflow: 'auto',
          boxSizing: 'border-box',
          clipPath: 'inset(0 round 16px)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            {mode === 'wrap' ? 'Wrap the selected primitive' : 'Add a child'}
            <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 8 }}>
              {mode === 'wrap'
                ? '（可用 Operation 或 Repeat 包裹当前节点）'
                : '(choose Primitive / Operation / Repeat / Instance)'
              }
            </span>
          </div>
          <button onClick={onCancel} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer' }} aria-label="Close">✕</button>
        </div>

        {/* ===== wrap mode ===== */}
        {mode === 'wrap' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 12 }}>
              <Seg value="op" current={wrapperKind} onClick={() => setState(s => ({ ...s, wrapperKind: 'op' }))}>Operation</Seg>
              <Seg value="repeat" current={wrapperKind} onClick={() => setState(s => ({ ...s, wrapperKind: 'repeat' }))}>Repeat</Seg>
            </div>

            {wrapperKind === 'repeat' ? (
              <>
                <div style={{ fontWeight: 800, color: '#111827', marginTop: 6, marginBottom: 8 }}>
                  Choose repeat type
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {repeatOptions.map(r => (
                    <Card
                      key={r.k}
                      selected={repeatType === r.k}
                      onClick={() => pickRepeat(r.k)}
                      icon={null}
                      title={r.title}
                      sub={r.sub}
                      fallbackText="R"
                    />
                  ))}
                </div>

                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Repeat node name</label>
                  <input
                    type="text"
                    value={repeatName}
                    onChange={(e) => setState(s => ({ ...s, repeatName: e.target.value }))}
                    placeholder={repeatType === 'circular' ? 'Circular Repeat' : 'Linear Repeat'}
                    style={{
                      marginTop: 6,
                      width: '100%',
                      height: 36,
                      padding: '6px 10px',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      outline: 'none',
                      boxSizing: 'border-box',
                      minWidth: 0,
                      display: 'block',
                      maxWidth: '100%'
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') onConfirm() }}
                  />
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                    Tip: wrap will put the current node into Repeat.children[0] as template.
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* wrap with operation: keep old flow */}
                <div style={{ fontWeight: 800, color: '#111827', marginTop: 8, marginBottom: 8 }}>1) Choose operation</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {opOptions.map(o => (<Card key={o.k} selected={o.k === op} onClick={() => pickOp(o.k)} icon={o.icon} title={o.title} />))}
                </div>

                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Operation node name</label>
                  <input
                    type="text"
                    value={opName}
                    onChange={(e) => setState(s => ({ ...s, opName: e.target.value }))}
                    placeholder="e.g. Union A+B"
                    style={{
                      marginTop: 6,
                      width: '100%',
                      height: 36,
                      padding: '6px 10px',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      outline: 'none',
                      boxSizing: 'border-box',
                      minWidth: 0,
                      display: 'block',
                      maxWidth: '100%'
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && prim) onConfirm() }}
                  />
                </div>

                <div style={{ fontWeight: 800, color: '#111827', marginTop: 14, marginBottom: 8 }}>
                  2) Choose new primitive (will be the second operand)
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {primOptions.map(p => (<Card key={p.k} selected={p.k === prim} onClick={() => pickPrim(p.k)} icon={p.icon} title={p.title} />))}
                </div>

                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Primitive name</label>
                  <input
                    type="text"
                    value={primName}
                    onChange={(e) => setState(s => ({ ...s, primName: e.target.value }))}
                    placeholder="e.g. Small Cube"
                    style={{
                      marginTop: 6,
                      width: '100%',
                      height: 36,
                      padding: '6px 10px',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      outline: 'none',
                      boxSizing: 'border-box',
                      minWidth: 0,
                      display: 'block',
                      maxWidth: '100%'
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && prim) onConfirm() }}
                  />
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                    Tip: Press Enter to confirm when a primitive is selected.
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ===== append mode ===== */}
        {mode !== 'wrap' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <Seg value="prim" current={kind} onClick={() => setState(s => ({ ...s, kind: 'prim' }))}>Primitive</Seg>
              <Seg value="op" current={kind} onClick={() => setState(s => ({ ...s, kind: 'op' }))}>Operation</Seg>
              <Seg value="repeat" current={kind} onClick={() => setState(s => ({ ...s, kind: 'repeat' }))}>Repeat</Seg>
              {/* ✅ NEW */}
              <Seg value="instance" current={kind} onClick={() => setState(s => ({ ...s, kind: 'instance' }))}>Instance</Seg>
            </div>

            {kind === 'instance' && (
              <>
                <div style={{ fontWeight: 800, color: '#111827', marginTop: 4, marginBottom: 8 }}>
                  Choose an instance from Library
                </div>

                {orderedLib.length === 0 ? (
                  <div style={{ color: '#94a3b8', padding: 10, fontSize: 13, border: '1px dashed #e5e7eb', borderRadius: 12 }}>
                    你的 Library 里还没有实例。请先在结构树节点上点“⧉ 实例化”添加一个。
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {orderedLib.map(it => (
                      <Card
                        key={it.id}
                        selected={String(instanceId || '') === String(it.id)}
                        onClick={() => setState(s => ({ ...s, instanceId: it.id }))}
                        icon={null}
                        fallbackText="⧉"
                        title={it.name || 'Instance'}
                        sub={it.sourcePath ? `from ${it.sourcePath}` : `id: ${String(it.id).slice(0, 6)}…`}
                      />
                    ))}
                  </div>
                )}

                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
                  说明：会把该实例的子树“深拷贝”插入为新的 child。
                </div>
              </>
            )}

            {kind === 'repeat' && (
              <>
                <div style={{ fontWeight: 800, color: '#111827', marginTop: 6, marginBottom: 8 }}>
                  Choose repeat type
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {repeatOptions.map(r => (
                    <Card
                      key={r.k}
                      selected={repeatType === r.k}
                      onClick={() => pickRepeat(r.k)}
                      icon={null}
                      title={r.title}
                      sub={r.sub}
                      fallbackText="R"
                    />
                  ))}
                </div>

                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Repeat node name</label>
                  <input
                    type="text"
                    value={repeatName}
                    onChange={(e) => setState(s => ({ ...s, repeatName: e.target.value }))}
                    placeholder={repeatType === 'circular' ? 'Circular Repeat' : 'Linear Repeat'}
                    style={{
                      marginTop: 6,
                      width: '100%',
                      height: 36,
                      padding: '6px 10px',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      outline: 'none',
                      boxSizing: 'border-box',
                      minWidth: 0,
                      display: 'block',
                      maxWidth: '100%'
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') onConfirm() }}
                  />
                </div>

                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                  After creating Repeat, add a child primitive under it as template.
                </div>
              </>
            )}

            {kind === 'op' && (
              <>
                <div style={{ fontWeight: 800, color: '#111827', marginTop: 4, marginBottom: 8 }}>
                  Choose operation
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {opOptions.map(o => (<Card key={o.k} selected={o.k === op} onClick={() => pickOp(o.k)} icon={o.icon} title={o.title} />))}
                </div>

                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Operation name</label>
                  <input
                    type="text"
                    value={opName}
                    onChange={(e) => setState(s => ({ ...s, opName: e.target.value }))}
                    placeholder="e.g. Union part-1+part-2"
                    style={{
                      marginTop: 6,
                      width: '100%',
                      height: 36,
                      padding: '6px 10px',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      outline: 'none',
                      boxSizing: 'border-box',
                      minWidth: 0,
                      display: 'block',
                      maxWidth: '100%'
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && op) onConfirm() }}
                  />
                </div>
              </>
            )}

            {kind === 'prim' && (
              <>
                <div style={{ fontWeight: 800, color: '#111827', marginTop: 4, marginBottom: 8 }}>
                  Choose primitive
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {primOptions.map(p => (<Card key={p.k} selected={p.k === prim} onClick={() => pickPrim(p.k)} icon={p.icon} title={p.title} />))}
                </div>

                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Primitive name</label>
                  <input
                    type="text"
                    value={primName}
                    onChange={(e) => setState(s => ({ ...s, primName: e.target.value })) }
                    placeholder="e.g. Small Cube"
                    style={{
                      marginTop: 6,
                      width: '100%',
                      height: 36,
                      padding: '6px 10px',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      outline: 'none',
                      boxSizing: 'border-box',
                      minWidth: 0,
                      display: 'block',
                      maxWidth: '100%'
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && prim) onConfirm() }}
                  />
                </div>
              </>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer'
            }}
          >
            取消 / Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: '1px solid #1f2937',
              background: !confirmDisabled ? '#111827' : '#9ca3af',
              color: '#fff',
              cursor: !confirmDisabled ? 'pointer' : 'not-allowed',
              fontWeight: 900
            }}
          >
            确认添加 / Add
          </button>
        </div>
      </div>
    </div>
  )
}