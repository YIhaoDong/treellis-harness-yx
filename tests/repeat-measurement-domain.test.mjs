import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGeometry, evaluateChecks } from '../src/generation/geometry.mjs';
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-5, message + ': expected ' + expected + ', got ' + actual);
const array = ({ count = 8, span = 14, rotate = [0,0,0] } = {}) => ({ operation:'union', name:'Offline measurement fixture', transform:{t:[0,0,0],r:rotate,s:[1,1,1]}, children:[{name:'Panel Repeat',repeat:{type:'linear',count,t:[0,0,span],r:[0,0,0],s:[1,1,1]},children:[{name:'Panel Template',transform:{t:[0,0,-7],r:[0,0,0],s:[1,1,1]},primitive:{type:'cube',w:4,h:0.12,d:1}}]}] });
const check = (kind, path, axis, value, otherPath = '') => ({kind,path,otherPath,axis,comparison:'eq',value,tolerance:0.01});

test('eight panel template path aggregates all instances, matching its repeat parent', () => {
  const scene = array();
  const report = inspectGeometry(scene);
  assert.equal(report.ok,true);
  assert.equal(report.nodes['0.0.0'].instanceCount,8);
  near(report.nodes['0.0'].bounds.size[2],15,'parent Z extent');
  near(report.nodes['0.0.0'].bounds.size[2],15,'child aggregate Z extent');
  near(report.nodes['0.0.0'].bounds.center[2]-report.nodes['0.0'].bounds.center[2],0,'aggregate center difference');
  assert.equal(scene.children[0].children[0].primitive.d,1);
  assert.deepEqual(scene.children[0].children[0].transform.t,[0,0,-7]);
});

test('wrong local-template-as-world checks fail rather than disappearing', () => {
  const report=inspectGeometry(array());
  const checks=[check('extent','0.0.0','z',1),check('align','0.0.0','z',-7,'0.0')];
  const result=evaluateChecks(report,checks);
  assert.equal(result.ok,false);
  assert.equal(result.results.length,2);
  assert.equal(result.errors.length,2);
  assert.deepEqual(result.results.map(x=>x.passed),[false,false]);
  near(result.results[0].actual,15,'wrong extent measured honestly');
  near(result.results[1].actual,0,'wrong align measured honestly');
});

test('correct full-array count, extent and alignment checks pass', () => {
  const report=inspectGeometry(array());
  const result=evaluateChecks(report,[check('count','0.0.0','x',8),check('extent','0.0','z',15),check('extent','0.0.0','z',15),check('align','0.0.0','z',0,'0.0')]);
  assert.equal(result.ok,true,JSON.stringify(result.errors));
  assert.ok(result.results.every(x=>x.passed));
});

test('nonrepeated primitive retains ordinary world extent and relative-center semantics', () => {
  const scene={operation:'union',name:'Nonrepeat control',children:[{name:'Panel',transform:{t:[0,0,-7],r:[0,0,0],s:[1,1,1]},primitive:{type:'cube',w:4,h:0.12,d:1}},{name:'Reference',primitive:{type:'cube',w:1,h:1,d:1}}]};
  const report=inspectGeometry(scene);
  const result=evaluateChecks(report,[check('extent','0.0','z',1),check('align','0.0','z',-7,'0.1')]);
  assert.equal(report.nodes['0.0'].instanceCount,1);
  assert.equal(result.ok,true,JSON.stringify(result.errors));
});

test('8 to 10 count-only change keeps template d1 and total aggregate span15', () => {
  const before=array();const after=array({count:10});
  const a=inspectGeometry(before),b=inspectGeometry(after);
  assert.deepEqual(before.children[0].children,after.children[0].children);
  assert.deepEqual(after.children[0].repeat.t,[0,0,14]);
  assert.equal(after.children[0].children[0].primitive.d,1);
  assert.equal(b.nodes['0.0.0'].instanceCount,10);
  assert.equal(b.nodes['0.0.0'].primitiveCount,10);
  near(a.nodes['0.0.0'].bounds.size[2],15,'old aggregate extent');
  near(b.nodes['0.0.0'].bounds.size[2],15,'count-only new aggregate extent');
  const incorrect=evaluateChecks(b,[check('extent','0.0.0','z',17)]);
  assert.equal(incorrect.ok,false,'count-only change must not silently acquire per-step semantics');
});

test('extent17 requires an explicit total translation16, not merely count10', () => {
  const scene=array({count:10,span:16});const report=inspectGeometry(scene);
  assert.equal(scene.children[0].children[0].primitive.d,1);
  assert.deepEqual(scene.children[0].repeat.t,[0,0,16]);
  near(report.nodes['0.0'].bounds.size[2],17,'explicit changed total span');
  near(report.nodes['0.0.0'].bounds.size[2],17,'template aggregate same explicit span');
  assert.equal(evaluateChecks(report,[check('extent','0.0.0','z',17),check('align','0.0.0','z',0,'0.0')]).ok,true);
});

test('rotated ancestor rotates the aggregate measurement domain without changing local parameters', () => {
  const scene=array({rotate:[90,0,0]});const report=inspectGeometry(scene);
  assert.equal(scene.children[0].children[0].primitive.d,1);
  near(report.nodes['0.0.0'].bounds.size[1],15,'rotated world Y aggregate');
  near(report.nodes['0.0.0'].bounds.size[2],0.12,'rotated world Z extent');
  assert.equal(evaluateChecks(report,[check('extent','0.0.0','y',15),check('extent','0.0.0','z',0.12)]).ok,true);
});
