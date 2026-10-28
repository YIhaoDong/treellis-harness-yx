const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const validPath = value => typeof value === 'string' && /^0(?:\.(?:0|[1-9]\d*))*$/.test(value)

export function validateConversation(value = []) {
  if (!Array.isArray(value) || value.length > 6) throw new Error('Conversation must contain at most six messages.')
  let length = 0
  return value.map(turn => {
    if (!object(turn) || Object.keys(turn).sort().join(',') !== 'content,role' ||
      !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string' ||
      !turn.content.trim() || turn.content.length > 4000) throw new Error('Conversation messages require user/assistant role and 1–4000 characters.')
    length += turn.content.length
    if (length > 12000) throw new Error('Conversation history exceeds 12000 characters.')
    return { role: turn.role, content: turn.content }
  })
}

export function validateSuggestions(value = [], { scene, path = '0', mode = 'node' } = {}) {
  if (!Array.isArray(value) || value.length > 3) throw new Error('At most three executable suggestions are allowed.')
  if (value.length && (mode === 'create' || !validPath(path))) throw new Error('Suggestions require an existing editing scope.')
  return value.map(item => {
    if (!object(item) || Object.keys(item).sort().join(',') !== 'instruction,label,path' ||
      typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80 ||
      typeof item.instruction !== 'string' || !item.instruction.trim() || item.instruction.length > 2000 ||
      !validPath(item.path)) throw new Error('Each suggestion requires a short label, an actionable instruction and a valid target path.')
    if (item.path !== path && !path.startsWith(`${item.path}.`)) throw new Error('Suggestions may target only the current node or its ancestors.')
    let target = scene
    for (const part of item.path.split('.').slice(1)) target = target?.children?.[Number(part)]
    if (!object(target)) throw new Error('The suggested target no longer exists.')
    return { label: item.label.trim(), instruction: item.instruction.trim(), path: item.path }
  })
}
