import{readFile,writeFile,rename,rm}from'node:fs/promises';import{fileURLToPath}from'node:url';import path from'node:path';
import{collectEvidence,summarize,eligibleTrades}from'./evidence.mjs';import{trainShadow,trainTradeOutcomes}from'./learning.mjs';import{reviewStrategy,DEFAULT_CONFIG,researchPatterns}from'../engine.js';import{decryptState,encryptState}from'./private-state.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),DATA=ROOT+'/data';
const read=async(name,fallback)=>{try{return JSON.parse(await readFile(DATA+'/'+name,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}};
const save=async(name,value)=>writeFile(DATA+'/'+name,JSON.stringify(value,null,2)+'\n');
export function dailyJournalReview(state,market,now=Date.now()/1000,reviewer=reviewStrategy){
 const day=new Date(now*1000).toISOString().slice(0,10),end=Date.parse(day+'T00:00:00Z')/1000;
 if(state.journalResearch?.reviewDate===day)return {...state.journalResearch,duplicate:true};
 const account=state.account,outcomes=summarize(account,end-86400,end),completed=eligibleTrades(account,now),proposals=[];
 const dayEvidence=(state.evidence?.hourly??[]).filter(r=>Date.parse(r.periodStart)/1000>=end-86400&&Date.parse(r.periodEnd)/1000<=end);
 const coverageComplete=dayEvidence.length===24&&dayEvidence.every(r=>r.evidenceComplete);
 const frozenRisk=['riskPct','maxTotalRisk','maxAllocation','maxOpenPositions','maxDailyLoss'];
 for(const product of state.products??[]){const own=completed.filter(t=>t.product===product),before={...DEFAULT_CONFIG,...state.config,...state.productConfigs?.[product],...state.feeProfile};
  const evidenceEnough=coverageComplete&&now-Date.parse(state.updatedAt)/1000<=900&&completed.length>=100&&own.length>=30&&own.filter(t=>t.pnl>0).length>=5&&own.filter(t=>t.pnl<0).length>=5;
  if(!evidenceEnough){proposals.push({product,status:'insufficient-executed-evidence',eligibleClosedTrades:own.length,reason:'Need complete daily execution sampling coverage, a fresh heartbeat, 100 eligible completed trades overall and 30 for this market, including at least five wins and five losses. Parameters retained.'});continue;}
  const bars=market.products?.[product]?.candles??[],last=bars.at(-1),fresh=last&&now-last.time-3600<2*3600;
  if(!fresh){proposals.push({product,status:'stale-market-data',reason:'No tuning on stale market history.'});continue;}
  const review=reviewer(bars,before);let after={...before},status='retained';
  if(review.status==='candidate'){
   for(const key of ['rewardRisk','stopAtrMultiplier','maxHoldHours'])if(review.config[key]!=null)after[key]=review.config[key];
   if(frozenRisk.some(k=>after[k]!==before[k]))throw new Error('Risk cap mutation refused');
   if(JSON.stringify(after)!==JSON.stringify(before)){state.productConfigs??={};state.productConfigs[product]=after;status='adopted-for-future-entries';}
  }
  proposals.push({product,status,eligibleClosedTrades:own.length,before,after,reason:review.reason,baseline:review.baseline,candidate:review.candidate,training:review.training,holdout:review.holdout});
 }
 return {version:1,reviewDate:day,reviewedAt:new Date(now*1000).toISOString(),cadence:'once daily',executionCoverage:{hoursObserved:dayEvidence.length,complete:coverageComplete,note:'Missing or sparse execution checks must not be mistaken for a profitable or losing strategy.'},outcomes,patternResearch:Object.fromEntries((state.products??[]).map(product=>[product,researchPatterns(market.products?.[product]?.candles??[],{...DEFAULT_CONFIG,...state.config,...state.productConfigs?.[product],...state.feeProfile},now)])),tradeModel:trainTradeOutcomes(completed),proposals,notes:['Reviewing evidence does not place/close trades or alter existing positions.','Risk caps stay fixed. Insufficient evidence retains parameters.','Market-label shadow ML and executed-trade-outcome ML are distinct models.','Historical validation does not guarantee future profit.']};
}
async function run(){const phase=process.argv[2]??'collect';if(!['collect','review'].includes(phase))throw new Error('Unknown learning phase');const now=Date.now()/1000,market=await read('market.json',{products:{}}),paper=await read('paper.json',null);if(!paper?.account)throw new Error('Public ledger missing');
 paper.evidence=collectEvidence({...paper,evidence:await read('evidence.json',paper.evidence)},now);await save('evidence.json',paper.evidence);
 if(phase==='review'){const report=dailyJournalReview(paper,market,now);if(!report.duplicate){paper.journalResearch=report;paper.journalResearchHistory=[report,...(paper.journalResearchHistory??[]).filter(r=>r.reviewDate!==report.reviewDate)].slice(0,90);paper.learning={...trainShadow(market.products,{feeRate:paper.config.feeRate}),trainedOnDate:report.reviewDate,updatedAt:report.reviewedAt};await save('learning.json',paper.learning);await save('research.json',{...report,history:paper.journalResearchHistory});await save('paper.json',paper);}}
 const envelope=await read('portfolio.enc.json',null),key=process.env.PAPER_STATE_KEY?.trim();
 if(envelope&&!key){console.error('Private evidence collection unavailable: encryption key missing. Public collection saved; private ciphertext unchanged.');process.exitCode=1;return;}
 if(envelope){try{const state=await decryptState(envelope,key);state.evidence=collectEvidence(state,now);if(phase==='review'){const r=dailyJournalReview(state,market,now);if(!r.duplicate){state.journalResearch=r;state.journalResearchHistory=[r,...(state.journalResearchHistory??[]).filter(v=>v.reviewDate!==r.reviewDate)].slice(0,90);state.learning={...trainShadow(market.products,{feeRate:state.feeProfile?.feeRate??state.config.feeRate}),trainedOnDate:r.reviewDate,updatedAt:r.reviewedAt};}}
  const temp=DATA+'/.research.enc.tmp';try{await writeFile(temp,JSON.stringify(await encryptState(state,key),null,2)+'\n',{mode:0o600});await rename(temp,DATA+'/portfolio.enc.json');}finally{await rm(temp,{force:true})}
 }catch{console.error('Private learning failed; previous encrypted state retained.');process.exitCode=1;return;}}
 console.log('Journal '+phase+' completed. Trading heartbeat, cash, positions and real funds were not changed.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
