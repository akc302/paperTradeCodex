import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/data',{recursive:true});
for(const file of ['index.html','styles.css','app.js','engine.js','private-ui.js','favicon.svg'])await cp(file,`dist/${file}`);
await cp('THIRD_PARTY.md','dist/THIRD_PARTY.md');
await mkdir('dist/third-party/day-trader-skill',{recursive:true});
await cp('third-party/day-trader-skill/LICENSE','dist/third-party/day-trader-skill/LICENSE');
const allowed=['supervisor-report.json','market.json','mcp-seed.json','paper.json','reviews.json','portfolio.enc.json','private-status.json','learning.json','operations.json','evidence.json','research.json','team-report.json','fee-tier.json','research-notes.json','sweep.json'];
for(const name of allowed){
 try{
  const raw=await readFile(`data/${name}`);
  if(name==='portfolio.enc.json'){
   const envelope=JSON.parse(raw);
   if(envelope.version!==1||envelope.algorithm!=='AES-256-GCM'||Object.keys(envelope).sort().join(',')!=='algorithm,ciphertext,iv,version')throw new Error('Private publication requires an encrypted envelope only.');
   const canonical=value=>typeof value==='string'&&value.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(value)&&Buffer.from(value,'base64').toString('base64')===value;
   if(!canonical(envelope.iv)||!canonical(envelope.ciphertext)||Buffer.from(envelope.iv,'base64').length!==12||Buffer.from(envelope.ciphertext,'base64').length<18)throw new Error('Private publication requires canonical encrypted bytes.');
  }
  await writeFile(`dist/data/${name}`,raw);
 }catch(error){if(error.code!=='ENOENT')throw error;}
}
await mkdir('dist/scripts',{recursive:true});
await cp('scripts/private-state.mjs','dist/scripts/private-state.mjs');
await writeFile('dist/.nojekyll','');
console.log('Static Pages build ready. Explicit public-data whitelist and encrypted envelope checked.');
