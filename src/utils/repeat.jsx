// src/utils/repeat.js
// Repeat node utilities (pure, renderer-agnostic):
// - detect repeat nodes
// - normalize repeat type
// - compute per-instance TRS (no THREE dependency)

export const MAX_REPEAT_COUNT_SOFT = 256 // render-side safety limit

export function clampInt(n, lo, hi) {
  const x = Number(n)
  const xi = Number.isFinite(x) ? Math.floor(x) : lo
  return Math.max(lo, Math.min(hi, xi))
}

export function v3(arr, fallback = [0, 0, 0]) {
  const a = Array.isArray(arr) ? arr : []
  return [
    Number.isFinite(Number(a[0])) ? Number(a[0]) : fallback[0],
    Number.isFinite(Number(a[1])) ? Number(a[1]) : fallback[1],
    Number.isFinite(Number(a[2])) ? Number(a[2]) : fallback[2],
  ]
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * Normalize repeat type string.
 * @returns {'linear'|'circular'|null}
 */
export function normalizeRepeatType(raw) {
  const s = (raw ?? '').toString().trim().toLowerCase()
  if (!s) return null
  if (s.includes('circ') || s.includes('rad') || s.includes('ring')) return 'circular'
  if (s.includes('lin') || s.includes('array') || s.includes('row')) return 'linear'
  if (s === 'circle') return 'circular'
  if (s === 'linear') return 'linear'
  return null
}

/**
 * Repeat node identification:
 * - node.repeat exists OR
 * - node.kind/nodeKind === 'repeat'
 */
export function isRepeatNode(node) {
  const kind = (node?.kind || node?.nodeKind || '').toString().toLowerCase()
  const rep = node?.repeat
  if (rep && typeof rep === 'object') return true
  return kind === 'repeat'
}

/**
 * For UI/tree use: return a stable key used for styling/legend.
 * @returns {'repeat_linear'|'repeat_circular'|null}
 */
export function getRepeatKey(node) {
  const kind = (node?.kind || node?.nodeKind || '').toString().toLowerCase()
  const rep = node?.repeat
  if (!rep && kind !== 'repeat') return null

  const t =
    (rep?.type ?? rep?.mode ?? node?.repeatType ?? node?.repeatMode ?? '').toString()

  const nt = normalizeRepeatType(t) || 'linear'
  return nt === 'circular' ? 'repeat_circular' : 'repeat_linear'
}

/**
 * Compute per-instance TRS relative to the repeat node's own transform.
 *
 * Linear:
 * - f = i/(n-1) (n=1 => f=0)
 * - t = f * repeat.t
 * - r = f * repeat.r
 * - s = lerp(1, repeat.s, f) per-axis
 *
 * Circular (default around Y, in XZ plane):
 * - angle = i * 2π/n (no overlap)
 * - basePos = [radius*cos, 0, radius*sin]
 * - then add linear interpolated delta t/r/s as above (f still uses i/(n-1))
 *
 * @returns Array<{ t:[number,number,number], r:[number,number,number], s:[number,number,number] }>
 */
export function computeRepeatInstances(node, opts = {}) {
  const rep = node?.repeat || {}
  const type =
    normalizeRepeatType(rep.type ?? rep.mode ?? node?.repeatType ?? node?.repeatMode) || 'linear'

  const maxCount = clampInt(opts.maxCount ?? MAX_REPEAT_COUNT_SOFT, 1, 4096)
  const count = clampInt(rep.count ?? rep.n ?? 1, 1, maxCount)

  const rt = v3(rep.t, [0, 0, 0])
  const rr = v3(rep.r, [0, 0, 0])
  const rsEnd = v3(rep.s, [1, 1, 1]) // end scale multiplier

  const radius = Number.isFinite(Number(rep.radius)) ? Number(rep.radius) : 1

  const out = []
  for (let i = 0; i < count; i++) {
    const f = (count === 1) ? 0 : (i / (count - 1))

    const dt = [rt[0] * f, rt[1] * f, rt[2] * f]
    const dr = [rr[0] * f, rr[1] * f, rr[2] * f]
    const ds = [
      lerp(1, rsEnd[0], f),
      lerp(1, rsEnd[1], f),
      lerp(1, rsEnd[2], f),
    ]

    if (type === 'circular') {
      const theta = (i * Math.PI * 2) / count
      const basePos = [radius * Math.cos(theta), 0, radius * Math.sin(theta)]
      out.push({ t: [basePos[0] + dt[0], basePos[1] + dt[1], basePos[2] + dt[2]], r: dr, s: ds })
    } else {
      out.push({ t: dt, r: dr, s: ds })
    }
  }

  return out
}