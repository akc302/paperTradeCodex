/** Refreshes about two years of 6h and daily candles from Coinbase's public candles endpoint (no account access).
 * Incremental: only bars after the newest stored one are requested. Max 300 bars per request, polite delay between pages. */
import {writeFile,mkdir,stat,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {normalizeCandles} from '../engine.js';
import {HISTORY_PRODUCTS,GRANULARITIES,DAYS_BY_LABEL,historyFile,compact,readHistoryFile} from './history.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function fetchPage(product,granularity,start,end,{fetcher=fetch,delay=400}={}){
 const url=new URL(`https://api.exchange.coinbase.com/products/${product}/candles`);
 url.searchParams.set('granularity',String(granularity));url.searchParams.set('start',new Date(start*1000).toISOString());url.searchParams.set('end',new Date(end*1000).toISOString());
 for(let attempt=0;attempt<4;attempt++){
  const r=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'Level-Lab-Paper-Research/2.0'},signal:AbortSignal.timeout(25000)});
  if(r.status===429||r.status>=500){await sleep(delay*(attempt+2)*2);continue;}
  if(!r.ok)throw new Error(`Coinbase candles request failed (${r.status}).`);
  const page=await r.json();if(!Array.isArray(page))throw new Error('Invalid candle response.');await sleep(delay);return page;
 }
 throw new Error('Coinbase candles request kept failing.');
}
/** Returns completed bars for [now-days, now), merged with what is stored. */
export async function refreshSeries(product,label,stored,now,options={}){
 const g=GRANULARITIES[label],first=Math.floor((now-DAYS_BY_LABEL[label]*86400)/g)*g,end=Math.floor(now/g)*g;
 const have=normalizeCandles(stored??[]).filter(b=>b.time>=first&&b.time+g<=now);
 let start=have.length?have.at(-1).time+g:first;const rows=[...have];
 while(start<end){const stop=Math.min(start+300*g,end);rows.push(...normalizeCandles(await fetchPage(product,g,start,stop-1,options)));start=stop;}
 return normalizeCandles(rows).filter(b=>b.time>=first&&b.time+g<=now);
}
export async function run({dir='data/history',now=Date.now()/1000,options={}}={}){
 await mkdir(dir,{recursive:true});const stamp=new Date(now*1000).toISOString(),failures=[];let bytes=0;
 for(const product of HISTORY_PRODUCTS)for(const label of Object.keys(GRANULARITIES)){
  const file=historyFile(dir,product,label);
  try{const old=await readHistoryFile(file),bars=await refreshSeries(product,label,old?.candles,now,options);
   if(bars.length<10)throw new Error('too few candles');
   const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(compact(product,label,bars,stamp))+'\n');await rename(tmp,file);
   const size=(await stat(file)).size;bytes+=size;console.log(`${product} ${label}: ${bars.length} candles, ${(size/1024).toFixed(0)} KB.`);
  }catch(e){failures.push(`${product} ${label}: ${e.message}`);console.error(`${product} ${label}: history refresh failed; keeping stored file.`);}
 }
 console.log(`History total ${(bytes/1024/1024).toFixed(2)} MB.`);
 if(bytes>12*1024*1024)throw new Error('History files exceed the 12 MB budget.');
 return {failures,bytes};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await run();if(r.failures.length===HISTORY_PRODUCTS.length*Object.keys(GRANULARITIES).length)process.exitCode=1;}
