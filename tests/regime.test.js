import test from 'node:test';
import assert from 'node:assert/strict';
import {downtrendRegime,analyze} from '../engine.js';
import {CANDIDATES,TUNABLE,FROZEN} from '../scripts/strategy-lab.mjs';

const t0=1_700_000_000-1_700_000_000%3600;
const series=f=>Array.from({length:120},(_,i)=>{const c=f(i);return {time:t0+i*3600,open:c*1.001,high:c*1.004,low:c*0.996,close:c,volume:100};});

test('downtrend regime blocks only when EMA20<EMA50 and 24h drop is at least 3%',()=>{
  assert.equal(downtrendRegime(series(i=>100-i*0.3)).blocked,true);
  assert.equal(downtrendRegime(series(i=>100+i*0.3)).blocked,false);
  assert.equal(downtrendRegime(series(i=>100-i*0.01)).blocked,false,'mild drift below -3%/24h is not blocked');
  assert.equal(downtrendRegime(series(i=>100).slice(0,40)).blocked,false,'short history never blocks');
});

test('regimeFilter turns a BUY into WAIT in a downtrend and validates its type',()=>{
  const bars=series(i=>100-i*0.3);
  assert.equal(analyze(bars,{strategy:'aggressive'}).signal,'BUY');
  const r=analyze(bars,{strategy:'aggressive',regimeFilter:true});assert.equal(r.signal,'WAIT');assert.match(r.reason,/regime filter/);
  assert.equal(analyze(series(i=>100+i*0.3),{strategy:'aggressive',regimeFilter:true}).reason.includes('regime'),false);
  assert.throws(()=>analyze(bars,{regimeFilter:'yes'}),/regime filter/);
});

test('regime candidates exist, use only tunable keys and never touch frozen caps',()=>{
  const ids=CANDIDATES.map(c=>c.id);assert.ok(ids.includes('regime-block'));assert.ok(ids.includes('aggressive-day-hold+regime-block'));
  assert.ok(TUNABLE.includes('regimeFilter'));assert.ok(!FROZEN.includes('regimeFilter'));
  for(const c of CANDIDATES)assert.ok(Object.keys(c.changes).every(k=>!FROZEN.includes(k)));
});
