/** Manager agent: scores the trading team against the paper goal and lists the jobs to re-run. No trades, no config changes. */
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {markToMarket,performanceStats,goalEstimate} from '../engine.js';
import {decryptState,encryptState} from './private-state.mjs';
export const GOAL=85000;
const HOUR=3600;

/** Ledger arithmetic: cash must equal start + closed P&L - cost of open positions (fees net of rebates). */
export function integrity(a){
 const problems=[],num=v=>Number.isFinite(v);
 if(!num(a.cash)||a.cash<-0.01)problems.push('Cash is negative or not a number.');
 for(const p of a.positions??[])if(!(p.quantity>0)||!(p.entry>0)||!(p.stop>0)||!(p.trail||p.stop<p.entry)||!(p.target>p.entry))problems.push(`${p.product} position has invalid quantity, entry, stop or target.`);
 for(const t of a.trades??[])if(![t.pnl,t.fees,t.entry,t.exit,t.quantity].every(num))problems.push(`${t.product} trade ${t.id} has a non-numeric value.`);
 const expected=a.initial+(a.trades??[]).reduce((s,t)=>s+t.pnl,0)-(a.positions??[]).reduce((s,p)=>s+p.entry*p.quantity+(p.entryFee??0)-(p.entryFeeDetail?.rebateCredited??0),0);
 const diff=a.cash-expected;if(!(Math.abs(diff)<=0.01))problems.push(`Cash reconciliation off by $${num(diff)?diff.toFixed(2):'NaN'}: P&L, fees or rebates are miscounted.`);
 return {ok:!problems.length,cashDifference:diff,problems:problems.slice(0,10)};
}
/** Evidence the owner asked for before even considering a real account. All must pass; any failure = not ready. */
export function readiness(state,now=Date.now()/1000){
 const a=state.account,window=28*86400,trades=(a.trades??[]).filter(t=>!String(t.reason).includes('rebalance')&&t.closedAt>=now-window);
 const net=trades.reduce((s,t)=>s+t.pnl,0),gw=trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0),gl=-trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0);
 const weeks=[0,1,2,3].map(w=>trades.filter(t=>t.closedAt>=now-(w+1)*7*86400&&t.closedAt<now-w*7*86400).reduce((s,t)=>s+t.pnl,0));
 const first=Date.parse(state.strategyLabHistory?.at(-1)?.at??'')/1000,hours=(state.evidence?.hourly??[]).filter(h=>Date.parse(h.periodEnd)/1000>=now-7*86400);
 const coverage=hours.length?hours.filter(h=>h.evidenceComplete).length/168:0,decisions=Object.values(state.strategyLab?.products??{}).map(p=>p.decision);
 let peak=-Infinity,dd=0;for(const p of (a.equityHistory??[]).filter(p=>p.time>=now-window)){peak=Math.max(peak,p.equity);dd=Math.max(dd,(peak-p.equity)/peak);}
 const ledger=integrity(a),wins=trades.filter(t=>t.pnl>0).length,check=(id,label,pass,value)=>({id,label,pass:!!pass,value});
 const checks=[
  check('history','28+ days of forward paper trading with the research team',Number.isFinite(first)&&now-first>=window,Number.isFinite(first)?`${((now-first)/86400).toFixed(1)} days`:'0 days'),
  check('sample','150+ closed trades in the last 28 days',trades.length>=150,`${trades.length} trades`),
  check('winrate','Win rate 60%+ after fees',trades.length&&wins/trades.length>=.6,trades.length?`${(wins/trades.length*100).toFixed(1)}%`:'—'),
  check('profit','Net profit after fees and rebates, profit factor 1.3+',net>0&&gl>0&&gw/gl>=1.3,`$${net.toFixed(2)}, PF ${gl>0?(gw/gl).toFixed(2):'—'}`),
  check('weekly','Profitable in each of the last 4 weeks',weeks.every(v=>v>0),weeks.map(v=>'$'+v.toFixed(0)).join(' / ')),
  check('drawdown','Max drawdown 10% or less over 28 days',(a.equityHistory??[]).length&&dd<=.10,`${(dd*100).toFixed(1)}%`),
  check('validated','Research validated (profitable on unseen data) for most markets',decisions.filter(d=>d==='adopt-validated').length>decisions.length/2,`${decisions.filter(d=>d==='adopt-validated').length}/${decisions.length} markets`),
  check('uptime','Trader ran in 95%+ of hours over the last 7 days',coverage>=.95,`${(coverage*100).toFixed(0)}%`),
  check('integrity','No calculation errors in the ledger',ledger.ok,ledger.ok?'balanced':'errors'),
 ];
 const passed=checks.filter(c=>c.pass).length;
 return {ready:passed===checks.length,passed,total:checks.length,checks,message:passed===checks.length?'All evidence checks passed. Review the journal before deciding anything about a real account.':`Not ready: ${passed}/${checks.length} evidence checks passed. Keep paper trading.`};
}
const card=(id,label,account,pause,prices)=>{const s=performanceStats(account),m=markToMarket(account,prices);return {id,label,equity:m.equity,initial:account.initial,netPnl:s.netPnl,profitFactor:Number.isFinite(s.profitFactor)?s.profitFactor:s.profitFactor===Infinity?'no losses':null,maxDrawdown:s.maxDrawdown,winRate:s.winRate,avgWin:s.avgWin,avgLoss:s.avgLoss,closedTrades:s.closedTrades,fees:s.totalFees,makerFills:s.makerFills,takerFills:s.takerFills,openPositions:(account.positions??[]).length,pause:pause?.state??'normal',drawdown:pause?.drawdown??null};};
/** Net-after-fee scorecard for the main account and every challenger. */
export function scorecard(state,prices={}){return [card('main',`Main: ${state.config?.strategy??'rules'}`,state.account,state.pause,prices),...(state.challengers??[]).filter(c=>c.account).map(c=>card(c.id,c.label,c.account,c.pause,prices))];}
export function teamReport(state,market,now=Date.now()/1000,{operations={},researchNotes=null,sweep=null}={}){
 const a=state.account,prices=Object.fromEntries(Object.entries(market.products??{}).map(([p,v])=>[p,v.quote?.price??v.candles?.at(-1)?.close])),m=markToMarket(a,prices);
 const trades=(a.trades??[]).filter(t=>!String(t.reason).includes('rebalance')),day=trades.filter(t=>t.closedAt>=now-24*HOUR);
 let streak=0;for(const t of [...trades].reverse()){if(t.pnl>0)break;streak++;}
 const stat=list=>({closedTrades:list.length,wins:list.filter(t=>t.pnl>0).length,winRate:list.length?list.filter(t=>t.pnl>0).length/list.length:null,netPnl:list.reduce((s,t)=>s+t.pnl,0),grossFees:list.reduce((s,t)=>s+(t.fees??0),0),rebatesCredited:list.reduce((s,t)=>s+(t.rebateCredited??0),0)});
 const age=stamp=>{const t=Date.parse(stamp??'');return Number.isFinite(t)?now-t/1000:Infinity;};
 const trader=age(state.updatedAt),research=age(state.strategyLab?.updatedAt),lastEntry=Math.max(0,...(a.positions??[]).map(p=>p.openedAt),...trades.map(t=>t.openedAt));
 const issues=[],dispatch=[];
 if(trader>135*60){issues.push(`Trader (agent 1) last updated ${Math.round(trader/60)} min ago; expected every 2 hours.`);dispatch.push('update.yml');}
 if(research>6*HOUR){issues.push(`Researcher (agent 2) last ran ${Number.isFinite(research)?Math.round(research/HOUR)+'h':'never'} ago; expected every 5h.`);dispatch.push('learning.yml:research');}
 if(state.autoTrade===false)issues.push('Automatic entries are switched off.');
 if((state.errors??[]).length)issues.push(`${state.errors.length} trader error(s): ${state.errors.map(e=>e.message).join(' ')}`);
 if(operations.scheduleEventCount===0)issues.push('No scheduled trader run has recorded a successful paper check; schedule events may have failed or skipped the two-hour guard.');
 if(lastEntry&&now-lastEntry>24*HOUR)issues.push(`No new paper entry for ${Math.round((now-lastEntry)/HOUR)}h; current rules may be too strict for this market.`);
 const ledger=integrity(a);if(!ledger.ok)issues.push(...ledger.problems.map(p=>'Calculation error: '+p));
 const pause=state.pause??null;if(pause?.state==='blocked')issues.push(`Drawdown pause: equity ${(pause.drawdown*100).toFixed(1)}% below its peak; new entries blocked until a supervisor or manager sets pause.cleared in paper.json.`);else if(pause?.state==='halved')issues.push(`Drawdown ${(pause.drawdown*100).toFixed(1)}% from peak: new position sizes halved.`);
 const note=researchNotes?.entries?.at(-1)??null,noteAge=age(note?.at);
 if(noteAge>6*HOUR)issues.push(`Researcher (agent 2) has not written data/research-notes.json for ${Number.isFinite(noteAge)?Math.round(noteAge/HOUR)+'h':'ever'}; expected every 5h.`);
 if(day.length>=10&&day.filter(t=>t.pnl>0).length/day.length<0.4)issues.push(`Last 24h win rate ${(day.filter(t=>t.pnl>0).length/day.length*100).toFixed(0)}% over ${day.length} trades; rules are losing and the researcher must change them.`);
 if(streak>=10)issues.push(`${streak} losing trades in a row; researcher must replace the rules at its next run.`);
 const rules=Object.fromEntries((state.products??[]).map(p=>[p,{strategy:{...state.config,...state.productConfigs?.[p]}.strategy,approach:state.strategyLab?.products?.[p]?.selected??'current',decision:state.strategyLab?.products?.[p]?.decision??'none'}]));
 return {version:1,generatedAt:new Date(now*1000).toISOString(),goal:GOAL,equity:m.equity,startingEquity:a.initial,progressToGoal:(m.equity-a.initial)/(GOAL-a.initial),returnPct:(m.equity-a.initial)/a.initial,drawdown:m.drawdown,openPositions:(a.positions??[]).length,last24h:stat(day),allTime:stat(trades),losingStreak:streak,rulesInUse:rules,
  agents:{trader:{role:'Codex paper trader every 2 hours',lastRunMinutesAgo:Math.round(trader/60),healthy:trader<=135*60},researcher:{role:'Codex every 5h: loss analysis, backtest, rule adoption',lastRunHoursAgo:Number.isFinite(research)?+(research/HOUR).toFixed(1):null,healthy:research<=6*HOUR&&noteAge<=6*HOUR,sweep:sweep&&{at:sweep.at,source:sweep.source,days:sweep.days,rulesTested:sweep.rulesTested,passingAllWindows:sweep.passingAllWindows,regime:sweep.regime??null,best:sweep.best&&{config:sweep.best.config,unseen:sweep.best.unseen}},latestNote:note&&{at:note.at,tradesReviewed:note.tradesReviewed,losses:note.losses,findings:(note.findings??[]).length,changes:(note.changes??[]).length,adopted:note.adopted,nextIdea:note.nextIdea}},verifier:{role:'hourly health check and one retry',workflow:'health.yml'},manager:{role:'Codex every 6h: reads this report and the researcher notes, restarts and fixes jobs'},supervisor:{role:'Codex every 8h: audits the manager and researcher for the owner'}},
  integrity:ledger,readiness:readiness(state,now),goalEstimate:goalEstimate(a,{goal:GOAL,now,prices}),scorecard:scorecard(state,prices),drawdownPause:pause&&{state:pause.state,drawdown:pause.drawdown,peak:pause.peak,sizeMultiplier:pause.sizeMultiplier,triggeredAt:pause.triggeredAt??null,clearedAt:pause.clearedAt??null},
  verdict:issues.length?'needs-attention':'on-track',issues,dispatch:[...new Set(dispatch)]};
}

export async function run(){
 const read=async p=>JSON.parse(await readFile(p,'utf8')),now=Date.now()/1000,market=await read('data/market.json'),paper=await read('data/paper.json');
 let operations={};try{operations=await read('data/operations.json');}catch{}
 let researchNotes=null;try{researchNotes=await read('data/research-notes.json');}catch{}
 let sweep=null;try{sweep=await read('data/sweep.json');}catch{}
 const report=teamReport(paper,market,now,{operations,researchNotes,sweep});await writeFile('data/team-report.json',JSON.stringify(report,null,2)+'\n');
 const key=process.env.PAPER_STATE_KEY?.trim();let privateDispatch=[];
 if(key){try{const state=await decryptState(await read('data/portfolio.enc.json'),key);state.teamReport=teamReport(state,market,now,{operations,researchNotes:state.researchNotes??null,sweep});privateDispatch=state.teamReport.dispatch;const tmp='data/.team.enc.tmp';try{await writeFile(tmp,JSON.stringify(await encryptState(state,key),null,2)+'\n',{mode:0o600});await rename(tmp,'data/portfolio.enc.json');}finally{await rm(tmp,{force:true});}}catch{console.error('Private team report failed; ciphertext unchanged.');}}
 const all=[...new Set([...report.dispatch,...privateDispatch])];
 console.log(`Team verdict: ${report.verdict}. ${report.issues.join(' ')}`);
 if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`dispatch=${all.join(' ')}\n`,{flag:'a'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
