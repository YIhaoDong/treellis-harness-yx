/** Renderer-compatible AML contract shared by the browser and generation server. */
import { validateSuggestions } from './followups.mjs';
export const FRAMEWORK_VERSION = 'treellis-reasoning-v2';

const PRIMITIVES = { cube: ['w', 'h', 'd'], sphere: ['r'], cylinder: ['r', 'h'], torus: ['r', 't'], cone: ['r', 'h'] };
const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);
const NODE_KEYS = ['name', 'transform', 'primitive', 'operation', 'repeat', 'children'];
const REPEAT_KEYS = ['type', 'count', 't', 'r', 's', 'radius'];
const SEGMENT_KEYS = ['widthSegments', 'heightSegments', 'radialSegments', 'tubularSegments'];
// These legacy fields affect rendering and must never follow a changed node kind.
const LEGACY_KIND_KEYS = new Set(['kind', 'nodeKind', 'repeatType', 'repeatMode']);
const number = { type: 'number' };
// Mirror existing runtime rejection rules early; no new geometric lower bound.
const positiveDimension = { type: 'number', exclusiveMinimum: 0 };
const checkPath = { type: 'string', pattern: '^0(?:\\.(?:0|[1-9]\\d*))*$' };
const vector = { type: 'array', items: number, minItems: 3, maxItems: 3 };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const materialSchema = object({ color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } });
export const OBJECTIVE_CHECK_KINDS = ['count', 'extent', 'relative_extent', 'align', 'axis_direction', 'axis_parallel', 'axis_distance'];
// Angular alignment is measured as 1-abs(dot), not degrees. Reject loose
// values that could make a perpendicular or clearly tilted axis pass.
export const MAX_AXIS_DOT_TOLERANCE = 0.01;
export function hasAxisParallelCheck(checks, distance) {
  return checks.some(check => check?.kind === 'axis_parallel' && check.comparison === 'eq' && check.value === 1 &&
    Number.isFinite(check.tolerance) && check.tolerance >= 0 && check.tolerance <= MAX_AXIS_DOT_TOLERANCE &&
    (check.path === distance.path && check.otherPath === distance.otherPath || check.path === distance.otherPath && check.otherPath === distance.path));
}

function makeNodeSchema(kind) {
  const fields = {
    name: { type: 'string' }, transform: nullable({ $ref: '#/$defs/transform' }), primitive: { type: 'null' },
    operation: { type: 'null' }, repeat: { type: 'null' }, children: { type: 'null' },
  };
  if (PRIMITIVES[kind]) {
    fields.primitive = object({ type: { type: 'string', enum: [kind] }, ...Object.fromEntries(PRIMITIVES[kind].map(k => [k, positiveDimension])), material: nullable({ $ref: '#/$defs/material' }) });
  } else if (kind === 'operation') {
    fields.operation = { type: 'string', enum: ['union', 'subtract', 'intersection'] };
    fields.children = { type: 'array', items: { $ref: '#/$defs/node' }, minItems: 1, maxItems: 128 };
  } else {
    fields.repeat = object({ type: { type: 'string', enum: ['linear', 'circular'] }, count: { type: 'integer', minimum: 1, maximum: 64 }, t: { $ref: '#/$defs/vector' }, r: { $ref: '#/$defs/vector' }, s: { $ref: '#/$defs/vector' }, radius: nullable(number) });
    fields.children = { type: 'array', items: { $ref: '#/$defs/node' }, minItems: 1, maxItems: 128 };
  }
  return object(fields);
}

/** Shape accepted by Responses API text.format (Chat Completions wraps json_schema). */
export function createResponseFormat(mode = 'create', { allowStructure = true } = {}) {
  if (!['create', 'edit', 'node'].includes(mode)) throw new Error(`Unknown generation mode: ${mode}`);
  // This is the host's existing permission gate, not a second intent classifier.
  const patchOnly = mode !== 'create' && !allowStructure;
  const variants = [...Object.keys(PRIMITIVES), 'operation', 'repeat'];
  const defs = {
    vector,
    transform: object({ t: { $ref: '#/$defs/vector' }, r: { $ref: '#/$defs/vector' }, s: { $ref: '#/$defs/vector' } }),
    material: materialSchema,
    ...Object.fromEntries(variants.map(kind => [kind, makeNodeSchema(kind)])),
  };
  defs.node = { anyOf: variants.map(kind => ({ $ref: `#/$defs/${kind}` })) };
  const schema = object({
    action: { type: 'string', enum: mode === 'create' ? ['replace', 'clarify'] : patchOnly ? ['patch', 'clarify'] : ['patch', 'replace', 'clarify'] },
    replacement: patchOnly ? { type: 'null' } : nullable({ $ref: '#/$defs/node' }),
    patches: { type: 'array', maxItems: 128, items: object({ path: { type: 'string' }, value: { anyOf: [number, { type: 'string' }, vector] } }) },
    message: { type: 'string' },
    suggestions: { type: 'array', maxItems: 3, items: object({
      label: { type: 'string' }, instruction: { type: 'string' }, path: { type: 'string' },
    }) },
    plan: { type: 'array', maxItems: 12, items: { type: 'string' } },
    checks: { type: 'array', maxItems: 24, items: object({
      kind: { type: 'string', enum: OBJECTIVE_CHECK_KINDS },
      path: checkPath, otherPath: { anyOf: [{ type: 'string', enum: [''] }, checkPath] }, axis: { type: 'string', enum: ['x', 'y', 'z'] },
      comparison: { type: 'string', enum: ['eq', 'lt', 'le', 'gt', 'ge'] }, value: number, tolerance: number,
    }) },
  });
  if (!patchOnly) schema.$defs = defs;
  return { type: 'json_schema', name: 'treellis_generation', strict: true, schema };
}

const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = x => JSON.parse(JSON.stringify(x));
const isVec = x => Array.isArray(x) && x.length === 3 && x.every(finite);
const own = (x, k) => Object.prototype.hasOwnProperty.call(x || {}, k);

function nodeKind(node) {
  if (node?.repeat) return `repeat:${node.repeat.type || node.repeat.mode || 'linear'}`;
  if (node?.primitive) return `primitive:${node.primitive.type}`;
  return `operation:${node?.operation || 'union'}`;
}
const namedKind = node => typeof node?.name === 'string' && node.name.length ? `${node.name}\u0000${nodeKind(node)}` : null;
function uniqueNamedMatches(children) {
  const matches = new Map();
  for (const child of children || []) {
    const key = namedKind(child);
    if (key) matches.set(key, matches.has(key) ? null : child);
  }
  return matches;
}

/** Retain host-owned fields only for unambiguously corresponding sibling nodes. */
function reconcileReplacement(root, baseline, selectedRoot = true) {
  if (!isObject(root) || !isObject(baseline)) return root;
  const sameKind = nodeKind(root) === nodeKind(baseline);
  if (selectedRoot || sameKind) {
    for (const k of Object.keys(baseline)) {
      if (!NODE_KEYS.includes(k) && (sameKind || !LEGACY_KIND_KEYS.has(k))) root[k] = clone(baseline[k]);
    }
    if (sameKind && root.primitive && baseline.primitive) {
      const generatedKeys = ['type', ...PRIMITIVES[root.primitive.type], 'material'];
      for (const k of Object.keys(baseline.primitive)) if (!generatedKeys.includes(k)) root.primitive[k] = clone(baseline.primitive[k]);
      if (isObject(baseline.primitive.material)) {
        root.primitive.material = { ...clone(baseline.primitive.material), ...(root.primitive.material || {}) };
      }
    }
    if (sameKind && isObject(baseline.transform)) {
      for (const k of Object.keys(baseline.transform)) if (!['t', 'r', 's'].includes(k)) {
        root.transform ||= {};
        root.transform[k] = clone(baseline.transform[k]);
      }
    }
    if (sameKind && isObject(root.repeat) && isObject(baseline.repeat)) {
      for (const k of Object.keys(baseline.repeat)) if (!REPEAT_KEYS.includes(k)) root.repeat[k] = k === 'n' ? root.repeat.count : clone(baseline.repeat[k]);
    }
  }
  // A changed parent kind changes its content semantics: descendants get fresh identities.
  if (!sameKind || !Array.isArray(root.children) || !Array.isArray(baseline.children)) return root;
  const oldMatches = uniqueNamedMatches(baseline.children), newMatches = uniqueNamedMatches(root.children);
  for (const child of root.children) {
    const key = namedKind(child), oldChild = key && oldMatches.get(key);
    if (oldChild && newMatches.get(key) === child) reconcileReplacement(child, oldChild, false);
  }
  return root;
}

function baselineChild(child, index, siblings, oldSiblings, allowPositionalMatch) {
  if (!Array.isArray(oldSiblings)) return null;
  // Reconciled identities take precedence over array position after insertion/reordering.
  for (const key of ['uid', '_uid']) if (child?.[key] != null) {
    const matches = oldSiblings.filter(old => old?.[key] === child[key]);
    const candidates = siblings.filter(item => item?.[key] === child[key]);
    if (matches.length === 1 && candidates.length === 1 && nodeKind(child) === nodeKind(matches[0])) return matches[0];
  }
  const name = namedKind(child), oldMatches = uniqueNamedMatches(oldSiblings), newMatches = uniqueNamedMatches(siblings);
  if (name && oldMatches.get(name) && newMatches.get(name) === child) return oldMatches.get(name);
  // Value-only patches may rename an unidentified legacy node. Its position stays fixed.
  return allowPositionalMatch && nodeKind(child) === nodeKind(oldSiblings[index]) ? oldSiblings[index] : null;
}

function safeData(value, path = '', seen = new WeakSet(), depth = 0) {
  if (depth > 100) throw new Error(`${path || '/'}: JSON nesting is too deep.`);
  if (typeof value === 'number' && !finite(value)) throw new Error(`${path || '/'}: numbers must be finite.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return;
  if (typeof value !== 'object') throw new Error(`${path || '/'}: expected JSON data.`);
  if (seen.has(value)) throw new Error(`${path || '/'}: cyclic or shared references are not JSON.`);
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (BLOCKED.has(key)) throw new Error(`${path}/${key}: forbidden property.`);
    safeData(value[key], `${path}/${key}`, seen, depth + 1);
  }
  seen.delete(value);
}

/** Null placeholders are transport details; do not leave null transform/children in AML. */
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, normalize(v)]));
}

/** Validate AML without mutating it. Existing metadata is accepted only if preserved. */
export function validateAML(root, { baseline = null, maxNodes = 512, maxInstances = 2048, allowPositionalMatch = false, selectedReplacementPath = null } = {}) {
  const errors = [], warnings = [];
  const stats = { nodes: 0, primitives: 0, instances: 0, depth: 0 };
  try { safeData(root); } catch (e) { return { ok: false, errors: [e.message], warnings, stats }; }
  const report = (path, msg) => { if (errors.length < 64) errors.push(`${path}: ${msg}`); };
  let selectedBaseline = null, selectedFound = false;
  if (selectedReplacementPath !== null) {
    if (typeof selectedReplacementPath !== 'string' || !/^0(?:\.(?:0|[1-9]\d*))*$/.test(selectedReplacementPath)) {
      return { ok: false, errors: ['0: selected replacement path is invalid'], warnings, stats };
    }
    selectedBaseline = baseline;
    for (const index of selectedReplacementPath.split('.').slice(1)) selectedBaseline = selectedBaseline?.children?.[Number(index)];
    if (!isObject(selectedBaseline)) return { ok: false, errors: ['0: selected replacement path has no baseline node'], warnings, stats };
  }
  function keys(value, allowed, old, path) {
    for (const k of Object.keys(value)) {
      if (!allowed.includes(k) && (!own(old, k) || !equal(value[k], old[k]))) report(`${path}/${k}`, 'unsupported or changed metadata field');
    }
  }
  function trs(value, old, path, allowedKeys = ['t', 'r', 's']) {
    if (value == null) return;
    if (!isObject(value)) { report(path, 'expected transform object'); return; }
    keys(value, allowedKeys, old, path);
    for (const k of ['t', 'r', 's']) {
      if (value[k] != null && !isVec(value[k])) report(`${path}/${k}`, 'expected three finite numbers');
      if (k === 's' && Array.isArray(value[k]) && value[k].some(v => !finite(v) || v <= 0)) report(`${path}/s`, 'scale components must be positive');
    }
  }
  function walk(node, old, path, depth, multiplier, scopePath = '0') {
    // The host supplies this exact path only after replacing the selected node.
    // Its identity survives a kind change; siblings still use normal matching.
    if (scopePath === selectedReplacementPath) { old = selectedBaseline; selectedFound = true; }
    if (stats.nodes > maxNodes) return;
    stats.nodes++;
    stats.depth = Math.max(stats.depth, depth);
    if (stats.nodes > maxNodes) { report(path, `node budget exceeded (${maxNodes})`); return; }
    if (depth > 32) { report(path, 'maximum node depth is 32'); return; }
    if (!isObject(node)) { report(path, 'expected AML node object'); return; }
    keys(node, NODE_KEYS, old, path);
    const sameKind = !old || nodeKind(node) === nodeKind(old);
    if (!sameKind) for (const key of LEGACY_KIND_KEYS) if (own(node, key)) report(`${path}/${key}`, 'stale render-kind metadata cannot follow a changed node kind');
    if (own(node, 'name') && (typeof node.name !== 'string' || !node.name.trim() || node.name.length > 160)) report(`${path}/name`, 'name must be a nonempty string of at most 160 characters');
    trs(node.transform, sameKind ? old?.transform : null, `${path}/transform`);
    const kinds = ['primitive', 'operation', 'repeat'].filter(k => node[k] != null);
    if (kinds.length !== 1) { report(path, 'use exactly one of primitive, operation or repeat'); return; }
    let childMultiplier = multiplier;
    const children = node.children;
    if (children != null && !Array.isArray(children)) report(`${path}/children`, 'children must be an array');
    if (Array.isArray(children) && children.length > 128) report(`${path}/children`, 'at most 128 children per node');
    if (node.primitive != null) {
      const p = node.primitive;
      if (!isObject(p) || !own(PRIMITIVES, p.type)) { report(`${path}/primitive`, 'unsupported primitive type'); return; }
      keys(p, ['type', ...PRIMITIVES[p.type], 'material'], sameKind ? old?.primitive : null, `${path}/primitive`);
      for (const k of PRIMITIVES[p.type]) if (!finite(p[k]) || p[k] <= 0) report(`${path}/primitive/${k}`, 'dimension must be a positive finite number');
      if (p.material != null) {
        if (!isObject(p.material)) report(`${path}/primitive/material`, 'expected material object');
        else {
          keys(p.material, ['color'], sameKind ? old?.primitive?.material : null, `${path}/primitive/material`);
          if (!/^#[0-9a-fA-F]{6}$/.test(p.material.color || '')) report(`${path}/primitive/material/color`, 'expected #RRGGBB color');
        }
      }
      // Legacy segment settings survive patches, but cannot be invented or changed.
      for (const k of SEGMENT_KEYS) if (own(p, k) && (!Number.isInteger(p[k]) || p[k] < 2 || p[k] > 256)) report(`${path}/primitive/${k}`, 'segment count must be an integer between 2 and 256');
      if (Array.isArray(children) && children.length) report(path, 'primitive leaves cannot have children');
      stats.primitives++;
      stats.instances += multiplier;
    } else if (node.operation != null) {
      if (!['union', 'subtract', 'intersection', 'difference', 'intersect'].includes(node.operation)) report(`${path}/operation`, 'unsupported Boolean operation');
      const required = ['subtract', 'intersection', 'difference', 'intersect'].includes(node.operation) ? 2 : 1;
      if (!Array.isArray(children) || children.length < required) report(`${path}/children`, `operation requires at least ${required} operand(s)`);
    } else {
      const rep = node.repeat;
      if (!isObject(rep)) { report(`${path}/repeat`, 'expected repeat object'); return; }
      const oldRepeat = sameKind ? old?.repeat : null;
      const allowedRepeatKeys = [...REPEAT_KEYS, ...(own(oldRepeat, 'n') ? ['n'] : [])];
      keys(rep, allowedRepeatKeys, oldRepeat, `${path}/repeat`);
      if (!['linear', 'circular'].includes(rep.type)) report(`${path}/repeat/type`, 'repeat type must be linear or circular');
      const count = rep.count ?? rep.n;
      if (!Number.isInteger(count) || count < 1 || count > 64) report(`${path}/repeat/count`, 'repeat count must be an integer from 1 to 64');
      trs(rep, oldRepeat, `${path}/repeat`, allowedRepeatKeys);
      if (own(rep, 'n') && rep.n !== count) report(`${path}/repeat/n`, 'legacy count must agree with count');
      // trs checks vectors; repeat-specific keys are validated above instead.
      if (rep.type === 'circular' && (!finite(rep.radius) || rep.radius <= 0)) report(`${path}/repeat/radius`, 'circular repeat radius must be positive');
      if (rep.type === 'linear' && rep.radius != null) report(`${path}/repeat/radius`, 'radius is only supported for circular repeat');
      if (!Array.isArray(children) || !children.length) report(`${path}/children`, 'repeat requires a template child');
      childMultiplier = multiplier * (Number.isInteger(count) && count > 0 ? count : 1);
    }
    if (childMultiplier > maxInstances || stats.instances > maxInstances) report(path, `expanded instance budget exceeded (${maxInstances})`);
    if (Array.isArray(children)) children.forEach((child, i) => walk(child, baselineChild(child, i, children, sameKind ? old?.children : null, allowPositionalMatch || root === baseline), `${path}/children/${i}`, depth + 1, childMultiplier, `${scopePath}.${i}`));
  }
  walk(root, baseline, '0', 1, 1);
  if (selectedReplacementPath !== null && !selectedFound) report('0', 'selected replacement path is outside the generated scene');
  if (stats.instances > maxInstances) report('0', `expanded instance budget exceeded (${maxInstances})`);
  if (!stats.primitives && !errors.length) report('0', 'scene has no renderable primitive');
  return { ok: errors.length === 0, errors, warnings, stats };
}

function pointerParts(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || pointer.length > 1024) throw new Error('Patch path must be a relative JSON pointer beginning with /.');
  const pieces = pointer.slice(1).split('/');
  if (pieces.some(p => /~(?![01])/u.test(p))) throw new Error('Invalid JSON pointer escaping.');
  const parts = pieces.map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.some(p => BLOCKED.has(p))) throw new Error('Patch contains a forbidden property.');
  return parts;
}

function applyPatch(root, patch) {
  if (!isObject(patch) || Object.keys(patch).some(k => !['path', 'value'].includes(k)) || !own(patch, 'value')) throw new Error('Each patch requires exactly path and value.');
  const parts = pointerParts(patch.path);
  let target = root;
  let offset = 0;
  while (parts[offset] === 'children') {
    const index = parts[offset + 1];
    if (!/^(0|[1-9]\d*)$/.test(index || '') || !Array.isArray(target?.children) || Number(index) >= target.children.length) throw new Error(`${patch.path}: child index is outside the selected scope.`);
    target = target.children[Number(index)];
    offset += 2;
  }
  if (!isObject(target)) throw new Error(`${patch.path}: target node does not exist.`);
  const tail = parts.slice(offset), value = patch.value;
  const scalar = () => { if (!finite(value)) throw new Error(`${patch.path}: expected finite number.`); };
  if (tail.length === 1 && tail[0] === 'name') {
    if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new Error(`${patch.path}: invalid node name.`);
    const changed = target.name !== value;
    target.name = value;
    return changed;
  } else if ((tail[0] === 'transform' || tail[0] === 'repeat') && ['t', 'r', 's'].includes(tail[1]) && (tail.length === 2 || (tail.length === 3 && /^[012]$/.test(tail[2])))) {
    const group = tail[0], axis = tail[1];
    if (group === 'repeat' && !isObject(target.repeat)) throw new Error(`${patch.path}: node is not a repeat.`);
    const previous = target[group]?.[axis];
    if (!isObject(target[group])) target[group] = {};
    if (tail.length === 2) {
      if (!isVec(value)) throw new Error(`${patch.path}: expected three finite numbers.`);
      const changed = !isVec(previous) || previous.some((component, index) => component !== value[index]);
      target[group][axis] = [...value];
      return changed;
    } else {
      scalar();
      const defaults = axis === 's' ? [1, 1, 1] : [0, 0, 0];
      const changed = !Array.isArray(previous) || previous[Number(tail[2])] !== value;
      target[group][axis] = Array.isArray(target[group][axis]) ? [...target[group][axis]] : defaults;
      target[group][axis][Number(tail[2])] = value;
      return changed;
    }
  } else if (tail.length === 2 && tail[0] === 'primitive' && PRIMITIVES[target.primitive?.type]?.includes(tail[1])) {
    scalar();
    const changed = target.primitive[tail[1]] !== value;
    target.primitive[tail[1]] = value;
    return changed;
  } else if (tail.join('/') === 'primitive/material/color' && target.primitive) {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${patch.path}: expected #RRGGBB color.`);
    const changed = target.primitive.material?.color !== value;
    target.primitive.material = { ...(target.primitive.material || {}), color: value };
    return changed;
  } else if (tail.length === 2 && tail[0] === 'repeat' && ['count', 'radius'].includes(tail[1]) && isObject(target.repeat)) {
    scalar();
    const changed = target.repeat[tail[1]] !== value || (tail[1] === 'count' && own(target.repeat, 'n') && target.repeat.n !== value);
    target.repeat[tail[1]] = value;
    if (tail[1] === 'count' && own(target.repeat, 'n')) target.repeat.n = value;
    return changed;
  } else throw new Error(`${patch.path}: patch may only change node names, dimensions, transforms, colors, or repeat parameters.`);
}

function validateEnvelope(envelope) {
  safeData(envelope);
  if (!isObject(envelope)) throw new Error('Generation response must be an object.');
  const required = ['action', 'replacement', 'patches', 'message', 'plan', 'checks'];
  if (Object.keys(envelope).some(k => ![...required, 'suggestions'].includes(k)) || required.some(k => !own(envelope, k))) throw new Error('Generation response is missing required fields or contains unsupported fields.');
  if (own(envelope, 'suggestions') && !Array.isArray(envelope.suggestions)) throw new Error('Suggestions must be an array.');
  if (envelope.action !== 'clarify' && envelope.suggestions?.length) throw new Error('Only clarification responses may offer executable suggestions.');
  if (!['replace', 'patch', 'clarify'].includes(envelope.action)) throw new Error('Unsupported generation action.');
  if (typeof envelope.message !== 'string' || envelope.message.length > 4000) throw new Error('Generation message must be text of at most 4000 characters.');
  if (!Array.isArray(envelope.plan) || envelope.plan.length > 12 || envelope.plan.some(p => typeof p !== 'string' || p.length > 1000)) throw new Error('Generation plan is invalid.');
  if (!Array.isArray(envelope.patches) || envelope.patches.length > 128) throw new Error('At most 128 patches are allowed.');
  if (!Array.isArray(envelope.checks) || envelope.checks.length > 24) throw new Error('At most 24 checks are allowed.');
  for (const check of envelope.checks) {
    if (!isObject(check) || Object.keys(check).sort().join(',') !== 'axis,comparison,kind,otherPath,path,tolerance,value') throw new Error('Each check requires kind, path, otherPath, axis, comparison, value and tolerance.');
    if (!OBJECTIVE_CHECK_KINDS.includes(check.kind) || !/^0(?:\.(?:0|[1-9]\d*))*$/.test(check.path) || (check.otherPath !== '' && !/^0(?:\.(?:0|[1-9]\d*))*$/.test(check.otherPath)) || !['x', 'y', 'z'].includes(check.axis) || !['eq', 'lt', 'le', 'gt', 'ge'].includes(check.comparison) || !finite(check.value) || !finite(check.tolerance) || check.tolerance < 0) throw new Error('Generation check contains invalid fields.');
    if (['relative_extent', 'align', 'axis_parallel', 'axis_distance'].includes(check.kind) && !check.otherPath) throw new Error(`${check.kind} check needs otherPath.`);
    if (check.kind.startsWith('axis_') && (check.comparison !== 'eq' || check.value !== (check.kind === 'axis_distance' ? 0 : 1))) throw new Error('Axis checks require eq with value 1 for direction/parallel, or 0 for distance.');
    if (['axis_direction', 'axis_parallel'].includes(check.kind) && check.tolerance > MAX_AXIS_DOT_TOLERANCE) throw new Error(`Axis dot tolerance must be between 0 and ${MAX_AXIS_DOT_TOLERANCE}, not an angle in degrees.`);
    if (check.kind === 'axis_distance' && !hasAxisParallelCheck(envelope.checks, check)) throw new Error('axis_distance requires an axis_parallel check for the same primitive path pair.');
  }
  if (envelope.action === 'replace' && (!isObject(envelope.replacement) || envelope.patches.length)) throw new Error('Replacement action requires a node and no patches.');
  if (envelope.action === 'patch' && envelope.replacement !== null) throw new Error('Patch action requires replacement null.');
  if (envelope.action === 'patch' && !envelope.patches.length && !envelope.checks.length) throw new Error('An unchanged patch requires at least one measurable acceptance check.');
  if (envelope.action === 'clarify' && (envelope.replacement !== null || envelope.patches.length || !envelope.message.trim())) throw new Error('Clarification must contain a question and no changes.');
}

/** All-or-nothing scope-limited application; never mutates the caller's scene. */
export function applyGenerationEnvelope(envelope, { mode, scene = null, node = null, path = '0', allowStructure = false } = {}) {
  if (!['create', 'edit', 'node'].includes(mode)) throw new Error(`Unknown generation mode: ${mode}`);
  validateEnvelope(envelope);
  const baseline = mode === 'node' ? node : scene;
  if (mode !== 'create' && !isObject(baseline)) throw new Error('The selected scene or node is no longer available.');
  const suggestions = validateSuggestions(own(envelope, 'suggestions') ? envelope.suggestions : [], { scene, path: mode === 'node' ? path : '0', mode });
  const common = { action: envelope.action, message: envelope.message, suggestions, plan: [...envelope.plan], checks: clone(envelope.checks) };
  if (envelope.action === 'clarify') return { ...common, root: baseline, changes: [] };
  let root, changes;
  if (envelope.action === 'patch') {
    if (mode === 'create') throw new Error('New scenes require a replacement node.');
    safeData(baseline);
    root = clone(baseline);
    changes = [];
    for (const patch of envelope.patches) {
      if (applyPatch(root, patch)) changes.push(patch.path);
    }
    if (!changes.length && !envelope.checks.length) throw new Error('An unchanged patch requires at least one measurable acceptance check.');
  } else {
    if (mode !== 'create' && !allowStructure) throw new Error('This request does not allow replacing the scene structure; return parameter patches.');
    root = normalize(envelope.replacement);
    // Structural generation cannot create metadata or impersonate existing node identities.
    const canonical = validateAML(root);
    if (!canonical.ok) throw new Error(`Generated AML is invalid:\n${canonical.errors.join('\n')}`);
    // Structural additions/reordering preserve unambiguous existing sibling identities.
    reconcileReplacement(root, baseline);
    changes = [mode === 'node' ? path : '0'];
  }
  const result = validateAML(root, { baseline, allowPositionalMatch: envelope.action === 'patch' });
  if (!result.ok) throw new Error(`Generated AML is invalid:\n${result.errors.join('\n')}`);
  return { ...common, root, changes: [...new Set(changes)] };
}
