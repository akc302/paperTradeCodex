import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {createAccount} from '../engine.js';import {encryptState,decryptState} from '../scripts/private-state.mjs';
test('supervisor reports actual workflow evidence and keeps private note provenance',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'supervisor-scope-')),key=Buffer.alloc(32,17).toString('base64'),at=new Date().toISOString();
 const state={version:1,account:createAccount(),products:[],config:{},updatedAt:at,strategyLab:{updatedAt:at},researchNotes:{entries:[{at}]}};
 try{
  await fs.mkdir(path.join(dir,'data'));const write=(n,v)=>fs.writeFile(path.join(dir,'data',n+'.json'),JSON.stringify(v));
  await write('market',{products:{}});await write('paper',{...state,researchNotes:undefined});await write('operations',{scheduleEventCount:0});await write('research-notes',{entries:[{at}]});await write('portfolio.enc',await encryptState(state,key));
  const run=()=>spawnSync(process.execPath,[new URL('../scripts/supervisor-report.mjs',import.meta.url).pathname],{cwd:dir,env:{...process.env,PAPER_STATE_KEY:key},encoding:'utf8'});
  let result=run();assert.equal(result.status,0,result.stderr);let out=await decryptState(JSON.parse(await fs.readFile(path.join(dir,'data/portfolio.enc.json'),'utf8')),key);
  assert.deepEqual(out.account,state.account);assert.ok(out.supervisorReport.issues.some(x=>x.includes('scheduled trader')));assert.ok(!out.supervisorReport.issues.some(x=>x.includes('not written')));
  delete out.researchNotes;await write('portfolio.enc',await encryptState(out,key));await write('operations',{scheduleEventCount:1});result=run();assert.equal(result.status,0,result.stderr);out=await decryptState(JSON.parse(await fs.readFile(path.join(dir,'data/portfolio.enc.json'),'utf8')),key);
  assert.ok(out.supervisorReport.issues.some(x=>x.includes('not written')));assert.ok(!out.supervisorReport.issues.some(x=>x.includes('scheduled trader')));
  const pub=JSON.parse(await fs.readFile(path.join(dir,'data/supervisor-report.json'),'utf8'));assert.ok(!pub.issues.some(x=>x.includes('not written')));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
