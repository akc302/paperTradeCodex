import test from 'node:test';import assert from 'node:assert/strict';
import {createAccount,DEFAULT_CONFIG,trendSignal,rankTrend,updateTrailingStop,processQuoteBatch,backtestTrendPortfolio,performanceStats,trendContext,openPaperTrade} from '../engine.js';
import {integrity} from '../scripts/team-report.mjs';
import {refreshSeries} from '../scripts/fetch-history.mjs';
import {compact} from '../scripts/history.mjs';
import {migrateToTrend} from '../scripts/rules.mjs';
import {researchTrend,TREND_CANDIDATES} from '../scripts/strategy-lab.mjs';
const T0=Date.parse('2025-01-01T00:00:00Z')/1000,SIX=21600,DAY=86400;
/** Deterministic series: price path f(t) sampled into 6h and daily bars. */
export function series(f,days,start=T0){
 const bar=(t,g)=>{const o=f(t),c=f(t+g),w=Math.abs(c-o)+o*.01;return {time:t,open:o,close:c,high:Math.max(o,c)+w*.3,low:Math.min(o,c)-w*.3,volume:10};};
 return {sixHour:Array.from({length:days*4},(_,i)=>bar(start+i*SIX,SIX)),daily:Array.from({length:days},(_,i)=>bar(start+i*DAY,DAY))};
}
const up=(rate,wave=.04)=>t=>100*Math.exp(rate*(t-T0)/DAY)*(1+wave*Math.sin((t-T0)/(DAY*9)));
const cfg={...DEFAULT_CONFIG,strategy:'trend-follow',trailAtrMultiplier:3,trendTopN:2,maxHoldHours:0,feeRate:.003,makerFeeRate:.0015,takerFeeRate:.003};
const cut=(h,asOf)=>({sixHour:h.sixHour.filter(b=>b.time+SIX<=asOf),daily:h.daily.filter(b=>b.time+DAY<=asOf)});
test('trend test needs daily close > EMA50, EMA20 > EMA50 and a new 20-bar 6h closing high',()=>{
 const h=series(up(.004,0),200),s=trendSignal(h,cfg);assert.equal(s.signal,'BUY');assert.ok(s.trendPass&&s.stop<s.price&&s.target>=s.price*20&&s.return30>0);
 const down=trendSignal(series(up(-.004,0),200),cfg);assert.equal(down.signal,'WAIT');assert.equal(down.trendPass,false);
 assert.equal(trendSignal(series(up(.004),50),cfg).signal,'WAIT');
});
test('cross-sectional rank keeps only the top N trend-passing coins by 30-day return',()=>{
 const mk=(p,r,pass=true)=>({product:p,signal:{trendPass:pass,return30:r}});
 assert.deepEqual([...rankTrend([mk('A',.1),mk('B',.3),mk('C',.2),mk('D',.9,false)],2)].sort(),['B','C']);
});
test('chandelier stop = highest close since entry - k*ATR and never moves down',()=>{
 const h=series(up(.004,0),200),asOf=T0+150*DAY,p={entry:100,stop:1,openedAt:T0+140*DAY,trail:{atrMultiplier:3,highestClose:0}};
 assert.ok(updateTrailingStop(p,h.sixHour,asOf));const raised=p.stop;assert.ok(raised>1&&raised<h.sixHour.find(b=>b.time+SIX===asOf).close);
 const crash=h.sixHour.filter(b=>b.time+SIX<=asOf).concat([{time:asOf,open:50,high:51,low:40,close:41,volume:1}]);
 updateTrailingStop(p,crash,asOf+SIX);assert.ok(p.stop>=raised);
});
test('quote executor buys trend leaders, persists a rising trail and exits on it',()=>{
 const products=['AAA-USD','BBB-USD','CCC-USD'],rates=[.004,.006,.002],fs=Object.fromEntries(products.map((p,i)=>[p,up(rates[i],0)])),h=Object.fromEntries(products.map(p=>[p,series(fs[p],200)]));
 let now=T0+180*DAY+60;const hourly=p=>{const out=[];for(let t=now-3600*30-60;t+3600<=now;t+=3600){const s=Math.floor(t/3600)*3600,o=fs[p](s),c=fs[p](s+3600);out.push({time:s,open:o,high:Math.max(o,c)*1.001,low:Math.min(o,c)*.999,close:c,volume:1});}return out;};
 const ev=(price)=>products.map(p=>({product:p,quote:{price:String(price(p)),time:new Date(now*1000).toISOString()},bars:hourly(p),history:cut(h[p],now),config:cfg}));
 const a=createAccount(30000),last=p=>cut(h[p],now).sixHour.at(-1).close;
 processQuoteBatch(a,ev(last),{time:now});
 assert.deepEqual(a.positions.map(p=>p.product).sort(),['AAA-USD','BBB-USD']);assert.ok(a.positions.every(p=>p.trail&&p.maxHoldHours===0));
 assert.ok(a.decisions.some(d=>d.product==='CCC-USD'&&/top 2/.test(d.reason)));
 const s0=a.positions[0].stop;now+=10*DAY;processQuoteBatch(a,ev(last),{time:now});assert.ok(a.positions[0].stop>s0,'trail raised');
 assert.ok(integrity(a).ok,JSON.stringify(integrity(a)));
 now+=300;processQuoteBatch(a,ev(p=>p==='BBB-USD'?1:last(p)),{time:now});
 assert.equal(a.trades.at(-1).reason,'trail-stop');assert.equal(a.trades.at(-1).product,'BBB-USD');assert.ok(integrity(a).ok);
});
test('two-year portfolio replay reconciles cash and reports net-after-fee stats',()=>{
 const h={A:series(up(.003),730),B:series(up(.001,.08),730),C:series(up(-.001,.1),730)};
 const r=backtestTrendPortfolio(h,cfg,{initial:30000});assert.ok(r.closedTrades>0);assert.ok(integrity(r.account).ok);assert.ok(r.drawdown>=0&&r.drawdown<1);
 const s=performanceStats(r.account);assert.equal(s.closedTrades,r.closedTrades);assert.ok(Math.abs(s.netPnl-(r.equity-30000))<1e-6);
 assert.ok(r.account.trades.every(t=>['trail-stop','end-of-test'].includes(t.reason)));
});
test('history fetch pages at most 300 bars per request and is incremental',async()=>{
 const calls=[];const fetcher=async u=>{const g=+u.searchParams.get('granularity'),s=Date.parse(u.searchParams.get('start'))/1000,e=Date.parse(u.searchParams.get('end'))/1000,rows=[];for(let t=s;t<=e;t+=g)rows.push([t,9,11,10,10.5,1]);calls.push(rows.length);return {ok:true,status:200,json:async()=>rows};};
 const now=T0+800*DAY+100,bars=await refreshSeries('BTC-USD','6h',[],now,{fetcher,delay:0});
 assert.ok(calls.every(n=>n<=300));assert.equal(bars.length,730*4);assert.ok(bars.at(-1).time+SIX<=now);
 calls.length=0;const again=await refreshSeries('BTC-USD','6h',compact('BTC-USD','6h',bars,'x').candles,now+SIX,{fetcher,delay:0});assert.deepEqual(calls,[1]);assert.equal(again.at(-1).time,bars.at(-1).time+SIX);
});
test('trend migration archives old rules once and never changes risk caps',()=>{
 const s={config:{...DEFAULT_CONFIG,strategy:'aggressive',riskPct:.02,maxTotalRisk:.08},productConfigs:{'BTC-USD':{strategy:'aggressive'}}};
 assert.ok(migrateToTrend(s));assert.equal(s.config.strategy,'trend-follow');assert.equal(s.config.riskPct,.02);assert.deepEqual(s.productConfigs,{});assert.equal(s.legacyRules.productConfigs['BTC-USD'].strategy,'aggressive');assert.equal(migrateToTrend(s),false);
});
test('lab walk-forward ranks k in {2,3,4} on 2-year history and waits without it',()=>{
 assert.ok([2,3,4].every(k=>TREND_CANDIDATES.some(c=>c.changes.trailAtrMultiplier===k)));
 assert.equal(researchTrend({},cfg).status,'collecting-data');
 const h={A:series(up(.003),730),B:series(up(.001,.08),730),C:series(up(-.001,.1),730)},r=researchTrend(h,cfg,T0+730*DAY);
 assert.ok(['validated-on-2y','not-validated'].includes(r.status));assert.equal(r.development.length,TREND_CANDIDATES.length);assert.ok(r.window.selectionEnd<r.window.end);
});
test('trend context merges stored history with completed hourly aggregates only',()=>{
 const hourly=Array.from({length:48},(_,i)=>({time:T0+i*3600,open:1,high:2,low:.5,close:1.5,volume:1}));
 const c=trendContext(hourly,{},T0+47*3600);assert.equal(c.daily.length,1);assert.equal(c.sixHour.length,7);
});
test('portfolio replay counts losses before the first entry attempt toward the daily loss circuit',()=>{
 const h={A:series(up(.003),400),B:series(up(.002,.08),400)},r=backtestTrendPortfolio(h,{...cfg,maxDailyLoss:.001},{initial:10000});
 const days=Object.keys(r.account.dailyRisk);assert.ok(days.length>=80,'every replay day registers its opening equity');
 assert.ok(r.closedTrades<days.length,'days are registered without entry attempts');
});
