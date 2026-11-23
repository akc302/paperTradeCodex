/** Daily challenger promotion. A challenger replaces the main rules only if it beats them on the backtest AND live,
 * after a multiple-testing (deflated-Sharpe-style) penalty. Every decision is kept in promotionHistory. Risk caps never change. */
import {createHash} from 'node:crypto';
import {DEFAULT_CONFIG,backtest,backtestTrendPortfolio,performanceStats,normalizeCandles} from '../engine.js';
import {RULE_KEYS,CAP_KEYS,pickRules,challengerConfig,freshAccount} from './challengers.mjs';
export const LIVE_GATES=Object.freeze({minDays:7,minTrades:20,minProfitFactor:1.2,minPsr:0.95});
const DAY=86400,hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,16);
// Standard normal CDF (Abramowitz-Stegun 7.1.26) and inverse (Acklam).
export function normCdf(x){const t=1/(1+.3275911*Math.abs(x)/Math.SQRT2),y=1-((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x/2);return x>=0?(1+y)/2:(1-y)/2;}
export function normInv(p){const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239],b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572],c=[-.007784894002430293,-.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783],d=[.007784695709041462,.3224671290700398,2.445134137142996,3.754408661907416];
 if(p<=0)return -Infinity;if(p>=1)return Infinity;const lo=.02425;let q,r;
 if(p<lo){q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
 if(p>1-lo){q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
 q=p-.5;r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
/** Bailey & Lopez de Prado: the Sharpe a best-of-N search reaches by luck (SR0, rising with N), then PSR(SR0) of the observed daily returns. */
export function deflatedSharpe(returns,trials){
 const r=returns.filter(Number.isFinite),T=r.length,N=Math.max(1,trials);if(T<10)return {sharpe:null,threshold:null,psr:0,trials:N,observations:T,pass:false};
 const m=r.reduce((s,v)=>s+v,0)/T,sd=Math.sqrt(r.reduce((s,v)=>s+(v-m)**2,0)/(T-1))||1e-12,sr=m/sd;
 const skew=r.reduce((s,v)=>s+((v-m)/sd)**3,0)/T,kurt=r.reduce((s,v)=>s+((v-m)/sd)**4,0)/T,g=.5772156649;
 const sr0=N<2?0:Math.sqrt(1/T)*((1-g)*normInv(1-1/N)+g*normInv(1-1/(N*Math.E)));
 const psr=normCdf((sr-sr0)*Math.sqrt(T-1)/Math.sqrt(Math.max(1e-9,1-skew*sr+(kurt-1)/4*sr*sr)));
 return {sharpe:sr,annualizedSharpe:sr*Math.sqrt(365),threshold:sr0,annualizedThreshold:sr0*Math.sqrt(365),psr,trials:N,observations:T,pass:psr>=LIVE_GATES.minPsr};
}
export function dailyReturns(points){const days=new Map();for(const p of points)days.set(Math.floor(p.time/DAY),p.equity);const e=[...days.values()];return e.slice(1).map((v,i)=>v/e[i]-1);}
const mainConfig=(state,p)=>({...DEFAULT_CONFIG,...state.config,...state.productConfigs?.[p],...(state.feeProfile??{})});
const isTrend=c=>c.strategy==='trend-follow';
const summary=(r,points)=>({returnPct:r.returnPct,drawdown:r.drawdown,closedTrades:r.closedTrades,netPnl:r.netPnl,profitFactor:Number.isFinite(r.profitFactor)?r.profitFactor:null,dailyReturns:dailyReturns(points)});
/** Two-year 6h portfolio replay when both rule sets are trend-follow; otherwise both replay on the stored hourly window (hourly rules have no 2-year data). */
export function backtestRules(configFor,{market,history,trendOnly}){
 const products=Object.keys(history??{}).filter(p=>history[p]?.sixHour?.length>=1000&&history[p]?.daily?.length>=250);
 if(trendOnly&&products.length>=3){
  const sample=configFor(products[0]),start=Math.min(...products.map(p=>history[p].daily[0].time))+100*DAY;
  const r=backtestTrendPortfolio(Object.fromEntries(products.map(p=>[p,history[p]])),sample,{startTime:start,initial:30000});
  return {window:'2-year 6h portfolio replay',...summary({...r,netPnl:r.equity-30000},r.account.equityHistory)};
 }
 const curves=[];let trades=[],gw=0,gl=0;
 for(const [p,v] of Object.entries(market?.products??{})){const bars=normalizeCandles(v.candles??[]);if(bars.length<300)continue;const r=backtest(bars,configFor(p),{history:history?.[p]});curves.push(r.account.equityHistory);trades.push(...r.account.trades);}
 if(!curves.length)return {window:'unavailable',returnPct:null,drawdown:null,closedTrades:0,dailyReturns:[]};
 const times=[...new Set(curves.flatMap(c=>c.map(p=>p.time)))].sort((a,b)=>a-b),idx=curves.map(()=>0),last=curves.map(()=>10000),points=[];
 for(const t of times){curves.forEach((c,i)=>{while(idx[i]<c.length&&c[idx[i]].time<=t)last[i]=c[idx[i]++].equity;});points.push({time:t,equity:last.reduce((s,v)=>s+v,0)});}
 let peak=-Infinity,dd=0;for(const p of points){peak=Math.max(peak,p.equity);dd=Math.max(dd,(peak-p.equity)/peak);}
 for(const t of trades)t.pnl>0?gw+=t.pnl:gl-=t.pnl;const base=curves.length*10000;
 return {window:'hourly replay on stored hourly history (~90 days)',returnPct:points.at(-1).equity/base-1,drawdown:dd,closedTrades:trades.length,netPnl:gw-gl,profitFactor:gl>0?gw/gl:null,dailyReturns:dailyReturns(points)};
}
/** Distinct rule sets ever evaluated, plus the lab's current candidate count: the N in the multiple-testing penalty. */
export function trialCount(state){const lab=(state.strategyLab?.trend?.candidatesTried??0)+(state.strategyLab?.products?Math.max(0,...Object.values(state.strategyLab.products).map(p=>p.development?.length??0)):0);return (state.promotion?.tried?.length??0)+lab;}
export function evaluateChallenger(state,ch,{market,history,now,cache=new Map()}){
 const since=Date.parse(ch.rulesSince)/1000,days=(now-since)/DAY,cfg=p=>challengerConfig(state,ch,p),products=state.products??[];
 const trendOnly=products.length>0&&products.every(p=>isTrend(cfg(p))&&isTrend(mainConfig(state,p)));
 const bt={challenger:backtestRules(cfg,{market,history,trendOnly}),main:cache.get(trendOnly)??cache.set(trendOnly,backtestRules(p=>mainConfig(state,p),{market,history,trendOnly})).get(trendOnly)};
 const dsr=deflatedSharpe(bt.challenger.dailyReturns,trialCount(state));
 const live={challenger:performanceStats(ch.account,{since}),main:performanceStats(state.account,{since})};
 const fmt=s=>({netPnl:s.netPnl,closedTrades:s.closedTrades,profitFactor:Number.isFinite(s.profitFactor)?s.profitFactor:s.profitFactor===Infinity?999:null,maxDrawdown:s.maxDrawdown,winRate:s.winRate});
 const gates={
  backtestBeatsMain:bt.challenger.returnPct!=null&&bt.main.returnPct!=null&&bt.challenger.returnPct>bt.main.returnPct&&bt.challenger.drawdown<=bt.main.drawdown,
  deflatedSharpe:dsr.pass,
  liveDays:days>=LIVE_GATES.minDays,
  liveTrades:live.challenger.closedTrades>=LIVE_GATES.minTrades,
  liveNetBeatsMain:live.challenger.netPnl>live.main.netPnl,
  liveProfitFactor:(live.challenger.profitFactor??0)>=LIVE_GATES.minProfitFactor,
  liveDrawdownNoWorse:live.challenger.maxDrawdown<=live.main.maxDrawdown,
 };
 const pass=Object.values(gates).every(Boolean);
 return {challenger:ch.id,rulesVersion:ch.rulesVersion,rulesHash:hash(ch.rules)+hash(ch.productConfigs),decision:pass?'eligible':'rejected',gates,failed:Object.entries(gates).filter(([,v])=>!v).map(([k])=>k),liveDays:+days.toFixed(2),backtest:{window:bt.challenger.window,challenger:{...bt.challenger,dailyReturns:undefined},main:{...bt.main,dailyReturns:undefined}},deflatedSharpe:dsr,live:{challenger:fmt(live.challenger),main:fmt(live.main)}};
}
/** Once a day: evaluate all challengers, promote at most one (highest live net), log every decision. */
export function reviewChallengers(state,{market,history,now=Date.now()/1000,evaluate=evaluateChallenger}){
 const day=new Date(now*1000).toISOString().slice(0,10);state.promotion??={tried:[]};
 if(state.promotion.reviewDate===day||!state.challengers?.length)return null;
 for(const ch of state.challengers){const h=hash(ch.rules)+hash(ch.productConfigs);if(!state.promotion.tried.includes(h))state.promotion.tried.push(h);}
 const cache=new Map(),results=state.challengers.map(ch=>evaluate(state,ch,{market,history,now,cache}));
 const winner=results.filter(r=>r.decision==='eligible').sort((a,b)=>b.live.challenger.netPnl-a.live.challenger.netPnl)[0];
 const at=new Date(now*1000).toISOString();let promoted=null;
 if(winner){const ch=state.challengers.find(c=>c.id===winner.challenger),caps=CAP_KEYS.map(k=>state.config[k]);
  const old={rules:pickRules(state.config),productConfigs:structuredClone(state.productConfigs??{})};
  const next={...state.config};for(const k of RULE_KEYS)delete next[k];Object.assign(next,ch.rules);
  for(const k of RULE_KEYS)if(next[k]===undefined)delete next[k];
  if(JSON.stringify(CAP_KEYS.map(k=>next[k]))!==JSON.stringify(caps))throw Error('Risk cap mutation refused');
  state.rulesHistory=[{at,event:'promoted-challenger',challenger:ch.id,previous:old,next:{rules:ch.rules,productConfigs:ch.productConfigs}},...(state.rulesHistory??[])].slice(0,200);
  state.config=next;state.productConfigs=structuredClone(ch.productConfigs??{});
  // The displaced main rules continue as this challenger slot, on a fresh account.
  Object.assign(ch,{label:`Previous main rules (replaced by ${ch.id})`,source:'demoted main rules',rules:old.rules,productConfigs:old.productConfigs,account:freshAccount(state),pause:{},startedAt:at,rulesSince:at,rulesVersion:(ch.rulesVersion??1)+1});
  promoted=winner.challenger;
 }
 const entries=results.map(r=>({at,...r,decision:r.challenger===promoted?'promoted':r.decision==='eligible'?'eligible-not-chosen':'rejected'}));
 state.promotionHistory=[...entries,...(state.promotionHistory??[])].slice(0,500);
 state.promotion={...state.promotion,reviewDate:day,reviewedAt:at,promoted,trials:trialCount(state),gates:{...LIVE_GATES,backtest:'beat main return with no worse drawdown',multipleTesting:'PSR above the expected max Sharpe of N trials >= 95%'}};
 return {promoted,results:entries};
}
