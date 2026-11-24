import test from 'node:test';import assert from 'node:assert/strict';
import {teamReport,GOAL,integrity,readiness} from '../scripts/team-report.mjs';import {createAccount} from '../engine.js';
const now=1.8e9;
test('manager scores goal progress and flags stalled agents for restart',()=>{
 const a=createAccount(10000);a.cash=9000;a.trades=Array.from({length:12},(_,i)=>({product:'BTC-USD',pnl:-10,fees:2,rebateCredited:.5,openedAt:now-90000+i,closedAt:now-1000,reason:'stop'}));
 const r=teamReport({account:a,products:['BTC-USD'],config:{strategy:'aggressive'},productConfigs:{'BTC-USD':{patternRequired:true}},updatedAt:new Date((now-3*3600)*1000).toISOString(),autoTrade:true},{products:{}},now);
 assert.equal(r.goal,GOAL);assert.equal(r.equity,9000);assert.ok(r.progressToGoal<0);assert.equal(r.losingStreak,12);assert.equal(r.last24h.closedTrades,12);assert.equal(r.allTime.rebatesCredited,6);
 assert.deepEqual(r.dispatch,['update.yml','learning.yml:research']);assert.equal(r.verdict,'needs-attention');assert.ok(r.issues.some(i=>/losing trades in a row/.test(i)));
 const ok=teamReport({account:createAccount(),products:[],config:{},updatedAt:new Date(now*1000).toISOString(),strategyLab:{updatedAt:new Date(now*1000).toISOString()}},{products:{}},now,{researchNotes:{entries:[{at:new Date(now*1000).toISOString(),losses:0}]}});
 assert.equal(ok.verdict,'on-track');assert.deepEqual(ok.dispatch,[]);
});

test('ledger check catches miscounted cash and readiness requires every check',()=>{
 const a=createAccount(10000);a.trades=[{id:'1',product:'BTC-USD',pnl:-50,fees:5,entry:1,exit:1,quantity:1,closedAt:now,openedAt:now-60,reason:'stop'}];a.cash=9950;
 assert.equal(integrity(a).ok,true);a.cash=9960;const bad=integrity(a);assert.equal(bad.ok,false);assert.match(bad.problems[0],/reconciliation off by \$10\.00/);
 const r=readiness({account:a,strategyLab:{products:{}}},now);assert.equal(r.ready,false);assert.equal(r.total,9);assert.equal(r.checks.find(c=>c.id==='integrity').pass,false);
 assert.ok(teamReport({account:a,products:[],config:{},updatedAt:new Date(now*1000).toISOString()},{products:{}},now).issues.some(i=>/Calculation error/.test(i)));
});

test('manager reads the latest researcher note and flags stale notes or a losing 24h win rate',()=>{
 const fresh=new Date(now*1000).toISOString(),base={products:[],config:{},updatedAt:fresh,strategyLab:{updatedAt:fresh}};
 const note={at:fresh,tradesReviewed:42,losses:40,findings:['a','b'],changes:['c'],adopted:false,nextIdea:'regime block'};
 const r=teamReport({...base,account:createAccount()},{products:{}},now,{researchNotes:{entries:[note]}});
 assert.equal(r.agents.researcher.latestNote.nextIdea,'regime block');assert.equal(r.agents.researcher.latestNote.findings,2);assert.equal(r.agents.researcher.healthy,true);
 const stale=teamReport({...base,account:createAccount()},{products:{}},now,{researchNotes:{entries:[{...note,at:new Date((now-7*3600)*1000).toISOString()}]}});
 assert.ok(stale.issues.some(i=>/research-notes/.test(i)));assert.equal(stale.agents.researcher.healthy,false);
 assert.ok(teamReport({...base,account:createAccount()},{products:{}},now).issues.some(i=>/research-notes.json for ever/.test(i)));
 const a=createAccount(10000);a.trades=Array.from({length:10},(_,i)=>({product:'BTC-USD',pnl:i<2?5:-5,fees:1,openedAt:now-5000+i,closedAt:now-100,reason:'stop'}));a.cash=10000-30;
 const losing=teamReport({...base,account:a},{products:{}},now,{researchNotes:{entries:[note]}});
 assert.ok(losing.issues.some(i=>/win rate 20%/.test(i)));assert.equal(losing.verdict,'needs-attention');
});

test('private manager report uses encrypted research notes and never substitutes public-demo findings',async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os'),{spawnSync}=await import('node:child_process'),{encryptState,decryptState}=await import('../scripts/private-state.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paper-note-scope-')),key=Buffer.alloc(32,31).toString('base64'),at=new Date().toISOString();
 const state={version:1,account:createAccount(),products:[],config:{},updatedAt:at,researchNotes:{entries:[{at,nextIdea:'private-only-fixture'}]}};
 try{
  await fs.mkdir(path.join(dir,'data'));const write=(name,v)=>fs.writeFile(path.join(dir,'data',name+'.json'),JSON.stringify(v));
  await write('market',{products:{}});await write('paper',{...state,researchNotes:undefined});await write('research-notes',{entries:[{at,nextIdea:'public-only-fixture'}]});await write('portfolio.enc',await encryptState(state,key));
  const run=()=>spawnSync(process.execPath,[new URL('../scripts/team-report.mjs',import.meta.url).pathname],{cwd:dir,env:{...process.env,PAPER_STATE_KEY:key},encoding:'utf8'});
  let result=run();assert.equal(result.status,0,result.stderr);let out=await decryptState(JSON.parse(await fs.readFile(path.join(dir,'data/portfolio.enc.json'),'utf8')),key);
  assert.equal(out.teamReport.agents.researcher.latestNote.nextIdea,'private-only-fixture');assert.deepEqual(out.account,state.account);assert.ok(!result.stdout.includes('private-only-fixture'));
  const pub=JSON.parse(await fs.readFile(path.join(dir,'data/team-report.json'),'utf8'));assert.equal(pub.agents.researcher.latestNote.nextIdea,'public-only-fixture');
  delete out.researchNotes;await write('portfolio.enc',await encryptState(out,key));result=run();assert.equal(result.status,0,result.stderr);out=await decryptState(JSON.parse(await fs.readFile(path.join(dir,'data/portfolio.enc.json'),'utf8')),key);assert.equal(out.teamReport.agents.researcher.latestNote,null);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
