/** Challenger paper accounts: alternative rule sets traded on the same quotes, fees and code path as the main account.
 * Each holds its own virtual ledger and drawdown pause. Rules may only change entry/exit keys, never risk caps. */
import {DEFAULT_CONFIG,TREND_DEFAULTS,createAccount,markToMarket,processQuoteBatch} from '../engine.js';
export const RULE_KEYS=Object.freeze(['strategy','patternRequired','regimeFilter','dipRsi','rangeHours','rangeEntry','rangeExit','rangeStopPct','rangeMinWidth','rangeConfirm','maxHoldHours','stopAtrMultiplier','rewardRisk','mlWeights','mlThreshold','trailAtrMultiplier','trendTopN','trendBreakout','trendRankDays','entryOrder','limitOffset','limitChecks','lookback','pivotWindow','proximity','stopBuffer','trendLookback']);
export const CAP_KEYS=Object.freeze(['riskPct','maxTotalRisk','maxAllocation','maxOpenPositions','maxDailyLoss','maxExposure']);
export const SIZE_OVERRIDE_KEYS=Object.freeze(['maxAllocation','maxExposure']);
export const pickRules=(c={})=>Object.fromEntries(Object.entries(c).filter(([k,v])=>RULE_KEYS.includes(k)&&v!==undefined));
const trend=(k,n)=>({strategy:'trend-follow',...TREND_DEFAULTS,trailAtrMultiplier:k,trendTopN:n,maxHoldHours:0,patternRequired:false,entryOrder:'limit'});
/** Seed set (3-5 accounts). The hourly ones keep the previous main rules alive as challengers. */
export function seedChallengers(state){
 const legacy=state.legacyRules??{config:{strategy:'aggressive',maxHoldHours:24,stopAtrMultiplier:2.5,rewardRisk:1.5},productConfigs:{}};
 const hourly={...pickRules(legacy.config),mlWeights:undefined,mlThreshold:undefined,trailAtrMultiplier:undefined},hp=Object.fromEntries(Object.entries(legacy.productConfigs??{}).map(([p,c])=>[p,pickRules(c)]));
 return [
  {id:'trend-k2',label:'Trend follow, 2×ATR trail',source:'seed',rules:trend(2,2),productConfigs:{}},
  {id:'trend-k4',label:'Trend follow, 4×ATR trail',source:'seed',rules:trend(4,2),productConfigs:{}},
  {id:'lab-trend',label:'Lab trend leader (2-year walk-forward)',source:'strategy-lab',rules:trend(3,3),productConfigs:{}},
  {id:'hourly-legacy',label:'Previous hourly rules',source:'archived main rules',rules:hourly,productConfigs:hp},
  {id:'lab-hourly',label:'Lab hourly per-market rules',source:'strategy-lab',rules:hourly,productConfigs:structuredClone(hp)},
  // Always-on day-trade scout at 1/4 of main risk: keeps live trades and evidence flowing when the main trend rules sit out a downtrend.
  {id:'scout-daytrade',label:'Day-trade scout: support bounce (1.5% zone), 4h hold, 1/4 risk',source:'researcher',riskScale:0.25,rules:{strategy:'horizontal',maxHoldHours:4,stopAtrMultiplier:1.5,rewardRisk:1,proximity:0.015,patternRequired:false,regimeFilter:false,entryOrder:'limit',mlWeights:undefined,mlThreshold:undefined,trailAtrMultiplier:undefined},productConfigs:{}},
  // 6h dip buy inside a daily uptrend (2-year walk-forward positive on small samples); 1/4 risk until live evidence builds.
  {id:'scout-dip6h',label:'6h dip scout: RSI<25 in daily uptrend, 48h hold, 1/4 risk',source:'researcher',riskScale:0.25,rules:{strategy:'dip-6h',dipRsi:25,stopAtrMultiplier:2,rewardRisk:1,maxHoldHours:48,patternRequired:false,regimeFilter:false,entryOrder:'limit',mlWeights:undefined,mlThreshold:undefined,trailAtrMultiplier:undefined},productConfigs:{}},
  // Owner request (23 Nov): an always-trading, full-size day trader. Buys the bottom of the 24h range, sells near the top.
  // Backtest over 32 days lost about 11%/month at this size; it runs as evidence for the researcher, not as the main rules.
  {id:'daytrader-range',label:'Day trader: buy 24h range low, sell near high, up to 50% per trade',source:'researcher',keepAlive:true,caps:{maxAllocation:0.5,maxExposure:1},rules:{strategy:'range',rangeHours:24,rangeEntry:0.35,rangeExit:0.8,rangeStopPct:0.02,rangeMinWidth:0.015,rewardRisk:0.3,maxHoldHours:24,patternRequired:false,regimeFilter:false,entryOrder:'limit',mlWeights:undefined,mlThreshold:undefined,trailAtrMultiplier:undefined},productConfigs:{}},
 ];
}
export function freshAccount(state){const a=createAccount(Math.max(1,markToMarket(state.account).equity));Object.assign(a,{compactJournal:true,decisionLimit:300,equityLimit:2600,orderLogLimit:50});return a;}
export function ensureChallengers(state,now=Date.now()/1000){
 const at=new Date(now*1000).toISOString(),have=new Set((state.challengers??[]).map(c=>c.id));
 const added=seedChallengers(state).filter(c=>!have.has(c.id)).map(c=>({...c,rules:JSON.parse(JSON.stringify(c.rules)),account:freshAccount(state),pause:{},startedAt:at,rulesSince:at,rulesVersion:1}));
 // Researcher-owned seeds follow their seed rules: an existing one is updated in place (ledger kept, rulesHistory logged).
 let synced=false;
 for(const seed of seedChallengers(state).filter(c=>c.source==='researcher')){const ch=(state.challengers??[]).find(c=>c.id===seed.id);
  if(ch){ch.riskScale=seed.riskScale;ch.caps=seed.caps;ch.keepAlive=seed.keepAlive;ch.label=seed.label;synced=setChallengerRules(ch,{rules:JSON.parse(JSON.stringify(seed.rules))},now,'researcher seed rules updated')||synced;}}
 if(!added.length)return synced;
 state.challengers=[...(state.challengers??[]),...added];return true;
}
/** Effective per-market config: main caps and fees, the challenger's entry/exit rules. Undefined values remove main-rule keys. */
export function challengerConfig(state,ch,product){
 const c={...DEFAULT_CONFIG,...state.config};for(const k of RULE_KEYS)if(k in (ch.rules??{}))c[k]=ch.rules[k];
 for(const [k,v] of Object.entries(pickRules(ch.productConfigs?.[product])))c[k]=v;
 for(const k of RULE_KEYS)if(c[k]===undefined)delete c[k];
 if(c.strategy!=='trend-follow')for(const k of ['trailAtrMultiplier','trendTopN','trendBreakout','trendRankDays'])delete c[k];
 // A challenger may only scale its risk down (0-1) from the main caps, never up.
 const scale=Number.isFinite(ch.riskScale)?Math.min(1,Math.max(0,ch.riskScale)):1;if(scale<1)c.riskPct=c.riskPct*scale;
 // Owner-authorized size overrides for a challenger: only position size and total exposure, each capped at 100% of its own equity.
 for(const k of SIZE_OVERRIDE_KEYS)if(Number.isFinite(ch.caps?.[k]))c[k]=Math.min(1,Math.max(0.01,ch.caps[k]));
 return {...c,...(state.feeProfile??{})};
}
/** Replace a challenger's rules (e.g. from the lab). Its account is kept; live evaluation restarts at rulesSince. */
export function setChallengerRules(ch,{rules,productConfigs},now=Date.now()/1000,reason='updated'){
 const next={rules:rules?pickRules(rules):ch.rules,productConfigs:productConfigs??ch.productConfigs};
 if(JSON.stringify(next)===JSON.stringify({rules:ch.rules,productConfigs:ch.productConfigs}))return false;
 ch.rulesHistory=[{at:new Date(now*1000).toISOString(),reason,rules:ch.rules,productConfigs:ch.productConfigs},...(ch.rulesHistory??[])].slice(0,30);
 ch.retired=undefined;Object.assign(ch,next);ch.rulesSince=new Date(now*1000).toISOString();ch.rulesVersion=(ch.rulesVersion??1)+1;return true;
}
/** Daily: a challenger whose current rules have lost over at least minTrades closed trades (net < 0 and profit factor
 * below maxProfitFactor) stops opening new positions; open ones are still managed to their exits. New rules un-retire it.
 * Owner-requested challengers (keepAlive) are never retired. Returns the ids retired now. */
export function retireLosers(state,now=Date.now()/1000,{minTrades=30,maxProfitFactor=0.8}={}){
 const out=[];
 for(const ch of state.challengers??[]){if(ch.retired||ch.keepAlive)continue;const since=Date.parse(ch.rulesSince??ch.startedAt??0)/1000||0;
  const t=(ch.account?.trades??[]).filter(x=>x.openedAt>=since);if(t.length<minTrades)continue;
  const net=t.reduce((s,x)=>s+x.pnl,0),gw=t.filter(x=>x.pnl>0).reduce((s,x)=>s+x.pnl,0),gl=-t.filter(x=>x.pnl<=0).reduce((s,x)=>s+x.pnl,0),pf=gl>0?gw/gl:Infinity;
  if(net<0&&pf<maxProfitFactor){ch.retired={at:new Date(now*1000).toISOString(),trades:t.length,net:+net.toFixed(2),profitFactor:+pf.toFixed(2),reason:`Lost $${(-net).toFixed(2)} over ${t.length} trades (profit factor ${pf.toFixed(2)} < ${maxProfitFactor}).`};out.push(ch.id);}
 }
 return out;
}
/** Runs every challenger on the main account's quote events. A failing challenger never blocks the main account. */
export function runChallengers(state,events,time){
 for(const ch of state.challengers??[]){
  try{const account=structuredClone(ch.account),pause=structuredClone(ch.pause??{});
   // Retired challengers only see markets where they still hold a position, so they exit but never enter.
   const own=ch.retired?events.filter(e=>account.positions.some(p=>p.product===e.product)):events;if(!own.length){ch.updatedAt=new Date(time*1000).toISOString();continue;}
   processQuoteBatch(account,own.map(e=>({...e,config:challengerConfig(state,ch,e.product)})),{time,pause});
   for(const e of events)account.lastProcessed[e.product]=e.bars.at(-1).time;
   ch.account=account;ch.pause=pause;ch.lastError=null;ch.updatedAt=new Date(time*1000).toISOString();
  }catch(error){ch.lastError=error.message;}
 }
}
