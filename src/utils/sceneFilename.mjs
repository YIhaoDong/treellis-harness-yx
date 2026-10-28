const INVALID_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/
const INVALID_CHARACTERS_GLOBAL = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED_WINDOWS_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i

/** Validate a single portable filename; never interpret input as a path. */
export function normalizeSceneFilename(value) {
  const raw = String(value ?? '')
  const name = raw.trim()
  if (!name || /^\.json$/i.test(name)) return { error: 'Enter a file name.' }
  if (INVALID_CHARACTERS.test(raw)) return { error: 'File names cannot contain < > : " / \\ | ? * or control characters.' }
  if (/[. ]$/.test(raw)) return { error: 'File names cannot end with a dot or space.' }
  if (RESERVED_WINDOWS_NAME.test(name.replace(/ +\./g, '.'))) return { error: 'This name is reserved by Windows. Choose another file name.' }
  const filename = /\.json$/i.test(name) ? name : `${name}.json`
  if (filename.length > 255) return { error: 'Keep the file name within 255 characters, including .json.' }
  return { filename, error: '' }
}

/** Prefer an explicit filename or readable scene title, with a safe fallback. */
export function suggestSceneFilename(scene, filename, now = new Date()) {
  const candidate = typeof filename === 'string' && filename.trim()
    ? filename.trim()
    : typeof scene?.name === 'string' ? scene.name.trim() : ''
  const safe = candidate.replace(INVALID_CHARACTERS_GLOBAL, '-').replace(/^[. ]+|[. ]+$/g, '')
  const result = normalizeSceneFilename(safe)
  if (!result.error) return result.filename
  return `scene_${now.toISOString().replace(/[:.]/g, '-')}.json`
}
