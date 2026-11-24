import test from'node:test';import assert from'node:assert/strict';import {tradeDue,receiptAfterSuccess}from'../scripts/trade-cycle.mjs';import{collectEvidence}from'../scripts/evidence.mjs';import{createAccount}from'../engine.js';import{readFileSync}from'node:fs';
const now=Date.parse('2026-11-23T12:00:00Z')/1000;
test('two-hour execution receipt prevents extra checks and advances only on explicit success',()=>{assert.ok(tradeDue({},now));const r=receiptAfterSuccess({},new Date(now*1000).toISOString(),'codex');assert.equal(tradeDue(r,now+7199),false);assert.equal(tradeDue(r,now+7200),true);assert.equal(tradeDue(r,now-1),false);assert.equal(r.checks[0].event,'codex');});
test('hourly evidence respects the two-hour schedule without inventing observed checks',()=>{const account=createAccount();account.equityHistory=[{time:now-5400,equity:10000}];const s={account,updatedAt:new Date((now-5400)*1000).toISOString()};let h=collectEvidence(s,now).hourly.at(-1);assert.equal(h.observedChecks,0);assert.equal(h.evidenceComplete,true);assert.equal(h.expectedCheckIntervalSeconds,7200);h=collectEvidence(s,now+3600).hourly.at(-1);assert.equal(h.evidenceComplete,false);});
test('trader cron is two-hour and cannot self-dispatch a five-minute loop',()=>{const w=readFileSync(new URL('../.github/workflows/update.yml',import.meta.url),'utf8');assert.match(w,/15 1-23\/2 \* \* \*/);assert.doesNotMatch(w,/gh workflow run update\.yml|sleep "\$wait"/);assert.match(w,/scripts\/trade-cycle\.mjs/);assert.match(w,/github\.repository == 'akc302\/paperTradeCodex'/);});

test('supervisor evaluates evidence without changing account or settings',async()=>{const{supervise}=await import('../scripts/supervisor-report.mjs');const s={account:createAccount(),products:[],config:{riskPct:.02},updatedAt:new Date(now*1000).toISOString()};const before=structuredClone(s);const r=supervise(s,{products:{}},now);assert.deepEqual(s,before);assert.equal(r.scope,'paperTradeCodex only; two-hour execution; no real orders');assert.equal(r.readiness.ready,false);assert.equal(r.integrity.ok,true);});

test('shared coordinator keeps independent role cadences and does not refit hourly',async()=>{const{dueRoles,ROLE_HOURS}=await import('../scripts/agent-cycle.mjs');assert.deepEqual(dueRoles({},now),['verifier','researcher','manager','supervisor']);const s={roles:Object.fromEntries(Object.keys(ROLE_HOURS).map(r=>[r,{completedAt:new Date(now*1000).toISOString()}]))};assert.deepEqual(dueRoles(s,now+3600),['verifier']);assert.deepEqual(dueRoles(s,now+5*3600),['verifier','researcher']);assert.deepEqual(dueRoles(s,now+6*3600),['verifier','researcher','manager']);assert.equal(dueRoles(s,now+8*3600).length,4);});

test('late support-role completion does not skip the next hourly coordinator tick',async()=>{
 const{dueRoles,completedRole}=await import('../scripts/agent-cycle.mjs');
 const at=s=>Date.parse(s)/1000,initial='2026-11-23T23:13:07Z';
 const s={roles:Object.fromEntries(['verifier','researcher','manager','supervisor'].map(r=>[r,{completedAt:initial}]))};
 assert.deepEqual(dueRoles(s,at('2026-11-24T00:10:57Z')),['verifier']);
 s.roles.verifier=completedRole('verifier',s.roles.verifier,'healthy',at('2026-11-24T00:13:40Z'));
 assert.equal(s.roles.verifier.nextDueAt,'2026-11-24T01:00:00.000Z');
 assert.deepEqual(dueRoles(s,at('2026-11-24T00:59:59Z')),[]);
 assert.deepEqual(dueRoles(s,at('2026-11-24T01:10:57Z')),['verifier']);
 assert.ok(dueRoles(s,at('2026-11-24T04:10:57Z')).includes('researcher'));
 assert.ok(!dueRoles(s,at('2026-11-24T03:59:59Z')).includes('researcher'));
});
test('missed support cycles advance once beyond completion without catch-up refitting',async()=>{
 const{completedRole,roleDeadline}=await import('../scripts/agent-cycle.mjs');
 const old={completedAt:'2026-11-23T23:13:00Z',nextDueAt:'2026-11-24T04:00:00Z'};
 const r=completedRole('researcher',old,'completed',Date.parse('2026-11-24T16:30:00Z')/1000);
 assert.equal(r.nextDueAt,'2026-11-24T19:00:00.000Z');
 assert.equal(roleDeadline('researcher',r),Date.parse(r.nextDueAt)/1000);
 assert.throws(()=>completedRole('unknown',{},'completed'),/Unknown team role/);
});
