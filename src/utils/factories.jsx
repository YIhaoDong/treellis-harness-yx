// src/utils/factories.jsx

import { normalizeRepeatType } from './repeat'

export const PRIM_COLORS = {
  cube: '#eceeff',
  sphere: '#f3fff2',
  cylinder: '#e8ffe6',
  torus: '#fff4e1',
  cone: '#fff6ec',
}

export function createPrimitive(type, nameOverride) {
  const t = String(type).toLowerCase()
  const common = { type: t, material: { color: PRIM_COLORS[t] || '#cccccc' } }
  const nameDefault =
    t === 'cube' ? 'New Cube' :
    t === 'sphere' ? 'New Sphere' :
    t === 'cylinder' ? 'New Cylinder' :
    t === 'torus' ? 'New Torus' :
    t === 'cone' ? 'New Cone' : 'New Primitive'
  const nodeName = nameOverride && nameOverride.trim() ? nameOverride.trim() : nameDefault

  switch (t) {
    case 'cube':
      return {
        name: nodeName,
        primitive: { ...common, w: 1, h: 1, d: 1 },
        transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }
    case 'sphere':
      return {
        name: nodeName,
        primitive: { ...common, r: 1, widthSegments: 24, heightSegments: 24 },
        transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }
    case 'cylinder':
      return {
        name: nodeName,
        primitive: { ...common, r: 0.5, h: 1, radialSegments: 24 },
        transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }
    case 'torus':
      return {
        name: nodeName,
        primitive: { ...common, r: 1.0, t: 0.3, radialSegments: 24, tubularSegments: 24 },
        transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }
    case 'cone':
      return {
        name: nodeName,
        primitive: { ...common, r: 0.6, h: 1.2, radialSegments: 24 },
        transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }
    default:
      return {
        name: nodeName,
        primitive: { ...common, type: 'cube', w: 1, h: 1, d: 1 },
        transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }
  }
}

export function createOperation(type, nameOverride) {
  const op = String(type).toLowerCase()
  const title = nameOverride && nameOverride.trim()
    ? nameOverride.trim()
    : (op === 'subtract' ? 'Subtract' : (op === 'intersection' ? 'Intersection' : 'Union'))
  return {
    name: title,
    operation: op,
    transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    children: [],
  }
}

/**
 * ✅ NEW: create Repeat node (linear / circular)
 * - repeat.type 必须有（你的渲染器用它来识别 repeat）
 * - 默认不带 primitive；你可以在 repeat 下再 Add child primitive 作为 template
 * - wrap primitive 时，我们会把原 primitive 放到 repeat.children[0]
 */
export function createRepeat(type, nameOverride) {
  const tNorm = normalizeRepeatType(type) || 'linear'
  const defaultName = (tNorm === 'circular') ? 'Circular Repeat' : 'Linear Repeat'
  const nodeName = nameOverride && nameOverride.trim() ? nameOverride.trim() : defaultName

  const base = {
    name: nodeName,
    transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    repeat: {
      type: tNorm,
      count: (tNorm === 'circular') ? 12 : 6,
      t: (tNorm === 'circular') ? [0, 0, 0] : [2, 0, 0],
      r: [0, 0, 0],
      s: [1, 1, 1],
      ...(tNorm === 'circular' ? { radius: 4 } : {}),
    },
    children: [],
  }

  return base
}

/** 创建 Union 节点，并附带子节点（children 会被克隆，避免外部引用共享） */
export function makeUnionNode(children = [], nameOverride = 'Union') {
  return {
    name: nameOverride,
    operation: 'union',
    transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    children: children.map(c => JSON.parse(JSON.stringify(c))),
  }
}