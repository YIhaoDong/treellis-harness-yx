// src/hooks/usePanelSpecs.jsx
import { useMemo } from 'react'
import { getNodeAtPath, buildSliderSpecs } from '../utils/tree'
import { isRepeatNode, normalizeRepeatType, MAX_REPEAT_COUNT_SOFT } from '../utils/repeat'

function ensureVec3(v, d0 = 0, d1 = 0, d2 = 0) {
  const a = Array.isArray(v) ? v : []
  return [
    Number.isFinite(Number(a[0])) ? Number(a[0]) : d0,
    Number.isFinite(Number(a[1])) ? Number(a[1]) : d1,
    Number.isFinite(Number(a[2])) ? Number(a[2]) : d2,
  ]
}

function sanitizeRange(r, fallback) {
  const out = { ...fallback, ...(r || {}) }
  out.min = Number(out.min)
  out.max = Number(out.max)
  out.step = Number(out.step)

  if (!Number.isFinite(out.min)) out.min = Number(fallback.min)
  if (!Number.isFinite(out.max)) out.max = Number(fallback.max)
  if (!Number.isFinite(out.step) || out.step <= 0) out.step = Number(fallback.step)

  if (out.max <= out.min) out.max = out.min + Math.abs(out.step)
  return out
}

function groupForSpec(s) {
  const p0 = s?.path?.[0]
  if (p0 === 'repeat') return 'Repeat'
  if (p0 === 'transform') return 'Transform'
  if (p0 === 'primitive') return 'Primitive'
  return 'Other'
}

// repeat spec.path -> sig（用于 useRepeatRanges 的 key）
function repeatSigFromPath(path) {
  if (!Array.isArray(path)) return null
  if (path[0] !== 'repeat') return null
  const k1 = path[1]
  if (!k1) return null
  if (k1 === 'count' || k1 === 'n') return 'count'
  if (k1 === 'radius') return 'radius'
  if (k1 === 'angle') return 'angle'
  if ((k1 === 't' || k1 === 'r' || k1 === 's') && Number.isFinite(Number(path[2]))) {
    return `${k1}|${Number(path[2])}`
  }
  return String(k1)
}

/**
 * ✅ 默认导出：App.jsx 用的是 `import usePanelSpecs from ...`
 *
 * Phase B:
 * - 支持 Repeat ranges（getRepeatRange + repeatTick）
 * - Repeat 不显示 type（你已决定不需要互换 linear/circular）
 */
export default function usePanelSpecs({
  liveScene,
  panelPath,

  // Translate range overrides
  getTranslateRange,

  // Max-only overrides
  keyForSMax,
  keyForPrimMax,
  getMaxOverride,

  // ticks
  rangeTick,
  paramMaxTick,

  // ✅ Repeat ranges (PHASE B)
  getRepeatRange,
  repeatTick,
}) {
  const selectedNode = useMemo(() => {
    if (!panelPath || !liveScene) return null
    return getNodeAtPath(liveScene, panelPath)
  }, [liveScene, panelPath])

  const panelSpecs = useMemo(() => {
    if (!panelPath || !liveScene) return []
    const node = getNodeAtPath(liveScene, panelPath)
    if (!node) return []

    // 1) baseline: transform/primitive
    let specs = buildSliderSpecs(node).map(s => ({ ...s, group: groupForSpec(s) }))

    // 2) repeat inject (if repeat node)
    const isRep = isRepeatNode(node)
    const rep = (node?.repeat && typeof node.repeat === 'object') ? node.repeat : {}

    if (isRep) {
      const typeNorm =
        normalizeRepeatType(rep.type ?? rep.mode ?? node?.repeatType ?? node?.repeatMode) || 'linear'

      const count =
        Number.isFinite(Number(rep.count)) ? Number(rep.count)
          : Number.isFinite(Number(rep.n)) ? Number(rep.n)
            : 1

      const rt = ensureVec3(rep.t, 0, 0, 0)
      const rr = ensureVec3(rep.r, 0, 0, 0)
      const rs = ensureVec3(rep.s, 1, 1, 1)
      const radius = Number.isFinite(Number(rep.radius)) ? Number(rep.radius) : 3
      const angle = Number.isFinite(Number(rep.angle)) ? Number(rep.angle) : 360

      const repeatSpecs = []

      // ---- count
      {
        const def = { min: 1, max: MAX_REPEAT_COUNT_SOFT, step: 1 }
        const sig = 'count'
        const rng = typeof getRepeatRange === 'function'
          ? sanitizeRange(getRepeatRange(panelPath, sig, def), def)
          : def

        repeatSpecs.push({
          group: 'Repeat',
          label: 'Repeat Count',
          path: ['repeat', 'count'],
          value: count,
          min: rng.min,
          max: rng.max,
          step: rng.step,
          integer: true,
          repeatSig: sig,
          repeatDefRange: def,
        })
      }

      // ---- repeat.t
      ;(['x', 'y', 'z']).forEach((axis, i) => {
        const def = { min: -20, max: 20, step: 0.1 }
        const sig = `t|${i}`
        const rng = typeof getRepeatRange === 'function'
          ? sanitizeRange(getRepeatRange(panelPath, sig, def), def)
          : def

        repeatSpecs.push({
          group: 'Repeat',
          label: `Repeat T.${axis}`,
          path: ['repeat', 't', i],
          value: rt[i],
          min: rng.min,
          max: rng.max,
          step: rng.step,
          repeatSig: sig,
          repeatDefRange: def,
        })
      })

      // ---- repeat.r (deg)
      ;(['x', 'y', 'z']).forEach((axis, i) => {
        const def = { min: -360, max: 360, step: 1 }
        const sig = `r|${i}`
        const rng = typeof getRepeatRange === 'function'
          ? sanitizeRange(getRepeatRange(panelPath, sig, def), def)
          : def

        repeatSpecs.push({
          group: 'Repeat',
          label: `Repeat R.${axis} (deg)`,
          path: ['repeat', 'r', i],
          value: rr[i],
          min: rng.min,
          max: rng.max,
          step: rng.step,
          integer: true,
          repeatSig: sig,
          repeatDefRange: def,
        })
      })

      // ---- repeat.s
      ;(['x', 'y', 'z']).forEach((axis, i) => {
        const def = { min: 0.05, max: 5, step: 0.01 }
        const sig = `s|${i}`
        const rng = typeof getRepeatRange === 'function'
          ? sanitizeRange(getRepeatRange(panelPath, sig, def), def)
          : def

        repeatSpecs.push({
          group: 'Repeat',
          label: `Repeat S.${axis}`,
          path: ['repeat', 's', i],
          value: rs[i],
          min: rng.min,
          max: rng.max,
          step: rng.step,
          repeatSig: sig,
          repeatDefRange: def,
        })
      })

      // ---- circular only
      if (typeNorm === 'circular') {
        // radius
        {
          const def = { min: 0, max: 50, step: 0.1 }
          const sig = 'radius'
          const rng = typeof getRepeatRange === 'function'
            ? sanitizeRange(getRepeatRange(panelPath, sig, def), def)
            : def

          repeatSpecs.push({
            group: 'Repeat',
            label: 'Repeat Radius',
            path: ['repeat', 'radius'],
            value: radius,
            min: rng.min,
            max: rng.max,
            step: rng.step,
            repeatSig: sig,
            repeatDefRange: def,
          })
        }

        // angle (only if exists in data)
        if ('angle' in rep) {
          const def = { min: 0, max: 360, step: 1 }
          const sig = 'angle'
          const rng = typeof getRepeatRange === 'function'
            ? sanitizeRange(getRepeatRange(panelPath, sig, def), def)
            : def

          repeatSpecs.push({
            group: 'Repeat',
            label: 'Repeat Angle (deg)',
            path: ['repeat', 'angle'],
            value: angle,
            min: rng.min,
            max: rng.max,
            step: rng.step,
            integer: true,
            repeatSig: sig,
            repeatDefRange: def,
          })
        }
      }

      // repeat 放前面
      specs = [...repeatSpecs, ...specs]
    }

    // 3) existing overrides (translate + max-only)
    specs = specs.map((s) => {
      // Translate: override min/max/step
      if (s.path?.[0] === 'transform' && s.path?.[1] === 't') {
        const axis = s.path[2]
        const r = getTranslateRange(panelPath, axis)
        return { ...s, group: s.group || 'Transform', min: r.min, max: r.max, step: r.step }
      }

      // Scale: override max only
      if (s.path?.[0] === 'transform' && s.path?.[1] === 's') {
        const axis = s.path[2]
        const key = keyForSMax(panelPath, axis)
        const newMax = getMaxOverride(key, s.max)
        const safeMax = (newMax > s.min) ? newMax : (s.min + Math.abs(s.step || 0.001))
        return { ...s, group: s.group || 'Transform', max: safeMax }
      }

      // Primitive: override max only
      if (s.path?.[0] === 'primitive') {
        const pkey = s.path[1]
        const key = keyForPrimMax(panelPath, pkey)
        const newMax = getMaxOverride(key, s.max)
        const safeMax = (newMax > s.min) ? newMax : (s.min + Math.abs(s.step || 0.001))
        return { ...s, group: s.group || 'Primitive', max: safeMax }
      }

      // Repeat: 已在注入时用 getRepeatRange 处理过，这里不再额外动它
      if (s.path?.[0] === 'repeat') {
        return { ...s, group: s.group || 'Repeat', repeatSig: s.repeatSig ?? repeatSigFromPath(s.path) }
      }

      return { ...s, group: s.group || groupForSpec(s) }
    })

    return specs
  }, [
    liveScene,
    panelPath,

    // ticks
    rangeTick,
    paramMaxTick,
    repeatTick,

    // getters
    getTranslateRange,
    getMaxOverride,
    keyForSMax,
    keyForPrimMax,
    getRepeatRange,
  ])

  return { selectedNode, panelSpecs }
}