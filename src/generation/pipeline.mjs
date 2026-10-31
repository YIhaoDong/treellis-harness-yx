import { createHash, randomUUID } from 'node:crypto'
import { MODEL_ID, MODEL_FAMILY_LABEL, RUN_MODES, DEFAULT_RUN_MODE, ASSET_NAMES } from './config.mjs'
import { FRAMEWORK_VERSION, createResponseFormat, validateAML, applyGenerationEnvelope } from './amlContract.mjs'
import { evaluateChecks } from './geometry.mjs'
import { runGeometryTask } from './geometryRunner.mjs'
import { callModel } from './provider.mjs'
import { getGenerationLimits } from './limits.mjs'
import { validateConversation } from './followups.mjs'
import { normalizeImages, imageUserContent, IMAGE_REFERENCE_RULE } from './imageInputs.mjs'

export class GenerationError extends Error {
  constructor(message, code = 'GENERATION_ERROR', details = {}) {
    super(message); this.name = 'GenerationError'; this.code = code; Object.assign(this, details)
  }
}
const cleanMessage = (value) => String(value || '').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1200)
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const clone = (value) => JSON.parse(JSON.stringify(value))
function aborted(signal) { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError') }
function getNode(scene, path) {
  if (!/^0(?:\.\d+)*$/.test(path)) throw new GenerationError('The selected node path is invalid.', 'INVALID_INPUT')
  let node = scene
  for (const index of path.split('.').slice(1)) node = node?.children?.[Number(index)]
  return node
}
function putNode(scene, path, node) {
  if (path === '0') return node
  const root = clone(scene), parts = path.split('.').slice(1).map(Number)
  let parent = root
  for (const index of parts.slice(0, -1)) parent = parent.children[index]
  parent.children[parts.at(-1)] = node
  return root
}
function ensureUIDs(node) {
  if (!node.uid) node.uid = `gen_${randomUUID()}`
  for (const child of node.children || []) ensureUIDs(child)
}
function errorStrings(errors) { return (errors || []).map((e) => typeof e === 'string' ? e : e.message || JSON.stringify(e)) }
function reportErrors(report, label) {
  const errors = errorStrings(report?.errors)
  if (report?.ok === false && !errors.length) errors.push(`${label} failed without diagnostics.`)
  return errors
}
function chooseExamples(text, prompt) {
  let data
  try { data = JSON.parse(text) } catch { throw new GenerationError('The prompt examples file is invalid JSON.', 'CONFIG_ERROR') }
  if (!Array.isArray(data.examples) || !data.examples.length) throw new GenerationError('No valid prompt examples are configured.', 'CONFIG_ERROR')
  const query = prompt.toLowerCase()
  return data.examples.map((example, index) => ({ example, index, score: (example.tags || []).reduce((n, tag) => n + (query.includes(tag.toLowerCase()) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 2).map(({ example }) => ({ description: example.description, aml: example.aml }))
}
function messagesFor({ mode, prompt, scene, node, path, context, assets, conversation, images }) {
  const system = [assets[mode === 'node' ? 'role_node' : 'role_global'],
    assets[mode === 'create' ? 'task_global_create' : mode === 'node' ? 'task_node_edit' : 'task_global_edit'],
    assets.runtime_rules, assets.jsonFormat, assets.constraints_global, assets.parameterRules, assets.colorRules]
  if (mode === 'node') system.push(assets.constraints_node, assets.nodeAdjustRules)
  if (images.length) system.push(IMAGE_REFERENCE_RULE)
  const user = [`USER_INSTRUCTION:\n${prompt}`]
  if (mode === 'edit') user.push(`CURRENT_SCENE:\n${JSON.stringify(scene)}`)
  if (mode === 'node') user.push(`SELECTED_PATH: ${path}`, `CURRENT_NODE:\n${JSON.stringify(node)}`, `SPATIAL_CONTEXT (read-only; paths refer to the full scene):\n${JSON.stringify(context)}`)
  if (mode === 'node') user.push(`SUGGESTION_TARGETS (existing current node and ancestors; only for choices, never automatic scope changes):\n${JSON.stringify(path.split('.').map((_, index, parts) => {
    const targetPath = parts.slice(0, index + 1).join('.')
    return { path: targetPath, name: getNode(scene, targetPath)?.name || 'Node' }
  }))}`)
  user.push(`AML_EXAMPLES (shape syntax only; use the response envelope required by the schema):\n${JSON.stringify(chooseExamples(assets.jsonCase, prompt))}`)
  return [{ role: 'system', content: system.join('\n\n') }, ...conversation, { role: 'user', content: imageUserContent(user.join('\n\n'), images) }]
}
function responseText(data) {
  if (data.status === 'incomplete') throw new GenerationError(data.incomplete_details?.reason === 'max_output_tokens'
    ? 'The output budget, including reasoning, was exhausted. Use Step by step or request fewer parts. The incomplete result was not applied.'
    : 'OpenAI returned an incomplete response. The incomplete result was not applied. Please retry or use Step by step.', 'INCOMPLETE', { reason: data.incomplete_details?.reason, usage: data.usage })
  if (data.status && data.status !== 'completed') throw new GenerationError('The model did not complete the generation.', 'PROVIDER_ERROR')
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text
  const texts = []
  for (const item of data.output || []) for (const part of item.content || []) {
    if (part.type === 'refusal') throw new GenerationError(cleanMessage(part.refusal || 'The model could not fulfill this request.'), 'REFUSAL')
    if (typeof part.text === 'string') texts.push(part.text)
  }
  if (!texts.length) throw new GenerationError('The model returned no usable result.', 'EMPTY_RESPONSE')
  return texts.join('')
}
export async function runGeneration(input, dependencies = {}) {
  const { apiKey, loadAssets, fetchImpl, onProgress = () => {}, signal, maxRepairs = 2 } = dependencies
  const started = Date.now(), { mode, scene = null, path = '0' } = input || {}
  const prompt = String(input?.prompt || '').trim(), effort = input?.effort || DEFAULT_RUN_MODE
  if (!['create', 'edit', 'node'].includes(mode)) throw new GenerationError('Unknown generation mode.', 'INVALID_INPUT')
  if (!RUN_MODES[effort]) throw new GenerationError('Choose one of the five supported reasoning efforts.', 'INVALID_EFFORT')
  if (!prompt || prompt.length > 16000) throw new GenerationError('The combined generation instruction must contain 1–16000 characters.', 'INVALID_INPUT')
  if (!apiKey?.trim()) throw new GenerationError('Enter an OpenAI API key in Key settings.', 'MISSING_KEY')
  if (mode !== 'create' && (!scene || typeof scene !== 'object')) throw new GenerationError('Load a scene before editing.', 'INVALID_INPUT')
  if (JSON.stringify(scene).length > 1500000) throw new GenerationError('This scene is too large for one edit. Select a smaller subtree.', 'INVALID_INPUT')
  let conversation, images
  try { conversation = validateConversation(input?.conversation) } catch (error) { throw new GenerationError(error.message, 'INVALID_INPUT') }
  try { images = normalizeImages(input?.images) } catch (error) { throw new GenerationError(error.message, 'INVALID_IMAGES', { status: 400 }) }
  aborted(signal)
  const node = mode === 'node' ? getNode(scene, path) : scene
  if (mode === 'node' && !node) throw new GenerationError('The selected node no longer exists.', 'STALE_SCENE')
  if (mode === 'node' && input.node && JSON.stringify(input.node) !== JSON.stringify(node)) throw new GenerationError('The selected node changed. Reopen its prompt and try again.', 'STALE_SCENE')
  const assets = await loadAssets()
  for (const name of ASSET_NAMES) if (typeof assets?.[name] !== 'string' || !assets[name].trim()) throw new GenerationError(`The prompt template ${name} is missing. Restore its prompt file and retry.`, 'CONFIG_ERROR')
  aborted(signal)
  const progress = (stage, message, extra = {}) => { aborted(signal); onProgress({ stage, message, ...extra }) }
  progress('preparing', 'Preparing the scene…')
  const inspect = dependencies.inspectGeometry || ((root) => runGeometryTask({ type: 'inspect', root }, signal))
  const makeContext = dependencies.buildEditContext || ((root, selectedPath) => runGeometryTask({ type: 'context', scene: root, path: selectedPath }, signal))
  const context = mode === 'node' ? await makeContext(scene, path) : null
  const messages = messagesFor({ mode, prompt, scene, node, path, context, assets, conversation, images })
  const templateHash = digest(Object.fromEntries(ASSET_NAMES.map((name) => [name, assets[name]])))
  const allowStructure = /\b(add|remove|delete|insert|replace|rebuild|redesign|group|ungroup|create|build|generate|convert|duplicate|mirror|copy|clone|split|attach|detach|append|refine|detail|detailed|elaborate)\b|\b(?:turn|make)\b[\s\S]+\binto\b|添加|新增|增加|移除|删除|删掉|删去|去掉|去除|拿掉|移走|替换|重做|重建|重新设计|组合|分组|拆分|新建|生成|变成|改成|换成|加上|加个|加一个|多加|再加|添上|复制|镜像|细化|精细|细节/i.test(prompt)
  const totalUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, attempts = []
  let lastErrors = [], frozenChecks = null, incompleteRecoveryUsed = false
  const repairs = Math.min(2, Math.max(0, Number(maxRepairs) || 0))
  let budget = getGenerationLimits(effort).maxOutputTokens
  for (let attempt = 0; attempt <= repairs; attempt++) {
    progress(attempt ? 'repairing' : 'generating', attempt ? `Fixing the model (${attempt}/${repairs})…` : 'Generating the model…', { attempt: attempt + 1 })
    const data = await callModel({ model: MODEL_ID, store: false, reasoning: { effort }, text: { format: createResponseFormat(mode, { allowStructure }) }, input: messages, max_output_tokens: budget }, {
      apiKey: apiKey.trim(), fetchImpl, signal,
      onProgress: ({ stage, message, ...extra }) => progress(stage, message, { attempt: attempt + 1, ...extra }),
    })
    for (const key of Object.keys(totalUsage)) totalUsage[key] += Number(data.usage?.[key] || 0)
    let text
    try { text = responseText(data) } catch (error) {
      // Never parse or apply a truncated response. A single compact regeneration
      // shares the existing repair allowance, so costly attempts cannot multiply.
      attempts.push({ attempt: attempt + 1, passed: false, errors: [cleanMessage(error.message)], responseId: data.id || null, usage: data.usage || null })
      if (error.code === 'INCOMPLETE' && error.reason === 'max_output_tokens' && !incompleteRecoveryUsed && attempt < repairs) {
        incompleteRecoveryUsed = true
        budget = Math.min(getGenerationLimits('max').maxOutputTokens, budget * 2)
        progress('repairing', 'The output budget was reached. Regenerating a compact complete result…', { attempt: attempt + 2, outputBudget: budget })
        messages.push({ role: 'user', content: `The previous response exhausted its output budget and was NOT applied. Regenerate a complete strict response envelope for the SAME request and editable scope. Keep the same requested detail and all frozen acceptance checks. Make the final AML concise: prefer parameter patches when sufficient, use repeat templates for regular repeated parts, and keep message/plan brief. Do not include a truncated response, commentary, or private reasoning.\nFROZEN_ACCEPTANCE_CHECKS (must not be weakened):\n${JSON.stringify(frozenChecks || [])}` })
        continue
      }
      error.usage = { ...totalUsage }; error.attempts = attempts
      throw error
    }
    let envelope, candidate, report, checkReport
    const errors = []
    try {
      envelope = JSON.parse(text)
      candidate = applyGenerationEnvelope(envelope, { mode, scene, node, path, allowStructure })
      if (candidate.action === 'clarify') throw new GenerationError(candidate.message, 'CLARIFICATION', {
        suggestions: candidate.suggestions, usage: { ...totalUsage }, durationMs: Date.now() - started,
        // Keep prior validation diagnostics and this terminal outcome, never raw model text.
        attempts: [...clone(attempts), { attempt: attempt + 1, outcome: 'clarification', passed: false,
          errors: [], responseId: data.id || null, usage: clone(data.usage || null) }],
      })
      if (!frozenChecks && Array.isArray(envelope.checks) && envelope.checks.length) frozenChecks = clone(envelope.checks)
      const validation = validateAML(candidate.root, { baseline: mode === 'create' ? null : node, allowPositionalMatch: candidate.action === 'patch' })
      errors.push(...reportErrors(validation, 'AML validation'))
      if (!errors.length) {
        progress('checking', 'Checking geometry and requested changes…')
        const fullScene = mode === 'node' ? putNode(scene, path, candidate.root) : candidate.root
        if (mode === 'node') errors.push(...reportErrors(validateAML(fullScene, { baseline: scene, allowPositionalMatch: true,
          // The already-validated selected root can legitimately change kind
          // while retaining its host identity. No other node gets this mapping.
          ...(candidate.action === 'replace' ? { selectedReplacementPath: path } : {}),
        }), 'Whole scene validation'))
        if (!errors.length) {
          report = await inspect(fullScene)
          errors.push(...reportErrors(report, 'Geometry inspection'))
          if (!errors.length) { checkReport = evaluateChecks(report, frozenChecks || envelope.checks || []); errors.push(...reportErrors(checkReport, 'Requested changes check')) }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'CLARIFICATION') throw error
      errors.push(cleanMessage(error.message || error))
    }
    aborted(signal)
    attempts.push({ attempt: attempt + 1, passed: !errors.length, errors: errors.slice(0, 12), responseId: data.id || null, usage: data.usage || null })
    if (!errors.length && candidate) {
      if (candidate.action === 'replace') ensureUIDs(candidate.root)
      const meta = {
        prompt: { mode: 'full', text: prompt, len: prompt.length },
        model: { name: MODEL_ID, id: MODEL_ID, family: MODEL_FAMILY_LABEL, runMode: effort, reasoningEffort: effort },
        anchor: { scope: mode === 'node' ? 'node' : 'global', path: mode === 'node' ? path : 'root', name: node?.name || '(root)', ...(node?.uid ? { uid: node.uid } : {}) },
        mode: mode === 'node' ? 'node_edit' : mode, useCurrent: mode !== 'create', hasContext: mode !== 'create', usage: totalUsage, responseStatus: data.status || 'completed',
        framework: { version: FRAMEWORK_VERSION, templateHash, baseRevision: scene ? digest(scene) : null, attempts, repairs: attempt, incompleteRecoveryUsed, outputBudget: budget, durationMs: Date.now() - started,
          action: candidate.action, changes: candidate.changes, plan: envelope.plan || [], checks: checkReport?.results || [],
          geometry: { stats: report?.stats, bounds: report?.bounds }, warnings: [...(report?.warnings || []), ...(checkReport?.warnings || [])] },
      }
      progress('complete', 'Model ready.')
      return { result: candidate.root, meta, action: candidate.action, changes: candidate.changes }
    }
    lastErrors = errors
    if (attempt < repairs) {
      messages.push({ role: 'assistant', content: text })
      messages.push({ role: 'user', content: `The candidate was NOT applied. Repair only the diagnosed problems while preserving the original request and untouched fields. Return a complete response envelope.\nDIAGNOSTICS:\n${errors.slice(0, 12).join('\n')}\nFROZEN_ACCEPTANCE_CHECKS (must not be weakened):\n${JSON.stringify(frozenChecks || [])}` })
    }
  }
  throw new GenerationError(`The model could not pass checks after ${repairs + 1} attempts. Your scene is unchanged. ${lastErrors.slice(0, 2).join(' ')}`, 'VALIDATION_FAILED', { attempts, usage: totalUsage })
}
