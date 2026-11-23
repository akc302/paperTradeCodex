import test from 'node:test';import assert from 'node:assert/strict';
import{feeForFill,createAccount,openPaperTrade,closePaperTrade}from'../engine.js';
const c={feeRate:.003,makerFeeRate:.0015,takerFeeRate:.003,feeTier:'synthetic-test-tier',feeObservedAt:'2026-01-01T00:00:00Z',rebateRate:.25};
test('maker/taker applies to liquidity, rebate never invents spendable cash',()=>{assert.equal(feeForFill(1000,'maker',c).gross,1.5);const f=feeForFill(1000,'taker',c);assert.equal(f.gross,3);assert.equal(f.rebatePending,.75);assert.equal(f.rebateCredited,0);assert.equal(f.liveTierChecked,false);assert.equal(f.stale,true)});
test('market entry/taker and resting target/maker journal both fee observations',()=>{const a=createAccount();openPaperTrade(a,{product:'TEST-USD',price:100,stop:95,target:110,time:1},c);const p=a.positions[0];assert.equal(p.entryFeeDetail.liquidity,'taker');closePaperTrade(a,p.id,110,2,'target',c);const t=a.trades[0];assert.equal(t.exit,110);assert.equal(t.exitFeeDetail.liquidity,'maker');assert.equal(t.exitFee,t.quantity*110*.0015);assert.ok(Math.abs(a.cash-(10000+t.pnl))<1e-7);assert.equal(t.rebateCredited,0)});
test('immediate sell remains taker and market slippage applies',()=>{const a=createAccount();openPaperTrade(a,{product:'TEST-USD',price:100,stop:95,target:110,time:1},c);closePaperTrade(a,a.positions[0].id,95,2,'stop',c);assert.equal(a.trades[0].exitFeeDetail.liquidity,'taker');assert.ok(a.trades[0].exit<95)});
test('user-confirmed unlimited rebate reconciles USDC credits, cash and net P&L',()=>{const a=createAccount();const premium={...c,rebateVerified:true};openPaperTrade(a,{product:'TEST-USD',price:100,stop:95,target:110,time:1},premium);const p=a.positions[0];assert.equal(p.entryFeeDetail.rebateCredited,p.entryFee*.25);closePaperTrade(a,p.id,110,2,'target',premium);const t=a.trades[0];assert.equal(t.rebateCredited,t.fees*.25);assert.equal(t.rebatePending,0);assert.ok(Math.abs(a.cash-(10000+t.pnl))<1e-7);assert.ok(Math.abs(a.rebatesUSDC-t.rebateCredited)<1e-9)});

test('owner Advanced 2 tier: 0.30% taker entry, 0.15% maker target, 25% rebate credited',async()=>{
 const {createAccount,openPaperTrade,closePaperTrade,DEFAULT_CONFIG}=await import('../engine.js');
 const tier=JSON.parse((await import('node:fs')).readFileSync(new URL('../data/fee-tier.json',import.meta.url)));
 const c={...DEFAULT_CONFIG,...tier,slippage:0},a=createAccount(10000);
 openPaperTrade(a,{product:'BTC-USD',price:100,stop:95,target:110,time:1e9},c);
 const p=a.positions[0];assert.ok(Math.abs(p.entryFee-p.entry*p.quantity*.003)<1e-9);assert.ok(Math.abs(p.entryFeeDetail.rebateCredited-p.entryFee*.25)<1e-9);
 closePaperTrade(a,p.id,110,1e9+3600,'target',c);const t=a.trades[0];
 assert.ok(Math.abs(t.exitFee-110*t.quantity*.0015)<1e-9);assert.ok(Math.abs(t.rebateCredited-(t.entryFee+t.exitFee)*.25)<1e-9);
});
