import test from 'node:test';import assert from 'node:assert/strict';
import {createAccount,DEFAULT_CONFIG,openPaperTrade} from '../engine.js';
import {ensureChallengers,challengerConfig,runChallengers,CAP_KEYS,setChallengerRules} from '../scripts/challengers.mjs';
import {deflatedSharpe,reviewChallengers,evaluateChallenger,normInv,normCdf} from '../scripts/promotion.mjs';
import {migrateToTrend} from '../scripts/rules.mjs';
import {applyLab} from '../scripts/strategy-lab.mjs';
const T=Date.parse('2026-11-20T12:02:00Z')/1000;
const base=()=>{const s={config:{...DEFAULT_CONFIG,strategy:'aggressive',riskPct:.02,maxTotalRisk:.08,maxAllocation:.25,maxDailyLoss:.12,maxHoldHours:2},productConfigs:{'BTC-USD':{strategy:'aggressive',patternRequired:true,maxHoldHours:24}},products:['BTC-USD','ETH-USD'],account:createAccount(30000),feeProfile:{feeRate:.003,makerFeeRate:.0015,takerFeeRate:.003}};migrateToTrend(s,T);ensureChallengers(s,T);return s;};
const bars=now=>{const out=[];for(let t=Math.floor(now/3600)*3600-30*3600;t+3600<=now;t+=3600)out.push({time:t,open:100,high:101,low:99,close:100.5,volume:1});return out;};
test('3-8 challengers seed with fresh accounts and inherit the main risk caps (never above) and fees',()=>{
 const s=base();assert.ok(s.challengers.length>=3&&s.challengers.length<=8);assert.ok(s.challengers.every(c=>c.account.initial===30000&&c.account.compactJournal));
 for(const ch of s.challengers)for(const p of s.products){const c=challengerConfig(s,ch,p);for(const k of CAP_KEYS){if(k==='riskPct'&&ch.riskScale<1){assert.ok(c[k]<s.config[k]);continue;}if(ch.caps&&k in ch.caps){assert.ok(c[k]<=1);continue;}assert.equal(c[k],s.config[k]);}assert.equal(c.takerFeeRate,.003);}
 const legacy=s.challengers.find(c=>c.id==='hourly-legacy');assert.equal(challengerConfig(s,legacy,'BTC-USD').strategy,'aggressive');assert.equal(challengerConfig(s,legacy,'BTC-USD').patternRequired,true);
 assert.equal(challengerConfig(s,legacy,'BTC-USD').trailAtrMultiplier,undefined);assert.equal(ensureChallengers(s,T),false);
});
test('challengers trade the same quote events in separate ledgers; one failure never touches the others',()=>{
 const s=base(),events=s.products.map(p=>({product:p,quote:{price:'100.5',time:new Date(T*1000).toISOString()},bars:bars(T)}));
 s.challengers[0].account=null;runChallengers(s,events,T);
 assert.ok(s.challengers[0].lastError);const legacy=s.challengers.find(c=>c.id==='hourly-legacy');assert.equal(legacy.lastError,null);assert.ok(legacy.account.decisions.length>0);assert.equal(s.account.decisions.length,0);
});
test('multiple-testing threshold rises with the number of candidates tried',()=>{
 assert.ok(Math.abs(normInv(.975)-1.95996)<1e-4&&Math.abs(normCdf(1.96)-.975)<1e-3);
 const r=Array.from({length:200},(_,i)=>.002+.01*Math.sin(i*1.7));const a=deflatedSharpe(r,2),b=deflatedSharpe(r,50),c=deflatedSharpe(r,500);
 assert.ok(a.threshold<b.threshold&&b.threshold<c.threshold);assert.ok(a.psr>=b.psr&&b.psr>=c.psr);assert.equal(deflatedSharpe(r.slice(0,5),5).pass,false);
});
test('promotion needs 7 days, 20 trades, higher net, PF 1.2 and no worse drawdown; every decision is logged once a day',()=>{
 const s=base(),ch=s.challengers[0],r=evaluateChallenger(s,ch,{market:{products:{}},history:{},now:T+86400});
 assert.equal(r.decision,'rejected');assert.ok(r.failed.includes('liveDays')&&r.failed.includes('liveTrades'));assert.ok(Number.isFinite(r.deflatedSharpe.trials));
 const out=reviewChallengers(s,{market:{products:{}},history:{},now:T+86400});assert.equal(out.promoted,null);assert.equal(s.promotionHistory.length,s.challengers.length);
 assert.equal(reviewChallengers(s,{market:{products:{}},history:{},now:T+86400+60}),null);
});
test('a challenger that clears every gate becomes the main rules; caps stay fixed and the old rules become a challenger',()=>{
 const s=base(),caps=CAP_KEYS.map(k=>s.config[k]),winner=s.challengers.find(c=>c.id==='trend-k4');
 const evaluate=(st,ch)=>({challenger:ch.id,decision:ch.id==='trend-k4'?'eligible':'rejected',gates:{},failed:[],live:{challenger:{netPnl:ch.id==='trend-k4'?500:0}}});
 const out=reviewChallengers(s,{market:{products:{}},history:{},now:T+8*86400,evaluate});
 assert.equal(out.promoted,'trend-k4');assert.equal(s.config.trailAtrMultiplier,4);assert.deepEqual(CAP_KEYS.map(k=>s.config[k]),caps);
 assert.equal(winner.rules.trailAtrMultiplier,3);assert.equal(winner.source,'demoted main rules');assert.equal(s.rulesHistory[0].event,'promoted-challenger');
 assert.ok(s.promotionHistory.some(h=>h.decision==='promoted')&&s.promotionHistory.some(h=>h.decision==='rejected'));
});
test('lab research feeds challengers instead of replacing the trend-follow main rules',()=>{
 const s=base(),before=structuredClone(s.productConfigs),lab=s.challengers.find(c=>c.id==='lab-hourly'),since=lab.rulesSince;
 const report={updatedAt:new Date((T+3600)*1000).toISOString(),inputHash:'x',products:{'BTC-USD':{decision:'shadow',shadowOf:'adopt-improvement',selected:'donchian-breakout',changes:{strategy:'donchian',maxHoldHours:24}}},trend:{status:'validated-on-2y',selected:'trend-k2-top3',changes:{strategy:'trend-follow',trailAtrMultiplier:2,trendTopN:3}}};
 applyLab(s,report);assert.deepEqual(s.productConfigs,before);assert.equal(lab.productConfigs['BTC-USD'].strategy,'donchian');assert.notEqual(lab.rulesSince,since);
 assert.equal(s.challengers.find(c=>c.id==='lab-trend').rules.trailAtrMultiplier,2);assert.equal(s.strategyLab.fedChallengers.length,2);
 assert.equal(setChallengerRules(lab,{productConfigs:lab.productConfigs},T),false);
});

test('every lab-tunable rule key survives into challenger accounts (regimeFilter included)',async()=>{
 const {TUNABLE}=await import('../scripts/strategy-lab.mjs'),{RULE_KEYS,pickRules}=await import('../scripts/challengers.mjs');
 for(const k of TUNABLE)assert.ok(RULE_KEYS.includes(k),`${k} would be dropped by challengers`);
 assert.deepEqual(pickRules({regimeFilter:true,maxHoldHours:4,riskPct:0.5}),{regimeFilter:true,maxHoldHours:4});
 const c=challengerConfig({config:{...DEFAULT_CONFIG}},{rules:{strategy:'aggressive'},productConfigs:{'ADA-USD':{regimeFilter:true}}},'ADA-USD');
 assert.equal(c.regimeFilter,true);
});

test('scout day-trade challenger is added to existing sets once, at reduced risk that can never exceed main',async()=>{
 const {ensureChallengers}=await import('../scripts/challengers.mjs');
 const state={config:{...DEFAULT_CONFIG,riskPct:0.02},account:createAccount(30000),challengers:[{id:'trend-k2',rules:{},account:createAccount(30000)}]};
 assert.equal(ensureChallengers(state,1.8e9),true);
 const scout=state.challengers.find(c=>c.id==='scout-daytrade');assert.ok(scout);assert.equal(state.challengers.filter(c=>c.id==='trend-k2').length,1);
 assert.equal(ensureChallengers(state,1.8e9+60),false,'second call adds nothing');
 const c=challengerConfig(state,scout,'BTC-USD');assert.equal(c.strategy,'horizontal');assert.equal(c.maxHoldHours,4);assert.equal(c.entryOrder,'limit');
 assert.ok(Math.abs(c.riskPct-0.005)<1e-12);assert.equal(c.maxOpenPositions,state.config.maxOpenPositions);
 assert.equal(challengerConfig(state,{...scout,riskScale:5},'BTC-USD').riskPct,0.02,'scale above 1 is clamped to main risk');
});

test('an existing scout picks up updated researcher seed rules in place, keeping its ledger',async()=>{
 const {ensureChallengers}=await import('../scripts/challengers.mjs');
 const state={config:{...DEFAULT_CONFIG},account:createAccount(30000)};ensureChallengers(state,1.8e9);
 const scout=state.challengers.find(c=>c.id==='scout-daytrade');scout.rules={...scout.rules,proximity:0.006};scout.account.cash=12345;
 assert.equal(ensureChallengers(state,1.8e9+60),true);
 assert.equal(scout.rules.proximity,0.015);assert.equal(scout.account.cash,12345);assert.equal(scout.rulesHistory[0].rules.proximity,0.006);
 assert.equal(ensureChallengers(state,1.8e9+120),false,'no change when rules already match');
 assert.equal(state.challengers.find(c=>c.id==='trend-k2').rulesHistory,undefined,'non-researcher seeds untouched');
});

test('daytrader-range runs the range strategy with owner-authorized size overrides, capped at 100%',async()=>{
 const {seedChallengers,SIZE_OVERRIDE_KEYS}=await import('../scripts/challengers.mjs');
 const state={config:{...DEFAULT_CONFIG,riskPct:0.02,maxAllocation:0.25,maxOpenPositions:4,maxTotalRisk:0.08,maxDailyLoss:0.12},account:createAccount(30000)};
 const ch=seedChallengers(state).find(c=>c.id==='daytrader-range');assert.ok(ch);
 const c=challengerConfig(state,ch,'XRP-USD');assert.equal(c.strategy,'range');assert.equal(c.maxAllocation,0.5);assert.equal(c.maxExposure,1);
 for(const k of ['riskPct','maxOpenPositions','maxTotalRisk','maxDailyLoss'])assert.equal(c[k],state.config[k],k+' stays at the main cap');
 assert.deepEqual([...SIZE_OVERRIDE_KEYS],['maxAllocation','maxExposure']);
 assert.equal(challengerConfig(state,{...ch,caps:{maxAllocation:9}},'XRP-USD').maxAllocation,1,'override clamped to 100%');
 assert.equal(challengerConfig(state,{...ch,caps:{riskPct:0.5}},'XRP-USD').riskPct,0.02,'risk per trade cannot be overridden');
});

test('losing challengers retire after 30 trades and stop entering; owner keepAlive and new rules are exempt',async()=>{
 const {retireLosers,runChallengers:run}=await import('../scripts/challengers.mjs');
 const T=1.8e9,trade=(pnl,i)=>({product:'BTC-USD',pnl,openedAt:T-90000+i,closedAt:T-1000});
 const mk=(id,pnls,extra={})=>({id,rulesSince:new Date((T-100000)*1000).toISOString(),rules:{},account:{...createAccount(30000),trades:pnls.map(trade)},...extra});
 const state={config:{...DEFAULT_CONFIG},account:createAccount(30000),challengers:[
  mk('loser',Array.from({length:30},(_,i)=>i%5?-10:5)),mk('few',Array.from({length:10},()=>-10)),mk('winner',Array.from({length:30},(_,i)=>i%2?20:-10)),
  mk('owner',Array.from({length:30},()=>-10),{keepAlive:true})]};
 assert.deepEqual(retireLosers(state,T),['loser']);
 const loser=state.challengers[0];assert.ok(loser.retired.reason.includes('30 trades'));assert.deepEqual(retireLosers(state,T),[],'already retired');
 const before=JSON.stringify(loser.account);run(state,[{product:'BTC-USD',quote:{price:1,time:new Date(T*1000).toISOString()},bars:[{time:T-7200,open:1,high:1,low:1,close:1,volume:1}]}],T);
 assert.equal(JSON.stringify(loser.account),before,'a retired challenger with no positions does not trade');
 setChallengerRules(loser,{rules:{strategy:'horizontal'}},T+60,'new rules');assert.equal(loser.retired,undefined,'new rules un-retire it');
});
