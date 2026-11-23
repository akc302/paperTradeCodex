/** Four non-trading roles share one coordinator; each runs only when its own cadence is due. */
import {readFile,writeFile}from'node:fs/promises';import{spawnSync}from'node:child_process';import{pathToFileURL}from'node:url';import{checkHealth}from'./health-check.mjs';import{decryptState}from'./private-state.mjs';
export const ROLE_HOURS=Object.freeze({verifier:1,researcher:5,manager:6,supervisor:8});
export function dueRoles(status,now=Date.now()/1000){return Object.entries(ROLE_HOURS).filter(([role,h])=>{const t=Date.parse(status?.roles?.[role]?.completedAt??'')/1000;return !Number.isFinite(t)||now-t>=h*3600;}).map(([role])=>role);}
export async function run(){
 if(process.env.GH_REPO&&process.env.GH_REPO!=='akc302/paperTradeCodex')throw Error('Refusing another repository');
 const read=async p=>JSON.parse(await readFile(p,'utf8'));let status={version:1,repository:'akc302/paperTradeCodex',roles:{}};try{status=await read('data/codex-agent-status.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 const roles=dueRoles(status);if(!roles.length){console.log('No team roles are due.');return;}
 const key=process.env.PAPER_STATE_KEY?.trim();if(!key)throw Error('Private team key unavailable; no role marked complete.');try{await decryptState(await read('data/portfolio.enc.json'),key);}catch{throw Error('Private team unlock failed; no role marked complete.');}
 const exec=(script,...args)=>{const r=spawnSync(process.execPath,[...process.execArgv,script,...args],{env:process.env,stdio:'inherit'});if(r.status!==0)throw Error('Team operation failed: '+script);};
 // Evidence collection never trades or fits; it covers completed hourly windows.
 exec('scripts/journal-learning.mjs','collect');
 for(const role of roles){let result='completed';
  if(role==='verifier'){const report=await checkHealth(p=>read(p));status.verification={checkedAt:report.checkedAt,ok:report.ok,errors:report.errors,scope:'repository files; published site must be checked separately'};result=report.ok?'healthy':'needs-attention';}
  if(role==='researcher')exec('scripts/strategy-lab.mjs');
  if(role==='manager'){
   const paper=await read('data/paper.json'),now=new Date(),day=now.toISOString().slice(0,10);
   if((now.getUTCHours()>0||now.getUTCMinutes()>=37)&&paper.journalResearch?.reviewDate!==day){exec('scripts/journal-learning.mjs','review');exec('scripts/rules.mjs');}
   exec('scripts/team-report.mjs');
  }
  if(role==='supervisor')exec('scripts/supervisor-report.mjs');
  status.roles[role]={completedAt:new Date().toISOString(),status:result,intervalHours:ROLE_HOURS[role]};
  await writeFile('data/codex-agent-status.json',JSON.stringify(status,null,2)+'\n');console.log('Destination role completed: '+role);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
