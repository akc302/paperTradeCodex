/** Pure market analysis plus a virtual, long-only ledger. No account or order APIs. */
export const DEFAULT_CONFIG = Object.freeze({strategy:'horizontal',lookback:48,pivotWindow:3,proximity:0.006,stopBuffer:0.004,rewardRisk:2,riskPct:0.01,feeRate:0.006,slippage:0.0005,maxAllocation:0.25,trendLookback:180,maxHoldHours:48,maxDailyLoss:0.04,maxOpenPositions:4,maxTotalRisk:0.03,stopAtrMultiplier:1.25});

// A take-profit must clear both fees by at least this much at the live quote, or the entry is skipped.
export const MIN_TARGET_EDGE=0.001;
export const STRATEGIES = Object.freeze(['horizontal','trendline','aggressive','ema-trend','donchian','rsi-reversion','trend-follow','dip-6h','range']);
/** Trend-follow defaults: chandelier k, how many top-ranked coins may be held, 6h breakout length, ranking window (days). */
export const TREND_DEFAULTS = Object.freeze({trailAtrMultiplier:3,trendTopN:2,trendBreakout:20,trendRankDays:30});
/** Trend positions have no fixed target; this far-away safety target only satisfies the ledger's bracket invariant. */
export const TREND_SAFETY_TARGET = 20;
/** At most this share of equity may be invested across all open positions (correlated crypto exposure cap). */
export const MAX_EXPOSURE = 0.6;
/** Equity-peak drawdown pauses: halve new position sizes at 10%, block new entries at 15% until pause.cleared is set. */
export const DRAWDOWN_RULES = Object.freeze({halveAt:0.10,blockAt:0.15});
/** Simulated maker entries: limit below bid/last by this offset, cancelled after this many unfilled 5-minute checks. */
export const LIMIT_DEFAULTS = Object.freeze({limitOffset:0.0005,limitChecks:3});
const finite = (n) => Number.isFinite(Number(n));
const positive = (n) => finite(n) && Number(n)>0;
const cfg = (c={}) => {
  const x={...DEFAULT_CONFIG,...c};
  if(!Number.isInteger(x.lookback)||x.lookback<12||x.lookback>300||!Number.isInteger(x.pivotWindow)||x.pivotWindow<1||x.pivotWindow>10) throw new Error('Invalid level window.');
  if(!positive(x.proximity)||x.proximity>0.1||!positive(x.stopBuffer)||x.stopBuffer>0.1||!positive(x.rewardRisk)||x.rewardRisk>10) throw new Error('Invalid strategy parameters.');
  if(!positive(x.riskPct)||x.riskPct>0.05||!positive(x.maxAllocation)||x.maxAllocation>1||!finite(x.feeRate)||x.feeRate<0||x.feeRate>0.05||!finite(x.slippage)||x.slippage<0||x.slippage>0.05) throw new Error('Invalid paper risk or execution settings.');
  if(x.mlWeights!=null&&(!Array.isArray(x.mlWeights)||x.mlWeights.length!==7||!x.mlWeights.every(Number.isFinite)||!Number.isFinite(x.mlThreshold)||x.mlThreshold<0||x.mlThreshold>1))throw new Error('Invalid ML entry filter.');
  if(!STRATEGIES.includes(x.strategy)||!Number.isInteger(x.trendLookback)||x.trendLookback<60||x.trendLookback>720)throw new Error('Invalid strategy or trendline window.');
  if(!finite(x.maxHoldHours)||x.maxHoldHours<0||x.maxHoldHours>720||!finite(x.maxDailyLoss)||x.maxDailyLoss<0||x.maxDailyLoss>0.5||!Number.isInteger(x.maxOpenPositions)||x.maxOpenPositions<1||x.maxOpenPositions>20||!positive(x.maxTotalRisk)||x.maxTotalRisk>0.2)throw new Error('Invalid portfolio risk limits.');
  if(x.regimeFilter!=null&&typeof x.regimeFilter!=='boolean')throw new Error('Invalid regime filter.');
  if(x.rangeHours!=null&&(!Number.isInteger(x.rangeHours)||x.rangeHours<6||x.rangeHours>168))throw new Error('Invalid range window.');
  if(x.rangeEntry!=null&&(!finite(x.rangeEntry)||x.rangeEntry<=0||x.rangeEntry>0.5))throw new Error('Invalid range entry zone.');
  if(x.rangeExit!=null&&(!finite(x.rangeExit)||x.rangeExit<0.5||x.rangeExit>1))throw new Error('Invalid range exit level.');
  if(x.rangeStopPct!=null&&(!finite(x.rangeStopPct)||x.rangeStopPct<0||x.rangeStopPct>0.1))throw new Error('Invalid range stop.');
  if(x.rangeConfirm!=null&&typeof x.rangeConfirm!=='boolean')throw new Error('Invalid range confirmation flag.');
  if(x.rangeMinWidth!=null&&(!finite(x.rangeMinWidth)||x.rangeMinWidth<0||x.rangeMinWidth>0.5))throw new Error('Invalid range width.');
  if(x.dipRsi!=null&&(!finite(x.dipRsi)||x.dipRsi<5||x.dipRsi>50))throw new Error('Invalid dip RSI threshold.');
  if(!positive(x.stopAtrMultiplier)||x.stopAtrMultiplier<.5||x.stopAtrMultiplier>4)throw new Error('Invalid stop ATR multiplier.');
  if(x.maxExposure!=null&&(!positive(x.maxExposure)||x.maxExposure>1))throw new Error('Invalid exposure cap.');
  if(x.entryOrder!=null&&!['market','limit'].includes(x.entryOrder))throw new Error('Invalid entry order type.');
  if(x.limitOffset!=null&&(!finite(x.limitOffset)||x.limitOffset<0||x.limitOffset>.02)||x.limitChecks!=null&&(!Number.isInteger(x.limitChecks)||x.limitChecks<1||x.limitChecks>36))throw new Error('Invalid limit entry settings.');
  if(x.trailAtrMultiplier!=null&&(!positive(x.trailAtrMultiplier)||x.trailAtrMultiplier<1||x.trailAtrMultiplier>6))throw new Error('Invalid trailing ATR multiplier.');
  for(const [k,lo,hi] of [['trendTopN',1,8],['trendBreakout',5,100],['trendRankDays',5,120]])if(x[k]!=null&&(!Number.isInteger(x[k])||x[k]<lo||x[k]>hi))throw new Error(`Invalid ${k}.`);
  return x;
};
/** Per-fill costs use a saved fee observation; this never claims an authenticated live check. */
export function feeForFill(notional,liquidity,config={},time=Date.now()/1000){
 const rate=liquidity==='maker'?(config.makerFeeRate??config.feeRate??DEFAULT_CONFIG.feeRate):(config.takerFeeRate??config.feeRate??DEFAULT_CONFIG.feeRate);
 if(!Number.isFinite(rate)||rate<0||rate>.05||!Number.isFinite(notional)||notional<0)throw new Error('Invalid modeled fill fee.');
 const gross=notional*rate,credit=config.rebateVerified===true&&gross*(config.rebateRate??0)>=.000001?gross*config.rebateRate:0,observedAt=config.feeObservedAt??null;
 const age=observedAt?Math.max(0,time-Date.parse(observedAt)/1000):null;
 return {liquidity,rate,gross,tier:config.feeTier??'Unverified estimate',observedAt,checkedAt:time,source:observedAt?'Coinbase MCP saved snapshot':'Configured estimate',liveTierChecked:false,snapshotAgeSeconds:age,stale:age==null||age>86400,rebatePending:config.rebateVerified?0:gross*(config.rebateRate??0),rebateCredited:credit,rebateStatus:config.rebateVerified?'Simulated USDC credit; Premium eligibility user-confirmed':config.rebateRate?'Pending eligibility/cap verification; excluded from cash and P&L':'Not modeled'};
}
function seconds(t){const n=Number(t);return Number.isFinite(n)?(n>1e12?n/1000:n):Date.parse(t)/1000;}
function executionAt(price,stop,target,c){
  const entry=price*(1+c.slippage),cost=entry*(1+c.feeRate);
  const risk=cost-stop*(1-c.slippage)*(1-c.feeRate);
  const reward=target*(1-c.slippage)*(1-c.feeRate)-cost;
  return {entry,risk,reward};
}
export function normalizeCandles(input){
  const rows=Array.isArray(input)?input:input?.candles;
  if(!Array.isArray(rows))return [];
  const map=new Map();
  for(const r of rows){
    if(!r||typeof r!=='object')continue;
    const c=Array.isArray(r)?{time:seconds(r[0]),low:+r[1],high:+r[2],open:+r[3],close:+r[4],volume:+r[5]}:{time:seconds(r.time??r.start),open:+r.open,high:+r.high,low:+r.low,close:+r.close,volume:+(r.volume??0)};
    if(!Number.isFinite(c.time)||c.time<0||![c.open,c.high,c.low,c.close].every(positive)||!Number.isFinite(c.volume)||c.volume<0||c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close,c.high))continue;
    map.set(c.time,c);
  }
  return [...map.values()].sort((a,b)=>a.time-b.time);
}

export function analyze(input,config={}){
  const c=cfg(config);
  const indicator={'ema-trend':analyzeEmaTrend,donchian:analyzeDonchian,'rsi-reversion':analyzeRsiReversion,'trend-follow':analyzeTrendFollow,'dip-6h':analyzeDip6h,range:analyzeRange}[c.strategy];
  const result=indicator?indicator(input,c):c.strategy==='aggressive'?analyzeAggressive(input,c):c.strategy==='trendline'?analyzeTrendline(input,c):{...analyzeHorizontal(input,c),strategy:'horizontal',setup:'support-bounce',trend:'unconfirmed',trendlines:[]};
  const completed=normalizeCandles(input);result.pattern=patternConfirmation(completed,{asOf:(completed.at(-1)?.time??0)+3600});
  if(c.patternRequired===true&&result.signal==='BUY'&&!result.pattern.confirmed){result.signal='WAIT';result.reason='Research pattern filter: no completed-candle confirmation.';}
  if(c.regimeFilter===true&&result.signal==='BUY'){const r=downtrendRegime(completed);if(r.blocked){result.signal='WAIT';result.reason=`Research regime filter: downtrend (EMA20 below EMA50, 24h ${(r.change24h*100).toFixed(1)}%).`;}}
  if(c.mlWeights&&result.signal==='BUY'){const x=featuresAt(completed,completed.length-1),p=x?mlProbability(c.mlWeights,x):null;result.mlProbability=p;if(p==null||p<c.mlThreshold){result.signal='WAIT';result.reason=`ML entry filter: ${p==null?'features unavailable':`probability ${(p*100).toFixed(1)}% below ${(c.mlThreshold*100).toFixed(1)}% threshold`}.`;}}
  return result;
}

/** Downtrend regime: EMA20 below EMA50 on completed hourly closes and 24h change at or below -3%. Needs 50 bars; otherwise not blocked. */
export function downtrendRegime(bars,{minDrop=-0.03}={}){
  if(!Array.isArray(bars)||bars.length<50)return {blocked:false,change24h:null};
  const closes=bars.map(b=>b.close),e20=emaSeries(closes,20).at(-1),e50=emaSeries(closes,50).at(-1),change24h=closes.at(-1)/closes.at(-25)-1;
  return {blocked:e20<e50&&change24h<=minDrop,change24h};
}

/** Aggregate already-completed, hourly bars. Incomplete or noncontiguous UTC groups are omitted. */
export function aggregateCandles(input,hours=4){
  if(!Number.isInteger(hours)||hours<1||hours>24)throw new Error('Aggregation hours must be an integer from 1 to 24.');
  const interval=hours*3600,groups=new Map();
  for(const b of normalizeCandles(input)){const start=Math.floor(b.time/interval)*interval;if(!groups.has(start))groups.set(start,[]);groups.get(start).push(b);}
  const result=[];
  for(const [time,bars] of groups){
    if(bars.length!==hours||!bars.every((b,i)=>b.time===time+i*3600))continue;
    result.push({time,open:bars[0].open,high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low)),close:bars.at(-1).close,volume:bars.reduce((sum,b)=>sum+b.volume,0)});
  }
  return result;
}

function pivots(bars,window){
  const lows=[],highs=[];
  for(let i=window;i<bars.length-window;i++){
    const around=bars.slice(i-window,i+window+1);
    if(around.every(b=>b.low>=bars[i].low)&&around.some(b=>b.low>bars[i].low))lows.push({index:i,time:bars[i].time,price:bars[i].low});
    if(around.every(b=>b.high<=bars[i].high)&&around.some(b=>b.high<bars[i].high))highs.push({index:i,time:bars[i].time,price:bars[i].high});
  }
  return {lows,highs};
}

function findTrendline(points,bars,type,c,atr){
  const recent=points.slice(-30),lastIndex=bars.length-1,tolerance=Math.max(bars.at(-1).close*c.proximity,atr*0.2);
  let best=null;
  for(let a=0;a<recent.length-1;a++)for(let z=a+1;z<recent.length;z++){
    const first=recent[a],end=recent[z];if(end.index-first.index<42)continue;
    const slope=(end.price-first.price)/(end.index-first.index);
    if(type==='support'?slope<=0:slope>=0)continue;
    const at=i=>first.price+slope*(i-first.index),touches=[];
    for(const p of recent){if(p.index<first.index||Math.abs(p.price-at(p.index))>tolerance)continue;if(!touches.length||p.index-touches.at(-1).index>=3)touches.push(p);}
    if(touches.length<3||touches.at(-1).index-touches[0].index<42)continue;
    // The latest closed 4h candle may break a resistance line. Older closes may not.
    const violated=bars.slice(first.index,-1).some((b,offset)=>type==='support'?b.close<at(first.index+offset)-2*tolerance:b.close>at(first.index+offset)+2*tolerance);
    if(violated)continue;
    const score=touches.length*100+(touches.at(-1).index-touches[0].index)+touches.at(-1).index/100;
    if(!best||score>best.score)best={type,direction:type==='support'?'rising':'descending',slope,originTime:first.time,originPrice:first.price,startTime:touches[0].time,endTime:bars.at(-1).time,startPrice:at(touches[0].index),endPrice:at(lastIndex),price:at(lastIndex),previousPrice:at(lastIndex-1),touches:touches.map(({time,price})=>({time,price})),spanBars:touches.at(-1).index-touches[0].index,score};
  }
  if(best)delete best.score;
  return best;
}

function analyzeTrendline(input,c){
  const hourly=normalizeCandles(input),last=hourly.at(-1);
  let four=aggregateCandles(hourly,4).slice(-c.trendLookback);
  for(let i=four.length-1;i>0;i--)if(four[i].time!==four[i-1].time+14400){four=four.slice(i);break;}
  const base={strategy:'trendline',setup:'none',trend:'unconfirmed',price:last?.close??null,support:null,resistance:null,atr:0,signal:'WAIT',reason:'Need confirmed 4h trendline touches spanning at least one week.',levels:[],trendlines:[],stop:null,target:null,confirmation:false,structure:false,estimatedRewardRisk:null};
  if(four.length<43+2*c.pivotWindow)return base;
  const latest=four.at(-1),previous=four.at(-2);
  if(last.time+3600-latest.time-14400>3*3600){base.reason='Waiting for a contiguous, completed 4h candle.';return base;}
  const ranges=four.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-four[i].close),Math.abs(b.low-four[i].close)));
  base.atr=ranges.slice(-14).reduce((s,v)=>s+v,0)/Math.min(14,ranges.length);
  const {lows,highs}=pivots(four,c.pivotWindow);
  const higherLows=lows.length>=2&&lows.at(-1).price>lows.at(-2).price;
  const higherHighs=highs.length>=2&&highs.at(-1).price>highs.at(-2).price;
  const lowerLows=lows.length>=2&&lows.at(-1).price<lows.at(-2).price;
  const lowerHighs=highs.length>=2&&highs.at(-1).price<highs.at(-2).price;
  base.trend=higherLows&&higherHighs?'bullish':lowerLows&&lowerHighs?'bearish':'mixed';
  base.levels=highs.map(p=>({price:p.price,type:'resistance',touches:1})).concat(lows.map(p=>({price:p.price,type:'support',touches:1}))).sort((a,b)=>a.price-b.price);
  base.resistance=base.levels.find(l=>l.type==='resistance'&&l.price>base.price)?.price??null;
  base.support=base.levels.filter(l=>l.type==='support'&&l.price<base.price).at(-1)?.price??null;
  const rising=findTrendline(lows,four,'support',c,base.atr),descending=findTrendline(highs,four,'resistance',c,base.atr);
  base.trendlines=[rising,descending].filter(Boolean);
  const bounce=rising&&latest.low<=rising.price*(1+c.proximity)&&latest.close>rising.price&&latest.close<=rising.price*(1+2*c.proximity)&&latest.close>latest.open&&latest.close>previous.close;
  const breakout=descending&&previous.close<=descending.previousPrice&&latest.close>descending.price*(1+c.proximity*0.25)&&latest.close>latest.open;
  const breakStructure=breakout&&higherLows&&highs.length&&latest.close>highs.at(-1).price;
  if(bounce){base.setup='rising-support-bounce';base.structure=higherLows&&higherHighs;base.support=rising.price;}
  else if(breakout){base.setup='descending-resistance-break';base.structure=Boolean(breakStructure);if(base.structure)base.trend='bullish';base.support=descending.price;}
  else {base.reason=base.trendlines.length?'Waiting for a closed 4h support bounce or descending resistance break.':'No valid trendline with three spaced touches over at least one week.';return base;}
  if(!base.structure){base.reason='The 4h setup lacks bullish price structure (higher lows and higher highs or a confirmed structure break).';return base;}
  base.confirmation=hourly.length>1&&last.close>last.open&&last.close>hourly.at(-2).close&&last.close>=latest.close*(1-c.proximity);
  if(!base.confirmation){base.reason='4h setup confirmed; waiting for a bullish closed 1h entry candle.';return base;}
  base.stop=Math.min(latest.low,base.support)*(1-c.stopBuffer);
  base.target=base.resistance;
  if(!base.target){base.reason='No confirmed horizontal resistance above price to define a conservative target.';return base;}
  const fill=executionAt(base.price,base.stop,base.target,c);base.estimatedRewardRisk=fill.reward/fill.risk;
  if(fill.risk<=0||base.estimatedRewardRisk<Math.max(2,c.rewardRisk)){base.reason='Nearest horizontal resistance offers less than 2:1 net reward/risk after fees and slippage.';return base;}
  base.signal='BUY';base.reason=`Algorithmic ${base.setup.replaceAll('-',' ')}: weekly 4h trendline, bullish structure, closed 1h confirmation and at least 2:1 net reward/risk.`;
  return base;
}

function analyzeHorizontal(input,config={}){
  const c=cfg(config),bars=normalizeCandles(input).slice(-c.lookback),last=bars.at(-1),price=last?.close??null;
  const base={price,support:null,resistance:null,atr:0,signal:'WAIT',reason:'Collecting completed candles to confirm levels.',levels:[],stop:null,target:null};
  if(bars.length<Math.max(12,c.pivotWindow*2+3))return base;
  const ranges=bars.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-bars[i].close),Math.abs(b.low-bars[i].close)));
  base.atr=ranges.slice(-14).reduce((a,b)=>a+b,0)/Math.min(14,ranges.length);
  const raw=[];
  for(let i=c.pivotWindow;i<bars.length-c.pivotWindow;i++){
    const around=bars.slice(i-c.pivotWindow,i+c.pivotWindow+1);
    if(around.every((b)=>b.low>=bars[i].low)&&around.some(b=>b.low>bars[i].low))raw.push({price:bars[i].low,type:'support'});
    if(around.every((b)=>b.high<=bars[i].high)&&around.some(b=>b.high<bars[i].high))raw.push({price:bars[i].high,type:'resistance'});
  }
  const clusters=[];
  for(const p of raw){const existing=clusters.find(l=>l.type===p.type&&Math.abs(l.price-p.price)<=Math.max(price*c.proximity*0.5,base.atr*0.25));if(existing){existing.price=(existing.price*existing.touches+p.price)/(existing.touches+1);existing.touches++;}else clusters.push({...p,touches:1});}
  base.levels=clusters.sort((a,b)=>a.price-b.price);
  base.support=base.levels.filter(l=>l.price<price).at(-1)?.price??null;
  base.resistance=base.levels.find(l=>l.price>price)?.price??null;
  if(!base.support||!base.resistance){base.reason='Waiting for confirmed support below price and resistance above it.';return base;}
  base.stop=base.support*(1-c.stopBuffer);
  const {entry,risk}=executionAt(price,base.stop,price,c);
  // Target compensates for estimated round-trip costs before the requested reward/risk.
  base.target=(entry*(1+c.feeRate)+risk*c.rewardRisk)/((1-c.slippage)*(1-c.feeRate));
  if(last.low>base.support*(1+c.proximity)||price>base.support*(1+2*c.proximity)){base.reason='Price is away from the support entry zone.';return base;}
  if(last.close<=last.open||last.close<=bars.at(-2).close){base.reason='Support is nearby; waiting for a bullish candle confirmation.';return base;}
  if(base.target>base.resistance){base.reason='Resistance leaves too little reward after estimated fees and slippage.';return base;}
  base.signal='BUY';base.reason='Confirmed support bounce with room to resistance after estimated trading costs.';return base;
}

export function createAccount(initial=10000){
  if(!positive(initial))throw new Error('Starting paper cash must be positive.');
  return {initial:+initial,cash:+initial,positions:[],trades:[],equityHistory:[],lastProcessed:{},marks:{},nextId:1,decisions:[],dailyRisk:{}};
}

function dayRisk(account,time,c){
  account.dailyRisk??={};
  const day=new Date(time*1000).toISOString().slice(0,10),equity=markToMarket(account).equity;
  const state=account.dailyRisk[day]??={openingEquity:equity,blocked:false};
  if(c.maxDailyLoss>0&&equity<=state.openingEquity*(1-c.maxDailyLoss))state.blocked=true;
  const days=Object.keys(account.dailyRisk).sort();for(const old of days.slice(0,-90))delete account.dailyRisk[old];
  return state;
}

function reservedRisk(account){
  return account.positions.reduce((sum,p)=>sum+Math.max(0,p.entry*p.quantity+p.entryFee-p.stop*(1-p.slippage)*(1-p.feeRate)*p.quantity),0);
}

function journal(account,product,time,signal,config,reason,action='WAIT'){
  account.decisions??=[];
  account.decisions.push({time,product,signal:action.startsWith('BUY')?'BUY':'WAIT',observedSignal:signal.signal??'WAIT',action,reason:reason??signal.reason,setup:signal.setup??'support-bounce',strategy:config.strategy,pattern:signal.pattern??null,support:signal.support??null,resistance:signal.resistance??null,stop:signal.stop??null,target:signal.target??null,price:signal.price??null,trend:signal.trend??'unconfirmed',...(account.compactJournal?{pattern:null}:{config:{...config}})});
  // Challenger accounts keep a compact, shorter journal so paper.json stays small.
  const limit=account.decisionLimit??5000;if(account.decisions.length>limit)account.decisions.splice(0,account.decisions.length-limit);
}

export function markToMarket(account,prices={}){
  const marks={...account.marks,...prices};
  const equity=account.cash+account.positions.reduce((s,p)=>s+p.quantity*(positive(marks[p.product])?+marks[p.product]:p.entry),0);
  const unrealized=account.positions.reduce((s,p)=>s+p.quantity*((positive(marks[p.product])?+marks[p.product]:p.entry)-p.entry)-p.entryFee+(p.entryFeeDetail?.rebateCredited??0),0);
  const realized=account.trades.reduce((s,t)=>s+t.pnl,0);
  let peak=account.initial,drawdown=0;
  for(const point of [...account.equityHistory,{equity}]){peak=Math.max(peak,point.equity);drawdown=Math.max(drawdown,(peak-point.equity)/peak);}
  return {equity,unrealized,realized,winRate:account.trades.length?account.trades.filter(t=>t.pnl>0).length/account.trades.length:0,closedTrades:account.trades.length,totalFees:account.trades.reduce((s,t)=>s+t.fees,0)+account.positions.reduce((s,p)=>s+p.entryFee,0),drawdown};
}

/** Mutates account, returns it. Fills are modeled with adverse slippage and fees. */
/** liquidity 'maker' = a simulated resting limit fill at `price` (no slippage, maker fee). riskScale<1 applies drawdown halving. */
export function openPaperTrade(account,{product,price,stop,target,time=Date.now()/1000,source='manual',pattern=null,trail=null,liquidity='taker',riskScale=1},config={}){
  const c=cfg(config);
  if(typeof product!=='string'||!product||![price,stop,target].every(positive)||!finite(time))throw new Error('Invalid paper trade.');
  if(account.positions.some(p=>p.product===product))throw new Error('A paper position is already open for this market.');
  if(account.positions.length>=c.maxOpenPositions)throw new Error('Maximum shared paper positions reached.');
  if(dayRisk(account,+time,c).blocked)throw new Error('UTC daily loss circuit is active; new paper entries are paused for this day.');
  const maker=liquidity==='maker',ec=maker?{...c,slippage:0,feeRate:c.makerFeeRate??c.feeRate}:c;
  if(!(riskScale>0&&riskScale<=1))throw new Error('Invalid risk scale.');
  const {entry,risk:lossPerUnit,reward}=executionAt(+price,+stop,+target,{...ec,slippage:maker?0:c.slippage});
  if(+stop>=entry||+target<=entry)throw new Error('Stop must be below entry; target must be above entry.');
  const equity=markToMarket(account).equity;
  const remainingRisk=Math.max(0,equity*c.maxTotalRisk-reservedRisk(account));
  if(remainingRisk<=1e-8)throw new Error('Maximum shared paper stop risk reached.');
  const invested=account.positions.reduce((s,p)=>s+p.quantity*(positive(account.marks?.[p.product])?+account.marks[p.product]:p.entry),0),room=equity*(c.maxExposure??MAX_EXPOSURE)-invested;
  if(account.cash<=0.01)throw new Error('Insufficient virtual cash.');
  if(room<=equity*0.01)throw new Error(`Maximum ${((c.maxExposure??MAX_EXPOSURE)*100).toFixed(0)}% invested exposure reached.`);
  // Equal risk per position: size = risk budget / stop distance (an ATR stop for the ATR-based strategies).
  const quantity=Math.min(equity*c.riskPct*riskScale/lossPerUnit,remainingRisk/lossPerUnit,equity*c.maxAllocation/(entry*(1+c.feeRate)),room/(entry*(1+c.feeRate)),account.cash/(entry*(1+c.feeRate)));
  if(!positive(quantity)||quantity*entry<0.01)throw new Error('Insufficient virtual cash.');
  const entryFeeDetail=feeForFill(entry*quantity,maker?'maker':'taker',c,+time),entryFee=entryFeeDetail.gross;
  account.cash-=entry*quantity+entryFee-entryFeeDetail.rebateCredited;
  account.rebatesUSDC=(account.rebatesUSDC??0)+entryFeeDetail.rebateCredited;
  account.positions.push({id:`paper-${account.nextId++}`,product,entry,quantity,stop:+stop,target:+target,openedAt:+time,entryFee,entryFeeDetail,entryOrderType:maker?'limit (simulated maker)':'market',entryLiquidity:maker?'maker':'taker',sizing:{method:'equal-risk-stop-distance',riskScale,stopDistance:entry-+stop},feeProfile:{makerFeeRate:c.makerFeeRate,takerFeeRate:c.takerFeeRate,feeTier:c.feeTier,feeObservedAt:c.feeObservedAt,rebateRate:c.rebateRate,rebateVerified:c.rebateVerified},source,pattern,...(trail?{trail:{...trail}}:{}),riskBudget:Math.min(equity*c.riskPct*riskScale,remainingRisk),estimatedRewardRisk:reward/lossPerUnit,feeRate:c.feeRate,slippage:c.slippage,maxHoldHours:c.maxHoldHours});
  account.marks[product]=+price;
  return account;
}

export function closePaperTrade(account,id,price,time=Date.now()/1000,reason='manual',config={}){
  cfg(config);
  if(!positive(price)||!finite(time))throw new Error('Invalid closing price or time.');
  const index=account.positions.findIndex(p=>p.id===id);
  if(index<0)throw new Error('Paper position not found.');
  const p=account.positions[index],restingTarget=reason==='target'&&p.feeProfile?.makerFeeRate!=null;
  const exit=restingTarget?+price:+price*(1-p.slippage);
  const exitFeeDetail=feeForFill(exit*p.quantity,restingTarget?'maker':'taker',{feeRate:p.feeRate,...p.feeProfile,...config},+time),exitFee=exitFeeDetail.gross;
  account.cash+=exit*p.quantity-exitFee+exitFeeDetail.rebateCredited;
  account.rebatesUSDC=(account.rebatesUSDC??0)+exitFeeDetail.rebateCredited;
  account.trades.push({...p,exit,closedAt:+time,exitFee,exitFeeDetail,exitOrderType:restingTarget?'resting-limit (simulated)':'market (simulated)',exitLiquidity:restingTarget?'maker':'taker',rebatePending:(p.entryFeeDetail?.rebatePending??0)+exitFeeDetail.rebatePending,rebateCredited:(p.entryFeeDetail?.rebateCredited??0)+exitFeeDetail.rebateCredited,fees:p.entryFee+exitFee,pnl:(exit-p.entry)*p.quantity-p.entryFee-exitFee+(p.entryFeeDetail?.rebateCredited??0)+exitFeeDetail.rebateCredited,reason});
  account.positions.splice(index,1);account.marks[p.product]=+price;
  return account;
}

// Bounded history keeps replay linear; covers every strategy's deepest lookback.
const historyWindow=c=>c.strategy==='trend-follow'||c.strategy==='dip-6h'?24*130:Math.max(320,c.lookback+10,c.trendLookback*4+8);
/** Pass completed candles only. Initial sync starts now; replay=true is for backtests. */
export function processCandles(account,product,input,config={},options={}){
  const c=cfg(config),bars=normalizeCandles(input),{autoTrade=true,replay=false}=options;
  if(!bars.length)return account;
  account.lastProcessed??={};account.marks??={};account.decisions??=[];account.dailyRisk??={};
  if(account.lastProcessed[product]==null&&!replay){
    account.lastProcessed[product]=bars.at(-1).time;account.marks[product]=bars.at(-1).close;
    journal(account,product,bars.at(-1).time,analyze(bars,c),c,'Initial synchronization: monitoring starts here; historical signals were not traded.','SYNC');
    return account;
  }
  for(let i=0;i<bars.length;i++){
    const bar=bars[i];if(bar.time<=(account.lastProcessed[product]??-1))continue;
    dayRisk(account,bar.time,c);account.marks[product]=bar.open;
    let reason,action='WAIT';
    const existing=account.positions.find(p=>p.product===product);
    // Chandelier trail: ratchet the stop from 6h bars that completed before this bar opened.
    if(existing?.trail)updateTrailingStop(existing,trendContext(bars.slice(Math.max(0,i-historyWindow(c)),i),options.history,bar.time).sixHour,bar.time);
    if(existing&&bar.time>=existing.openedAt){
      if(bar.open<=existing.stop){closePaperTrade(account,existing.id,bar.open,bar.time,'stop',c);reason='Existing paper position closed at a stop gap.';action='EXIT';}
      else if(bar.open>=existing.target){closePaperTrade(account,existing.id,existing.target,bar.time,'target',c);reason='Existing paper position reached its target at the open.';action='EXIT';}
      else if((existing.maxHoldHours??c.maxHoldHours)>0&&bar.time>=existing.openedAt+(existing.maxHoldHours??c.maxHoldHours)*3600){closePaperTrade(account,existing.id,bar.open,bar.time,'time-exit',c);reason='Maximum paper holding period reached; exited at the next eligible open.';action='EXIT';}
    }
    // A signal can use only bars that ended before this bar began. Never its future high/low.
    const window=bars.slice(Math.max(0,i-historyWindow(c)),i),signal=analyze(c.strategy==='trend-follow'||c.strategy==='dip-6h'?{candles:window,...(options.history??{}),asOf:bar.time}:window,c),daily=dayRisk(account,bar.time,c);
    if(c.strategy==='trend-follow'&&signal.signal==='BUY'){signal.stop=bar.open-(c.trailAtrMultiplier??TREND_DEFAULTS.trailAtrMultiplier)*signal.atr;signal.target=bar.open*TREND_SAFETY_TARGET;}
    if(!existing&&autoTrade&&!daily.blocked){
      const fill=executionAt(bar.open,signal.stop,signal.target,c);
      // Recheck at the executable next open: an upward gap can erase the signal's
      // advertised reward/risk even when the original stop and target bracket it.
      const requiredReward=c.strategy==='trend-follow'?0:fill.risk*(c.strategy==='trendline'?Math.max(2,c.rewardRisk):c.rewardRisk);
      const meetsRewardRisk=fill.risk>0&&fill.reward+Math.max(1,Math.abs(requiredReward))*1e-10>=requiredReward;
      if(signal.signal==='BUY'&&signal.stop<bar.open&&signal.target>fill.entry&&meetsRewardRisk){
        try{openPaperTrade(account,{product,price:bar.open,stop:signal.stop,target:signal.target,time:bar.time,source:signal.setup??'support-bounce',pattern:signal.pattern,trail:trailFor(signal,c)},c);action='BUY';reason=signal.reason;}
        catch(error){reason=error.message;}
      }else if(signal.signal==='BUY')reason='Next-open gap fails the stop/target bracket or minimum net reward/risk; entry skipped.';
    }else if(!existing){reason=daily.blocked?'UTC daily loss circuit is active; new entries paused while exits remain active.':'Automatic paper entries are paused.';}
    else if(action!=='EXIT'){reason='Existing paper position is being monitored; no additional position opened.';action='HOLD';}
    const p=account.positions.find(p=>p.product===product);
    if(p&&bar.time>=p.openedAt){
      // If both exits were touched, choose stop first. Stop gaps fill at the worse open.
      if(bar.low<=p.stop){closePaperTrade(account,p.id,Math.min(bar.open,p.stop),bar.time,p.trail?'trail-stop':'stop',c);reason='Paper stop triggered; stop takes priority when both exits are touched.';action=action==='BUY'?'BUY_EXIT':'EXIT';}
      else if(bar.high>=p.target){closePaperTrade(account,p.id,p.target,bar.time,'target',c);reason='Paper take-profit target reached.';action=action==='BUY'?'BUY_EXIT':'EXIT';}
    }
    account.marks[product]=bar.close;account.lastProcessed[product]=bar.time;
    dayRisk(account,bar.time,c);journal(account,product,bar.time,signal,c,reason,action);
    const point={time:bar.time,equity:markToMarket(account).equity};
    account.equityHistory.push(point);
    if(account.equityHistory.length>5000)account.equityHistory.splice(0,account.equityHistory.length-5000);
  }
  return account;
}

/**
 * Advance a shared account by one completed hour across multiple markets.
 * Every event's bars must end at the same timestamp. Earlier bars are context.
 * Entry priority is alphabetical product ID, independent of input order. All
 * entries use simultaneous opening marks and cash; intrabar profits are applied
 * only after every entry decision. Callers preflight missing history first.
 */
export function processBarBatch(account,events,options={}){
  if(!Array.isArray(events))throw new Error('Paper bar batch must be an array.');
  const prepared=events.map(event=>({product:event.product,bars:normalizeCandles(event.bars),config:cfg(event.config),autoTrade:event.autoTrade??options.autoTrade??true})).filter(event=>event.bars.length);
  if(!prepared.length)return account;
  const time=prepared[0].bars.at(-1).time;
  if(new Set(prepared.map(event=>event.product)).size!==prepared.length)throw new Error('Paper bar batch has duplicate products.');
  if(prepared.some(event=>typeof event.product!=='string'||!event.product||event.bars.at(-1).time!==time))throw new Error('Paper bar batch must contain distinct products ending at the same candle time.');
  account.lastProcessed??={};account.marks??={};account.decisions??=[];account.dailyRisk??={};
  const active=prepared.filter(event=>time>(account.lastProcessed[event.product]??-1)).sort((a,b)=>a.product.localeCompare(b.product));
  if(!active.length)return account;
  // Register the day's baseline before replacing the previous closing marks.
  for(const event of active)dayRisk(account,time,event.config);
  for(const event of active){
    event.bar=event.bars.at(-1);event.sync=account.lastProcessed[event.product]==null&&!options.replay;
    event.existing=account.positions.find(position=>position.product===event.product);
    event.action='WAIT';event.reason=undefined;
    account.marks[event.product]=event.bar.open;
  }
  // These exits are already determined at the open. Their proceeds may fund an
  // opening entry. The later high/low and close are never read in this phase.
  for(const event of active){
    const p=event.existing,{bar,config:c}=event;
    if(event.sync||!p||time<p.openedAt)continue;
    if(bar.open<=p.stop){closePaperTrade(account,p.id,bar.open,time,'stop',c);event.reason='Existing paper position closed at a stop gap.';event.action='EXIT';}
    else if(bar.open>=p.target){closePaperTrade(account,p.id,p.target,time,'target',c);event.reason='Existing paper position reached its target at the open.';event.action='EXIT';}
    else if((p.maxHoldHours??c.maxHoldHours)>0&&time>=p.openedAt+(p.maxHoldHours??c.maxHoldHours)*3600){closePaperTrade(account,p.id,bar.open,time,'time-exit',c);event.reason='Maximum paper holding period reached; exited at the next eligible open.';event.action='EXIT';}
  }
  // Every analytic signal uses only history strictly before this hour's open.
  for(const event of active)event.analysis=analyze(event.sync?event.bars:event.bars.slice(0,-1),event.config);
  // Opening cash and simultaneous opening valuations are the only funding and
  // sizing inputs. No event has realized an intrabar exit or marked its close.
  for(const event of active){
    const {bar,config:c,analysis:signal}=event;
    if(event.sync){event.action='SYNC';event.reason='Initial synchronization: monitoring starts here; historical signals were not traded.';continue;}
    const daily=dayRisk(account,time,c);
    if(event.existing){if(event.action!=='EXIT'){event.action='HOLD';event.reason='Existing paper position is being monitored; no additional position opened.';}continue;}
    if(!event.autoTrade||daily.blocked){event.reason=daily.blocked?'UTC daily loss circuit is active; new entries paused while exits remain active.':'Automatic paper entries are paused.';continue;}
    if(signal.signal!=='BUY')continue;
    const fill=executionAt(bar.open,signal.stop,signal.target,c),requiredReward=fill.risk*(c.strategy==='trendline'?Math.max(2,c.rewardRisk):c.rewardRisk);
    const eligible=signal.stop<bar.open&&signal.target>fill.entry&&fill.risk>0&&fill.reward+Math.max(1,Math.abs(requiredReward))*1e-10>=requiredReward;
    if(!eligible){event.reason='Next-open gap fails the stop/target bracket or minimum net reward/risk; entry skipped.';continue;}
    try{openPaperTrade(account,{product:event.product,price:bar.open,stop:signal.stop,target:signal.target,time,source:signal.setup??'support-bounce',pattern:signal.pattern},c);event.action='BUY';event.reason=signal.reason;}
    catch(error){event.reason=error.message;}
  }
  // Intrabar information becomes available only after every opening entry has
  // been sized. Its proceeds cannot travel backward into another opening fill.
  for(const event of active){
    if(event.sync)continue;
    const p=account.positions.find(position=>position.product===event.product),{bar,config:c}=event;
    if(!p||time<p.openedAt)continue;
    if(bar.low<=p.stop){closePaperTrade(account,p.id,Math.min(bar.open,p.stop),time,'stop',c);event.reason='Paper stop triggered; stop takes priority when both exits are touched.';event.action=event.action==='BUY'?'BUY_EXIT':'EXIT';}
    else if(bar.high>=p.target){closePaperTrade(account,p.id,p.target,time,'target',c);event.reason='Paper take-profit target reached.';event.action=event.action==='BUY'?'BUY_EXIT':'EXIT';}
  }
  // Mark all closes together before recording shared equity and daily loss.
  for(const event of active){account.marks[event.product]=event.bar.close;account.lastProcessed[event.product]=time;}
  for(const event of active){dayRisk(account,time,event.config);journal(account,event.product,time,event.analysis,event.config,event.reason,event.action);}
  account.equityHistory.push({time,equity:markToMarket(account).equity});
  if(account.equityHistory.length>5000)account.equityHistory.splice(0,account.equityHistory.length-5000);
  return account;
}

export function backtest(input,config={},options={}){
  const bars=normalizeCandles(input),account=createAccount();
  if(finite(options.startTime)){
    const before=bars.filter(b=>b.time<+options.startTime).at(-1);
    if(before){account.lastProcessed.BACKTEST=before.time;account.marks.BACKTEST=before.close;}
  }
  processCandles(account,'BACKTEST',bars,config,{autoTrade:true,replay:true,history:options.history});
  if(account.positions.length&&bars.length)closePaperTrade(account,account.positions[0].id,bars.at(-1).close,bars.at(-1).time,'end-of-test',config);
  const stats=markToMarket(account);
  return {account,...stats,returnPct:(stats.equity-account.initial)/account.initial,candles:finite(options.startTime)?bars.filter(b=>b.time>=+options.startTime).length:bars.length};
}

/** Offline research only. Never adopts a candidate or promises future gains. */
export function reviewStrategy(input,config={}){
  const c=cfg(config),bars=normalizeCandles(input);
  const required=c.strategy==='trendline'?480:240;
  if(bars.length<required)return {status:'insufficient-data',config:c,reason:`Need at least ${required} completed hourly candles for separate training and holdout samples.`,baseline:null,candidate:null,training:null,holdout:null};
  const cut=Math.floor(bars.length*0.7),train=bars.slice(0,cut),hold=bars.slice(cut);
  // Training candles may warm up indicators, but holdout account/fills start only
  // at the split. The training-selected candidate never sees future holdout data.
  const baseline=backtest(bars,c,{startTime:hold[0].time}),trainBase=backtest(train,c);
  const variants=c.strategy==='aggressive'?[{...c,rewardRisk:1.2},{...c,rewardRisk:2},{...c,maxHoldHours:1},{...c,stopAtrMultiplier:1.5}]:c.strategy==='trendline'?[{...c,trendLookback:120},{...c,trendLookback:240},{...c,proximity:0.004},{...c,proximity:0.008}]:[{...c,lookback:24},{...c,lookback:72},{...c,proximity:0.004},{...c,proximity:0.008}];
  const candidates=variants.map(config=>({config,result:backtest(train,config)}));
  candidates.sort((a,b)=>(b.result.returnPct-b.result.drawdown)-(a.result.returnPct-a.result.drawdown));
  const best=candidates[0],candidate=backtest(bars,best.config,{startTime:hold[0].time});
  const enough=[trainBase,best.result,baseline,candidate].every(r=>r.closedTrades>=5);
  const wins=enough&&best.result.returnPct>trainBase.returnPct&&candidate.returnPct>baseline.returnPct&&candidate.drawdown<=baseline.drawdown;
  const compact=r=>({returnPct:r.returnPct,drawdown:r.drawdown,closedTrades:r.closedTrades,winRate:r.winRate,totalFees:r.totalFees});
  return {status:wins?'candidate':'retained',config:wins?best.config:c,reason:!enough?'Retained current parameters: fewer than five closed trades in a comparison sample.':wins?'A training-selected candidate also beat the baseline on the later holdout with no higher drawdown. Review before adoption; future gains are uncertain.':'Retained current parameters: the training-selected candidate did not pass the later holdout.',baseline:compact(baseline),candidate:compact(candidate),training:{candles:train.length,baseline:compact(trainBase),candidate:compact(best.result)},holdout:{candles:hold.length,start:hold[0].time,end:hold.at(-1).time}};
}

/** Explicitly experimental; this intentionally does not claim a confirmed Tori setup. */
function analyzeAggressive(input,c){
 const bars=normalizeCandles(input),last=bars.at(-1),base={strategy:'aggressive',setup:'aggressive-exploration',trend:'experimental',price:last?.close??null,support:null,resistance:null,atr:0,levels:[],trendlines:[],signal:'WAIT',reason:'Need 24 completed hourly bars.',stop:null,target:null};
 if(bars.length<24)return base;
 base.trendlines=analyzeTrendline(bars,{...c,strategy:'trendline'}).trendlines;
 const recent=bars.slice(-24);base.support=Math.min(...recent.map(b=>b.low));base.resistance=Math.max(...recent.map(b=>b.high));base.atr=recent.slice(-14).reduce((s,b)=>s+b.high-b.low,0)/14;
 base.stop=base.price-Math.max(base.price*.015,base.atr*c.stopAtrMultiplier);
 const fill=executionAt(base.price,base.stop,base.price,c);
 base.target=(fill.entry*(1+c.feeRate)+fill.risk*c.rewardRisk)/((1-c.slippage)*(1-c.feeRate));
 const bullish=last.close>last.open,nearSupport=last.close<=base.support*1.03,pullback=last.close/bars.at(-4).close-1<-.01;
 if(bullish||nearSupport||pullback){base.signal='BUY';base.reason='Aggressive PAPER exploration: bullish candle, widened support zone or countertrend pullback. Not a confirmed trendline entry; fixed cost-aware target and time exit.';}
 else base.reason='Aggressive experiment waits for a bullish candle, support-zone revisit, or pullback.';
 return base;
}

/** Current-quote execution never backdates fills into already-observed hourly candles.
 * Events may carry `history:{sixHour,daily}` (stored Coinbase candles) used by trend-follow and trailing stops. */
export function processQuoteBatch(account,events,{time=Date.now()/1000,pause=null}={}){
 if(!Array.isArray(events)||!events.length||new Set(events.map(e=>e.product)).size!==events.length)throw new Error('Invalid quote batch');
 const prepared=events.map(e=>({...e,config:cfg(e.config),bars:normalizeCandles(e.bars)}));
 for(const e of prepared){const stamp=Date.parse(e.quote.time)/1000;if(!positive(e.quote.price)||!Number.isFinite(stamp)||time-stamp>120||stamp-time>30||e.bars.length<24||e.bars.some(b=>b.time+3600>time)||e.bars.slice(-24).some((b,i,a)=>i>0&&b.time!==a[i-1].time+3600)||time-(e.bars.at(-1).time+3600)>3600)throw new Error('Fresh quotes and completed history required for all markets.');}
 const bucket=Math.floor(time/300);if((account.lastQuoteBucket??-1)>=bucket)return account;
 account.decisions??=[];account.lastEntries??={};account.lastExits??={};
 const trendy=e=>e.config.strategy==='trend-follow'||e.config.strategy==='dip-6h'||account.positions.some(p=>p.product===e.product&&p.trail);
 for(const e of prepared)if(trendy(e))e.ctx=trendContext(e.bars,e.history,time);
 for(const e of prepared)dayRisk(account,time,e.config);
 for(const e of prepared)account.marks[e.product]=+e.quote.price;
 const exited=new Set();
 for(const e of prepared){const p=account.positions.find(p=>p.product===e.product);if(!p)continue;const price=+e.quote.price;
  if(p.trail&&e.ctx)updateTrailingStop(p,e.ctx.sixHour,time);
  const reason=price<=p.stop?(p.trail?'trail-stop':'quote-stop'):price>=p.target?'target':(p.maxHoldHours??e.config.maxHoldHours)>0&&time>=p.openedAt+(p.maxHoldHours??e.config.maxHoldHours)*3600?'time-exit':null;
  if(reason){closePaperTrade(account,p.id,reason==='target'?p.target:price,time,reason,e.config);exited.add(e.product);account.lastExits[e.product]=time;}
 }
 const gate=updateDrawdownPause(pause??account.pause??{},markToMarket(account).equity,time);if(pause)Object.assign(pause,gate);else account.pause=gate;
 // Resting paper limit orders from earlier checks: filled only when a later quote trades at or below the limit.
 account.pendingOrders??=[];account.orderLog??=[];const filled=new Set();
 for(const o of [...account.pendingOrders]){const e=prepared.find(v=>v.product===o.product),price=+e?.quote.price;let outcome=null,detail='';
  if(!e||time<=o.createdAt)continue;
  if(account.positions.some(p=>p.product===o.product)||exited.has(o.product))outcome='cancelled',detail='position changed';
  else if(gate.state==='blocked')outcome='cancelled',detail='drawdown pause blocks new entries';
  else if(price<=o.limit){const stop=o.limit-o.stopDistance;try{openPaperTrade(account,{product:o.product,price:o.limit,stop,target:o.limit*o.targetMultiple,time,source:o.setup,pattern:o.pattern,trail:o.trail?{...o.trail,highestClose:o.trail.highestClose,initialStop:stop}:null,liquidity:'maker',riskScale:gate.sizeMultiplier},e.config);outcome='filled';filled.add(o.product);account.lastEntries[o.product]=time;}catch(error){outcome='cancelled';detail=error.message;}}
  else if(++o.checks>=o.maxChecks)outcome='cancelled',detail=`not filled after ${o.maxChecks} checks`;
  if(outcome){account.pendingOrders.splice(account.pendingOrders.indexOf(o),1);account.orderLog.unshift({...o,outcome,detail,resolvedAt:time,quote:price});journal(account,o.product,time,{signal:'BUY',price,setup:o.setup,stop:o.limit-o.stopDistance},e.config,outcome==='filled'?`Paper limit buy filled at ${o.limit.toPrecision(6)} (maker).`:`Paper limit order cancelled: ${detail}.`,outcome==='filled'?'BUY':'CANCEL');}
 }
 account.orderLog.splice(300);
 const priority=['XRP-USD','SOL-USD','ETH-USD','BTC-USD','ADA-USD','DOGE-USD','LINK-USD','AVAX-USD'];
 const ordered=prepared.sort((a,b)=>(priority.indexOf(a.product)<0?99:priority.indexOf(a.product))-(priority.indexOf(b.product)<0?99:priority.indexOf(b.product))||a.product.localeCompare(b.product));
 for(const e of ordered)e.signal=e.config.strategy==='trend-follow'?{...trendSignal(e.ctx,e.config),pattern:patternConfirmation(e.bars,{asOf:time})}:e.config.strategy==='dip-6h'?{...dipSignal(e.ctx,e.config,+e.quote.price),pattern:patternConfirmation(e.bars,{asOf:time})}:analyze(e.bars,e.config);
 const leaders=rankTrend(ordered.filter(e=>e.config.strategy==='trend-follow').map(e=>({product:e.product,signal:e.signal})),ordered.find(e=>e.config.strategy==='trend-follow')?.config.trendTopN??TREND_DEFAULTS.trendTopN);
 for(const e of ordered){const signal=e.signal,price=+e.quote.price;
  if(e.config.strategy==='aggressive'&&signal.signal==='BUY'){signal.price=price;signal.stop=price-Math.max(price*.015,signal.atr*e.config.stopAtrMultiplier);const fill=executionAt(price,signal.stop,price,e.config);signal.target=(fill.entry*(1+e.config.feeRate)+fill.risk*e.config.rewardRisk)/((1-e.config.slippage)*(1-e.config.feeRate));}
  if(e.config.strategy==='trend-follow'){
   const held=account.positions.filter(p=>p.trail).length+account.pendingOrders.filter(o=>o.trail&&o.product!==e.product).length,limit=e.config.trendTopN??TREND_DEFAULTS.trendTopN;
   if(signal.signal==='BUY'&&!leaders.has(e.product)){signal.signal='WAIT';signal.reason=`Trend breakout, but not in the top ${limit} trend-passing coins by ${e.config.trendRankDays??30}-day return.`;}
   else if(signal.signal==='BUY'&&held>=limit&&!account.positions.some(p=>p.product===e.product)){signal.signal='WAIT';signal.reason=`Already holding ${held} trend positions (top-${limit} limit).`;}
   else if(signal.signal==='BUY'&&(account.lastExits[e.product]??-1)>=signal.barEnd){signal.signal='WAIT';signal.reason='Trailing stop already exited after this 6h breakout; waiting for a new breakout.';}
   if(signal.signal==='BUY'){signal.price=price;signal.stop=price-(e.config.trailAtrMultiplier??TREND_DEFAULTS.trailAtrMultiplier)*signal.atr;signal.target=price*TREND_SAFETY_TARGET;}
  }
  let action='WAIT',reason=signal.reason;
  if(filled.has(e.product))continue;
  if(account.positions.some(p=>p.product===e.product)){action='HOLD';reason='Open virtual position monitored at fresh quote.';}
  else if(account.pendingOrders.some(o=>o.product===e.product)){action='ORDER';reason='Paper limit buy resting below the market; waiting for a later quote at or below it.';}
  else if(exited.has(e.product)){action='EXIT';reason='Virtual exit executed at this check; no immediate same-check re-entry.';}
  else if(time-(account.lastEntries[e.product]??0)<1800)reason='30-minute exploration re-entry cooldown.';
  else if(signal.signal==='BUY'&&gate.state==='blocked')reason=`Drawdown pause: equity ${(gate.drawdown*100).toFixed(1)}% below its peak; new entries blocked until pause.cleared is set by the supervisor or manager.`;
  else if(signal.signal==='BUY'&&e.config.strategy!=='trend-follow'&&positive(signal.target)&&signal.target/price<1+2*(e.config.makerFeeRate??e.config.feeRate)+MIN_TARGET_EDGE)reason=`Target ${((signal.target/price-1)*100).toFixed(2)}% above the live quote does not cover round-trip fees plus ${(MIN_TARGET_EDGE*100).toFixed(1)}%.`;
  else if(signal.signal==='BUY'&&e.config.entryOrder==='limit'){const ref=Math.min(price,positive(e.quote.bid)?+e.quote.bid:price),limit=ref*(1-(e.config.limitOffset??LIMIT_DEFAULTS.limitOffset));
   account.pendingOrders.push({id:`order-${account.nextId++}`,product:e.product,limit,stopDistance:price-signal.stop,targetMultiple:signal.target/price,createdAt:time,checks:0,maxChecks:e.config.limitChecks??LIMIT_DEFAULTS.limitChecks,setup:signal.setup,pattern:signal.pattern??null,trail:trailFor(signal,e.config),liquidity:'maker',riskScale:gate.sizeMultiplier});
   action='ORDER';reason=`${signal.reason} Paper limit buy placed at ${limit.toPrecision(6)} (bid/last minus ${((e.config.limitOffset??LIMIT_DEFAULTS.limitOffset)*100).toFixed(2)}%); counts only if a later quote trades at or below it.`;}
  else if(signal.signal==='BUY')try{openPaperTrade(account,{product:e.product,price,stop:signal.stop,target:signal.target,time,source:signal.setup,pattern:signal.pattern,trail:trailFor(signal,e.config),riskScale:gate.sizeMultiplier},e.config);action='BUY';account.lastEntries[e.product]=time;}catch(error){reason=error.message;}
  journal(account,e.product,time,signal,e.config,reason,action);
 }
 account.orderLog.splice(account.orderLogLimit??300);account.lastQuoteBucket=bucket;account.equityHistory.push({time,equity:markToMarket(account).equity});const cap=account.equityLimit??5000;if(account.equityHistory.length>cap)account.equityHistory.splice(0,account.equityHistory.length-cap);return account;
}

/** Equity-peak drawdown gate. `cleared:true` (set by the supervisor or manager in paper.json) lifts a block and restarts the peak. */
export function updateDrawdownPause(pause={},equity,time=Date.now()/1000){
 const p={state:'normal',...pause};p.history=[...(p.history??[])].slice(0,50);
 if(p.cleared===true){if(p.state==='blocked')p.history.unshift({event:'cleared',at:time,equity,drawdown:p.drawdown});p.state='normal';p.peak=equity;p.cleared=false;p.clearedAt=time;}
 p.peak=Math.max(Number.isFinite(p.peak)?p.peak:equity,equity);p.drawdown=p.peak>0?Math.max(0,1-equity/p.peak):0;
 const next=p.state==='blocked'||p.drawdown>=DRAWDOWN_RULES.blockAt?'blocked':p.drawdown>=DRAWDOWN_RULES.halveAt?'halved':'normal';
 if(next!==p.state){p.history.unshift({event:next,at:time,equity,drawdown:p.drawdown});if(next==='blocked')p.triggeredAt=time;}
 p.maxDrawdown=Math.max(p.maxDrawdown??0,p.drawdown);p.state=next;p.sizeMultiplier=next==='blocked'?0:next==='halved'?.5:1;p.equity=equity;p.updatedAt=time;p.cleared=false;
 p.rules={halveNewSizesAt:DRAWDOWN_RULES.halveAt,blockNewEntriesAt:DRAWDOWN_RULES.blockAt,resume:'set pause.cleared = true in data/paper.json'};
 return p;
}
const SIX_HOURS=21600,ONE_DAY=86400;
/** Completed 6h and daily candles at `asOf`: stored Coinbase history merged with aggregates of completed hourly bars.
 * Coinbase has no 4h granularity, so the trend series is 6h (aligned 00/06/12/18 UTC). */
export function trendContext(hourly,history={},asOf){
 const h=normalizeCandles(hourly);asOf??=(h.at(-1)?.time??0)+3600;
 const merge=(stored,hours,span)=>normalizeCandles([...normalizeCandles(stored??[]),...aggregateCandles(h,hours)]).filter(b=>b.time+span<=asOf);
 return {sixHour:merge(history?.sixHour,6,SIX_HOURS),daily:merge(history?.daily,24,ONE_DAY)};
}
/** Precomputed series so a two-year replay and the live check evaluate the identical rule. */
export function prepareTrend({sixHour=[],daily=[]}={}){
 const s=normalizeCandles(sixHour),d=normalizeCandles(daily),tr=s.map((b,i)=>i?Math.max(b.high-b.low,Math.abs(b.high-s[i-1].close),Math.abs(b.low-s[i-1].close)):b.high-b.low);
 const atr=tr.map((_,i)=>{if(i<14)return null;let sum=0;for(let j=i-13;j<=i;j++)sum+=tr[j];return sum/14;}),dc=d.map(b=>b.close);
 return {six:s,daily:d,atr,e20:emaSeries(dc,20),e50:emaSeries(dc,50)};
}
/** Trend test + entry at prepared indexes si (latest completed 6h bar) and di (latest completed day). */
export function trendSignalAt(P,si,di,c={}){
 const n=c.trendBreakout??TREND_DEFAULTS.trendBreakout,rank=c.trendRankDays??TREND_DEFAULTS.trendRankDays,k=c.trailAtrMultiplier??TREND_DEFAULTS.trailAtrMultiplier;
 const last=P.six[si],out={strategy:'trend-follow',setup:'trend-breakout',trend:'unconfirmed',price:last?.close??null,support:null,resistance:null,atr:0,levels:[],trendlines:[],signal:'WAIT',stop:null,target:null,trendPass:false,return30:null,barEnd:last?last.time+SIX_HOURS:null,reason:'Need 100 completed daily and 35 completed 6h candles.'};
 if(si<Math.max(n,14)+1||di<99||!P.atr[si])return out;
 let high=-Infinity;for(let j=si-n;j<si;j++)high=Math.max(high,P.six[j].close);
 const close=P.daily[di].close,e20=P.e20[di],e50=P.e50[di];
 out.atr=P.atr[si];out.resistance=high;out.support=e50;out.return30=di>=rank?close/P.daily[di-rank].close-1:null;
 out.trendPass=close>e50&&e20>e50;out.trend=out.trendPass?'bullish':close<e50?'bearish':'mixed';
 out.stop=last.close-k*out.atr;out.target=last.close*TREND_SAFETY_TARGET;out.estimatedRewardRisk=null;
 if(!out.trendPass){out.reason='Daily trend test failed: needs close above EMA50 and EMA20 above EMA50.';return out;}
 if(!(last.close>high)){out.reason=`Daily uptrend; waiting for a 6h close above the prior ${n}-bar closing high.`;return out;}
 out.signal='BUY';out.reason=`Trend follow: daily close > EMA50, EMA20 > EMA50 and a new ${n}-period 6h closing high. Chandelier ${k}×ATR trailing stop, no fixed target or time exit.`;return out;
}
/** Live evaluation on the latest completed bars of a trend context. */
export function trendSignal(ctx,c={}){const P=prepareTrend(ctx??{});return trendSignalAt(P,P.six.length-1,P.daily.length-1,c);}
/** Cross-sectional rank: only the top N trend-passing coins by 30-day return may be bought. */
export function rankTrend(items,topN=TREND_DEFAULTS.trendTopN){
 return new Set(items.filter(x=>x.signal?.trendPass&&Number.isFinite(x.signal.return30)).sort((a,b)=>b.signal.return30-a.signal.return30||a.product.localeCompare(b.product)).slice(0,topN).map(x=>x.product));
}
function trailFor(signal,c){return c.strategy==='trend-follow'?{type:'chandelier',atrMultiplier:c.trailAtrMultiplier??TREND_DEFAULTS.trailAtrMultiplier,highestClose:signal.price,atr:signal.atr,initialStop:signal.stop}:null;}
/** Chandelier exit: highest 6h close since entry minus k×ATR(14, 6h). The stop only moves up. Returns true when raised. */
export function updateTrailingStop(p,sixHour,time){
 if(!p?.trail)return false;
 const done=normalizeCandles(sixHour).filter(b=>b.time+SIX_HOURS<=time);if(done.length<15)return false;
 let hc=p.trail.highestClose??p.entry;for(const b of done)if(b.time+SIX_HOURS>p.openedAt)hc=Math.max(hc,b.close);
 const atr=atrOf(done,14),next=hc-p.trail.atrMultiplier*atr;
 p.trail.highestClose=hc;p.trail.atr=atr;p.trail.checkedAt=time;
 if(Number.isFinite(next)&&next>p.stop){p.stop=next;p.trail.raisedAt=time;return true;}
 return false;
}
/**
 * 6h dip buy inside a daily uptrend: RSI(14) on completed 6h closes below dipRsi (default 25) while the last completed
 * daily close is above its EMA100. ATR(14, 6h) stop x stopAtrMultiplier and a cost-aware rewardRisk target.
 * Walk-forward on 2 years of 6h/1d history (research notes, 23 Nov): validation 5t/100%/+2.3R, unseen 5t/100%/+4.2R; small samples.
 */
export function dipSignal(ctx,c={},price=null){
 const six=normalizeCandles(ctx?.sixHour??[]),daily=normalizeCandles(ctx?.daily??[]),last=six.at(-1);
 const out={strategy:'dip-6h',setup:'6h-dip-in-daily-uptrend',trend:'unconfirmed',price:price??last?.close??null,support:null,resistance:null,atr:0,levels:[],trendlines:[],signal:'WAIT',stop:null,target:null,reason:'Need 30 completed 6h bars and 101 daily bars.'};
 if(six.length<30||daily.length<101||!out.price)return out;
 const r=rsiSeries(six.map(b=>b.close)).at(-1),e100=emaSeries(daily.map(b=>b.close),100).at(-1),up=daily.at(-1).close>e100,k=c.dipRsi??25;
 out.trend=up?'bullish':'bearish';out.rsi6h=r;out.atr=atrOf(six);
 const cc={...DEFAULT_CONFIG,...c};out.stop=out.price-Math.max(out.price*.004,out.atr*(cc.stopAtrMultiplier??2));
 const fill=executionAt(out.price,out.stop,out.price,cc);out.target=(fill.entry*(1+cc.feeRate)+fill.risk*cc.rewardRisk)/((1-cc.slippage)*(1-cc.feeRate));
 if(!up){out.reason='Daily close is below its EMA100; no dip buying outside a daily uptrend.';return out;}
 if(!(r<k)){out.reason=`6h RSI ${r.toFixed(1)}; waiting for a dip below ${k}.`;return out;}
 out.signal='BUY';out.reason=`6h RSI ${r.toFixed(1)} below ${k} inside a daily uptrend; ATR stop and cost-aware target.`;return out;
}
/**
 * Intraday range trade: buy in the bottom rangeEntry of the last rangeHours high-low range after a bullish hourly close,
 * sell at rangeExit of the range (resting maker limit), stop stopAtrMultiplier x ATR below the range low.
 * Skips ranges narrower than rangeMinWidth so the move can pay the round-trip fees.
 */
function analyzeRange(input,c){
 const bars=normalizeCandles(input),base=indicatorBase(bars,'range','range-support-buy'),n=c.rangeHours??24;if(bars.length<n+15){base.reason=`Need ${n+15} completed hourly bars.`;return base;}
 const win=bars.slice(-n),last=bars.at(-1),lo=Math.min(...win.map(b=>b.low)),hi=Math.max(...win.map(b=>b.high)),width=hi/lo-1;
 base.support=lo;base.resistance=hi;base.atr=atrOf(bars);base.price=last.close;
 base.stop=c.rangeStopPct!=null?lo*(1-c.rangeStopPct):lo-base.atr*(c.stopAtrMultiplier??0.5);base.target=lo+(hi-lo)*(c.rangeExit??0.85);base.trend=width>=(c.rangeMinWidth??0.015)?'ranging':'tight';
 if(width<(c.rangeMinWidth??0.015)){base.reason=`24h range ${(width*100).toFixed(2)}% is too narrow to pay fees.`;return base;}
 if(last.close>lo+(hi-lo)*(c.rangeEntry??0.3)){base.reason='Price is not in the lower part of the range.';return base;}
 if(c.rangeConfirm===true&&last.close<=last.open){base.reason='In the buy zone; waiting for a bullish hourly close.';return base;}
 if(base.target<=last.close*1.004){base.reason='Range target is too close to cover fees.';return base;}
 base.signal='BUY';base.reason=`Range buy: ${(width*100).toFixed(1)}% 24h range, price in the bottom ${((c.rangeEntry??0.3)*100).toFixed(0)}%, target near the range high.`;return base;
}
function analyzeDip6h(input,c){
 const hourly=normalizeCandles(input),asOf=input?.asOf??((hourly.at(-1)?.time??0)+3600);
 return dipSignal(trendContext(hourly,{sixHour:input?.sixHour,daily:input?.daily},asOf),c,hourly.at(-1)?.close??null);
}
function analyzeTrendFollow(input,c){
 const hourly=normalizeCandles(input),asOf=input?.asOf??((hourly.at(-1)?.time??0)+3600);
 return trendSignal(trendContext(hourly,{sixHour:input?.sixHour,daily:input?.daily},asOf),c);
}
/**
 * Two-year portfolio replay of trend-follow on stored 6h/daily candles across all markets: shared cash, ranking,
 * risk caps, fees and the chandelier trail. Signals use bars completed before each 6h open; entries fill at that open
 * with adverse slippage (taker); a stop touched inside a bar exits at the stop, or the open on a gap.
 */
export function backtestTrendPortfolio(histories,config={},{startTime=-Infinity,endTime=Infinity,initial=10000}={}){
 const c=cfg({...config,strategy:'trend-follow'}),account=createAccount(initial),products=Object.keys(histories).sort();
 const P=Object.fromEntries(products.map(p=>[p,prepareTrend(histories[p])]));
 const times=[...new Set(products.flatMap(p=>P[p].six.map(b=>b.time)))].filter(t=>t>=startTime&&t<endTime).sort((a,b)=>a-b);
 const ptr=Object.fromEntries(products.map(p=>[p,{s:-1,d:-1,bar:new Map(P[p].six.map((b,i)=>[b.time,i]))}]));
 const lastExit={};let peak=initial,maxDd=0;
 for(const t of times){
  for(const p of products){const x=ptr[p],q=P[p];while(x.s+1<q.six.length&&q.six[x.s+1].time+SIX_HOURS<=t)x.s++;while(x.d+1<q.daily.length&&q.daily[x.d+1].time+ONE_DAY<=t)x.d++;}
  const live=products.filter(p=>ptr[p].bar.has(t));
  // Register the UTC day's opening equity from the previous closes before any exit, as the live executor does.
  dayRisk(account,t,c);
  for(const p of live){const bar=P[p].six[ptr[p].bar.get(t)];account.marks[p]=bar.open;}
  // Trail from completed bars, then exits determined at the open.
  for(const p of live){const pos=account.positions.find(v=>v.product===p);if(!pos)continue;const x=ptr[p],q=P[p];
   if(x.s>=0&&q.six[x.s].time+SIX_HOURS>pos.openedAt){pos.trail.highestClose=Math.max(pos.trail.highestClose,q.six[x.s].close);const next=pos.trail.highestClose-pos.trail.atrMultiplier*q.atr[x.s];if(next>pos.stop){pos.stop=next;pos.trail.raisedAt=t;}}
   const bar=q.six[x.bar.get(t)];if(bar.open<=pos.stop){closePaperTrade(account,pos.id,bar.open,t,'trail-stop',c);lastExit[p]=t;}}
  const signals=live.map(p=>({product:p,signal:trendSignalAt(P[p],ptr[p].s,ptr[p].d,c)})),leaders=rankTrend(signals,c.trendTopN??TREND_DEFAULTS.trendTopN);
  for(const {product:p,signal} of signals){
   if(signal.signal!=='BUY'||!leaders.has(p)||account.positions.some(v=>v.product===p)||(lastExit[p]??-1)>=signal.barEnd||account.positions.length>=(c.trendTopN??TREND_DEFAULTS.trendTopN))continue;
   const bar=P[p].six[ptr[p].bar.get(t)],limit=c.entryOrder==='limit'?bar.open*(1-(c.limitOffset??LIMIT_DEFAULTS.limitOffset)):null,price=limit??bar.open,stop=price-(c.trailAtrMultiplier??3)*signal.atr;if(!(stop>0))continue;
   // A limit entry fills inside this 6h bar only if its low reaches the limit; otherwise it is cancelled.
   if(limit&&bar.low>limit)continue;
   try{openPaperTrade(account,{product:p,price,stop,target:price*TREND_SAFETY_TARGET,time:t,source:'trend-breakout',liquidity:limit?'maker':'taker',trail:{type:'chandelier',atrMultiplier:c.trailAtrMultiplier??3,highestClose:signal.price,atr:signal.atr,initialStop:stop}},c);}catch{}
  }
  for(const p of live){const pos=account.positions.find(v=>v.product===p);const bar=P[p].six[ptr[p].bar.get(t)];if(pos&&pos.openedAt<=t&&bar.low<=pos.stop){closePaperTrade(account,pos.id,Math.min(bar.open,pos.stop),t,'trail-stop',c);lastExit[p]=t;}account.marks[p]=bar.close;}
  dayRisk(account,t,c);
  const equity=markToMarket(account).equity;peak=Math.max(peak,equity);maxDd=Math.max(maxDd,(peak-equity)/peak);account.equityHistory.push({time:t,equity});
 }
 for(const pos of [...account.positions])closePaperTrade(account,pos.id,account.marks[pos.product],times.at(-1)??0,'end-of-test',c);
 const stats=performanceStats(account);
 return {account,...stats,returnPct:(stats.equity-initial)/initial,drawdown:maxDd,bars:times.length,start:times[0]??null,end:times.at(-1)??null};
}
/** Net-after-fees scorecard for any paper account: profit factor, drawdown, win rate, average win vs loss. */
export function performanceStats(account,{since=-Infinity}={}){
 const trades=(account.trades??[]).filter(t=>!String(t.reason).includes('rebalance')&&t.closedAt>=since),wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0);
 const gw=wins.reduce((s,t)=>s+t.pnl,0),gl=-losses.reduce((s,t)=>s+t.pnl,0),m=markToMarket(account);
 let peak=-Infinity,dd=0;for(const p of [{equity:account.initial,time:-Infinity},...(account.equityHistory??[])].filter(p=>p.time>=since||p.time===-Infinity)){peak=Math.max(peak,p.equity);dd=Math.max(dd,(peak-p.equity)/peak);}
 return {equity:m.equity,netPnl:gw-gl,closedTrades:trades.length,winRate:trades.length?wins.length/trades.length:null,profitFactor:gl>0?gw/gl:gw>0?Infinity:null,avgWin:wins.length?gw/wins.length:null,avgLoss:losses.length?-gl/losses.length:null,maxDrawdown:dd,totalFees:trades.reduce((s,t)=>s+(t.fees??0)-(t.rebateCredited??0),0),makerFills:trades.reduce((s,t)=>s+(t.entryFeeDetail?.liquidity==='maker')+(t.exitFeeDetail?.liquidity==='maker'),0),takerFills:trades.reduce((s,t)=>s+(t.entryFeeDetail?.liquidity==='taker')+(t.exitFeeDetail?.liquidity==='taker'),0)};
}

/** Adapted research rules from day-trader-skill (see THIRD_PARTY.md); hourly crypto, not NYSE sessions. */
export function patternConfirmation(input,{asOf=Date.now()/1000}={}){
 const bars=normalizeCandles(input).filter(b=>b.time+3600<=asOf),last=bars.at(-1);
 const result={version:1,timeframe:'1h',asOf:last?last.time+3600:null,mode:'observe',confirmed:false,matches:[],context:[],status:'insufficient-data',volumeRatio:null,reason:'Need 31 contiguous completed hourly candles.'};
 const recent=bars.slice(-31);
 if(recent.length<31||recent.some((b,i)=>i&&b.time!==recent[i-1].time+3600))return result;
 if(asOf-last.time-3600>7200)return {...result,status:'stale-data',reason:'Completed hourly candle is over two hours old.'};
 const c=recent.map(b=>b.close),prior=c.slice(-21,-1),mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
 const high20=Math.max(...prior),ma=mean(c.slice(-20)),prevMa=mean(prior);
 const wilder=values=>{let gain=0,loss=0;for(let i=1;i<=14;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d)/14;loss+=Math.max(0,-d)/14;}for(let i=15;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*13+Math.max(0,d))/14;loss=(loss*13+Math.max(0,-d))/14;}return loss===0?(gain===0?50:100):100-100/(1+gain/loss);};
 const rsi=wilder(recent.map(b=>b.close)),previousRsi=wilder(recent.slice(0,-1).map(b=>b.close));
 if(last.close>high20)result.matches.push('closing-high-breakout-20h');
 if(c.at(-2)<prevMa&&last.close>ma)result.matches.push('ma20-reclaim');
 if(previousRsi<30&&last.close>c.at(-2))result.matches.push('oversold-bounce');
 const run=c.at(-6)/c.at(-16)-1,range=(Math.max(...c.slice(-5))-Math.min(...c.slice(-5)))/last.close;
 if(run>.10&&range<.05)result.context.push('bull-flag-consolidation');
 if(rsi<30)result.context.push('oversold-alone-is-not-entry');
 // A consolidation is context only; a close above a frozen prior range is the entry confirmation.
 const flagPrior=c.slice(-6,-1),flagRun=c.at(-7)/c.at(-17)-1;
 if(flagRun>.10&&(Math.max(...flagPrior)-Math.min(...flagPrior))/c.at(-2)<.05&&last.close>Math.max(...recent.slice(-6,-1).map(b=>b.high)))result.matches.push('bull-flag-breakout');
 const volume=mean(recent.slice(-21,-1).map(b=>b.volume));result.volumeRatio=volume>0?last.volume/volume:null;
 return {...result,status:'evaluated',confirmed:result.matches.length>0,levels:{closingHigh20:high20,ma20:ma},rsi,previousRsi,reason:result.matches.length?'Completed hourly candle matches an explicit entry rule.':'No completed-candle entry confirmation; context alone is insufficient.'};
}

/** Fixed comparison, not a parameter search or permission to alter live paper entries. */
export function researchPatterns(input,config={},asOf=Date.now()/1000){
 const bars=normalizeCandles(input).filter(b=>b.time+3600<=asOf),base={version:1,mode:'shadow',timeframe:'1h',asOf:bars.at(-1)?.time+3600??null,candles:bars.length,confirmation:patternConfirmation(bars,{asOf}),status:'insufficient-data',recommendation:'Observe only; keep the current entry rules.',warning:'Hourly candle replay is an approximation of five-minute quote execution, not a forecast. No NYSE opening-range rule is applied to 24/7 crypto.'};
 if(bars.length<480)return {...base,reason:'Need 480 completed hourly candles for separated training and holdout.'};
 if(bars.some((b,i)=>i&&b.time!==bars[i-1].time+3600))return {...base,status:'data-gaps',reason:'Contiguous candles required; no results across missing intervals.'};
 const cut=Math.floor(bars.length*.7),train=bars.slice(0,cut),split=bars[cut].time;
 const compact=r=>({returnPct:r.returnPct,netPnl:r.equity-r.account.initial,drawdown:r.drawdown,closedTrades:r.closedTrades,winRate:r.winRate,totalFees:r.totalFees});
 const baseline={...config,patternRequired:false},filtered={...config,patternRequired:true};
 const training={baseline:compact(backtest(train,baseline)),filtered:compact(backtest(train,filtered))};
 const holdout={start:split,end:bars.at(-1).time+3600,baseline:compact(backtest(bars,baseline,{startTime:split})),filtered:compact(backtest(bars,filtered,{startTime:split}))};
 const enough=[training.baseline,training.filtered,holdout.baseline,holdout.filtered].every(r=>r.closedTrades>=5);
 const beats=(a,b)=>b.returnPct>a.returnPct&&b.drawdown<=a.drawdown;
 const passed=enough&&beats(training.baseline,training.filtered)&&beats(holdout.baseline,holdout.filtered)&&holdout.filtered.netPnl>0;
 return {...base,training,holdout,status:!enough?'insufficient-trades':passed?'promising-shadow':'no-demonstrated-edge',reason:!enough?'Fewer than five closes in at least one comparison sample.':passed?'Fixed filter improved training and later holdout net returns with no higher drawdown; still requires forward paper evidence.':'The fixed pattern filter did not improve both training and holdout with positive holdout profit and no higher drawdown.',assumptions:{execution:'next hourly open, adverse slippage; stop first if ambiguous',costs:'existing account fee, rebate and slippage configuration',risk:'identical risk caps and targets in both arms'},splitTime:split};
}

/** Shared entry-time features; also used by the shadow logistic-regression models. */
export function featuresAt(bars,i){
 if(i<24)return null;const p=bars[i].close,prev=bars[i-1],recent=bars.slice(i-23,i+1),range=recent.reduce((s,b)=>s+(b.high-b.low)/b.close,0)/24;
 return [1,(p/prev.close-1)*50,(p/bars[i-4].close-1)*25,(p/bars[i-12].close-1)*10,range*50,(bars[i].close-bars[i].open)/(bars[i].high-bars[i].low||1),((p/Math.min(...recent.map(b=>b.low)))-1)*10].map(v=>Math.max(-5,Math.min(5,v)));
}
export function mlProbability(weights,x){const z=weights.reduce((s,v,i)=>s+v*x[i],0);return 1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));}

const emaSeries=(values,n)=>{const k=2/(n+1),out=[];let e=values[0];for(const v of values){e=v*k+e*(1-k);out.push(e);}return out;};
const atrOf=(bars,n=14)=>{const r=bars.slice(-n-1).slice(1).map((b,i,a)=>{const pc=bars.at(-n-1+i)?.close??b.open;return Math.max(b.high-b.low,Math.abs(b.high-pc),Math.abs(b.low-pc));});return r.reduce((s,v)=>s+v,0)/(r.length||1);};
function rsiSeries(closes,n=14){const out=Array(closes.length).fill(50);let g=0,l=0;for(let i=1;i<closes.length;i++){const d=closes[i]-closes[i-1];if(i<=n){g+=Math.max(0,d)/n;l+=Math.max(0,-d)/n;}else{g=(g*(n-1)+Math.max(0,d))/n;l=(l*(n-1)+Math.max(0,-d))/n;}if(i>=n)out[i]=l===0?100:100-100/(1+g/l);}return out;}
/** Cost-aware ATR bracket: stop = ATR multiple, target = net reward/risk after fees and slippage. */
function atrBracket(base,bars,c){
 base.atr=atrOf(bars);base.stop=base.price-Math.max(base.price*.004,base.atr*c.stopAtrMultiplier);
 const fill=executionAt(base.price,base.stop,base.price,c);
 base.target=(fill.entry*(1+c.feeRate)+fill.risk*c.rewardRisk)/((1-c.slippage)*(1-c.feeRate));
 base.estimatedRewardRisk=c.rewardRisk;return base;
}
function indicatorBase(bars,strategy,setup){const recent=bars.slice(-24),last=bars.at(-1);return {strategy,setup,trend:'unconfirmed',price:last?.close??null,support:recent.length?Math.min(...recent.map(b=>b.low)):null,resistance:recent.length?Math.max(...recent.map(b=>b.high)):null,atr:0,levels:[],trendlines:[],signal:'WAIT',reason:'Need 120 completed hourly bars.',stop:null,target:null};}

/** Trend-following pullback: EMA20 above a rising EMA50, price dips to EMA20 and closes back above it bullish. */
function analyzeEmaTrend(input,c){
 const bars=normalizeCandles(input).slice(-300),base=indicatorBase(bars,'ema-trend','ema-pullback');if(bars.length<120)return base;
 const closes=bars.map(b=>b.close),e20=emaSeries(closes,20),e50=emaSeries(closes,50),last=bars.at(-1),f=e20.at(-1),s=e50.at(-1);
 base.trend=f>s&&s>e50.at(-6)?'bullish':f<s?'bearish':'mixed';base.support=f;
 if(base.trend!=='bullish'){base.reason='EMA20/EMA50 uptrend not confirmed.';return atrBracket(base,bars,c);}
 if(last.low>f*(1+c.proximity)){base.reason='Uptrend confirmed; waiting for a pullback to EMA20.';return atrBracket(base,bars,c);}
 if(!(last.close>f&&last.close>last.open)){base.reason='Pullback to EMA20; waiting for a bullish close back above it.';return atrBracket(base,bars,c);}
 atrBracket(base,bars,c);base.signal='BUY';base.reason='EMA trend pullback: rising EMA50, EMA20 retest and bullish close; ATR stop and cost-aware target.';return base;
}
/** Breakout: close above the prior 20-hour high while above EMA50 with above-average volume. */
function analyzeDonchian(input,c){
 const bars=normalizeCandles(input).slice(-300),base=indicatorBase(bars,'donchian','channel-breakout');if(bars.length<120)return base;
 const last=bars.at(-1),prior=bars.slice(-21,-1),high=Math.max(...prior.map(b=>b.high)),e50=emaSeries(bars.map(b=>b.close),50).at(-1),vol=prior.reduce((s,b)=>s+b.volume,0)/20;
 base.resistance=high;base.trend=last.close>e50?'bullish':'bearish';
 if(!(last.close>high)){base.reason='Waiting for a close above the prior 20-hour high.';return atrBracket(base,bars,c);}
 if(last.close<=e50){base.reason='Breakout below EMA50 trend filter; skipped.';return atrBracket(base,bars,c);}
 if(vol>0&&last.volume<vol){base.reason='Breakout volume below 20-hour average; skipped.';return atrBracket(base,bars,c);}
 atrBracket(base,bars,c);base.signal='BUY';base.reason='Donchian 20-hour breakout above EMA50 with volume; ATR stop and cost-aware target.';return base;
}
/** Mean reversion: RSI(14) crosses back above 30 with a bullish close, only while above the EMA100 regime filter less 3%. */
function analyzeRsiReversion(input,c){
 const bars=normalizeCandles(input).slice(-300),base=indicatorBase(bars,'rsi-reversion','rsi-oversold-reclaim');if(bars.length<120)return base;
 const closes=bars.map(b=>b.close),r=rsiSeries(closes),e100=emaSeries(closes,100).at(-1),last=bars.at(-1);
 base.trend=last.close>e100?'bullish':'bearish';
 if(!(r.at(-2)<30&&r.at(-1)>=30)){base.reason=`RSI ${r.at(-1).toFixed(1)}; waiting for a cross back above 30.`;return atrBracket(base,bars,c);}
 if(last.close<=last.open||last.close<e100*.97){base.reason='RSI reclaim lacks a bullish close or is in a deep downtrend regime.';return atrBracket(base,bars,c);}
 atrBracket(base,bars,c);base.signal='BUY';base.reason='RSI oversold reclaim inside regime filter; ATR stop and cost-aware target.';return base;
}
/** Days to reach `goal` if equity kept compounding at its trailing growth rate (default 30 days). An estimate, not a promise. */
export function goalEstimate(account,{goal=85000,now=Date.now()/1000,prices={},days=30,minDays=7}={}){
 const equity=markToMarket(account,prices).equity,points=[...Object.entries(account.dailyRisk??{}).map(([d,s])=>({time:Date.parse(d+'T00:00:00Z')/1000,equity:s.openingEquity})),...(account.equityHistory??[])].filter(p=>Number.isFinite(p.time)&&p.equity>0&&p.time>=now-days*86400&&p.time<now).sort((a,b)=>a.time-b.time);
 const base={goal,equity,windowDays:days,label:`Estimated time to $${goal.toLocaleString('en-US')} at the trailing ${days}-day growth rate (not a promise)`};
 if(equity>=goal)return {...base,status:'reached',days:0};
 const first=points[0],span=first?(now-first.time)/86400:0;
 if(!first||span<minDays)return {...base,status:'insufficient-history',spanDays:span,message:`Needs at least ${minDays} days of equity history.`};
 const daily=(equity/first.equity)**(1/span)-1;
 if(!(daily>0))return {...base,status:'not-growing',spanDays:span,dailyGrowth:daily,message:'Trailing growth is zero or negative, so no date can be estimated.'};
 const d=Math.log(goal/equity)/Math.log(1+daily);
 return {...base,status:'estimated',spanDays:span,dailyGrowth:daily,days:d,date:new Date((now+d*86400)*1000).toISOString().slice(0,10)};
}
