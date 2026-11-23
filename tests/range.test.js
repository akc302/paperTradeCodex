import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,STRATEGIES} from '../engine.js';
const t0=1_700_006_400;
const bar=(i,o,h,l,c)=>({time:t0+i*3600,open:o,high:h,low:l,close:c,volume:1});
// 40 bars oscillating between 100 and 104, last bar closes near the range low.
const ranging=Array.from({length:40},(_,i)=>{const c=i%8<4?101:103;return bar(i,c,104,100,c);});
test('range strategy buys near the 24h low with a target near the high and a stop below the low',()=>{
 assert.ok(STRATEGIES.includes('range'));
 const bars=[...ranging,bar(40,100.6,100.9,100.2,100.8)];
 const r=analyze(bars,{strategy:'range',rangeHours:24,rangeEntry:0.35,rangeExit:0.8,rangeStopPct:0.02,rangeMinWidth:0.015,rewardRisk:0.3});
 assert.equal(r.signal,'BUY');assert.ok(Math.abs(r.target-103.2)<1e-9);assert.ok(Math.abs(r.stop-98)<1e-9);
 const high=analyze([...ranging,bar(40,103,103.8,102.9,103.5)],{strategy:'range',rangeHours:24});assert.equal(high.signal,'WAIT');
 const tight=Array.from({length:41},(_,i)=>bar(i,100,100.3,99.9,100.1));assert.equal(analyze(tight,{strategy:'range',rangeHours:24}).signal,'WAIT','too narrow for fees');
 assert.throws(()=>analyze(bars,{strategy:'range',rangeEntry:0.9}),/range entry/);
});
