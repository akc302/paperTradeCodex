/** Daily automatic rule sweep (paper research only). Backtests a grid of entry/exit rules on stored hourly candles
 * (1-year data/history/*-1h.json when present, else data/market.json) and scores each rule on three chronological
 * windows: train (first 50%), validation (next 25%) and unseen (newest 25%), after the configured fees.
 * Writes data/sweep.json for the researcher; it never changes any account's rules. */
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {backtest,DEFAULT_CONFIG,normalizeCandles} from '../engine.js';
import {HISTORY_PRODUCTS,historyFile,readHistoryFile,loadHistory} from './history.mjs';
export function grid(){
 const g=[];
 for(const maxHoldHours of [4,24])for(const stopAtrMultiplier of [1.5,2.5])for(const rewardRisk of [1,1.5])g.push({strategy:'aggressive',patternRequired:true,regimeFilter:true,maxHoldHours,stopAtrMultiplier,rewardRisk});
 for(const proximity of [0.006,0.015])for(const rewardRisk of [1,1.5])g.push({strategy:'horizontal',proximity,maxHoldHours:8,rewardRisk});
 for(const rangeHours of [12,24])for(const rangeEntry of [0.25,0.35])for(const rangeStopPct of [0.01,0.02])g.push({strategy:'range',rangeHours,rangeEntry,rangeExit:0.8,rangeStopPct,rangeMinWidth:0.015,rewardRisk:0.3,maxHoldHours:24});
 for(const rewardRisk of [1,2])for(const maxHoldHours of [24,48])for(const s of ['ema-trend','donchian','rsi-reversion'])g.push({strategy:s,stopAtrMultiplier:2.5,rewardRisk,maxHoldHours});
 // Let-winners-run breakouts (multi-day hold, wide target): tracked daily so a regime change shows up quickly.
 // 6h dip inside a daily uptrend (needs the stored 6h/daily history).
 for(const dipRsi of [25,30])for(const rewardRisk of [1,2])g.push({strategy:'dip-6h',dipRsi,stopAtrMultiplier:2,rewardRisk,maxHoldHours:48});
 for(const rewardRisk of [3,5])g.push({strategy:'donchian',stopAtrMultiplier:3.5,rewardRisk,maxHoldHours:168});
 return g;
}
const sum=xs=>xs.reduce((a,v)=>a+v,0);
export function score(trades,a,b){
 const w=(lo,hi)=>{const t=trades.filter(x=>x.openedAt>=lo&&x.openedAt<hi),gw=sum(t.filter(x=>x.pnl>0).map(x=>x.pnl)),gl=-sum(t.filter(x=>x.pnl<=0).map(x=>x.pnl));
  return {trades:t.length,winRate:t.length?t.filter(x=>x.pnl>0).length/t.length:null,net:+sum(t.map(x=>x.pnl)).toFixed(2),profitFactor:gl>0?+(gw/gl).toFixed(2):(gw>0?99:null)};};
 return {train:w(-Infinity,a),validation:w(a,b),unseen:w(b,Infinity)};
}
export function sweep(series,fees,configs=grid(),{riskPct=0.02,maxAllocation=0.25,history={}}={}){
 const results=configs.map(cfg=>{let trades=[];const cuts=[];
  for(const [product,bars] of Object.entries(series)){if(bars.length<300)continue;const r=backtest(bars,{...DEFAULT_CONFIG,...cfg,...fees,riskPct,maxAllocation,entryOrder:'limit'},{startTime:bars[200].time,history:history[product]});trades.push(...r.account.trades.map(t=>({...t,product})));}
  const times=Object.values(series).flatMap(b=>b.slice(200).map(x=>x.time)).sort((x,y)=>x-y),a=times[Math.floor(times.length*.5)],b=times[Math.floor(times.length*.75)];
  const s=score(trades,a,b);return {config:cfg,...s,passesEarlier:s.train.net>0&&s.validation.net>0,passesAll:s.train.net>0&&s.validation.net>0&&s.unseen.net>0};
 });
 results.sort((x,y)=>(y.passesAll-x.passesAll)||(y.passesEarlier-x.passesEarlier)||(y.unseen.net-x.unseen.net));
 return results;
}
/** Market regime from stored daily candles: share of coins whose last daily close is above EMA50 and EMA20>EMA50,
 * plus BTC's 7- and 30-day change. 'up' when at least half the coins pass, so the team knows when trend rules can trade. */
export function regimeFrom(dailyByProduct){
 const ema=(a,n)=>{const k=2/(n+1);let e=a[0];for(const v of a)e=v*k+e*(1-k);return e;};
 const rows=Object.entries(dailyByProduct).filter(([,d])=>d.length>=60).map(([p,d])=>{const c=d.map(b=>b.close),e20=ema(c,20),e50=ema(c,50);return {product:p,above:c.at(-1)>e50&&e20>e50};});
 const share=rows.length?rows.filter(r=>r.above).length/rows.length:0,btc=dailyByProduct['BTC-USD']??[],ch=n=>btc.length>n?+((btc.at(-1).close/btc.at(-1-n).close-1)*100).toFixed(2):null;
 return {coinsInUptrend:rows.filter(r=>r.above).map(r=>r.product),share:+share.toFixed(2),state:share>=0.5?'up':share>0?'mixed':'down',btc7dPct:ch(7),btc30dPct:ch(30)};
}
export async function loadHourly(products=HISTORY_PRODUCTS,dir='data/history'){
 const out={};let source='data/history 1h (1 year)';
 for(const p of products){const f=await readHistoryFile(historyFile(dir,p,'1h')).catch(()=>null);if(f?.candles?.length)out[p]=normalizeCandles(f.candles);}
 if(Object.keys(out).length<products.length){source='data/market.json (about 32 days; 1-year hourly history not fetched yet)';const m=JSON.parse(await readFile('data/market.json','utf8'));for(const p of products)out[p]=normalizeCandles(m.products?.[p]?.candles??[]);}
 return {series:out,source};
}
/** Runs the grid across worker threads (one per CPU, max 8); results are identical to a single-threaded sweep. */
async function parallelSweep(series,fees,configs=grid(),history={}){
 const n=Math.max(1,Math.min(8,availableParallelism(),configs.length));if(n===1)return sweep(series,fees,configs,{history});
 const chunks=Array.from({length:n},(_,i)=>configs.filter((_,j)=>j%n===i));
 const parts=await Promise.all(chunks.map(chunk=>new Promise((resolve,reject)=>{const w=new Worker(new URL(import.meta.url),{workerData:{series,fees,chunk,history}});w.once('message',resolve);w.once('error',reject);})));
 const results=parts.flat();results.sort((x,y)=>(y.passesAll-x.passesAll)||(y.passesEarlier-x.passesEarlier)||(y.unseen.net-x.unseen.net));return results;
}
if(!isMainThread&&workerData?.chunk){parentPort.postMessage(sweep(workerData.series,workerData.fees,workerData.chunk,{history:workerData.history}));}
export async function run(){
 const {series,source}=await loadHourly(),ft=JSON.parse(await readFile('data/fee-tier.json','utf8')),fees={feeRate:ft.takerFeeRate,makerFeeRate:ft.makerFeeRate,takerFeeRate:ft.takerFeeRate},t0=Date.now();
 const daily={};for(const p of HISTORY_PRODUCTS){const f=await readHistoryFile(historyFile('data/history',p,'1d')).catch(()=>null);daily[p]=normalizeCandles(f?.candles??[]);}
 const history=await loadHistory();
 const results=await parallelSweep(series,fees,grid(),history),bars=Math.max(...Object.values(series).map(b=>b.length));
 const report={at:new Date().toISOString(),source,barsPerCoin:bars,days:+(bars/24).toFixed(1),fees,regime:regimeFrom(daily),windows:'train 50% / validation 25% / unseen newest 25%, by entry time',rulesTested:results.length,
  passingAllWindows:results.filter(r=>r.passesAll).length,best:results[0]??null,top:results.slice(0,12),seconds:+((Date.now()-t0)/1000).toFixed(1)};
 await writeFile('data/sweep.json',JSON.stringify(report,null,1)+'\n');
 console.log(`Sweep: ${report.rulesTested} rules on ${report.days} days, ${report.passingAllWindows} positive in all three windows (${report.seconds}s).`);
}
if(isMainThread&&process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
