const PATH = /^0(?:\.(?:0|[1-9]\d*))*$/

export function followupNodeAt(scene, path) {
  if (typeof path !== 'string' || !PATH.test(path)) return null
  let node = scene
  for (const part of path.split('.').slice(1)) node = node?.children?.[Number(part)]
  return node && typeof node === 'object' ? node : null
}

// Keep only actual dialog turns. Public reasoning summaries are never dialog input.
export function boundedNodeConversation(messages) {
  if (!Array.isArray(messages)) return []
  const turns = messages.filter(item => ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string')
    .map(item => ({ role: item.role, content: item.content.trim().slice(0, 4000) })).filter(item => item.content)
  const result = []
  let remaining = 12000
  for (const item of turns.slice(-6).reverse()) {
    if (remaining <= 0) break
    const content = item.content.slice(0, remaining)
    result.unshift({ role: item.role, content })
    remaining -= content.length
  }
  return result
}

export function nodeReplyConversation(clarification) {
  const provided = boundedNodeConversation(clarification?.conversation)
  if (provided.length) return provided
  return boundedNodeConversation([
    { role: 'user', content: clarification?.prompt },
    { role: 'assistant', content: clarification?.message },
  ])
}

export function nodeFollowupSuggestions(scene, sourcePath, suggestions) {
  if (!followupNodeAt(scene, sourcePath) || !Array.isArray(suggestions)) return []
  return suggestions.slice(0, 3).flatMap(item => {
    if (typeof item?.label !== 'string' || typeof item.instruction !== 'string' || typeof item.path !== 'string') return []
    const label = item.label.trim().slice(0, 80)
    const instruction = item.instruction.trim().slice(0, 2000)
    const target = followupNodeAt(scene, item.path)
    if (!label || !instruction || !target || (sourcePath !== item.path && !sourcePath.startsWith(`${item.path}.`))) return []
    return [{ label, instruction, path: item.path, name: target.name || target.primitive?.type || 'node', parentScope: sourcePath !== item.path }]
  })
}
