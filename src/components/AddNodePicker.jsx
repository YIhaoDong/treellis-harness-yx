// src/components/AddNodePicker.jsx
// Add a part under a node, or wrap a shape so it can hold more parts.
import React from 'react'
import Dialog from './Dialog.jsx'

const PRIMS = [
  { k: 'cube', title: 'Cube', sub: 'A box', icon: '/icons/cube.svg', name: 'New Cube' },
  { k: 'sphere', title: 'Sphere', sub: 'A ball', icon: '/icons/sphere.svg', name: 'New Sphere' },
  { k: 'cylinder', title: 'Cylinder', sub: 'A tube or rod', icon: '/icons/cylinder.svg', name: 'New Cylinder' },
  { k: 'torus', title: 'Torus', sub: 'A ring', icon: '/icons/torus.svg', name: 'New Torus' },
  { k: 'cone', title: 'Cone', sub: 'A tapered point', icon: '/icons/cone.svg', name: 'New Cone' },
]
const OPS = [
  { k: 'union', title: 'Union', sub: 'Joins parts into one', icon: '/icons/union.svg', name: 'Union' },
  { k: 'subtract', title: 'Subtract', sub: 'Cuts the second part out of the first', icon: '/icons/difference.svg', name: 'Subtract' },
  { k: 'intersection', title: 'Intersect', sub: 'Keeps only the overlap', icon: '/icons/intersection.svg', name: 'Intersection' },
]
const REPEATS = [
  { k: 'linear', title: 'Linear repeat', sub: 'Copies along a line', icon: '/icons/repeat-linear.svg', name: 'Linear Repeat' },
  { k: 'circular', title: 'Circular repeat', sub: 'Copies around a ring', icon: '/icons/repeat-ring.svg', name: 'Circular Repeat' },
]

function OptionGrid({ label, options, value, onPick }) {
  return (
    <div className="add-node__options" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={option.k} type="button" role="radio" aria-checked={option.k === value}
          className="add-node__option" onClick={() => onPick(option.k)}>
          {option.icon
            ? <img src={option.icon} alt="" width="30" height="30" />
            : <span className="add-node__glyph" aria-hidden="true">{option.glyph || '⧉'}</span>}
          <span className="add-node__option-title">{option.title}</span>
          {option.sub && <span className="add-node__option-sub">{option.sub}</span>}
        </button>
      ))}
    </div>
  )
}

function NameField({ label, value, placeholder, onChange }) {
  return (
    <label className="ui-field add-node__name">
      <span className="ui-field__label">{label}</span>
      <input className="ui-input" type="text" value={value || ''} placeholder={placeholder} autoComplete="off"
        onChange={event => onChange(event.target.value)} />
    </label>
  )
}

function Tabs({ tabs, value, onChange }) {
  return (
    <div className="add-node__tabs" role="tablist" aria-label="What to add">
      {tabs.map(tab => (
        <button key={tab.k} type="button" role="tab" aria-selected={tab.k === value}
          className="add-node__tab" onClick={() => onChange(tab.k)}>{tab.title}</button>
      ))}
    </div>
  )
}

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
    instanceId = null,
    targetName = '',
  } = state
  const set = patch => setState(s => ({ ...s, ...patch }))

  const lib = (Array.isArray(libraryItems) ? [...libraryItems] : [])
    .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
    .map(item => ({ k: item.id, title: item.name || 'Saved part', sub: item.sourcePath ? `From ${item.sourcePath}` : '', glyph: '⧉' }))

  const wrap = mode === 'wrap'
  const section = wrap ? wrapperKind : kind
  const confirmDisabled = wrap
    ? (wrapperKind === 'repeat' ? false : !prim)
    : (kind === 'prim' ? !prim : kind === 'op' ? !op : kind === 'instance' ? !instanceId : false)

  const primDefault = PRIMS.find(p => p.k === prim)?.name || 'New Primitive'
  const opDefault = OPS.find(o => o.k === op)?.name || 'Union'
  const repeatDefault = REPEATS.find(r => r.k === repeatType)?.name || 'Linear Repeat'
  const target = targetName ? `“${targetName}”` : 'this part'

  let body
  if (section === 'repeat') {
    body = <>
      <OptionGrid label="Repeat type" options={REPEATS} value={repeatType} onPick={k => set({ repeatType: k })} />
      <NameField label="Name" value={repeatName} placeholder={repeatDefault} onChange={v => set({ repeatName: v })} />
      <p className="ui-hint">{wrap ? `${target} becomes the part that gets repeated.` : 'Then add a part inside the repeat. That part is what gets copied.'}</p>
    </>
  } else if (section === 'op' && wrap) {
    body = <>
      <h3 className="add-node__step">1. How to combine</h3>
      <OptionGrid label="Combine with" options={OPS} value={op} onPick={k => set({ op: k })} />
      <h3 className="add-node__step">2. The new shape to add</h3>
      <OptionGrid label="Shape" options={PRIMS} value={prim} onPick={k => set({ prim: k })} />
      <div className="add-node__names">
        <NameField label="Combine node name" value={opName} placeholder={opDefault} onChange={v => set({ opName: v })} />
        <NameField label="Shape name" value={primName} placeholder={primDefault} onChange={v => set({ primName: v })} />
      </div>
    </>
  } else if (section === 'op') {
    body = <>
      <OptionGrid label="Combine with" options={OPS} value={op} onPick={k => set({ op: k })} />
      <NameField label="Name" value={opName} placeholder={opDefault} onChange={v => set({ opName: v })} />
      <p className="ui-hint">Then add the parts to combine inside it.</p>
    </>
  } else if (section === 'instance') {
    body = lib.length === 0 ? (
      <div className="ui-empty">
        <div className="ui-empty__title">No saved parts yet</div>
        <p>Hover a node in the tree and choose <strong>Save as part</strong>. It will appear here, ready to add to any scene.</p>
      </div>
    ) : <>
      <OptionGrid label="Saved part" options={lib} value={instanceId} onPick={k => set({ instanceId: k })} />
      <p className="ui-hint">Adds a copy. Changing it later won't change the saved part.</p>
    </>
  } else {
    body = <>
      <OptionGrid label="Shape" options={PRIMS} value={prim} onPick={k => set({ prim: k })} />
      <NameField label="Name" value={primName} placeholder={primDefault} onChange={v => set({ primName: v })} />
    </>
  }

  return (
    <Dialog
      open
      as="form"
      size="md"
      onClose={onCancel}
      onSubmit={event => { event.preventDefault(); if (!confirmDisabled) onConfirm() }}
      title={`Add to ${target}`}
      subtitle={wrap
        ? 'A shape cannot hold other parts, so it will be wrapped together with the new part.'
        : 'Add a shape, a way to combine shapes, a repeat, or a saved part.'}
      footer={<>
        <button type="button" className="ui-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn--primary" disabled={confirmDisabled}>Add</button>
      </>}
    >
      {wrap
        ? <Tabs value={wrapperKind} onChange={k => set({ wrapperKind: k })}
            tabs={[{ k: 'op', title: 'Combine with a new shape' }, { k: 'repeat', title: 'Repeat it' }]} />
        : <Tabs value={kind} onChange={k => set({ kind: k })}
            tabs={[{ k: 'prim', title: 'Shape' }, { k: 'op', title: 'Combine' }, { k: 'repeat', title: 'Repeat' }, { k: 'instance', title: 'Saved part' }]} />}
      <div className="add-node__body">{body}</div>
    </Dialog>
  )
}
