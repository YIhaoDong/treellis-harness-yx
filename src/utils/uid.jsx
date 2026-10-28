// src/utils/uid.jsx
// Lightweight UID generator (browser-safe).
// - Uses crypto.getRandomValues when available.
// - Falls back to time + Math.random.
// This UID is intended for UI/library items (not cryptographic).

function hexFromBytes(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

function safeNowBase36() {
  try {
    return Date.now().toString(36)
  } catch {
    return String(+new Date())
  }
}

function safeRandBase36() {
  try {
    return Math.floor(Math.random() * 1e12).toString(36)
  } catch {
    return '0'
  }
}

/**
 * newUid(prefix?)
 * @param {string} prefix - e.g., 'lib', 'snap'
 * @returns {string} uid like 'lib_kt3m9p_4f2a9c...'
 */
export function newUid(prefix = 'id') {
  const p = String(prefix || 'id').trim() || 'id'
  const ts = safeNowBase36()

  // Prefer cryptographically-strong randomness when available
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(10) // 80-bit
      crypto.getRandomValues(bytes)
      const rnd = hexFromBytes(bytes)
      return `${p}_${ts}_${rnd}`
    }
  } catch {
    // ignore and fallback
  }

  // Fallback
  const rnd = `${safeRandBase36()}${safeRandBase36()}`
  return `${p}_${ts}_${rnd}`
}