import test from 'node:test';import assert from 'node:assert/strict';
import {score,grid} from '../scripts/sweep.mjs';
test('sweep scores train/validation/unseen windows by entry time and the grid covers several strategies',()=>{
 const t=[{openedAt:1,pnl:10},{openedAt:2,pnl:-5},{openedAt:5,pnl:3},{openedAt:9,pnl:-1}];const s=score(t,3,8);
 assert.deepEqual([s.train.trades,s.train.net,s.validation.trades,s.unseen.net],[2,5,1,-1]);assert.equal(s.train.profitFactor,2);
 assert.ok(new Set(grid().map(c=>c.strategy)).size>=5);
});
import {regimeFrom} from '../scripts/sweep.mjs';
test('regime: share of coins in a daily uptrend and BTC change',()=>{
 const d=(f)=>Array.from({length:80},(_,i)=>({time:i*86400,open:1,high:1,low:1,close:f(i),volume:1}));
 const r=regimeFrom({'BTC-USD':d(i=>100+i),'ETH-USD':d(i=>200-i),'SOL-USD':d(i=>50+i*0.5)});
 assert.deepEqual(r.coinsInUptrend,['BTC-USD','SOL-USD']);assert.equal(r.state,'up');assert.equal(r.share,0.67);assert.equal(r.btc7dPct,+((179/172-1)*100).toFixed(2));
 assert.equal(regimeFrom({'ETH-USD':d(i=>200-i)}).state,'down');
});
