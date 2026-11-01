// src/hooks/useParamRanges.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { STATIC_DEMO } from '../staticDemo/mode.mjs'

// 公开给外部用于占位/默认 UI 提示
export const DEFAULT_T_RANGE = { min: -10, max: 10, step: 0.1 }

// ✅ Repeat 的默认范围兜底（如果调用方不传 defRange）
export const DEFAULT_REPEAT_RANGE = { min: -20, max: 20, step: 0.1 }

/* ---------------------- Translate 范围（min/max/step） ---------------------- */
export function useTranslateRanges() {
  const RANGE_LS_KEY = 'ttcs.translateRange.v1'

  // 真正的存储
  const rangeOverridesRef = useRef({})
  const [rangeTick, setRangeTick] = useState(0)

  // 文本输入的“中间态”
  const rangeDraftRef = useRef({})
  const [rangeDraftTick, setRangeDraftTick] = useState(0)

  useEffect(() => {
    if (STATIC_DEMO) return
    try {
      const raw = localStorage.getItem(RANGE_LS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') rangeOverridesRef.current = parsed
      }
    } catch {}
  }, [])

  const persist = useCallback(() => {
    if (STATIC_DEMO) return
    try { localStorage.setItem(RANGE_LS_KEY, JSON.stringify(rangeOverridesRef.current)) } catch {}
  }, [])

  const keyForT = (path, axisIndex) => `t|${path}|${axisIndex}`
  const keyForDraft = (path, axisIndex, kind) => `t|${path}|${axisIndex}|${kind}` // kind: 'min' | 'max'

  const getTranslateRange = useCallback((path, axisIndex) => {
    const rec = rangeOverridesRef.current[keyForT(path, axisIndex)]
    if (rec && Number.isFinite(rec.min) && Number.isFinite(rec.max) && Number.isFinite(rec.step)) {
      return rec
    }
    return DEFAULT_T_RANGE
  }, [])

  const updateTranslateRange = useCallback((path, axisIndex, patch) => {
    const k = keyForT(path, axisIndex)
    const prev = rangeOverridesRef.current[k] || DEFAULT_T_RANGE
    let next = { ...prev, ...patch }

    next.min = Number(next.min)
    next.max = Number(next.max)
    next.step = Number(next.step ?? prev.step ?? DEFAULT_T_RANGE.step)
    if (!Number.isFinite(next.min)) next.min = DEFAULT_T_RANGE.min
    if (!Number.isFinite(next.max)) next.max = DEFAULT_T_RANGE.max
    if (!Number.isFinite(next.step) || next.step <= 0) next.step = DEFAULT_T_RANGE.step
    if (next.max <= next.min) next.max = next.min + Math.abs(next.step)

    rangeOverridesRef.current[k] = next
    persist()
    setRangeTick(t => t + 1)
  }, [persist])

  const resetTranslateRange = useCallback((path, axisIndex) => {
    const k = keyForT(path, axisIndex)
    delete rangeOverridesRef.current[k]
    // 清掉草稿，避免遗留
    delete rangeDraftRef.current[keyForDraft(path, axisIndex, 'min')]
    delete rangeDraftRef.current[keyForDraft(path, axisIndex, 'max')]
    persist()
    setRangeDraftTick(t => t + 1)
    setRangeTick(t => t + 1)
  }, [persist])

  return {
    // stores + ticks（给 UI 强制刷新）
    rangeOverridesRef, rangeTick,
    rangeDraftRef, rangeDraftTick, setRangeDraftTick,
    // helpers
    getTranslateRange, updateTranslateRange, resetTranslateRange, keyForDraft,
  }
}

/* ---------------------- Scale/Primitive 的 Max-only 上限 ---------------------- */
export function useParamMaxOverrides() {
  const PARAM_MAX_LS_KEY = 'ttcs.paramMax.v1'

  const paramMaxOverridesRef = useRef({})
  const [paramMaxTick, setParamMaxTick] = useState(0)

  const paramMaxDraftRef = useRef({})
  const [paramMaxDraftTick, setParamMaxDraftTick] = useState(0)

  useEffect(() => {
    if (STATIC_DEMO) return
    try {
      const raw = localStorage.getItem(PARAM_MAX_LS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') paramMaxOverridesRef.current = parsed
      }
    } catch {}
  }, [])

  const persist = useCallback(() => {
    if (STATIC_DEMO) return
    try { localStorage.setItem(PARAM_MAX_LS_KEY, JSON.stringify(paramMaxOverridesRef.current)) } catch {}
  }, [])

  const keyForSMax = (path, axisIndex) => `s|${path}|${axisIndex}`
  const keyForPrimMax = (path, paramKey) => `p|${path}|${paramKey}`

  const getMaxOverride = useCallback((key, defMax) => {
    const v = paramMaxOverridesRef.current[key]
    return Number.isFinite(v) ? v : defMax
  }, [])

  const setMaxOverride = useCallback((key, next, defMin, step) => {
    let v = Number(next)
    if (!Number.isFinite(v)) return
    const eps = Math.abs(step || 0.001)
    if (!(defMin == null)) {
      if (v <= defMin) v = defMin + eps
    }
    paramMaxOverridesRef.current[key] = v
    persist()
    setParamMaxTick(t => t + 1)
  }, [persist])

  const resetMaxOverride = useCallback((key) => {
    delete paramMaxOverridesRef.current[key]
    persist()
    setParamMaxTick(t => t + 1)
  }, [persist])

  return {
    // stores + ticks（给 UI 强制刷新）
    paramMaxOverridesRef, paramMaxTick,
    paramMaxDraftRef, paramMaxDraftTick, setParamMaxDraftTick,
    // helpers
    getMaxOverride, setMaxOverride, resetMaxOverride,
    keyForSMax, keyForPrimMax,
  }
}

/* ---------------------- ✅ Repeat 范围（min/max/step） ---------------------- */
/**
 * Repeat 的每个参数一条 range override：{min,max,step}
 * key = rep|<path>|<sig>
 * sig examples:
 * - count
 * - radius
 * - angle
 * - t|0 / t|1 / t|2
 * - r|0 / r|1 / r|2
 * - s|0 / s|1 / s|2
 */
export function useRepeatRanges() {
  const REPEAT_LS_KEY = 'ttcs.repeatRange.v1'

  const repeatOverridesRef = useRef({})
  const [repeatTick, setRepeatTick] = useState(0)

  const repeatDraftRef = useRef({})
  const [repeatDraftTick, setRepeatDraftTick] = useState(0)

  useEffect(() => {
    if (STATIC_DEMO) return
    try {
      const raw = localStorage.getItem(REPEAT_LS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') repeatOverridesRef.current = parsed
      }
    } catch {}
  }, [])

  const persist = useCallback(() => {
    if (STATIC_DEMO) return
    try { localStorage.setItem(REPEAT_LS_KEY, JSON.stringify(repeatOverridesRef.current)) } catch {}
  }, [])

  const keyForRepeat = (path, sig) => `rep|${path}|${sig}`
  const keyForRepeatDraft = (path, sig, kind) => `rep|${path}|${sig}|${kind}` // kind: 'min'|'max'|'step'

  const getRepeatRange = useCallback((path, sig, defRange = DEFAULT_REPEAT_RANGE) => {
    const rec = repeatOverridesRef.current[keyForRepeat(path, sig)]
    if (rec && Number.isFinite(rec.min) && Number.isFinite(rec.max) && Number.isFinite(rec.step)) {
      return rec
    }
    return defRange
  }, [])

  const updateRepeatRange = useCallback((path, sig, patch, defRange = DEFAULT_REPEAT_RANGE) => {
    const k = keyForRepeat(path, sig)
    const prev = repeatOverridesRef.current[k] || defRange
    let next = { ...prev, ...patch }

    next.min = Number(next.min)
    next.max = Number(next.max)
    next.step = Number(next.step ?? prev.step ?? defRange.step)

    if (!Number.isFinite(next.min)) next.min = Number(defRange.min)
    if (!Number.isFinite(next.max)) next.max = Number(defRange.max)
    if (!Number.isFinite(next.step) || next.step <= 0) next.step = Number(defRange.step)

    if (next.max <= next.min) next.max = next.min + Math.abs(next.step)

    repeatOverridesRef.current[k] = next
    persist()
    setRepeatTick(t => t + 1)
  }, [persist])

  const resetRepeatRange = useCallback((path, sig) => {
    const k = keyForRepeat(path, sig)
    delete repeatOverridesRef.current[k]
    delete repeatDraftRef.current[keyForRepeatDraft(path, sig, 'min')]
    delete repeatDraftRef.current[keyForRepeatDraft(path, sig, 'max')]
    delete repeatDraftRef.current[keyForRepeatDraft(path, sig, 'step')]
    persist()
    setRepeatDraftTick(t => t + 1)
    setRepeatTick(t => t + 1)
  }, [persist])

  return {
    repeatOverridesRef, repeatTick,
    repeatDraftRef, repeatDraftTick, setRepeatDraftTick,
    getRepeatRange, updateRepeatRange, resetRepeatRange,
    keyForRepeatDraft,
  }
}
