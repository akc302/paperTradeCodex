/** Reproducible public-market logistic regression. Shadow research, never a win guarantee. */
import {normalizeCandles,featuresAt} from '../engine.js';
export {featuresAt};
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const predict=(w,x)=>sigmoid(w.reduce((s,v,i)=>s+v*x[i],0));
export function trainShadow(products,{feeRate=.006,horizon=4}={}){
 const datasets=Object.entries(products).map(([product,value])=>({product,bars:normalizeCandles(value.candles??value)}));
 const times=[...new Set(datasets.flatMap(v=>v.bars.map(b=>b.time)))].sort((a,b)=>a-b);
 if(times.length<240)return {status:'collecting-data',mode:'shadow',reason:'Need at least 240 distinct completed hourly timestamps.'};
 const split=times[Math.floor(times.length*.7)],train=[],holdout=[];
 for(const {product,bars}of datasets)for(let i=24;i+horizon<bars.length;i++){
  if(bars[i+horizon].time!==bars[i].time+horizon*3600)continue;
  const x=featuresAt(bars,i),sample={product,time:bars[i].time,labelTime:bars[i+horizon].time,x,y:bars[i+horizon].close/bars[i].close-1>2*feeRate+.001?1:0};
  if(sample.labelTime<split)train.push(sample);else if(sample.time>=split)holdout.push(sample);
 }
 if(train.length<100||holdout.length<50)return {status:'collecting-data',mode:'shadow',reason:'Insufficient training or holdout samples.'};
 if(new Set(train.map(s=>s.y)).size<2||new Set(holdout.map(s=>s.y)).size<2)return {status:'collecting-data',mode:'shadow',reason:'Both profitable and unprofitable labels are required in training and holdout.'};
 const weights=Array(7).fill(0);
 for(let epoch=0;epoch<160;epoch++){
  const gradient=Array(7).fill(0);
  for(const s of train){const err=predict(weights,s.x)-s.y;for(let j=0;j<7;j++)gradient[j]+=err*s.x[j];}
  for(let j=0;j<7;j++)weights[j]-=.08*(gradient[j]/train.length+(j?.02*weights[j]:0));
 }
 const base=train.reduce((s,v)=>s+v.y,0)/train.length;
 const brier=holdout.reduce((s,v)=>s+(predict(weights,v.x)-v.y)**2,0)/holdout.length;
 const baselineBrier=holdout.reduce((s,v)=>s+(base-v.y)**2,0)/holdout.length;
 const accuracy=holdout.filter(v=>(predict(weights,v.x)>=.5?1:0)===v.y).length/holdout.length;
 return {status:'trained-shadow',mode:'shadow',model:'regularized logistic regression',features:['bias','1h return','4h return','12h return','24h relative range','candle body fraction','distance from 24h low'],horizonHours:horizon,label:'Future four-hour close exceeds modeled round-trip taker costs plus 0.1% slippage buffer',feeRate,splitTime:split,trainSamples:train.length,holdoutSamples:holdout.length,latestTrainingLabel:Math.max(...train.map(s=>s.labelTime)),earliestHoldoutFeature:Math.min(...holdout.map(s=>s.time)),weights,holdout:{brier,baselineBrier,accuracy,beatsConstantBaseline:brier<baselineBrier},predictions:Object.fromEntries(datasets.filter(v=>v.bars.length>24).map(({product,bars})=>[product,{time:bars.at(-1).time,probability:predict(weights,featuresAt(bars,bars.length-1))}])),warning:'Historical candle labels, not real wins. Overlapping samples and market changes limit validity. Shadow-only; does not control trades or promise profits.'};
}

/** Separate model whose labels come from actual closed PAPER trades, not market-return labels. */
export function trainTradeOutcomes(trades,{minimum=100}={}){
 const rows=trades.filter(t=>!String(t.reason).includes('rebalance')&&Number.isFinite(t.pnl)&&Number.isFinite(t.openedAt)&&Number.isFinite(t.closedAt)&&t.closedAt>=t.openedAt&&Number.isFinite(t.learningContext?.featureTime)&&t.learningContext.featureTime+3600<=t.openedAt&&Array.isArray(t.learningContext?.features)&&t.learningContext.features.length===7&&t.learningContext.features.every(Number.isFinite)).sort((a,b)=>a.openedAt-b.openedAt||a.closedAt-b.closedAt);
 const result={status:'collecting-data',mode:'shadow',label:'Positive realized paper P&L after gross fees and credited rebates',eligibleClosedTrades:rows.length,minimumRequired:minimum};
 if(rows.length<minimum)return {...result,reason:'Need more closed trades with frozen entry-time features.'};
 const split=rows[Math.floor(rows.length*.7)].openedAt,train=rows.filter(t=>t.closedAt<split),hold=rows.filter(t=>t.openedAt>=split);
 if(train.length<40||hold.length<20||new Set(train.map(t=>t.pnl>0)).size<2||new Set(hold.map(t=>t.pnl>0)).size<2)return {...result,reason:'Need separate chronological training/holdout samples containing both wins and losses; overlapping trades crossing split excluded.'};
 const weights=Array(7).fill(0);
 for(let epoch=0;epoch<160;epoch++){const g=Array(7).fill(0);for(const t of train){const x=t.learningContext.features,err=predict(weights,x)-(t.pnl>0?1:0);for(let j=0;j<7;j++)g[j]+=err*x[j];}for(let j=0;j<7;j++)weights[j]-=.08*(g[j]/train.length+(j?.02*weights[j]:0));}
 const base=train.filter(t=>t.pnl>0).length/train.length,brier=hold.reduce((s,t)=>s+(predict(weights,t.learningContext.features)-(t.pnl>0?1:0))**2,0)/hold.length,baselineBrier=hold.reduce((s,t)=>s+(base-(t.pnl>0?1:0))**2,0)/hold.length;
 return {...result,status:'trained-shadow',reason:'Shadow evaluation only; no automatic entry filtering or risk changes.',weights,trainSamples:train.length,holdoutSamples:hold.length,latestTrainingOutcome:Math.max(...train.map(t=>t.closedAt)),earliestHoldoutEntry:Math.min(...hold.map(t=>t.openedAt)),holdout:{brier,baselineBrier,beatsConstantBaseline:brier<baselineBrier}};
}
