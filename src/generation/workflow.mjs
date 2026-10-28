import { createHash, randomUUID } from 'node:crypto'
import { runGeneration, GenerationError } from './pipeline.mjs'
import { callModel } from './provider.mjs'
import { getGenerationLimits } from './limits.mjs'
import { MODEL_ID, MODEL_FAMILY_LABEL, RUN_MODES, DEFAULT_RUN_MODE } from './config.mjs'
import { validateConversation } from './followups.mjs'
import { summarizeScenePalette } from './palette.mjs'
import { runGeometryTask } from './geometryRunner.mjs'
import { validateCompletedPartPaths, buildCompletedPartReferences } from './completedReferences.mjs'

const MAX_STEPS = 6
const clone = value => JSON.parse(JSON.stringify(value))
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const clean = value => String(value || '').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1200)
const validPath = value => typeof value === 'string' && /^0(?:\.(?:0|[1-9]\d*))*$/.test(value)
const within = (path, scope) => path === scope || path.startsWith(`${scope}.`)
const usage = () => ({ input_tokens: 0, output_tokens: 0, total_tokens: 0 })
function addUsage(total, next) {
  for (const key of Object.keys(total)) if (Number.isFinite(next?.[key]) && next[key] >= 0) total[key] += next[key]
}
function aborted(signal) { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError') }
function getNode(scene, path) {
  if (!validPath(path)) throw new GenerationError('The selected node path is invalid.', 'INVALID_INPUT')
  let node = scene
  for (const index of path.split('.').slice(1)) node = node?.children?.[Number(index)]
  return node
}
function putNode(scene, path, node) {
  if (path === '0') return clone(node)
  const result = clone(scene), indices = path.split('.').slice(1).map(Number)
  let parent = result
  for (const index of indices.slice(0, -1)) parent = parent.children[index]
  parent.children[indices.at(-1)] = clone(node)
  return result
}
function validateInput(input, dependencies) {
  let conversation
  try { conversation = validateConversation(input?.conversation) } catch (error) { throw new GenerationError(error.message, 'INVALID_INPUT') }
  const prompt = String(input?.prompt || '').trim()
  const effort = input?.effort || DEFAULT_RUN_MODE
  if (!['create', 'edit', 'node'].includes(input?.mode)) throw new GenerationError('Unknown generation mode.', 'INVALID_INPUT')
  if (!prompt || prompt.length > 12000) throw new GenerationError('Enter a prompt of 1–12000 characters.', 'INVALID_INPUT')
  if (!Object.hasOwn(RUN_MODES, effort)) throw new GenerationError('Choose one of the five supported reasoning efforts.', 'INVALID_EFFORT')
  if (!dependencies.apiKey?.trim()) throw new GenerationError('Enter an OpenAI API key in Key settings.', 'MISSING_KEY')
  if (input.mode !== 'create' || input.resume) {
    if (!input.scene || typeof input.scene !== 'object' || Array.isArray(input.scene)) throw new GenerationError('Load a scene before editing or continuing.', 'INVALID_INPUT')
    if (JSON.stringify(input.scene).length > 1500000) throw new GenerationError('This scene is too large for one edit. Select a smaller subtree.', 'INVALID_INPUT')
  }
  const scopePath = input.mode === 'node' ? input.path || '0' : '0'
  const node = input.scene && getNode(input.scene, scopePath)
  if (input.mode === 'node' && !node) throw new GenerationError('The selected node no longer exists.', 'STALE_SCENE')
  if (input.mode === 'node' && input.node && JSON.stringify(node) !== JSON.stringify(input.node)) throw new GenerationError('The selected node changed. Reopen its prompt and try again.', 'STALE_SCENE')
  aborted(dependencies.signal)
  return { prompt, effort, scopePath, conversation }
}
function validateSteps(steps, scene, scopePath) {
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_STEPS) throw new GenerationError('The part plan must contain 1–6 steps.', 'INVALID_PLAN')
  const accepted = []
  for (const step of steps) {
    if (!step || typeof step !== 'object' || !validPath(step.path) || !within(step.path, scopePath)) throw new GenerationError('The part plan targeted a node outside the selected scope.', 'INVALID_PLAN')
    const node = getNode(scene, step.path)
    if (!node) throw new GenerationError(`The planned part ${step.path} no longer exists.`, 'INVALID_PLAN')
    if (step.path === scopePath && node.children?.length) throw new GenerationError('A detailed plan must refine individual parts rather than replace the entire assembly.', 'INVALID_PLAN')
    if (accepted.some(other => within(step.path, other.path) || within(other.path, step.path))) throw new GenerationError('The part plan contains overlapping targets.', 'INVALID_PLAN')
    if (typeof step.title !== 'string' || !step.title.trim() || step.title.length > 100 || typeof step.instruction !== 'string' || !step.instruction.trim() || step.instruction.length > 900) throw new GenerationError('The part plan contains an invalid title or instruction.', 'INVALID_PLAN')
    accepted.push({ path: step.path, title: step.title.trim(), instruction: step.instruction.trim() })
  }
  return accepted
}
function validateConstraints(value) {
  if (!Array.isArray(value) || value.length > 6 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 160)) throw new GenerationError('The part plan contains invalid shared constraints.', 'INVALID_PLAN')
  return value.map(item => item.trim())
}
function validatePlanTitles(value) {
  if (!Array.isArray(value) || value.length > 7 || value.some(title => typeof title !== 'string' || !title.trim() || title.length > 100)) throw new GenerationError('The saved part titles are invalid.', 'INVALID_PLAN')
  return value.map(title => title.trim())
}
function sceneSynopsis(scene, scopePath) {
  const nodes = []
  const visit = (node, path, depth) => {
    if (!node || typeof node !== 'object' || depth > 32 || nodes.length >= 512) throw new GenerationError('This assembly exceeds the detailed planning budget.', 'INVALID_INPUT')
    const primitive = node.primitive && Object.fromEntries(Object.entries(node.primitive).filter(([key, value]) => key === 'type' || typeof value === 'number'))
    nodes.push({ path, name: String(node.name || '').slice(0, 160), editable: within(path, scopePath), type: node.operation || node.repeat?.type || node.primitive?.type || 'group',
      ...(node.transform ? { transform: node.transform } : {}), ...(primitive ? { primitive } : {}),
      ...(node.repeat ? { repeat: node.repeat } : {}), children: (node.children || []).map((_, i) => `${path}.${i}`) })
    for (let i = 0; i < (node.children || []).length; i++) visit(node.children[i], `${path}.${i}`, depth + 1)
  }
  visit(scene, '0', 0)
  return { selectedScope: scopePath, coordinates: 'Local TRS relative to parent; full paths start at 0. Preserve attachment locations and the selected part transform.',
    palette: summarizeScenePalette(scene, { scopePath }), nodes }
}
function primitiveCount(node) {
  return Number(Boolean(node?.primitive)) + (node?.children || []).reduce((count, child) => count + primitiveCount(child), 0)
}
function extractText(data) {
  if (data?.status === 'incomplete') throw new GenerationError('The part plan was incomplete. The scene was not changed by this plan.', 'INCOMPLETE', { reason: data.incomplete_details?.reason })
  if (data?.status && data.status !== 'completed') throw new GenerationError('The model did not complete its part plan.', 'PROVIDER_ERROR')
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text
  const texts = []
  for (const item of data?.output || []) for (const part of item.content || []) {
    if (part.type === 'refusal') throw new GenerationError(clean(part.refusal || 'The model could not make this plan.'), 'REFUSAL')
    if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text)
  }
  if (!texts.length) throw new GenerationError('The model returned no part plan.', 'EMPTY_RESPONSE')
  return texts.join('')
}
const planSchema = {
  type: 'json_schema', name: 'treellis_part_plan', strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['summary', 'steps', 'constraints'], properties: {
    summary: { type: 'string', maxLength: 500 },
    steps: { type: 'array', minItems: 1, maxItems: MAX_STEPS, items: { type: 'object', additionalProperties: false, required: ['path', 'title', 'instruction'], properties: {
      path: { type: 'string' }, title: { type: 'string', maxLength: 100 }, instruction: { type: 'string', maxLength: 900 },
    } } },
    constraints: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 160 } },
  } },
}
function assertResume(resume, input, scene, context) {
  const maximum = input.mode === 'create' ? 7 : 6
  if (!resume || resume.version !== 1 || !['parts', 'plan'].includes(resume.phase) || !/^[A-Za-z0-9-]{8,80}$/.test(resume.runId || '') || resume.mode !== input.mode || resume.scopePath !== context.scopePath || resume.effort !== context.effort || resume.originalPrompt !== context.prompt || !Number.isInteger(resume.completedSteps) || !Number.isInteger(resume.totalSteps) || resume.completedSteps < 0 || resume.totalSteps > maximum || resume.completedSteps > resume.totalSteps || resume.sceneRevision !== revision(scene)) throw new GenerationError('This plan no longer matches the scene or generation settings. Start a new generation.', 'STALE_PLAN')
  if (resume.conversationRevision ? resume.conversationRevision !== revision(context.conversation) : context.conversation.length) throw new GenerationError('The conversation changed. Start a new generation.', 'STALE_PLAN')
  const constraints = validateConstraints(resume.constraints || [])
  const plan = validatePlanTitles(resume.plan || resume.steps?.map(step => step.title) || [])
  if (resume.phase === 'plan') {
    if (input.mode !== 'create' || resume.completedSteps !== 1 || resume.totalSteps !== 1 || !Array.isArray(resume.steps) || resume.steps.length) throw new GenerationError('This partial creation plan is invalid.', 'INVALID_PLAN')
    if (resume.completedPartPaths !== undefined && (!Array.isArray(resume.completedPartPaths) || resume.completedPartPaths.length)) throw new GenerationError('A base-only resume cannot have completed part references.', 'INVALID_PLAN')
    return { ...clone(resume), constraints, plan, completedPartPaths: [] }
  }
  const steps = validateSteps(resume.steps, scene, context.scopePath)
  if (resume.totalSteps !== resume.completedSteps + steps.length) throw new GenerationError('The remaining part count is invalid.', 'INVALID_PLAN')
  let completedPartPaths
  try { completedPartPaths = validateCompletedPartPaths(resume.completedPartPaths, { scene, scopePath: context.scopePath, remainingPaths: steps.map(step => step.path), completedPartsCount: Math.max(0, resume.completedSteps - (input.mode === 'create' ? 1 : 0)) }) }
  catch (error) { throw new GenerationError(error.message, 'INVALID_PLAN') }
  return { ...clone(resume), steps, constraints, plan, completedPartPaths }
}

/** Both entry points use this router; a checkpoint is always a complete, checked edit scope. */
export async function runGenerationWorkflow(input, dependencies = {}) {
  validateInput(input, dependencies)
  const strategy = input?.strategy || 'single'
  if (!['single', 'staged'].includes(strategy)) throw new GenerationError('Choose a supported generation strategy.', 'INVALID_INPUT')
  if (strategy === 'single') {
    if (input.resume) throw new GenerationError('A part plan can only continue in step-by-step mode.', 'INVALID_INPUT')
    return (dependencies.runGeneration || runGeneration)(input, dependencies)
  }
  return runStagedGeneration(input, dependencies)
}

export async function runStagedGeneration(input, dependencies = {}) {
  const { prompt, effort, scopePath, conversation } = validateInput(input, dependencies)
  const { signal, onProgress = () => {}, onCheckpoint = async () => {} } = dependencies
  const generate = dependencies.runGeneration || runGeneration, planCall = dependencies.callModel || callModel
  const started = Date.now(), totalUsage = usage(), allChanges = []
  let working = input.scene ? clone(input.scene) : null, remaining = [], constraints = [], completedSteps = 0, totalSteps = 0
  let runId = randomUUID(), phase = 'plan', lastMeta = {}, currentResume = null, planningResponseId = null, titles = [], completedPartPaths = []
  const initialRevision = working ? revision(working) : null
  const taskProgress = () => ({ strategy: 'staged', phase, planReady: phase === 'parts', completedSteps, totalSteps, plan: [...titles] })
  const emit = (stage, message, extra = {}) => { aborted(signal); onProgress({ stage, message, ...extra, ...taskProgress() }) }
  const makeResume = () => ({ version: 1, runId, phase, steps: clone(remaining), constraints: [...constraints], plan: [...titles], completedSteps, totalSteps, scopePath, originalPrompt: prompt, conversationRevision: revision(conversation), effort, mode: input.mode, sceneRevision: revision(working), completedPartPaths: [...completedPartPaths], usage: { ...totalUsage } })
  const metaFor = (base, checkpointPhase, title = '', path = scopePath) => ({ ...base,
    prompt: { mode: 'full', text: prompt, len: prompt.length },
    model: { ...(base.model || {}), name: MODEL_ID, id: MODEL_ID, family: MODEL_FAMILY_LABEL, runMode: effort, reasoningEffort: effort },
    mode: input.mode === 'node' ? 'node_edit' : input.mode, useCurrent: input.mode !== 'create', hasContext: input.mode !== 'create',
    anchor: { scope: input.mode === 'node' ? 'node' : 'global', path: input.mode === 'node' ? scopePath : 'root', name: getNode(working, scopePath)?.name || '(root)', ...(getNode(working, scopePath)?.uid ? { uid: getNode(working, scopePath).uid } : {}) }, usage: { ...totalUsage },
    framework: { ...(base.framework || {}), strategy: 'staged', phase: checkpointPhase, planReady: phase === 'parts', runId, completedSteps, totalSteps, step: completedSteps, title, path,
      workflowPlan: [...titles], planningResponseId, baseRevision: initialRevision, durationMs: Date.now() - started },
  })
  const checkpoint = async (base, title, path, checkpointPhase = 'part') => {
    currentResume = completedSteps < totalSteps || phase === 'plan' ? makeResume() : null
    const meta = metaFor(base, checkpointPhase, title, path)
    await onCheckpoint({ result: clone(getNode(working, scopePath)), meta, step: completedSteps, title, path, resume: currentResume, ...taskProgress() })
    aborted(signal)
    return meta
  }
  try {
    if (input.resume) {
      const restored = assertResume(input.resume, input, working, { prompt, effort, scopePath, conversation })
      ;({ runId, phase, steps: remaining, constraints, completedSteps, totalSteps } = restored)
      addUsage(totalUsage, restored.usage)
      titles = restored.plan; completedPartPaths = restored.completedPartPaths
      currentResume = makeResume()
    } else if (input.mode === 'create') {
      titles = ['Base assembly']; totalSteps = 1
      emit('part', 'Building the base assembly…', { step: 1, totalSteps: 1, title: 'Base assembly' })
      const base = await generate({ ...input, prompt: `${prompt}\n\nSTAGED CREATION: Create a coherent coarse base assembly first. Preserve the requested identity, proportions and main parts, but use at most 18 primitive nodes and give major parts distinct named subtrees so they can be refined independently later. Do not attempt final tiny details in this first pass.` }, {
        ...dependencies, maxRepairs: Math.min(1, Math.max(0, dependencies.maxRepairs ?? 1)), onProgress: event => emit('part', `Base assembly · ${event.message || 'Generating…'}`, { ...event, stage: 'part', step: 1, totalSteps: 1, title: 'Base assembly', detailStage: event.stage }),
      })
      aborted(signal)
      if (!base?.result || primitiveCount(base.result) > 18) throw new GenerationError('The base assembly exceeded its 18-part budget. Your existing scene is unchanged; try a simpler base description.', 'VALIDATION_FAILED', { usage: base?.meta?.usage })
      working = clone(base.result); lastMeta = base.meta || {}; addUsage(totalUsage, base.meta?.usage)
      completedSteps = 1; totalSteps = 1; phase = 'plan'; titles = ['Base assembly']; allChanges.push(...(base.changes || []))
      await checkpoint(lastMeta, 'Base assembly', '0', 'base')
    }
    if (phase === 'plan') {
      emit('planning', 'Planning independently editable parts…', { step: completedSteps, totalSteps, ...(currentResume ? { resume: currentResume } : {}) })
      const synopsis = sceneSynopsis(working, scopePath)
      const allowedPaths = synopsis.nodes.filter(node => node.editable && (node.path !== scopePath || !node.children.length)).map(node => node.path)
      if (!allowedPaths.length) throw new GenerationError('This assembly has no independently editable parts.', 'INVALID_PLAN')
      const format = clone(planSchema)
      format.schema.properties.steps.items.properties.path.enum = allowedPaths
      format.schema.properties.steps.maxItems = Math.min(MAX_STEPS, allowedPaths.length)
      const body = { model: MODEL_ID, store: false, reasoning: { effort }, text: { format }, max_output_tokens: getGenerationLimits(effort).maxOutputTokens,
        input: [{ role: 'system', content: 'You plan a staged editable 3D assembly refinement in Treellis. Return only the required JSON. Write a brief user-facing task summary, never private reasoning. Select 1–6 independent existing part paths inside the selected scope. Never choose an entire selected assembly/root if it already has children. Select meaningful existing child subtrees instead. Paths must exist, must be unique, and must not overlap as ancestor/descendant. Leaf scope may target itself. Give each step a concise title in the user’s language and an actionable instruction describing visible requested improvements, attachment locations and overall proportions. Each instruction applies only to its subtree; existing outside parts cannot be replaced. Keep the original object identity unless the user explicitly requests conversion. Put cross-part dimensions, symmetry, proportions and interface preservation in at most six short shared constraints. Refining several unrelated components in parallel is deliberately avoided to preserve consistent interfaces. The synopsis includes read-only outside context; do not target it. This is a routing step only: do not solve final geometry, enumerate every parameter or write AML during planning. Leave exact geometry calculations to the individual part tasks. If a simple creation base already satisfies the requested final state, plan one concise verification step on an allowed existing part instead of inventing extra detail or unnecessary tasks. A verification task may finish with a checked no-op when objective checks confirm the requested state. Keep the plan concise and proportional to the request. The read-only palette contains actual scene colors and their source paths. When a part instruction needs an existing color or a material reference outside its subtree, give its explicit #RRGGBB from that palette so the part can execute without missing neighbor information. Never invent an existing dark material or leave an unresolved relative color reference. For unspecified minor cosmetic choices, use an available scene color or leave the configured default choice to the part task; do not turn such choices into a user clarification dependency.' },
          ...conversation, { role: 'user', content: `ORIGINAL_REQUEST (interpret as the latest answer/instruction in the preceding dialogue):\n${prompt}\n\nEDITABLE_SCOPE: ${scopePath}\nASSEMBLY_SYNOPSIS:\n${JSON.stringify(synopsis)}` }],
      }
      let plan
      for (let attempt = 0; attempt < 2; attempt++) {
        const data = await planCall(body, { ...dependencies, onProgress: event => emit('planning', event.message || 'Planning the parts…', { ...event, stage: 'planning', step: completedSteps, totalSteps }) })
        aborted(signal); addUsage(totalUsage, data.usage); planningResponseId = data.id || null
        let text = ''
        try {
          text = extractText(data)
          try { plan = JSON.parse(text) } catch { throw new GenerationError('The model returned an invalid part plan.', 'INVALID_PLAN') }
          if (!plan || typeof plan !== 'object' || Array.isArray(plan) || typeof plan.summary !== 'string' || plan.summary.length > 500) throw new GenerationError('The model returned an invalid part summary.', 'INVALID_PLAN')
          remaining = validateSteps(plan.steps, working, scopePath); constraints = validateConstraints(plan.constraints)
          break
        } catch (error) {
          if (error.code === 'INCOMPLETE' && error.reason === 'max_output_tokens' && !attempt) {
            body.max_output_tokens = Math.min(getGenerationLimits('max').maxOutputTokens, body.max_output_tokens * 2)
            emit('planning', 'The plan output budget was reached. Regenerating a compact part plan…', { step: completedSteps, totalSteps, outputBudget: body.max_output_tokens })
            body.input.push({ role: 'user', content: 'The previous part plan exhausted its output budget and was NOT applied. Return a compact complete JSON plan for the same request, effort, editable scope and allowed paths. Use 1–6 independent nonoverlapping steps, concise titles/instructions and short shared constraints. Preserve the requested object identity, detail and interfaces. Do not include commentary, private reasoning or a truncated response.' })
            continue
          }
          if (error.code !== 'INVALID_PLAN' || attempt) throw error
          emit('planning', 'Correcting the part plan before changing the scene…', { step: completedSteps, totalSteps })
          body.input.push({ role: 'assistant', content: text }, { role: 'user', content: `This plan was not applied. Correct only the planning error and return the full JSON plan. DIAGNOSTIC: ${clean(error.message)}\nAllowed existing part paths: ${allowedPaths.join(', ')}. Select unique, nonoverlapping subtrees. Do not select the entire assembly.` })
        }
      }
      totalSteps = completedSteps + remaining.length; phase = 'parts'; titles = [...titles, ...remaining.map(step => step.title)]; currentResume = makeResume()
      emit('planning', plan.summary || 'The part plan is ready.', { step: completedSteps, totalSteps, plan: [...titles], resume: currentResume })
    } else {
      emit('planning', 'Continuing the remaining parts…', { step: completedSteps, totalSteps, plan: [...titles], resume: currentResume })
    }
    while (remaining.length) {
      aborted(signal)
      const [step] = validateSteps(remaining, working, scopePath), number = completedSteps + 1
      emit('part', `Refining ${step.title}…`, { step: number, totalSteps, title: step.title, path: step.path })
      const stepPrompt = `ORIGINAL USER REQUEST:\n${prompt}\n\nCURRENT PART: ${step.title}\nPART TASK: ${step.instruction}\nSHARED ASSEMBLY CONSTRAINTS:\n${constraints.join('\n')}\n\nRefine only this selected subtree. You may add or replace its internal detail geometry when requested. Preserve the selected subtree root transform/attachment interface and the overall proportion unless this part task explicitly requires changing it. Keep all other scene nodes unchanged. Do not try to complete other planned parts. Acceptance checks must concern this current part or invariants that must hold now. Targets assigned to later parts are pending and must not be required to pass in this step.`
      const referenceRevision = revision(working)
      const originalContext = dependencies.buildEditContext || ((scene, path) => runGeometryTask({ type: 'context', scene, path }, signal))
      const partContext = async (scene, path) => {
        const context = await originalContext(scene, path)
        if (path !== step.path || revision(scene) !== referenceRevision) throw new GenerationError('The scene changed while preparing completed part references.', 'STALE_SCENE')
        return { ...context, completedPartsReferences: buildCompletedPartReferences(scene, { selectedPath: path, scopePath, completedPartPaths, completedPartsCount: Math.max(0, completedSteps - (input.mode === 'create' ? 1 : 0)), sceneRevision: referenceRevision }) }
      }
      const next = await generate({ mode: 'node', scene: working, node: clone(getNode(working, step.path)), path: step.path, prompt: stepPrompt, effort, conversation }, {
        ...dependencies, buildEditContext: partContext, maxRepairs: Math.min(1, Math.max(0, dependencies.maxRepairs ?? 1)),
        onProgress: event => emit('part', `${step.title} · ${event.message || 'Generating…'}`, { ...event, stage: 'part', detailStage: event.stage, step: number, totalSteps, title: step.title, path: step.path }),
      })
      aborted(signal)
      if (!next?.result || typeof next.result !== 'object' || Array.isArray(next.result)) throw new GenerationError('The part generator returned no checked subtree.', 'INVALID_RESULT')
      working = putNode(working, step.path, next.result); addUsage(totalUsage, next.meta?.usage); lastMeta = next.meta || {}
      allChanges.push(...(next.changes || []).map(change => `${step.path}: ${change}`))
      completedPartPaths.push(step.path)
      completedSteps++; remaining = remaining.slice(1)
      lastMeta = await checkpoint(lastMeta, step.title, step.path)
      emit('part_complete', `${step.title} is ready.`, { step: completedSteps, totalSteps, title: step.title, path: step.path, resume: currentResume })
    }
    const meta = metaFor(lastMeta, 'complete', 'Complete')
    emit('complete', 'All parts are ready.', { step: completedSteps, totalSteps, resume: null })
    return { result: clone(getNode(working, scopePath)), meta, action: 'replace', changes: allChanges }
  } catch (error) {
    if (error?.usage) addUsage(totalUsage, error.usage)
    if (!(error instanceof Error)) error = new GenerationError(clean(error))
    error.completedSteps = completedSteps; error.totalSteps = totalSteps; error.runId = runId
    error.resume = currentResume ? { ...currentResume, usage: { ...totalUsage } } : null
    error.usage = { ...totalUsage }
    if (completedSteps && working) error.partialResult = clone(getNode(working, scopePath))
    throw error
  }
}
