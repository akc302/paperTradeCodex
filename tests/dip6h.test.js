import test from 'node:test';
import assert from 'node:assert/strict';
import {dipSignal,analyze,STRATEGIES} from '../engine.js';
import {seedChallengers,challengerConfig} from '../scripts/challengers.mjs';
import {DEFAULT_CONFIG,createAccount} from '../engine.js';

const D=86400,S=21600,t0=1_700_006_400;
const bars=(n,step,f)=>Array.from({length:n},(_,i)=>{const c=f(i);return {time:t0+i*step,open:c,high:c*1.01,low:c*0.99,close:c,volume:1};});
const upDaily=bars(150,D,i=>100+i*0.5),downDaily=bars(150,D,i=>200-i*0.5);
const dipSix=bars(60,S,i=>i<50?170:170-(i-49)*4);

test('dip-6h buys a sharp 6h dip only inside a daily uptrend',()=>{
 assert.ok(STRATEGIES.includes('dip-6h'));
 const buy=dipSignal({sixHour:dipSix,daily:upDaily},{stopAtrMultiplier:2,rewardRisk:1,dipRsi:25});
 assert.equal(buy.signal,'BUY');assert.ok(buy.rsi6h<25);assert.ok(buy.stop<buy.price&&buy.target>buy.price);
 assert.equal(dipSignal({sixHour:dipSix,daily:downDaily},{dipRsi:25}).signal,'WAIT');
 assert.equal(dipSignal({sixHour:bars(60,S,()=>170),daily:upDaily},{dipRsi:25}).signal,'WAIT','no dip, no entry');
 assert.equal(dipSignal({sixHour:dipSix.slice(0,10),daily:upDaily}).signal,'WAIT','needs history');
 assert.throws(()=>analyze([],{strategy:'dip-6h',dipRsi:99}),/dip RSI/);
});

test('scout-dip6h is a researcher challenger at 1/4 risk on the dip-6h strategy',()=>{
 const state={config:{...DEFAULT_CONFIG,riskPct:0.02},account:createAccount(30000)};
 const ch=seedChallengers(state).find(c=>c.id==='scout-dip6h');assert.ok(ch);assert.equal(ch.source,'researcher');
 const c=challengerConfig(state,ch,'BTC-USD');assert.equal(c.strategy,'dip-6h');assert.equal(c.dipRsi,25);assert.equal(c.maxHoldHours,48);assert.ok(Math.abs(c.riskPct-0.005)<1e-12);
});
