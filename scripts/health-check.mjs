import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
const BASE='https://akc302.github.io/paperTradeCodex/';
export async function checkHealth(getJSON,now=Date.now()){
 const errors=[];
 const fresh=(stamp,maxAge)=>{const t=Date.parse(stamp);return Number.isFinite(t)&&t<=now+60000&&now-t<=maxAge;};
 for(const path of ['data/market.json','data/paper.json','data/private-status.json']){
  try{
   const data=await getJSON(path);
   if(!fresh(data.updatedAt,135*60000))errors.push(`${path}: last successful update is missing or older than 135 minutes.`);
   if(path.endsWith('market.json')){
    if((data.errors??[]).length)errors.push('Market update reports feed errors.');
    for(const product of ['BTC-USD','ETH-USD','SOL-USD','XRP-USD','ADA-USD','DOGE-USD','LINK-USD','AVAX-USD']){
     const bars=data.products?.[product]?.candles,last=bars?.at(-1);
     if(!last||!Number.isFinite(last.time)||now-(last.time+3600)*1000>4*3600000)errors.push(`${product}: completed candles missing or stale.`);
    }
   }
   if(path.endsWith('paper.json')&&(!data.autoTrade||(data.errors??[]).length))errors.push('Public paper simulation is paused or reports errors.');
   if(path.endsWith('private-status.json')&&(!data.configured||data.automation!=='updated'))errors.push('Private simulation is not reporting successful encrypted updates.');
  }catch{errors.push(`${path}: unavailable or invalid response.`);}
 }
 return {ok:errors.length===0,checkedAt:new Date(now).toISOString(),errors};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const repositoryMode=process.env.HEALTH_SOURCE==='repository';
 const report=await checkHealth(async path=>{if(repositoryMode)return JSON.parse(await readFile(path,'utf8'));const response=await fetch(BASE+path+'?health='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error();return response.json();});
 report.scope=repositoryMode?'repository state; Pages publication is separate':'published Pages state';
 console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
}
