import test from 'node:test';import assert from 'node:assert/strict';
import {createAccount,DEFAULT_CONFIG,openPaperTrade,processQuoteBatch,updateDrawdownPause,performanceStats,MAX_EXPOSURE} from '../engine.js';
import {integrity,teamReport} from '../scripts/team-report.mjs';
const T=Date.parse('2026-11-20T12:02:00Z')/1000;
const fees={feeRate:.003,makerFeeRate:.0015,takerFeeRate:.003,rebateRate:.25,rebateVerified:true,feeObservedAt:'2026-11-20T00:00:00Z'};
const cfg={...DEFAULT_CONFIG,...fees,strategy:'aggressive',riskPct:.02,maxTotalRisk:.08,maxAllocation:.25,maxHoldHours:2,maxDailyLoss:.12,entryOrder:'limit',limitChecks:2};
const bars=now=>{const out=[];for(let t=Math.floor(now/3600)*3600-30*3600;t+3600<=now;t+=3600)out.push({time:t,open:100,high:101,low:99,close:100.5,volume:1});return out;};
const ev=(now,price,products=['BTC-USD'],bid)=>products.map(p=>({product:p,quote:{price:String(price),bid:bid&&String(bid),time:new Date(now*1000).toISOString()},bars:bars(now),config:cfg}));
test('limit entry rests below bid/last and fills as maker only on a later quote at or below it',()=>{
 const a=createAccount(30000);processQuoteBatch(a,ev(T,100,undefined,99.9),{time:T});
 assert.equal(a.positions.length,0);assert.equal(a.pendingOrders.length,1);const o=a.pendingOrders[0];assert.ok(Math.abs(o.limit-99.9*(1-.0005))<1e-9);
 processQuoteBatch(a,ev(T+300,o.limit),{time:T+300});
 assert.equal(a.positions.length,1);const p=a.positions[0];assert.equal(p.entry,o.limit);assert.equal(p.entryFeeDetail.liquidity,'maker');assert.equal(p.entryLiquidity,'maker');assert.equal(p.entryFeeDetail.rate,.0015);assert.equal(a.orderLog[0].outcome,'filled');assert.ok(integrity(a).ok);
});
test('unfilled limit orders are cancelled after N checks',()=>{
 const a=createAccount(30000);processQuoteBatch(a,ev(T,100),{time:T});processQuoteBatch(a,ev(T+300,101),{time:T+300});assert.equal(a.pendingOrders.length,1);
 processQuoteBatch(a,ev(T+600,101),{time:T+600});assert.equal(a.orderLog[0].outcome,'cancelled');assert.match(a.orderLog[0].detail,/2 checks/);assert.equal(a.positions.length,0);
});
test('no more than 60% of equity is invested in total',()=>{
 assert.equal(MAX_EXPOSURE,.6);const a=createAccount(10000),c={...DEFAULT_CONFIG,riskPct:.05,maxAllocation:.25,maxTotalRisk:.2,maxOpenPositions:8};
 for(const p of ['A','B','C'])openPaperTrade(a,{product:p,price:100,stop:99,target:110,time:1},c);
 const invested=a.positions.reduce((s,p)=>s+p.quantity*p.entry,0);assert.ok(invested<=6000+1e-6&&invested>5900,String(invested));
 assert.throws(()=>openPaperTrade(a,{product:'D',price:100,stop:99,target:110,time:1},c),/60% invested/);
});
test('equal risk per position: size scales inversely with ATR stop distance',()=>{
 const a=createAccount(100000),c={...DEFAULT_CONFIG,riskPct:.01,maxAllocation:1,maxExposure:1,maxTotalRisk:.2,feeRate:0,slippage:0};
 openPaperTrade(a,{product:'A',price:100,stop:98,target:200,time:1},c);openPaperTrade(a,{product:'B',price:100,stop:96,target:200,time:1},c);
 const [x,y]=a.positions;assert.ok(Math.abs(x.quantity*2-y.quantity*4)<1e-6);assert.equal(x.sizing.method,'equal-risk-stop-distance');
});
test('drawdown pause halves sizes at 10%, blocks at 15% and resumes only when cleared',()=>{
 let p=updateDrawdownPause({},100,1);assert.equal(p.state,'normal');p=updateDrawdownPause(p,89,2);assert.equal(p.state,'halved');assert.equal(p.sizeMultiplier,.5);
 p=updateDrawdownPause(p,84,3);assert.equal(p.state,'blocked');p=updateDrawdownPause(p,99,4);assert.equal(p.state,'blocked','recovery alone does not lift the block');
 p.cleared=true;p=updateDrawdownPause(p,99,5);assert.equal(p.state,'normal');assert.equal(p.peak,99);assert.equal(p.cleared,false);assert.ok(p.history.some(h=>h.event==='cleared'));
});
test('blocked accounts place no new entries; halved accounts risk half; dashboard report shows the state',()=>{
 const pause={state:'blocked',peak:40000,drawdown:.2},a=createAccount(30000);processQuoteBatch(a,ev(T,100),{time:T,pause});
 assert.equal(a.pendingOrders.length,0);assert.ok(a.decisions.some(d=>/Drawdown pause/.test(d.reason)));
 const half={peak:30000/0.88},b=createAccount(30000);processQuoteBatch(b,ev(T,100).map(e=>({...e,config:{...e.config,entryOrder:'market'}})),{time:T,pause:half});
 assert.equal(half.state,'halved');assert.equal(b.positions[0].sizing.riskScale,.5);
 const r=teamReport({account:a,products:[],config:{},pause,updatedAt:new Date(T*1000).toISOString()},{products:{}},T);assert.equal(r.drawdownPause.state,'blocked');assert.ok(r.issues.some(i=>/pause.cleared/.test(i)));
});
test('fee details record maker vs taker per fill',()=>{
 const a=createAccount(30000);openPaperTrade(a,{product:'A',price:100,stop:95,target:120,time:1},{...DEFAULT_CONFIG,...fees});
 const s=performanceStats(a);assert.equal(a.positions[0].entryFeeDetail.liquidity,'taker');assert.equal(s.closedTrades,0);
});

test('no entry when the take-profit at the live quote cannot cover round-trip fees',()=>{
 const rc={...cfg,strategy:'range',rangeHours:24,rangeEntry:0.35,rangeExit:0.8,rangeStopPct:0.02,rangeMinWidth:0.009,rewardRisk:0.1,maxHoldHours:24};
 const rbars=now=>{const out=[];for(let t=Math.floor(now/3600)*3600-40*3600;t+3600<=now;t+=3600)out.push({time:t,open:100.5,high:101,low:100,close:100.5,volume:1});out.at(-1).open=100.1;out.at(-1).close=100.2;return out;};
 const at=(price)=>[{product:'XRP-USD',quote:{price:String(price),bid:String(price),time:new Date(T*1000).toISOString()},bars:rbars(T),config:rc}];
 const a=createAccount(30000);processQuoteBatch(a,at(100.6),{time:T});
 assert.equal(a.pendingOrders.length,0);assert.match(a.decisions.at(-1).reason,/does not cover round-trip fees/);
 const b=createAccount(30000);processQuoteBatch(b,at(100.2),{time:T});assert.equal(b.pendingOrders.length,1,'enough room at a lower quote');
});
