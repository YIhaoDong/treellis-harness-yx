import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedLabel, replaceScope, resumeIsCurrent, supportsStagedGeneration, taskProgress, updateProgress } from '../src/generation/progressState.mjs';

test('elapsed time uses actual minutes and seconds without wrapping at an hour', () => {
  assert.equal(elapsedLabel(207999), '03:27');
  assert.equal(elapsedLabel(3661000), '61:01');
  assert.equal(elapsedLabel(-40), '00:00');
  assert.equal(supportsStagedGeneration('max'), true);
  assert.equal(supportsStagedGeneration('xhigh'), true);
  assert.equal(supportsStagedGeneration('high'), false);
});

test('thinking/writing heartbeats retain the current part and public summary without invented progress', () => {
  let state = updateProgress({}, { stage: 'part', step: 2, totalSteps: 4, title: 'Engine', summary: 'Adding the engine intake.' });
  state = updateProgress(state, { stage: 'thinking', message: 'Model is thinking' });
  assert.equal(state.title, 'Engine');
  assert.equal(state.step, 2);
  assert.equal(state.summary, 'Adding the engine intake.');
  assert.equal(state.percent, undefined);
  state = updateProgress(state, { stage: 'writing', outputChars: 1500 });
  assert.equal(state.title, 'Engine');
  assert.equal(state.outputChars, 1500);
});

test('duplicate completion notifications do not duplicate the list of completed parts', () => {
  let state = updateProgress({}, { type: 'checkpoint', step: 1, totalSteps: 2, title: 'Wing' });
  state = updateProgress(state, { stage: 'part_complete', step: 1, title: 'Wing' });
  assert.equal(state.completed.length, 1);
  assert.equal(state.completedSteps, 1);
});

test('a full task list follows checked completion through Stop, Continue and final confirmation', () => {
  const plan = ['细化机翼', '细化发动机', '细化座舱'];
  let state = updateProgress({}, { strategy: 'staged', phase: 'parts', planReady: true,
    stage: 'planning', plan, completedSteps: 0, step: 0, totalSteps: 3 });
  const view = (busy = true) => taskProgress(state, { busy });
  assert.equal(view().completed, 0);
  assert.equal(view().total, 3);
  assert.equal(view().totalKnown, true);
  assert.deepEqual(view().tasks.map(task => task.title), plan);
  assert.deepEqual(view().tasks.map(task => task.status), ['pending', 'pending', 'pending']);
  state = updateProgress(state, { stage: 'part', step: 1, title: plan[0] });
  state = updateProgress(state, { stage: 'writing', outputChars: 1000 });
  assert.equal(view().completed, 0); // Receiving JSON is not a checked checkpoint.
  assert.equal(view().tasks[0].status, 'active');
  state = updateProgress(state, { type: 'checkpoint', step: 1, title: plan[0], completedSteps: 1 });
  state = updateProgress(state, { stage: 'part_complete', step: 1, title: plan[0] });
  assert.equal(view().completed, 1);
  assert.equal(state.completed.length, 1);
  state = updateProgress(state, { stage: 'part', step: 2, title: plan[1] });
  assert.deepEqual(view().tasks.map(task => task.status), ['completed', 'active', 'pending']);
  state = updateProgress(state, { stage: 'stopped' });
  assert.deepEqual(view(false).tasks.map(task => task.status), ['completed', 'paused', 'pending']);
  assert.equal(view(false).completed, 1);
  assert.deepEqual(view(false).tasks.map(task => task.title), plan);
  state = updateProgress(state, { stage: 'preparing', step: 0 });
  assert.deepEqual(view().tasks.map(task => task.status), ['completed', 'pending', 'pending']);
  state = updateProgress(state, { stage: 'part', step: 2, title: plan[1] });
  state = updateProgress(state, { stage: 'checking' });
  assert.equal(view().completed, 1);
  assert.equal(view().tasks[1].status, 'active');
  state = updateProgress(state, { type: 'checkpoint', step: 2, title: plan[1] });
  state = updateProgress(state, { type: 'checkpoint', step: 2, title: plan[1] });
  assert.equal(view().completed, 2);
  assert.equal(state.completed.length, 2);
  state = updateProgress(state, { stage: 'part', step: 3, title: plan[2] });
  state = updateProgress(state, { type: 'checkpoint', step: 3, title: plan[2] });
  state = updateProgress(state, { stage: 'complete', completedSteps: 3 });
  assert.equal(view(false).completed, 3);
  assert.deepEqual(view(false).tasks.map(task => task.status), ['completed', 'completed', 'completed']);
});

test('new scene skeletons never imply the entire unknown task plan is finished', () => {
  let state = updateProgress({}, { strategy: 'staged', stage: 'planning', phase: 'plan',
    planReady: false, plan: [], completedSteps: 0, step: 0, totalSteps: 0 });
  assert.deepEqual(taskProgress(state, { busy: true }), { completed: 0, total: 0, totalKnown: false, tasks: [] });
  state = updateProgress(state, { stage: 'part', step: 1, totalSteps: 1, title: 'Base assembly', plan: ['Base assembly'] });
  assert.equal(taskProgress(state, { busy: true }).tasks[0].status, 'active');
  assert.equal(taskProgress(state, { busy: true }).totalKnown, false);
  state = updateProgress(state, { type: 'checkpoint', step: 1, title: 'Base assembly', completedSteps: 1 });
  state = updateProgress(state, { stage: 'planning' });
  assert.equal(taskProgress(state, { busy: true }).completed, 1);
  assert.equal(taskProgress(state, { busy: true }).totalKnown, false);
  state = updateProgress(state, { stage: 'planning', phase: 'parts', planReady: true,
    plan: ['Base assembly', 'Wing detail', 'Engine detail'], totalSteps: 3, completedSteps: 1 });
  assert.equal(taskProgress(state, { busy: true }).totalKnown, true);
  assert.deepEqual(taskProgress(state, { busy: true }).tasks.map(task => task.status), ['completed', 'pending', 'pending']);
});

test('checkpoint and continuation metadata recover full task names and confirmed counts', () => {
  let state = updateProgress({}, { type: 'checkpoint', meta: { framework: {
    strategy: 'staged', phase: 'part', step: 1, completedSteps: 1, totalSteps: 3,
    title: 'Wing', workflowPlan: ['Wing', 'Engine', 'Tail'],
  } } });
  assert.equal(state.phase, 'parts');
  assert.equal(state.planReady, true);
  assert.equal(state.completedSteps, 1);
  assert.equal(state.completed[0].title, 'Wing');
  assert.deepEqual(taskProgress(state).tasks.map(task => task.title), ['Wing', 'Engine', 'Tail']);
  state = updateProgress({}, { stage: 'planning', resume: {
    phase: 'parts', completedSteps: 1, totalSteps: 3, plan: ['Wing', 'Engine', 'Tail'],
  } });
  assert.equal(taskProgress(state, { busy: true }).completed, 1);
  assert.equal(taskProgress(state, { busy: true }).totalKnown, true);
  assert.deepEqual(taskProgress(state, { busy: true }).tasks.map(task => task.status), ['completed', 'pending', 'pending']);
  const skeleton = updateProgress({}, { type: 'checkpoint', meta: { framework: {
    strategy: 'staged', phase: 'base', step: 1, completedSteps: 1, totalSteps: 1, workflowPlan: ['Base assembly'],
  } }, resume: { phase: 'plan', plan: ['Base assembly'], completedSteps: 1, totalSteps: 1 } });
  assert.equal(taskProgress(skeleton).totalKnown, false);
});

test('only an unfinished current task is active, paused or failed', () => {
  const state = { strategy: 'staged', planReady: true, plan: ['Wing', 'Engine'], totalSteps: 2, completedSteps: 1 };
  for (const stage of ['part', 'thinking', 'writing', 'checking', 'repairing']) {
    assert.equal(taskProgress({ ...state, stage, step: 1 }, { busy: true }).tasks[0].status, 'completed');
    assert.equal(taskProgress({ ...state, stage, step: 2 }, { busy: true }).tasks[1].status, 'active');
  }
  assert.equal(taskProgress({ ...state, stage: 'failed', step: 2 }).tasks[1].status, 'failed');
  assert.equal(taskProgress({ ...state, stage: 'stopped', step: 2 }).tasks[1].status, 'paused');
  assert.equal(taskProgress({ ...state, stage: 'preparing', step: 0 }, { busy: true }).tasks[1].status, 'pending');
  assert.equal(taskProgress({ ...state, stage: 'complete', step: 1 }).tasks[0].status, 'completed');
});

test('completed records can recover checked progress without a counter and single-pass progress stays task-free', () => {
  const view = taskProgress({ plan: ['Wing', 'Engine'], planReady: true,
    completed: [{ step: 1, title: 'Wing' }], step: 2, stage: 'part' }, { busy: true });
  assert.equal(view.completed, 1);
  assert.deepEqual(view.tasks.map(task => task.status), ['completed', 'active']);
  const single = updateProgress({}, { stage: 'thinking', message: 'Working', summary: 'Considering dimensions.' });
  assert.deepEqual(taskProgress(single, { busy: true }), { completed: 0, total: 0, totalKnown: false, tasks: [] });
});

test('a new part or generation phase clears the preceding summary, while same-part progress retains it', () => {
  let state = updateProgress({}, { stage: 'part', step: 1, title: 'Wing', summary: 'Adding wing details.' });
  state = updateProgress(state, { stage: 'part', step: 1, title: 'Wing', message: 'Model is thinking' });
  assert.equal(state.summary, 'Adding wing details.');
  state = updateProgress(state, { stage: 'part', step: 2, title: 'Engine' });
  assert.equal(state.summary, '');
  state = updateProgress(state, { stage: 'part', step: 2, title: 'Engine', summary: 'Building the engine intake.' });
  state = updateProgress(state, { stage: 'part', step: 2, title: 'Engine', outputChars: 80 });
  assert.equal(state.summary, 'Building the engine intake.');
  state = updateProgress(state, { stage: 'planning' });
  assert.equal(state.summary, '');
  state = updateProgress(state, { stage: 'planning', summary: 'Plan details.' });
  state = updateProgress(state, { stage: 'planning', message: 'Planning continues' });
  assert.equal(state.summary, 'Plan details.');
  state = updateProgress(state, { stage: 'generating' });
  assert.equal(state.summary, '');
});

test('node checkpoints replace the entire original selected scope and retain everything outside it', () => {
  const scene = { name: 'Aircraft', children: [{ name: 'Wing', children: [{ name: 'tip' }] }, { name: 'Engine', uid: 'e' }] };
  const updated = replaceScope(scene, '0.0', { name: 'Wing', children: [{ name: 'detailed tip' }] });
  assert.deepEqual(updated.children[1], scene.children[1]);
  assert.equal(scene.children[0].children[0].name, 'tip');
  assert.equal(updated.children[0].children[0].name, 'detailed tip');
  assert.throws(() => replaceScope(scene, '0.7', { name: 'bad' }), /no longer exists/);
});

test('continuation is bound to current scene, request text/settings, and the original selection', () => {
  const scene = { name: 'Plane', children: [{ name: 'Wing' }] };
  const ticket = { resume: { completedSteps: 1 }, identity: 'same prompt and effort', path: '0.0', revision: JSON.stringify(scene) };
  const current = { identity: ticket.identity, scene, path: '0.0' };
  assert.equal(resumeIsCurrent(ticket, current), true);
  assert.equal(resumeIsCurrent(ticket, { ...current, identity: 'different prompt' }), false);
  assert.equal(resumeIsCurrent(ticket, { ...current, path: '0.1' }), false);
  assert.equal(resumeIsCurrent(ticket, { ...current, scene: { ...scene, name: 'User edit' } }), false);
});
