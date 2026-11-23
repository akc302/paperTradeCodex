import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
export async function waitForStableArtifact({probe,pause=()=>new Promise(r=>setTimeout(r,5000)),attempts=18,required=3}) {
 let consecutive=0;
 for(let i=0;i<attempts;i++) {
  let visible=false;try{visible=await probe();}catch{visible=false;}
  consecutive=visible?consecutive+1:0;
  if(consecutive>=required)return;
  if(i+1<attempts)await pause();
 }
 throw new Error('Pages artifact did not remain visible across consecutive API checks.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {GH_REPO,RUN_ID}=process.env;if(!GH_REPO||!RUN_ID)throw new Error('Repository/run context missing');
 const exec=promisify(execFile);
 await waitForStableArtifact({probe:async()=>{
  const {stdout}=await exec('gh',['api',`repos/${GH_REPO}/actions/runs/${RUN_ID}/artifacts`,'--jq','[.artifacts[] | select(.name == "github-pages" and .expired == false)] | length']);return Number(stdout.trim())===1;
 }});
 console.log('Pages artifact remained visible across three consecutive checks.');
}
