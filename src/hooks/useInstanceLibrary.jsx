// src/hooks/useInstanceLibrary.jsx
// Copy-based Instance Library (NOT reference-based).
// Stores subtree snapshots (deep-cloned) into localStorage.
// Designed to be safely introduced without wiring UI yet.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deepClone, getNodeAtPath } from '../utils/tree'
import { newUid } from '../utils/uid'

const LS_KEY = 'ttcs.instanceLibrary.v1'

// Hard limits to avoid localStorage quota issues.
// Adjust if needed.
const DEFAULT_LIMITS = {
  maxItems: 60,              // soft cap on number of stored instances
  maxBytes: 2_500_000,       // ~2.5 MB JSON payload soft cap
}

function safeParseJSON(raw) {
  try {
    const obj = JSON.parse(raw)
    return obj
  } catch {
    return null
  }
}

function approxBytesOfString(s) {
  // In browser, Blob is more accurate; fallback to string length.
  try {
    return new Blob([s]).size
  } catch {
    return (s || '').length
  }
}

function normalizeName(name, fallback = 'Instance') {
  const t = String(name ?? '').trim()
  return t.length ? t : fallback
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) return []
  // Ensure each item has required fields; drop corrupt entries.
  const out = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const id = String(it.id || '').trim()
    const name = String(it.name || '').trim()
    const subtree = it.subtree
    if (!id || !name || !subtree || typeof subtree !== 'object') continue
    out.push({
      id,
      name,
      subtree,
      createdAt: Number.isFinite(Number(it.createdAt)) ? Number(it.createdAt) : Date.now(),
      sourcePath: (it.sourcePath != null ? String(it.sourcePath) : null),
    })
  }
  return out
}

function pack(items) {
  // store as { version, items }
  return JSON.stringify({ version: 1, items })
}

function unpack(raw) {
  const parsed = safeParseJSON(raw)
  if (!parsed || typeof parsed !== 'object') return []
  // Backward compatible: allow direct array
  if (Array.isArray(parsed)) return sanitizeItems(parsed)
  return sanitizeItems(parsed.items)
}

/**
 * Enforce size and count limits by dropping oldest items (FIFO by createdAt).
 */
function enforceLimits(items, limits) {
  const lim = { ...DEFAULT_LIMITS, ...(limits || {}) }
  let next = Array.isArray(items) ? [...items] : []

  // Always sort oldest -> newest, then trim from start as needed
  next.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))

  // Trim by maxItems
  if (Number.isFinite(lim.maxItems) && lim.maxItems > 0) {
    if (next.length > lim.maxItems) {
      next = next.slice(next.length - lim.maxItems)
    }
  }

  // Trim by maxBytes
  if (Number.isFinite(lim.maxBytes) && lim.maxBytes > 0) {
    // Iteratively drop oldest until within budget
    let payload = pack(next)
    let bytes = approxBytesOfString(payload)
    while (next.length > 0 && bytes > lim.maxBytes) {
      next.shift()
      payload = pack(next)
      bytes = approxBytesOfString(payload)
    }
  }

  return next
}

export default function useInstanceLibrary(limits = DEFAULT_LIMITS) {
  const [items, setItems] = useState([])

  // Keep latest items in ref for stable callbacks
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])

  // Load once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const loaded = unpack(raw)
      const bounded = enforceLimits(loaded, limits)
      setItems(bounded)
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = useCallback((nextItems) => {
    try {
      const bounded = enforceLimits(nextItems, limits)
      const payload = pack(bounded)
      localStorage.setItem(LS_KEY, payload)
      return bounded
    } catch {
      // If persist fails (quota), try dropping oldest aggressively
      try {
        let bounded = enforceLimits(nextItems, { ...limits, maxBytes: Math.max(200_000, (limits?.maxBytes || DEFAULT_LIMITS.maxBytes) * 0.6) })
        localStorage.setItem(LS_KEY, pack(bounded))
        return bounded
      } catch {
        return nextItems
      }
    }
  }, [limits])

  const addSubtree = useCallback((subtree, nameOverride = null, meta = {}) => {
    if (!subtree || typeof subtree !== 'object') return null
    const name = normalizeName(nameOverride, subtree?.name || 'Instance')
    const id = newUid('lib')
    const createdAt = Date.now()

    const item = {
      id,
      name,
      subtree: deepClone(subtree),
      createdAt,
      sourcePath: meta?.sourcePath != null ? String(meta.sourcePath) : null,
    }

    setItems((prev) => {
      const next = [...(prev || []), item]
      return persist(next)
    })

    return id
  }, [persist])

  const addFromPath = useCallback((scene, path, nameOverride = null) => {
    if (!scene || !path) return null
    const node = getNodeAtPath(scene, path)
    if (!node) return null
    const defaultName = node?.name || 'Instance'
    const finalName = normalizeName(nameOverride, defaultName)
    return addSubtree(node, finalName, { sourcePath: String(path) })
  }, [addSubtree])

  const remove = useCallback((id) => {
    const key = String(id || '').trim()
    if (!key) return
    setItems((prev) => {
      const next = (prev || []).filter(it => String(it.id) !== key)
      return persist(next)
    })
  }, [persist])

  const rename = useCallback((id, nextName) => {
    const key = String(id || '').trim()
    if (!key) return
    const nm = normalizeName(nextName, 'Instance')
    setItems((prev) => {
      const next = (prev || []).map(it => (String(it.id) === key ? { ...it, name: nm } : it))
      return persist(next)
    })
  }, [persist])

  const clear = useCallback(() => {
    setItems([])
    try { localStorage.removeItem(LS_KEY) } catch {}
  }, [])

  const getItem = useCallback((id) => {
    const key = String(id || '').trim()
    if (!key) return null
    const arr = itemsRef.current || []
    return arr.find(it => String(it.id) === key) || null
  }, [])

  // For UI: newest first
  const orderedItems = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : []
    arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return arr
  }, [items])

  return {
    items: orderedItems,
    addFromPath,
    addSubtree,
    remove,
    rename,
    clear,
    getItem,
  }
}