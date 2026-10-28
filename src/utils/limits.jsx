// src/utils/limits.js
// 纯常量 + 纯函数（无副作用），用于范围/上限以及 localStorage 键名

// Translate per-node per-axis 的本地存储键
export const RANGE_LS_KEY = 'ttcs.translateRange.v1'

// Translate 默认范围
export const DEFAULT_T_RANGE = { min: -10, max: 10, step: 0.1 }

// Scale/Primitive “仅 Max 覆盖”的本地存储键
export const PARAM_MAX_LS_KEY = 'ttcs.paramMax.v1' // s|path|axis 或 p|path|param -> number(max)

// ---- 键名构造器（保持旧命名 & 兼容现有逻辑）----
export const keyForT = (path, axisIndex) => `t|${path}|${axisIndex}`
export const keyForDraft = (path, axisIndex, kind) => `t|${path}|${axisIndex}|${kind}` // kind: 'min' | 'max'
export const keyForSMax = (path, axisIndex) => `s|${path}|${axisIndex}`
export const keyForPrimMax = (path, paramKey) => `p|${path}|${paramKey}`
