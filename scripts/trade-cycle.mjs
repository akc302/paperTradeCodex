/** Repository-scoped, rate-limited paper execution. No real Coinbase account calls. */
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {decryptState} from './private-state.mjs';
export const REPOSITORY='akc302/paperTradeCodex';
export const INTERVAL_SECONDS=7200;
export function tradeDue(receipt,now=Date.now()/1000){const t=Date.parse(receipt?.lastSuccessfulAt??'')/1000;return !Number.isFinite(t)||now-t>=INTERVAL_SECONDS;}
export function receiptAfterSuccess(receipt,at,event='manual'){return {version:1,repository:REPOSITORY,intervalSeconds:INTERVAL_SECONDS,lastSuccessfulAt:at,checks:[...(receipt?.checks??[]),{at,event}].slice(-100),note:'Successful paper checks only; a check may legitimately place no order.'};}
export async function run(){
 if(process.env.GH_REPO&&process.env.GH_REPO!==REPOSITORY)throw Error('Refusing execution outside paperTradeCodex');
 const read=async p=>JSON.parse(await readFile(p,'utf8'));let receipt={};try{receipt=await read('data/codex-trading.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 const now=Date.now()/1000;if(!tradeDue(receipt,now)){console.log('Paper check skipped: the two-hour interval has not elapsed.');return;}
 const key=process.env.PAPER_STATE_KEY?.trim();if(!key)throw Error('Paper check blocked: PAPER_STATE_KEY is unavailable. No ledger changed.');
 try{await decryptState(await read('data/portfolio.enc.json'),key);}catch{throw Error('Paper check blocked: private key/envelope verification failed. No ledger changed.');}
 const startedAt=Date.now();
 const result=spawnSync(process.execPath,[...process.execArgv,'scripts/update-market.mjs'],{env:{...process.env,PAPER_JOB_MODE:'trade'},stdio:'inherit'});
 if(result.status!==0)throw Error('Paper updater failed; success receipt not advanced.');
 const paper=await read('data/paper.json'),status=await read('data/private-status.json');
 if((paper.errors??[]).length||Date.parse(paper.updatedAt)<startedAt||status.automation!=='updated'||Date.parse(status.updatedAt)<startedAt)throw Error('Paper check incomplete; success receipt not advanced.');
 receipt=receiptAfterSuccess(receipt,paper.updatedAt,process.env.TRIGGER_EVENT??'codex');
 await writeFile('data/codex-trading.json',JSON.stringify(receipt,null,2)+'\n');
 console.log('Two-hour paper check completed; private ledger encrypted.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
