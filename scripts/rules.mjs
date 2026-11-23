/** Daily-review rule management for the public demo and the encrypted account (same code path for both).
 * Step 1: make trend-follow the main rules once; the previous rules are archived in rulesHistory. Never touches risk caps. */
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {TREND_DEFAULTS} from '../engine.js';
import {decryptState,encryptState} from './private-state.mjs';
import {ensureChallengers,retireLosers} from './challengers.mjs';
import {reviewChallengers} from './promotion.mjs';
import {loadHistory} from './history.mjs';
/** Daily review for one account: migrate once, seed challengers, then evaluate promotion. */
export function dailyRules(state,{market,history,now}){
 const migrated=migrateToTrend(state,now),seeded=ensureChallengers(state,now),retired=retireLosers(state,now),review=reviewChallengers(state,{market,history,now});
 return {migrated,seeded,retired,promoted:review?.promoted??null,reviewed:!!review};
}
export const RULES_VERSION='trend-v1';
export const MAIN_TREND=Object.freeze({strategy:'trend-follow',...TREND_DEFAULTS,maxHoldHours:0,patternRequired:false,entryOrder:'limit',limitOffset:0.0005,limitChecks:3});
const CAPS=['riskPct','maxTotalRisk','maxAllocation','maxOpenPositions','maxDailyLoss'];
export function migrateToTrend(state,now=Date.now()/1000){
 if(state.rulesVersion===RULES_VERSION)return false;
 const at=new Date(now*1000).toISOString(),before=CAPS.map(k=>state.config?.[k]);
 state.rulesHistory=[{at,event:'archived-main-rules',reason:'Trend following became the main strategy; previous hourly rules kept as challengers.',config:{...state.config},productConfigs:structuredClone(state.productConfigs??{})},...(state.rulesHistory??[])].slice(0,200);
 state.legacyRules={config:{...state.config},productConfigs:structuredClone(state.productConfigs??{}),archivedAt:at};
 state.config={...state.config,...MAIN_TREND};state.productConfigs={};state.rulesVersion=RULES_VERSION;
 if(JSON.stringify(CAPS.map(k=>state.config[k]))!==JSON.stringify(before))throw Error('Risk cap mutation refused');
 return true;
}
export async function run(){
 const now=Date.now()/1000,paper=JSON.parse(await readFile('data/paper.json','utf8')),market=JSON.parse(await readFile('data/market.json','utf8')),history=await loadHistory();
 const r=dailyRules(paper,{market,history,now});console.log(`Public demo rules: ${JSON.stringify(r)}.`);
 await writeFile('data/paper.json',JSON.stringify(paper,null,2)+'\n');
 const key=process.env.PAPER_STATE_KEY?.trim();if(!key)return;
 try{const state=await decryptState(JSON.parse(await readFile('data/portfolio.enc.json','utf8')),key);
  dailyRules(state,{market,history,now});console.log('Private account: daily rule review done (details encrypted).');
  const tmp='data/.rules.enc.tmp';try{await writeFile(tmp,JSON.stringify(await encryptState(state,key),null,2)+'\n',{mode:0o600});await rename(tmp,'data/portfolio.enc.json');}finally{await rm(tmp,{force:true});}
 }catch{console.error('Private rule update failed; ciphertext unchanged.');process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
