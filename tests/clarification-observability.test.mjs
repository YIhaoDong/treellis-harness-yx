import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneration} from '../src/generation/pipeline.mjs';
import {requestGeneration} from '../src/generation/client.mjs';
import jobs from '../src/generation/jobs.cjs';
import {inspectGeometry} from '../src/generation/geometry.mjs';
import {ASSET_NAMES} from '../src/generation/config.mjs';
const {createGenerationJobs,publicError}=jobs;
const clone=x=>JSON.parse(JSON.stringify(x));
const cube=w=>({name:'Cube',transform:null,primitive:{type:'cube',w,h:1,d:1,material:{color:'#D8FFD4'}},operation:null,repeat:null,children:null});
const widthCheck={kind:'extent',path:'0',otherPath:'',axis:'x',comparison:'eq',value:2,tolerance:.01};
const bad=()=>({action:'replace',replacement:cube(1),patches:[],message:'Created.',suggestions:[],plan:[],checks:[clone(widthCheck)]});
const clarify=()=>({action:'clarify',replacement:null,patches:[],message:'Which concrete alternative?',suggestions:[],plan:[],checks:[]});
const loadAssets=async()=>Object.fromEntries(ASSET_NAMES.map(k=>[k,k==='jsonCase'?JSON.stringify({examples:[{description:'cube',tags:['cube'],aml:cube(1)}]}):'Offline mock asset '+k]));
function pipelineHarness(envelopes,maxRepairs=2){const calls=[];const usages=[{input_tokens:100,output_tokens:50,total_tokens:150},{input_tokens:7,output_tokens:11,total_tokens:18},{input_tokens:3,output_tokens:5,total_tokens:8}];return{calls,run:()=>runGeneration({mode:'create',prompt:'Create a cube with width2.',effort:'max'},{apiKey:'mock-offline-key',loadAssets,maxRepairs,inspectGeometry:async r=>inspectGeometry(r),fetchImpl:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});const index=calls.length-1;assert.ok(index<envelopes.length,'Unexpected extra provider attempt');return new Response(JSON.stringify({id:'resp_mock_'+index,status:'completed',output_text:JSON.stringify(envelopes[index]),usage:usages[index]}),{headers:{'Content-Type':'application/json'}});}})};}
async function rejection(task){try{await task();assert.fail('Expected terminal rejection');}catch(e){if(e.code===undefined)throw e;return e;}}
const encoder=new TextEncoder();
const ndjson=events=>new Response(events.map(x=>JSON.stringify(x)).join('\n')+'\n',{headers:{'Content-Type':'application/x-ndjson'}});

test('pipeline -> retained jobs/publicError -> client preserves failed attempt and final clarification without another retry',async()=>{
 const h=pipelineHarness([bad(),clarify()]);const jobs=createGenerationJobs({run:()=>h.run()});let fetches=0,applied=0;
 try{const error=await rejection(()=>requestGeneration({mode:'create'},{onCheckpoint:()=>applied++,reconnectDelayMs:0,fetchImpl:async(url,init)=>{fetches++;assert.match(String(url),/\/api\/generate$/);const id=init.headers['X-Generation-Id'],token=init.headers['X-Generation-Token'];const job=jobs.start({id,token,input:{},owner:''});return new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode(JSON.stringify({type:'job',id})+'\n'));jobs.subscribe(job.id,token,0,event=>{if(event)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));else controller.close();});}}),{headers:{'Content-Type':'application/x-ndjson'}});}}));
 assert.equal(error.code,'CLARIFICATION');assert.equal(error.terminal,true);assert.equal(h.calls.length,2);assert.equal(fetches,1);assert.equal(applied,0);assert.equal(error.attempts.length,2);assert.match(error.attempts[0].errors[0],/measured 1, expected eq 2/);assert.equal(error.attempts[1].outcome,'clarification');assert.equal(error.attempts[1].responseId,'resp_mock_1');assert.deepEqual(error.usage,{input_tokens:107,output_tokens:61,total_tokens:168});assert.ok(error.durationMs>=0);assert.deepEqual(error.suggestions,[]);assert.equal(JSON.stringify(error).includes('output_text'),false);
 }finally{jobs.close();}
});

test('first response clarification remains terminal with exactly one diagnostic attempt',async()=>{
 const h=pipelineHarness([clarify()]);const e=await rejection(()=>h.run());assert.equal(e.code,'CLARIFICATION');assert.equal(h.calls.length,1);assert.equal(e.attempts.length,1);assert.equal(e.attempts[0].outcome,'clarification');assert.deepEqual(e.attempts[0].errors,[]);assert.deepEqual(e.usage,{input_tokens:100,output_tokens:50,total_tokens:150});assert.ok(Number.isFinite(e.durationMs));
});

test('two validation failures followed by clarification keep all3 attempts within existing repair allowance',async()=>{
 const h=pipelineHarness([bad(),bad(),clarify()]);const e=await rejection(()=>h.run());assert.equal(e.code,'CLARIFICATION');assert.equal(h.calls.length,3);assert.deepEqual(e.attempts.map(x=>x.attempt),[1,2,3]);assert.equal(e.attempts[2].outcome,'clarification');assert.deepEqual(e.usage,{input_tokens:110,output_tokens:66,total_tokens:176});
});

test('diagnostic usage is snapshotted and public output is detached from the thrown error',async()=>{
 const h=pipelineHarness([bad(),clarify()]);const e=await rejection(()=>h.run());const event=publicError(e);e.usage.input_tokens=999;e.attempts[0].errors[0]='mutated';e.attempts[0].usage.input_tokens=999;assert.equal(event.usage.input_tokens,107);assert.equal(event.attempts[0].usage.input_tokens,100);assert.match(event.attempts[0].errors[0],/measured 1/);assert.equal(event.attempts[1].usage.input_tokens,7);
});

test('public diagnostics use strict fields, bounded counts/strings and key redaction',()=>{
 const secret='sk-fake-observability-secret';const raw='RAW_MODEL_TEXT_MUST_NOT_LEAK';const original={code:'CLARIFICATION',message:'Question '+secret,suggestions:[],usage:{input_tokens:2,output_tokens:-1,total_tokens:Infinity,raw},durationMs:7,attempts:Array.from({length:5},(_,i)=>({attempt:i+1,passed:false,outcome:i===1?'clarification':'privateThought',responseId:'resp_'+secret+'x'.repeat(250),usage:{input_tokens:1,output_tokens:2,total_tokens:3,raw},errors:[secret+'x'.repeat(800),{raw},...Array.from({length:15},(_,j)=>'diagnostic '+j)],output_text:raw,reasoning:raw})),output_text:raw,apiKey:secret};
 const event=publicError(original);assert.equal(event.attempts.length,3);assert.ok(event.attempts.every(x=>x.errors.length===12&&x.errors.every(s=>s.length<=400)&&x.responseId.length<=160));assert.deepEqual(Object.keys(event.attempts[0]).sort(),['attempt','errors','passed','responseId','usage'].sort());assert.equal(event.attempts[1].outcome,'clarification');assert.deepEqual(event.usage,{input_tokens:2});assert.equal(event.durationMs,7);assert.equal(JSON.stringify(event).includes(secret),false);assert.equal(JSON.stringify(event).includes(raw),false);assert.match(event.message,/\[redacted\]/);assert.ok(original.attempts.length===5&&original.attempts[0].errors[0].includes(secret));
});

test('invalid diagnostic field types are omitted and legacy services remain compatible',async()=>{
 const event=publicError({code:'CLARIFICATION',message:'Old-compatible',attempts:[null,{attempt:0},{attempt:'1'}],usage:[],durationMs:NaN});assert.deepEqual(event.attempts,[]);assert.equal('usage'in event,false);assert.equal('durationMs'in event,false);
 const e=await rejection(()=>requestGeneration({},{fetchImpl:async()=>ndjson([{type:'error',code:'CLARIFICATION',message:'Old service',suggestions:[]}])}));assert.equal(e.code,'CLARIFICATION');assert.equal(e.terminal,true);assert.equal('attempts'in e,false);assert.equal('usage'in e,false);assert.equal('durationMs'in e,false);
});

test('reconnect replay deduplicates prior progress/checkpoints and terminal diagnostics never trigger a provider retry',async()=>{
 const terminal=publicError({code:'CLARIFICATION',message:'Choose',attempts:[{attempt:1,passed:false,errors:['prior failure']},{attempt:2,passed:false,outcome:'clarification',errors:[]}],usage:{input_tokens:107,output_tokens:61,total_tokens:168},durationMs:50});let requests=0,checkpoints=0,parts=0;
 const e=await rejection(()=>requestGeneration({},{reconnectDelayMs:0,onCheckpoint:()=>checkpoints++,onProgress:p=>{if(p.stage==='part')parts++;},fetchImpl:async(url,init)=>{requests++;if(requests===1)return ndjson([{type:'job',id:init.headers['X-Generation-Id']},{type:'progress',stage:'part',seq:1},{type:'checkpoint',seq:2,result:{name:'kept'}}]);assert.equal(requests,2);assert.match(String(url),/after=2$/);return ndjson([{type:'progress',stage:'part',seq:1},{type:'checkpoint',seq:2,result:{name:'duplicate'}},{...terminal,seq:3},{...terminal,seq:3}]);}}));
 assert.equal(requests,2);assert.equal(checkpoints,1);assert.equal(parts,1);assert.equal(e.terminal,true);assert.equal(e.attempts.length,2);assert.deepEqual(e.usage,terminal.usage);assert.equal(e.durationMs,50);
});

test('new observation fields cannot relax frozen checks or add validation retries',async()=>{
 const second=bad();second.checks=[];const h=pipelineHarness([bad(),second],1);const e=await rejection(()=>h.run());assert.equal(e.code,'VALIDATION_FAILED');assert.equal(h.calls.length,2);assert.equal(e.attempts.length,2);assert.ok(e.attempts.every(x=>x.errors.some(s=>/expected eq 2/.test(s))));assert.ok(JSON.stringify(h.calls[1].body.input).includes('FROZEN_ACCEPTANCE_CHECKS'));
});
