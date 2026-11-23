/** Uses completed execution receipts, not successful skipped workflow jobs, as cadence evidence. */
import {readFileSync,writeFileSync} from 'node:fs';
let receipt={};try{receipt=JSON.parse(readFileSync('data/codex-trading.json','utf8'));}catch{}
const checks=receipt.checks??[],last=checks.slice(-3),times=last.map(c=>Date.parse(c.at));
const verified=times.length===3&&Date.now()-times.at(-1)<=135*60000&&times.slice(1).every((v,i)=>v-times[i]>=7200000&&v-times[i]<=8100000);
writeFileSync('data/operations.json',JSON.stringify({updatedAt:new Date().toISOString(),repository:'akc302/paperTradeCodex',intervalMinutes:120,triggerEvent:process.env.TRIGGER_EVENT??'codex',scheduleEventCount:checks.filter(c=>c.event==='schedule').length,tradingCadenceVerified:verified,fiveMinuteCadenceVerified:false,recentRuns:checks.slice(-6).reverse().map(c=>({createdAt:c.at,event:c.event,status:'completed',conclusion:'success'})),note:'Two-hour cadence is evaluated from successful paper checks. Codex/manual checks are distinct from GitHub schedule events; cron configuration does not prove delivery.'},null,2)+'\n');
