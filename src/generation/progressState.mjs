export const supportsStagedGeneration = (effort) => effort === 'xhigh' || effort === 'max';

export function elapsedLabel(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function stageLabel(stage, attempt = 1) {
  return ({ preparing: 'Preparing', planning: 'Planning', generating: 'Generating',
    part: 'Refining', part_complete: 'Part complete', thinking: 'Thinking', writing: 'Writing',
    checking: 'Checking', recovering: 'Reconnecting', retrying: 'Retrying', provider: 'Thinking',
    complete: 'Complete', stopped: 'Stopped', failed: 'Needs attention', clarification: 'Waiting for your answer',
    repairing: `Repairing (${Math.max(1, attempt - 1)}/2)` })[stage] || 'Working';
}

export function updateProgress(previous, event) {
  const next = { ...previous };
  const framework = event.meta?.framework || {};
  const resume = event.resume || {};
  const value = (key) => event[key] ?? framework[key] ?? resume[key];
  if (['part', 'planning', 'generating'].includes(event.stage)) next.outputChars = 0;
  const newPart = event.stage === 'part' &&
    ((event.step !== undefined && event.step !== previous.step) ||
      (typeof event.title === 'string' && event.title.trim() && event.title !== previous.title));
  const newGenerationPhase = ['planning', 'generating'].includes(event.stage) && event.stage !== previous.stage;
  if (newPart || newGenerationPhase) next.summary = '';
  for (const key of ['stage', 'message', 'step', 'totalSteps', 'attempt', 'outputChars', 'strategy', 'phase', 'planReady']) {
    if (value(key) !== undefined) next[key] = value(key);
  }
  // Older checkpoint metadata uses base/part/complete rather than the workflow phase.
  if (event.phase === undefined && framework.phase && resume.phase) next.phase = resume.phase;
  if (next.phase === 'base') next.phase = 'plan';
  if (next.phase === 'part' || next.phase === 'complete') next.phase = 'parts';
  if (value('planReady') === undefined && ['plan', 'parts'].includes(next.phase)) next.planReady = next.phase === 'parts';
  if (typeof event.title === 'string' && event.title.trim()) next.title = event.title;
  if (typeof event.summary === 'string' && event.summary.trim()) next.summary = event.summary;
  const plan = [event.plan, framework.workflowPlan, resume.plan].find(Array.isArray);
  if (plan) next.plan = plan.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
  const step = taskCount(value('step'));
  if ((event.stage === 'part_complete' || event.type === 'checkpoint') && step > 0) {
    const completed = [...(previous.completed || [])];
    const existing = completed.findIndex(item => item.step === step);
    const item = { step, title: event.title || framework.title || next.plan?.[step - 1] || `Part ${step}` };
    if (existing < 0) completed.push(item); else completed[existing] = item;
    next.completed = completed.sort((a, b) => a.step - b.step);
    next.completedSteps = Math.max(taskCount(previous.completedSteps), step);
  }
  if (value('completedSteps') !== undefined) next.completedSteps = Math.max(taskCount(next.completedSteps), taskCount(value('completedSteps')));
  return next;
}

const taskCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function taskProgress(progress = {}, { busy = false } = {}) {
  const state = progress || {};
  const plan = Array.isArray(state.plan) ? state.plan.filter(title => typeof title === 'string' && title.trim()) : [];
  const records = new Map((state.completed || []).filter(item => taskCount(item?.step) > 0).map(item => [item.step, item.title]));
  const completed = Math.max(taskCount(state.completedSteps), 0, ...records.keys());
  const step = taskCount(state.step);
  const total = Math.max(taskCount(state.totalSteps), plan.length, completed, step);
  // A new scene first builds its skeleton; more tasks are still unknown at that point.
  const totalKnown = state.planReady === true && total > 0;
  const working = ['part', 'thinking', 'writing', 'checking', 'repairing', 'recovering', 'retrying', 'provider'].includes(state.stage);
  const tasks = Array.from({ length: total }, (_, index) => {
    const number = index + 1;
    let status = number <= completed ? 'completed' : 'pending';
    if (number === step && number > completed) {
      if (busy && working) status = 'active';
      else if (!busy && state.stage === 'stopped') status = 'paused';
      else if (!busy && state.stage === 'failed') status = 'failed';
    }
    const title = plan[index] || records.get(number) || (number === step && state.title) || `Task ${number}`;
    return { step: number, title, status };
  });
  return { completed, total, totalKnown, tasks };
}

export function replaceScope(scene, path, replacement) {
  if (!path || path === '0') return replacement;
  if (!/^0(?:\.\d+)+$/.test(path)) throw new Error('The selected node path is invalid.');
  const root = structuredClone(scene);
  const parts = path.split('.').slice(1).map(Number);
  let parent = root;
  for (const index of parts.slice(0, -1)) {
    parent = parent?.children?.[index];
    if (!parent) throw new Error('The selected node no longer exists.');
  }
  const index = parts.at(-1);
  if (!parent?.children?.[index]) throw new Error('The selected node no longer exists.');
  parent.children[index] = replacement;
  return root;
}

export function scopeAt(scene, path) {
  let node = scene;
  for (const index of String(path || '0').split('.').slice(1).map(Number)) node = node?.children?.[index];
  return node;
}

// The revision belongs to the complete scene, even when a node is being edited.
export function resumeIsCurrent(ticket, { identity, scene, path = null }) {
  return !!ticket?.resume && ticket.identity === identity && ticket.path === path &&
    ticket.revision === JSON.stringify(scene);
}
