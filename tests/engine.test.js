import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG,normalizeCandles,aggregateCandles,analyze,createAccount,openPaperTrade,closePaperTrade,processCandles,processBarBatch,markToMarket,backtest,reviewStrategy} from '../engine.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const bar=(time,open,high,low,close)=>({time,open,high,low,close,volume:10});
const config={...DEFAULT_CONFIG,pivotWindow:1,lookback:24,feeRate:0,slippage:0,rewardRisk:1};
const supportPattern=()=>[
  ...Array.from({length:12},(_,i)=>bar(i*3600,100,103+i%2,98-i%2,100)),
  bar(12*3600,100,101,95,99),bar(13*3600,99,110,98,105),bar(14*3600,105,106,96,96),
  bar(15*3600,96,97,95.1,95.2),bar(16*3600,95.2,96,95.15,95.5)
];

test('normalizes both Coinbase candle formats, deduplicates and rejects malformed OHLC',()=>{
  const input=[[7200,9,12,10,11,3],[0,1,4,2,3,2],[0,1,5,2,4,2],[3600,20,12,10,11,3]];
  const out=normalizeCandles(input);assert.equal(out.length,2);assert.equal(out[0].close,4);assert.equal(out[1].time,7200);
  assert.deepEqual(normalizeCandles({candles:[{start:'1',open:'2',high:'4',low:'1',close:'3',volume:'2'}]}),[bar(1,2,4,1,3)].map(x=>({...x,volume:2})));
});

test('cash ledger includes adverse entry/exit slippage and both fees',()=>{
  const a=createAccount();openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120,time:1});
  const p=a.positions[0];near(p.entry,100.05);assert.ok(a.cash>=0);assert.ok(p.quantity*p.entry+p.entryFee<=2500+1e-8);
  near(a.cash,10000-p.entry*p.quantity-p.entryFee);
  closePaperTrade(a,p.id,110,2,'manual');
  const t=a.trades[0];near(t.exit,109.945);near(a.cash,10000+t.pnl);near(t.fees,t.entryFee+t.exitFee);assert.ok(t.fees>0);
  near(markToMarket(a).realized,t.pnl);near(markToMarket(a).equity,a.cash);
});

test('planned stop loss including fees respects risk budget',()=>{
  const a=createAccount();openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120,time:1});
  const p=a.positions[0];closePaperTrade(a,p.id,90,2,'stop');near(a.trades[0].pnl,-100);
});

test('allocation cap includes buy fee and a second market cannot overdraw virtual cash',()=>{
  const a=createAccount(1000);const c={...config,maxAllocation:1,maxExposure:1};
  openPaperTrade(a,{product:'A-USD',price:100,stop:99.999,target:110,time:1},c);near(a.cash,0);
  assert.throws(()=>openPaperTrade(a,{product:'B-USD',price:100,stop:90,target:110,time:1},c),/Insufficient/);
});

test('rejects invalid brackets, duplicate positions, unsafe risk settings',()=>{
  const a=createAccount();assert.throws(()=>openPaperTrade(a,{product:'BTC-USD',price:100,stop:101,target:120}),/Stop/);
  assert.throws(()=>openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120},{riskPct:1}),/risk/);
  openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120});
  assert.throws(()=>openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120}),/already/);
});

test('initial live synchronization never invents historical trades',()=>{
  const a=createAccount();processCandles(a,'BTC-USD',supportPattern(),config);
  assert.equal(a.positions.length,0);assert.equal(a.trades.length,0);assert.equal(a.lastProcessed['BTC-USD'],16*3600);
});

test('support signal waits for next open; current signal candle is never its fill',()=>{
  const bars=supportPattern();assert.equal(analyze(bars,config).signal,'BUY');
  const a=createAccount();processCandles(a,'BTC-USD',bars,config);
  assert.equal(a.positions.length,0);
  const next=bar(17*3600,95.5,95.9,95.3,95.7);
  processCandles(a,'BTC-USD',[...bars,next],config);
  assert.equal(a.positions.length,1);near(a.positions[0].entry,95.5);assert.equal(a.positions[0].openedAt,next.time);
  const before=JSON.stringify(a);processCandles(a,'BTC-USD',[...bars,next],config);assert.equal(JSON.stringify(a),before);
});

test('stops win ambiguous candles and a gap fills below the stop',()=>{
  const a=createAccount();processCandles(a,'BTC-USD',[bar(0,100,101,99,100)],config);
  openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:110,time:1},config);
  processCandles(a,'BTC-USD',[bar(0,100,101,99,100),bar(3600,80,120,70,100)],config,{autoTrade:false});
  assert.equal(a.trades[0].reason,'stop');near(a.trades[0].exit,80);assert.equal(a.positions.length,0);
});

test('incremental replay agrees with a full replay and cannot use future candles',()=>{
  const bars=[...supportPattern(),bar(17*3600,95.5,95.9,95.3,95.7),bar(18*3600,95.7,99,95.2,98),bar(19*3600,98,99,94,95)];
  const a=createAccount(),b=createAccount();processCandles(a,'BTC-USD',bars.slice(0,18),config,{replay:true});
  const firstEntry=a.positions[0]?.entry??a.trades[0]?.entry;near(firstEntry,95.5);
  processCandles(a,'BTC-USD',bars,config,{replay:true});processCandles(b,'BTC-USD',bars,config,{replay:true});
  assert.deepEqual(a,b);assert.ok(a.trades.length>0);
});

test('backtest costs reduce results and daily review retains parameters without evidence',()=>{
  const bars=[...supportPattern(),bar(17*3600,95.5,95.9,95.3,95.7),bar(18*3600,95.7,99,95.2,98)];
  const result=backtest(bars,config);assert.ok(result.closedTrades>=1);assert.ok(result.returnPct>0);
  assert.equal(reviewStrategy(bars,config).status,'insufficient-data');
  const flat=Array.from({length:300},(_,i)=>bar(i*3600,100,101,99,100));const review=reviewStrategy(flat,config);
  assert.equal(review.status,'retained');assert.match(review.reason,/fewer than five/);assert.equal(review.training.candles,210);assert.equal(review.holdout.candles,90);
});

test('next-open gaps cannot lower automated reward/risk below the configured net minimum',()=>{
  const bars=supportPattern().map((b,i)=>i<12?{...b,low:98}:b),c={...config,feeRate:0.001,slippage:0.0005,rewardRisk:2};
  const signal=analyze(bars,c);assert.equal(signal.signal,'BUY');
  const nextTime=17*3600;
  const gapOpen=95.6;
  assert.ok(signal.stop<gapOpen&&signal.target>gapOpen*(1+c.slippage),'old bracket-only check would allow this trade');
  const skipped=createAccount();processCandles(skipped,'BTC-USD',bars,c);
  processCandles(skipped,'BTC-USD',[...bars,bar(nextTime,gapOpen,95.9,95.3,95.7)],c);
  assert.equal(skipped.positions.length,0);assert.equal(skipped.trades.length,0);near(skipped.cash,10000);
  assert.equal(skipped.decisions.at(-1).observedSignal,'BUY');assert.equal(skipped.decisions.at(-1).signal,'WAIT');
  const accepted=createAccount();processCandles(accepted,'BTC-USD',bars,c);
  processCandles(accepted,'BTC-USD',[...bars,bar(nextTime,95.5,95.9,95.3,95.7)],c);
  assert.equal(accepted.positions.length,1);
  assert.ok(accepted.positions[0].estimatedRewardRisk>=2-1e-10);
  // A favorable gap preserves the same bracket and increases the net ratio.
  const favorable=createAccount();processCandles(favorable,'BTC-USD',bars,c);
  processCandles(favorable,'BTC-USD',[...bars,bar(nextTime,95.4,95.9,95.3,95.7)],c);
  assert.equal(favorable.positions.length,1);assert.ok(favorable.positions[0].estimatedRewardRisk>2);
});

test('4h aggregation excludes incomplete, misaligned, and missing-hour groups',()=>{
  const bars=Array.from({length:12},(_,i)=>bar(i*3600,100+i,102+i,99+i,101+i));
  const complete=aggregateCandles(bars.slice(0,11));assert.equal(complete.length,2);
  assert.deepEqual(complete[0],{time:0,open:100,high:105,low:99,close:104,volume:40});
  const gap=aggregateCandles(bars.filter(b=>b.time!==3600));assert.equal(gap.length,2);assert.equal(gap[0].time,14400);
  const misaligned=aggregateCandles(bars.slice(0,4).map(b=>({...b,time:b.time+60})));assert.equal(misaligned.length,0);
});

function risingTrendFixture(){
  const four=Array.from({length:70},(_,i)=>{
    const line=100+0.2*i;
    return bar(i*14400,line+4,line+6,line+3,line+4.2);
  });
  for(const i of [6,30,54])four[i].low=100+0.2*i;
  for(const i of [10,34])four[i].high=100+0.2*i+7;
  four[58].high=100+0.2*58+14;
  four[68]=bar(68*14400,114,114.4,113.7,114.2);
  four[69]=bar(69*14400,114.6,115.1,113.85,115);
  return four.flatMap(b=>[
    bar(b.time,b.open,b.open,b.open,b.open),
    bar(b.time+3600,b.open,b.high,b.open,b.open),
    bar(b.time+7200,b.open,b.open,b.low,b.open),
    bar(b.time+10800,b.open,Math.max(b.open,b.close),Math.min(b.open,b.close),b.close)
  ]);
}

test('trendline setup needs three confirmed spaced touches spanning one week and closed 1h confirmation',()=>{
  const bars=risingTrendFixture(),c={...DEFAULT_CONFIG,strategy:'trendline',pivotWindow:3};
  const result=analyze(bars,c);
  assert.equal(result.signal,'BUY',result.reason);assert.equal(result.setup,'rising-support-bounce');assert.equal(result.trend,'bullish');assert.equal(result.confirmation,true);
  assert.ok(result.estimatedRewardRisk>=2);assert.ok(result.trendlines[0].spanBars>=42);assert.ok(result.trendlines[0].touches.length>=3);
  const short=analyze(bars.slice(-160),c);assert.equal(short.signal,'WAIT');assert.equal(short.trendlines.length,0);
  const incomplete=analyze(bars.slice(0,-1),c);assert.equal(incomplete.signal,'WAIT');
  assert.ok(result.trendlines[0].touches.every(t=>t.time<=aggregateCandles(bars).at(-1).time-c.pivotWindow*14400));
});

test('descending 4h resistance break requires bullish structure and a cost-aware overhead target',()=>{
  const four=Array.from({length:70},(_,i)=>{const line=150-0.5*i;return bar(i*14400,line-4,line-2,line-7,line-4.5);});
  for(const i of [6,30,63])four[i].high=150-0.5*i;
  for(const [i,low] of [[14,90],[40,95],[61,100]])four[i].low=low;
  four[68]=bar(68*14400,115.6,116.2,115,115.8);four[69]=bar(69*14400,116,119.5,115.6,119);
  const bars=four.flatMap(b=>[
    bar(b.time,b.open,b.open,b.open,b.open),bar(b.time+3600,b.open,b.high,b.open,b.open),
    bar(b.time+7200,b.open,b.open,b.low,b.open),bar(b.time+10800,b.open,Math.max(b.open,b.close),Math.min(b.open,b.close),b.close)
  ]);
  const c={...DEFAULT_CONFIG,strategy:'trendline'},signal=analyze(bars,c);
  assert.equal(signal.signal,'BUY',signal.reason);assert.equal(signal.setup,'descending-resistance-break');assert.equal(signal.structure,true);assert.equal(signal.trend,'bullish');
  assert.ok(signal.trendlines.some(l=>l.direction==='descending'&&l.spanBars>=42&&l.touches.length>=3));assert.ok(signal.estimatedRewardRisk>=2);
});

test('future bars cannot alter an earlier journal signal or fill in multi-timeframe replay',()=>{
  const bars=risingTrendFixture(),c={...DEFAULT_CONFIG,strategy:'trendline'};
  const nextTime=bars.at(-1).time+3600;
  const next=bar(nextTime,115,115.2,114.8,115.1),future=bar(nextTime+3600,115.1,500,1,2);
  const one=createAccount(),two=createAccount();
  processCandles(one,'BTC-USD',bars,c);processCandles(two,'BTC-USD',bars,c);
  processCandles(one,'BTC-USD',[...bars,next],c);
  processCandles(two,'BTC-USD',[...bars,next,future],c);
  const decision=one.decisions.find(d=>d.time===nextTime),same=two.decisions.find(d=>d.time===nextTime);
  assert.equal(decision.action,'BUY',decision.reason);assert.deepEqual(decision,same);
  near(one.positions[0].entry,two.trades[0].entry);
});

test('all markets share cash, stop-risk budget, and position limits',()=>{
  const a=createAccount(),c={...config,riskPct:0.02,maxAllocation:1,maxTotalRisk:0.03};
  openPaperTrade(a,{product:'A-USD',price:100,stop:90,target:130,time:0},c);
  openPaperTrade(a,{product:'B-USD',price:100,stop:90,target:130,time:0},c);
  near(a.positions[0].quantity,20);near(a.positions[1].quantity,10);near(a.cash,7000);
  assert.throws(()=>openPaperTrade(a,{product:'C-USD',price:100,stop:90,target:130,time:0},c),/shared paper stop risk/);
  assert.throws(()=>openPaperTrade(a,{product:'C-USD',price:100,stop:90,target:130,time:0},{...c,maxOpenPositions:2}),/positions/);
});

test('maximum hold closes at first eligible open and decision journal is idempotent',()=>{
  const a=createAccount(),c={...config,maxHoldHours:1};
  processCandles(a,'A-USD',[bar(0,100,101,99,100)],c);
  openPaperTrade(a,{product:'A-USD',price:100,stop:90,target:120,time:0},c);
  const bars=[bar(0,100,101,99,100),bar(3600,101,110,95,105)];
  processCandles(a,'A-USD',bars,c);
  assert.equal(a.positions.length,0);assert.equal(a.trades[0].reason,'time-exit');near(a.trades[0].exit,101);
  assert.equal(a.decisions.at(-1).action,'EXIT');assert.equal(a.decisions.at(-1).config.maxHoldHours,1);
  const snapshot=JSON.stringify(a);processCandles(a,'A-USD',bars,c);assert.equal(JSON.stringify(a),snapshot);
  a.decisions=Array.from({length:5000},()=>a.decisions[0]);
  processCandles(a,'A-USD',[...bars,bar(7200,105,106,104,105)],c,{autoTrade:false});assert.equal(a.decisions.length,5000);
});

test('daily equity-loss circuit latches for UTC day while existing exits remain active',()=>{
  const a=createAccount(),c={...config,maxHoldHours:0,maxDailyLoss:0.04};
  processCandles(a,'A-USD',[bar(0,100,101,99,100)],c);processCandles(a,'B-USD',[bar(0,100,101,99,100)],c);
  openPaperTrade(a,{product:'A-USD',price:100,stop:99,target:120,time:0},c);
  openPaperTrade(a,{product:'B-USD',price:100,stop:90,target:120,time:0},c);
  processCandles(a,'A-USD',[bar(0,100,101,99,100),bar(3600,70,75,69,72)],c);
  assert.equal(a.dailyRisk['1970-01-01'].blocked,true);
  assert.throws(()=>openPaperTrade(a,{product:'C-USD',price:100,stop:90,target:120,time:3601},c),/daily loss circuit/);
  processCandles(a,'B-USD',[bar(0,100,101,99,100),bar(3600,100,125,99,120)],c);
  assert.equal(a.positions.length,0);assert.equal(a.trades.at(-1).reason,'target');
  processCandles(a,'A-USD',[bar(7200,72,74,71,73)],c);
  assert.match(a.decisions.at(-1).reason,/daily loss circuit/);
  openPaperTrade(a,{product:'C-USD',price:100,stop:90,target:120,time:86400},c);assert.equal(a.positions.length,1);
});

test('holdout warmup uses earlier context without executing earlier trades',()=>{
  const bars=[...supportPattern(),bar(17*3600,95.5,95.9,95.3,95.7),bar(18*3600,95.7,99,95.2,98)];
  const result=backtest(bars,config,{startTime:17*3600});
  assert.equal(result.candles,2);assert.ok(result.closedTrades>0);
  assert.ok(result.account.trades.every(t=>t.openedAt>=17*3600));assert.ok(result.account.decisions.every(d=>d.time>=17*3600));
});

test('same-hour intrabar target proceeds cannot fund another markets opening fill',()=>{
  const a=createAccount(1000),c={...config,maxAllocation:1,maxExposure:1,maxTotalRisk:0.2,maxHoldHours:0,maxDailyLoss:0};
  const history=supportPattern(),time=17*3600;
  a.lastProcessed={'A-USD':16*3600,'B-USD':16*3600};a.marks={'A-USD':100,'B-USD':95.5};
  openPaperTrade(a,{product:'A-USD',price:100,stop:99.999,target:105,time:16*3600},c);near(a.cash,0);
  processBarBatch(a,[
    {product:'A-USD',bars:[bar(16*3600,100,101,99.9995,100),bar(time,100,110,99.9995,109)],config:c},
    {product:'B-USD',bars:[...history,bar(time,95.5,95.9,95.3,95.7)],config:c}
  ]);
  assert.equal(a.positions.length,0);assert.equal(a.trades.length,1);assert.equal(a.trades[0].reason,'target');near(a.cash,1050);
  const decision=a.decisions.find(d=>d.product==='B-USD');assert.equal(decision.observedSignal,'BUY');assert.equal(decision.action,'WAIT');assert.match(decision.reason,/Insufficient virtual cash/);
});

test('batch opening sizes use simultaneous open marks and are input-order independent',()=>{
  const c={...config,maxAllocation:0.25,maxHoldHours:0,maxDailyLoss:0},history=supportPattern(),time=17*3600;
  const make=()=>{const a=createAccount();a.lastProcessed={'A-USD':16*3600,'B-USD':16*3600};a.marks={'A-USD':100,'B-USD':95.5};openPaperTrade(a,{product:'A-USD',price:100,stop:99.9,target:150,time:16*3600},c);return a;};
  const events=[
    {product:'A-USD',bars:[bar(16*3600,100,101,99.99,100),bar(time,110,120,109,119)],config:c},
    {product:'B-USD',bars:[...history,bar(time,95.5,95.9,95.3,95.7)],config:c}
  ];
  const a=make(),b=make();processBarBatch(a,events);processBarBatch(b,[...events].reverse());assert.deepEqual(a,b);
  const position=a.positions.find(p=>p.product==='B-USD');assert.ok(position);near(position.quantity,10250*0.25/95.5);
  const snapshot=JSON.stringify(a);processBarBatch(a,events);assert.equal(JSON.stringify(a),snapshot);
});

test('known opening exits may fund new entries while per-event pause and timestamps are honored',()=>{
  const c={...config,maxAllocation:1,maxTotalRisk:0.2,maxHoldHours:0,maxDailyLoss:0},history=supportPattern(),time=17*3600;
  const make=()=>{const a=createAccount(1000);a.lastProcessed={'A-USD':16*3600,'B-USD':16*3600};a.marks={'A-USD':100,'B-USD':95.5};openPaperTrade(a,{product:'A-USD',price:100,stop:99.999,target:105,time:16*3600},c);return a;};
  const events=[
    {product:'A-USD',bars:[bar(time,106,110,105,109)],config:c},
    {product:'B-USD',bars:[...history,bar(time,95.5,95.9,95.3,95.7)],config:c}
  ];
  const a=make();processBarBatch(a,events);assert.equal(a.positions[0].product,'B-USD');assert.equal(a.trades[0].reason,'target');
  const paused=make();processBarBatch(paused,[events[0],{...events[1],autoTrade:false}]);assert.equal(paused.positions.length,0);assert.match(paused.decisions.find(d=>d.product==='B-USD').reason,/paused/);
  const invalid=make(),snapshot=JSON.stringify(invalid);
  assert.throws(()=>processBarBatch(invalid,[events[0],{...events[1],bars:history}]),/same candle time/);assert.equal(JSON.stringify(invalid),snapshot);
});
