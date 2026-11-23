/** Rolling five-hour research. Re-ranks approaches on fresh data each run and hands the 5-minute paper trader its entry/exit rules. Never places real orders or changes risk caps. */
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {backtest,normalizeCandles,DEFAULT_CONFIG,featuresAt,mlProbability,backtestTrendPortfolio,TREND_DEFAULTS} from '../engine.js';
import {loadHistory} from './history.mjs';
import {challengerConfig,setChallengerRules} from './challengers.mjs';
import {eligibleTrades,summarize} from './evidence.mjs';
import {decryptState,encryptState} from './private-state.mjs';
export const EXPERIMENT='rolling-v2';
// Only these keys may be adopted. Sizing, loss limits and costs are never touched.
export const TUNABLE=Object.freeze(['strategy','patternRequired','regimeFilter','maxHoldHours','stopAtrMultiplier','rewardRisk','mlWeights','mlThreshold','trailAtrMultiplier','trendTopN','trendBreakout','trendRankDays']);
/** Two-year trend-follow candidates: chandelier k in {2,3,4} and top 2 or 3 coins. */
export const TREND_CANDIDATES=Object.freeze([2,3,4].flatMap(k=>[2,3].map(n=>({id:`trend-k${k}-top${n}`,changes:{strategy:'trend-follow',trailAtrMultiplier:k,trendTopN:n,trendBreakout:20,trendRankDays:30,maxHoldHours:0}}))));
export const FROZEN=Object.freeze(['riskPct','maxTotalRisk','maxAllocation','maxOpenPositions','maxDailyLoss','maxExposure','feeRate','slippage','makerFeeRate','takerFeeRate','rebateRate','rebateVerified']);
const fresh={mlWeights:undefined,mlThreshold:undefined};
export const CANDIDATES=Object.freeze([
 {id:'current',changes:{}},
 {id:'pattern-confirmation',changes:{patternRequired:true}},
 {id:'horizontal-support',changes:{...fresh,strategy:'horizontal',maxHoldHours:24}},
 {id:'trendline',changes:{...fresh,strategy:'trendline',maxHoldHours:48}},
 {id:'longer-hold',changes:{maxHoldHours:4}},
 {id:'wider-stop',changes:{stopAtrMultiplier:1.5}},
 {id:'higher-reward',changes:{rewardRisk:2}},
 {id:'aggressive-day-hold',changes:{...fresh,strategy:'aggressive',maxHoldHours:24,stopAtrMultiplier:2.5,rewardRisk:1.5}},
 {id:'ema-trend-pullback',changes:{...fresh,strategy:'ema-trend',maxHoldHours:24,stopAtrMultiplier:2.5,rewardRisk:1.5}},
 {id:'donchian-breakout',changes:{...fresh,strategy:'donchian',maxHoldHours:24,stopAtrMultiplier:2.5,rewardRisk:1.5}},
 {id:'regime-block',changes:{regimeFilter:true}},
 {id:'aggressive-day-hold+regime-block',changes:{...fresh,strategy:'aggressive',maxHoldHours:24,stopAtrMultiplier:2.5,rewardRisk:1.5,patternRequired:true,regimeFilter:true}},
 {id:'rsi-reversion',changes:{...fresh,strategy:'rsi-reversion',maxHoldHours:24,stopAtrMultiplier:2.5,rewardRisk:1.5}},
]);

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const avg=xs=>xs.reduce((s,v)=>s+v,0)/xs.length;
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function modelRows(trades){return trades.filter(t=>Number.isFinite(t.pnl)&&Number.isFinite(t.openedAt)&&Number.isFinite(t.closedAt)&&t.closedAt>=t.openedAt&&Number.isFinite(t.learningContext?.featureTime)&&t.learningContext.featureTime+3600<=t.openedAt&&t.learningContext.features?.length===7&&t.learningContext.features.every(Number.isFinite)).map(t=>({x:t.learningContext.features,y:+(t.pnl>0),pnl:t.pnl,openedAt:t.openedAt,closedAt:t.closedAt})).sort((a,b)=>a.openedAt-b.openedAt);}
export function chronologicalSplit(rows){const a=rows[Math.floor(rows.length*.5)]?.openedAt,b=rows[Math.floor(rows.length*.75)]?.openedAt;return {train:rows.filter(t=>t.closedAt<a),validation:rows.filter(t=>t.openedAt>=a&&t.closedAt<b),test:rows.filter(t=>t.openedAt>=b)};}
function fit(kind,rows){
 const prior=(rows.filter(r=>r.y).length+1)/(rows.length+2);
 if(kind==='constant')return ()=>prior;
 if(kind==='logistic'){
  const w=Array(7).fill(0);
  for(let e=0;e<160;e++){const g=Array(7).fill(0);for(const r of rows){const err=sigmoid(dot(w,r.x))-r.y;g.forEach((_,j)=>g[j]+=err*r.x[j]);}w.forEach((_,j)=>w[j]-=.08*(g[j]/rows.length+(j?.02*w[j]:0)));}
  return x=>sigmoid(dot(w,x));
 }
 if(kind==='nearest-neighbors')return x=>{const near=rows.map(r=>({r,d:r.x.reduce((s,v,j)=>s+(v-x[j])**2,0)})).sort((a,b)=>a.d-b.d).slice(0,9);return (near.reduce((s,v)=>s+v.r.y,0)+1)/(near.length+2);};
 if(kind==='gaussian-naive-bayes'){
  const stats=[0,1].map(y=>{const rs=rows.filter(r=>r.y===y);return Array.from({length:7},(_,j)=>{const mean=avg(rs.map(r=>r.x[j]));return {mean,variance:Math.max(.01,avg(rs.map(r=>(r.x[j]-mean)**2)))};});});
  return x=>{const log=[Math.log(1-prior),Math.log(prior)];for(let y=0;y<2;y++)for(let j=1;j<7;j++){const {mean,variance}=stats[y][j];log[y]-=.5*(Math.log(variance)+(x[j]-mean)**2/variance);}return sigmoid(log[1]-log[0]);};
 }
 throw Error('Unknown fixed model');
}
const score=(predict,rows)=>({brier:avg(rows.map(r=>(predict(r.x)-r.y)**2)),samples:rows.length,selectedTrades:rows.filter(r=>predict(r.x)>=.5).length,selectedNetPnl:rows.filter(r=>predict(r.x)>=.5).reduce((s,r)=>s+r.pnl,0),allNetPnl:rows.reduce((s,r)=>s+r.pnl,0)});
export function compareModels(trades){
 const rows=modelRows(trades),base={mode:'shadow',eligible:rows.length,minimum:100};
 if(rows.length<100)return {...base,status:'collecting-data',reason:'Need 100 closed trades with entry-time features; no invented or reconstructed labels.'};
 const {train,validation,test}=chronologicalSplit(rows);
 if(train.length<40||validation.length<20||test.length<20||[train,validation,test].some(rs=>new Set(rs.map(r=>r.y)).size<2))return {...base,status:'collecting-data',reason:'Need 40 training, 20 validation and 20 final-test rows, both classes in each; trades crossing boundaries are purged.'};
 const kinds=['constant','logistic','nearest-neighbors','gaussian-naive-bayes'];
 const ranking=kinds.map(id=>({id,...score(fit(id,train),validation)})).sort((a,b)=>a.brier-b.brier||a.id.localeCompare(b.id));
 const selected=ranking[0].id,predict=fit(selected,train),result=score(predict,test),baseline=score(fit('constant',train),test);
 return {...base,status:'evaluated-shadow',selected,validation:ranking,finalTest:result,baseline,trainSamples:train.length,latestTrainingOutcome:Math.max(...train.map(t=>t.closedAt)),firstValidationEntry:Math.min(...validation.map(t=>t.openedAt)),latestValidationOutcome:Math.max(...validation.map(t=>t.closedAt)),firstTestEntry:Math.min(...test.map(t=>t.openedAt)),passed:selected!=='constant'&&result.brier<baseline.brier&&result.selectedTrades>=10&&result.selectedNetPnl>0,reason:'Validation chooses one model; the final test cannot choose a replacement. Predictive accuracy alone is not profitability; selected-trade P&L is descriptive, not a portfolio replay.'};
}
function metrics(bars,config,startTime){
 const r=backtest(bars,config,{startTime}),trades=r.account.trades;
 return {returnPct:r.returnPct,drawdown:r.drawdown,closedTrades:r.closedTrades,winRate:r.winRate,netPnl:r.realized,grossFees:r.totalFees,rebatesCredited:trades.reduce((s,t)=>s+(t.rebateCredited??0),0),expectancy:trades.length?r.realized/trades.length:null};
}
function segment(bars,config,start,end){return metrics(bars.slice(Math.max(0,start-240),end),config,bars[start].time);}
/** Logistic filter fitted only on bars before the development windows; threshold = 70th percentile of its training scores. */
export function fitEntryFilter(bars,end,feeRate,horizon=4){
 const rows=[];for(let i=24;i+horizon<end;i++)if(bars[i+horizon].time===bars[i].time+horizon*3600)rows.push({x:featuresAt(bars,i),y:+(bars[i+horizon].close/bars[i].close-1>2*feeRate+.001)});
 if(rows.length<100||new Set(rows.map(r=>r.y)).size<2)return null;
 const w=Array(7).fill(0);for(let e=0;e<200;e++){const g=Array(7).fill(0);for(const r of rows){const err=mlProbability(w,r.x)-r.y;for(let j=0;j<7;j++)g[j]+=err*r.x[j];}for(let j=0;j<7;j++)w[j]-=.1*(g[j]/rows.length+(j?.02*w[j]:0));}
 const sc=rows.map(r=>mlProbability(w,r.x)).sort((p,q)=>p-q);return {mlWeights:w,mlThreshold:sc[Math.floor(sc.length*.7)]};
}
function researchProduct(input,config,now){
 const bars=normalizeCandles(input).filter(b=>b.time+3600<=now);
 const contiguous=bars.every((b,i)=>!i||b.time===bars[i-1].time+3600);
 if(bars.length<600||!contiguous)return {status:'collecting-data',decision:'keep',reason:'Need 600 contiguous completed hourly bars; gaps are not filled with invented prices.'};
 // Fresh walk-forward every run: rank on two earlier windows, check once on the newest 25%.
 const cut=Math.floor(bars.length*.75),middle=Math.floor(bars.length*.5),start=Math.floor(bars.length*.3);
 const rank=({id,changes})=>{const c={...config,...changes},folds=[segment(bars,c,start,middle),segment(bars,c,middle,cut)];return {id,changes,folds,score:Math.min(...folds.map(f=>f.returnPct-f.drawdown)),eligible:folds.every(f=>f.closedTrades>=5)};};
 const order=(x,y)=>Number(y.eligible)-Number(x.eligible)||y.score-x.score||x.id.localeCompare(y.id);
 const ranking=CANDIDATES.map(rank).sort(order);
 const leader=ranking.find(r=>r.eligible&&r.id!=='current'),filter=leader&&fitEntryFilter(bars,start,config.feeRate??DEFAULT_CONFIG.feeRate);
 if(filter)ranking.push(rank({id:leader.id+'+ml-filter',changes:{...leader.changes,...filter}}));ranking.sort(order);
 const best=ranking.find(r=>r.eligible)??ranking.find(r=>r.id==='current'),candidateConfig={...config,...best.changes};
 const finalTest={candidate:segment(bars,candidateConfig,cut,bars.length),baseline:segment(bars,config,cut,bars.length)};
 const stress=segment(bars,{...candidateConfig,rebateVerified:false,rebateRate:0,slippage:config.slippage*2},cut,bars.length);
 const c=finalTest.candidate,b=finalTest.baseline,changed=best.id!=='current';
 const passed=changed&&c.closedTrades>=10&&b.closedTrades>=10&&c.returnPct>0&&c.returnPct>b.returnPct&&c.drawdown<=b.drawdown&&stress.returnPct>0;
 // Not profitable yet, but chosen on earlier data and then lost less with no worse drawdown on the unseen window.
 const improved=!passed&&changed&&c.closedTrades>=5&&c.returnPct>b.returnPct&&c.drawdown<=b.drawdown;
 const decision=passed?'adopt-validated':improved?'adopt-improvement':'keep';
 return {experiment:EXPERIMENT,status:passed?'validated-edge':improved?'less-bad-than-current':'no-better-rules',decision,selected:best.id,changes:best.changes,development:ranking.map(({changes,...r})=>r),finalTest,stress,passed,selectionEnd:bars[cut].time,historyStart:bars[0].time,registeredAt:new Date(now*1000).toISOString(),
  reason:passed?`${best.id} ranked first on earlier data and was profitable on the unseen newest 25% after costs, including the no-rebate/double-slippage stress.`:improved?`${best.id} ranked first on earlier data and lost less than the current rules on the unseen newest 25% with no worse drawdown. Adopted as an improvement, not a proven edge.`:'No approach beat the current rules on the unseen newest 25%; current rules kept and every losing experiment recorded.'};
}
/** Where realized losses came from: costs, unreachable targets, time exits, clustered entries. */
export function diagnoseLosses(account,market){
 const trades=(account?.trades??[]).filter(t=>!String(t.reason).includes('rebalance'));const findings=[];
 if(!trades.length)return {closedTrades:0,findings:['No closed trades yet.']};
 const sum=f=>trades.reduce((s,t)=>s+f(t),0),net=sum(t=>t.pnl),costs=sum(t=>(t.fees??0)-(t.rebateCredited??0)),breakeven=2*(trades[0].feeRate??.006)+2*(trades[0].slippage??.0005);
 let measured=0,reached=0,mfe=0;
 for(const t of trades){const bars=normalizeCandles(market.products?.[t.product]?.candles??[]).filter(b=>b.time+3600>t.openedAt&&b.time<t.closedAt);if(!bars.length)continue;const hi=Math.max(...bars.map(b=>b.high));measured++;mfe+=hi/t.entry-1;if(hi>=t.target)reached++;}
 const times=trades.filter(t=>t.reason==='time-exit').length,slots=trades.map(t=>Math.floor(t.openedAt/300)),clustered=slots.filter(v=>slots.filter(w=>w===v).length>=3).length;
 if(net<0&&costs>0)findings.push(`Costs were $${costs.toFixed(2)} (${(costs/Math.abs(net)*100).toFixed(0)}% of the net loss); each trade needs ~${(breakeven*100).toFixed(2)}% to break even.`);
 if(net+costs<0)findings.push(`Before costs, entries still lost $${(-(net+costs)).toFixed(2)}: entry timing had no edge.`);
 if(times/trades.length>.4)findings.push(`${times}/${trades.length} trades ended on the time exit before target or stop.`);
 if(measured)findings.push(`Target touched on ${reached}/${measured} trades; average best move after entry ${(mfe/measured*100).toFixed(2)}% vs average target ${(sum(t=>t.target/t.entry-1)/trades.length*100).toFixed(2)}%.`);
 if(clustered/trades.length>.5)findings.push(`${clustered}/${trades.length} entries opened alongside 2+ other markets in the same check; correlated losses.`);
 return {closedTrades:trades.length,wins:trades.filter(t=>t.pnl>0).length,netPnl:net,netCosts:costs,timeExits:times,targetReached:measured?reached/measured:null,findings};
}
const trendMetrics=r=>({returnPct:r.returnPct,drawdown:r.drawdown,closedTrades:r.closedTrades,winRate:r.winRate,profitFactor:Number.isFinite(r.profitFactor)?r.profitFactor:null,netPnl:r.netPnl,fees:r.totalFees,avgWin:r.avgWin,avgLoss:r.avgLoss});
/** Walk-forward on ~2 years of 6h/daily history: rank candidates on the first 70% (after a 100-day warm-up), test the leader once on the newest 30%. */
export function researchTrend(history,config,now=Date.now()/1000){
 const usable=Object.fromEntries(Object.entries(history??{}).filter(([,h])=>h?.sixHour?.length>=1000&&h?.daily?.length>=250));
 const base={experiment:'trend-2y-v1',timeframe:'6h + 1d',markets:Object.keys(usable)};
 if(Object.keys(usable).length<3)return {...base,status:'collecting-data',reason:'Need at least 3 markets with ~1 year of stored 6h and daily history (run fetch-history).'};
 const first=Math.min(...Object.values(usable).map(h=>h.daily[0].time))+100*86400,last=Math.min(now,Math.max(...Object.values(usable).map(h=>h.sixHour.at(-1).time+21600))),cut=first+(last-first)*.7;
 const current={...DEFAULT_CONFIG,...config,...(config.strategy==='trend-follow'?{}:{strategy:'trend-follow',...TREND_DEFAULTS,maxHoldHours:0})};
 const run=(c,start,end)=>backtestTrendPortfolio(usable,c,{startTime:start,endTime:end});
 const development=TREND_CANDIDATES.map(({id,changes})=>{const r=run({...current,...changes},first,cut);return {id,changes,result:trendMetrics(r),score:r.returnPct-r.drawdown,eligible:r.closedTrades>=10};}).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score||a.id.localeCompare(b.id));
 const leader=development[0],test={candidate:trendMetrics(run({...current,...leader.changes},cut,last)),current:trendMetrics(run(current,cut,last))},full=trendMetrics(run({...current,...leader.changes},first,last));
 const stress=trendMetrics(run({...current,...leader.changes,rebateVerified:false,rebateRate:0,slippage:(current.slippage??.0005)*2},cut,last));
 const passed=leader.eligible&&test.candidate.closedTrades>=5&&test.candidate.returnPct>0&&test.candidate.returnPct>=test.current.returnPct&&test.candidate.drawdown<=test.current.drawdown*1.1&&stress.returnPct>0;
 return {...base,status:passed?'validated-on-2y':'not-validated',selected:leader.id,changes:leader.changes,development:development.map(({changes,...r})=>r),finalTest:test,stress,fullPeriod:full,window:{start:new Date(first*1000).toISOString(),selectionEnd:new Date(cut*1000).toISOString(),end:new Date(last*1000).toISOString()},candidatesTried:TREND_CANDIDATES.length,
  reason:passed?`${leader.id} ranked first on the earlier 70% and was profitable on the unseen newest 30% after fees, slippage and the no-rebate stress.`:`${leader.id} ranked first on the earlier 70% but did not clear the unseen-window checks; recorded, not adopted.`};
}
export function runLab(state,market,now=Date.now()/1000,history={}){
 const trades=eligibleTrades(state.account,now),old=state.strategyLab;
 const inputHash=hash({experiment:EXPERIMENT,history:Object.entries(history).map(([p,h])=>[p,h.sixHour?.length,h.sixHour?.at(-1)?.time,h.daily?.at(-1)?.time]),trades,products:state.products.map(p=>[p,normalizeCandles(market.products[p]?.candles??[]).filter(b=>b.time+3600<=now)]),config:state.config,productConfigs:state.productConfigs,fees:state.feeProfile});
 if(old?.inputHash===inputHash)return old;
 const outcomes=summarize(state.account,0,now),models=compareModels(trades);
 const trendMain=state.config?.strategy==='trend-follow';
 // With trend-follow as the main rules, hourly research is recorded as shadow evidence instead of overriding the main rules per market.
 const labHourly=state.challengers?.find(c=>c.id==='lab-hourly');
 const products=Object.fromEntries(state.products.map(p=>{const r=researchProduct(market.products[p]?.candles??[],trendMain&&labHourly?challengerConfig(state,labHourly,p):{...DEFAULT_CONFIG,...state.config,...(trendMain?state.legacyRules?.config:{}),...(trendMain?state.legacyRules?.productConfigs?.[p]:state.productConfigs?.[p]),...state.feeProfile,...(trendMain?{strategy:state.legacyRules?.productConfigs?.[p]?.strategy??state.legacyRules?.config?.strategy??'aggressive'}:{})},now);return [p,trendMain&&r.decision?.startsWith('adopt')?{...r,decision:'shadow',shadowOf:r.decision}:r];}));
 const trend=researchTrend(history,{...DEFAULT_CONFIG,...state.config,...state.feeProfile},now);
 return {version:2,experiment:EXPERIMENT,inputHash,updatedAt:new Date(now*1000).toISOString(),mode:trendMain?'trend-main-hourly-shadow':'rolling-adoption',trend,outcomes,diagnosis:diagnoseLosses(state.account,market),costDiagnosis:{netFees:outcomes.grossFees-outcomes.rebatesCredited,costFlippedLosses:trades.filter(t=>t.pnl<0&&t.pnl+(t.fees??0)-(t.rebateCredited??0)>0).length},models,products,limitations:['Hourly replay cannot reproduce missed five-minute checks, order-book liquidity or exact historical fills.','Fees use the saved tier, modeled rebates and adverse slippage; this is not a live tier verification.','Re-ranking every five hours on overlapping windows can overfit; every run and its result is kept in history.','An improvement adoption means losing less on unseen data, not a proven profitable edge.','No strategy can guarantee winning trades; risk caps stay fixed.']};
}
/** Writes each market's adopted entry/exit rules where the 5-minute trader reads them. Refuses any risk-cap change. */
export function applyLab(state,report){
 const adopted=[];state.productConfigs??={};
 for(const [product,r] of Object.entries(report.products??{})){
  if(!r.decision?.startsWith('adopt'))continue;
  const before=FROZEN.map(k=>({...state.config,...state.productConfigs[product]})[k]),next={...state.productConfigs[product]};
  for(const k of TUNABLE)if(k in r.changes){if(r.changes[k]===undefined)delete next[k];else next[k]=r.changes[k];}
  if(Object.keys(r.changes).some(k=>!TUNABLE.includes(k))||JSON.stringify(FROZEN.map(k=>({...state.config,...next})[k]))!==JSON.stringify(before))throw Error('Risk cap mutation refused');
  state.productConfigs[product]=next;adopted.push({product,approach:r.selected,decision:r.decision});
 }
 // With trend-follow as the main rules, research feeds the challenger accounts; only the daily promotion gate can change the main rules.
 const fed=[],now=Date.parse(report.updatedAt)/1000,labHourly=state.challengers?.find(c=>c.id==='lab-hourly'),labTrend=state.challengers?.find(c=>c.id==='lab-trend');
 if(labHourly){const pcs=structuredClone(labHourly.productConfigs??{});for(const [product,r] of Object.entries(report.products??{})){if(r.decision!=='shadow'||!r.shadowOf?.startsWith('adopt'))continue;if(Object.keys(r.changes).some(k=>!TUNABLE.includes(k)))throw Error('Risk cap mutation refused');const next={...pcs[product]};for(const [k,v] of Object.entries(r.changes)){if(v===undefined)delete next[k];else next[k]=v;}pcs[product]=next;fed.push({challenger:'lab-hourly',product,approach:r.selected,decision:r.shadowOf});}
  if(fed.length)setChallengerRules(labHourly,{productConfigs:pcs},now,'strategy-lab hourly adoption');}
 if(labTrend&&report.trend?.status==='validated-on-2y'&&setChallengerRules(labTrend,{rules:{...labTrend.rules,...report.trend.changes}},now,`strategy-lab 2-year leader ${report.trend.selected}`))fed.push({challenger:'lab-trend',approach:report.trend.selected,decision:report.trend.status});
 if(fed.length||adopted.length||report.inputHash!==state.strategyLabHistory?.[0]?.inputHash)state.strategyLabHistory=[{at:report.updatedAt,inputHash:report.inputHash,adopted,fedChallengers:fed,trend:report.trend&&{status:report.trend.status,selected:report.trend.selected},decisions:Object.fromEntries(Object.entries(report.products??{}).map(([p,r])=>[p,{selected:r.selected,decision:r.decision,finalTest:r.finalTest&&{candidate:r.finalTest.candidate.returnPct,current:r.finalTest.baseline.returnPct}}]))},...(state.strategyLabHistory??[])].slice(0,300);
 state.strategyLab={...report,adopted,fedChallengers:fed};return adopted;
}
export async function run(){
 const key=process.env.PAPER_STATE_KEY?.trim();if(!key)throw Error('Private research key required; nothing changed.');
 const market=JSON.parse(await readFile('data/market.json','utf8')),paper=JSON.parse(await readFile('data/paper.json','utf8'));let state;
 try{state=await decryptState(JSON.parse(await readFile('data/portfolio.enc.json','utf8')),key);}catch{throw Error('Private research unlock failed; nothing changed.');}
 const now=Date.now()/1000,history=await loadHistory();applyLab(paper,runLab(paper,market,now,history));applyLab(state,runLab(state,market,now,history));
 const cipher=await encryptState(state,key),tmp='data/.strategy-lab.enc.tmp';
 try{await writeFile(tmp,JSON.stringify(cipher,null,2)+'\n',{mode:0o600});await rename(tmp,'data/portfolio.enc.json');}finally{await rm(tmp,{force:true});}
 await writeFile('data/paper.json',JSON.stringify(paper,null,2)+'\n');console.log('Research completed; adopted rules: public '+JSON.stringify(paper.strategyLab.adopted)+'; private results encrypted.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
