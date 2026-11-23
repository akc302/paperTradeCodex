/** Which learning phases are overdue, from the stored state (GitHub's own cron skips runs). Prints space-separated phases. */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const RESEARCH_EVERY_HOURS=3;
export function overduePhases(paper,now=Date.now()/1000){
 const out=[],labAt=Date.parse(paper?.strategyLab?.updatedAt??'')/1000,day=new Date(now*1000).toISOString().slice(0,10),hour=new Date(now*1000).getUTCHours();
 if(!(now-labAt<RESEARCH_EVERY_HOURS*3600))out.push('research');
 if(paper?.promotion?.reviewDate!==day&&hour>=1)out.push('review');
 return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let paper={};try{paper=JSON.parse(await readFile('data/paper.json','utf8'));}catch{}
 console.log(overduePhases(paper).join(' '));
}
