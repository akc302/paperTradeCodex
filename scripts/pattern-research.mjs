/** Explicit initial research refresh; no execution, configuration changes or heartbeat advancement. */
import {readFile,writeFile,rename,rm} from'node:fs/promises';
import {researchPatterns}from'../engine.js';import{decryptState,encryptState}from'./private-state.mjs';
const market=JSON.parse(await readFile('data/market.json','utf8')),paper=JSON.parse(await readFile('data/paper.json','utf8')),now=Date.now()/1000;
const evaluate=state=>({version:1,updatedAt:new Date(now*1000).toISOString(),mode:'shadow',products:Object.fromEntries(state.products.map(p=>[p,researchPatterns(market.products[p]?.candles??[],{...state.config,...state.productConfigs?.[p],...state.feeProfile},now)]))});
// Preflight private state before writing anything; ciphertext stays encrypted at rest.
const envelope=JSON.parse(await readFile('data/portfolio.enc.json','utf8')),key=process.env.PAPER_STATE_KEY?.trim();
if(!key)throw Error('Private research key required; no files changed.');
let state;try{state=await decryptState(envelope,key);}catch{throw Error('Private research unlock failed; no files changed.');}
paper.patternResearch=evaluate(paper);state.patternResearch=evaluate(state);
const cipher=await encryptState(state,key),tmp='data/.patterns.enc.tmp';
try{await writeFile(tmp,JSON.stringify(cipher,null,2)+'\n',{mode:0o600});await rename(tmp,'data/portfolio.enc.json');}finally{await rm(tmp,{force:true});}
await writeFile('data/paper.json',JSON.stringify(paper,null,2)+'\n');
console.log('Public and encrypted private pattern research refreshed; execution and risk settings unchanged.');
