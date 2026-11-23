import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createCipheriv,randomBytes} from 'node:crypto';

// All publication fixtures are synthetic. Never inspect an actual private snapshot.
const buildSource=new URL('../scripts/build.mjs',import.meta.url);
const publicNames=['market.json','mcp-seed.json','paper.json','reviews.json','private-status.json'];
function validEnvelope(){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',randomBytes(32),iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify({version:1,label:'synthetic-build-fixture'}),'utf8'),cipher.final(),cipher.getAuthTag()]);
  return {version:1,algorithm:'AES-256-GCM',iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64')};
}
async function withFixture(run){
  const root=await mkdtemp(path.join(tmpdir(),'level-lab-build-test-'));
  try{
    await mkdir(path.join(root,'scripts'));await mkdir(path.join(root,'data'));
    await copyFile(buildSource,path.join(root,'scripts/build.mjs'));
    await mkdir(path.join(root,'third-party/day-trader-skill'),{recursive:true});
    await writeFile(path.join(root,'third-party/day-trader-skill/LICENSE'),'Synthetic MIT attribution');
    await writeFile(path.join(root,'THIRD_PARTY.md'),'Synthetic research attribution');
    await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));
    for(const file of ['index.html','styles.css','app.js','engine.js','private-ui.js','favicon.svg'])await writeFile(path.join(root,file),`synthetic ${file}`);
    await writeFile(path.join(root,'scripts/private-state.mjs'),'export const syntheticFixtureOnly = true;');
    for(const name of publicNames)await writeFile(path.join(root,'data',name),JSON.stringify({synthetic:name}));
    return await run(root);
  }finally{await rm(root,{recursive:true,force:true})}
}
const build=root=>spawnSync(process.execPath,['scripts/build.mjs'],{cwd:root,encoding:'utf8',timeout:10000});

test('publication uses an explicit data whitelist and excludes unknown secret-like files',async()=>{
  await withFixture(async root=>{
    const canary='SYNTHETIC_SECRET_DEBUG_CANARY';
    await writeFile(path.join(root,'data/secret-debug.json'),JSON.stringify({key:canary}));
    await writeFile(path.join(root,'data/private-key.txt'),canary);
    const result=build(root);assert.equal(result.status,0,result.stderr);
    assert.deepEqual((await readdir(path.join(root,'dist/data'))).sort(),[...publicNames].sort());
    for(const name of await readdir(path.join(root,'dist/data'))){
      assert.ok(!(await readFile(path.join(root,'dist/data',name),'utf8')).includes(canary));
    }
    assert.equal(await readFile(path.join(root,'dist/third-party/day-trader-skill/LICENSE'),'utf8'),'Synthetic MIT attribution');
    assert.equal(await readFile(path.join(root,'dist/scripts/private-state.mjs'),'utf8'),'export const syntheticFixtureOnly = true;');
  });
});

test('publication accepts only the bounded AES-GCM envelope fields',async()=>{
  await withFixture(async root=>{
    const envelope=validEnvelope();
    await writeFile(path.join(root,'data/portfolio.enc.json'),JSON.stringify(envelope));
    const result=build(root);assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(await readFile(path.join(root,'dist/data/portfolio.enc.json'),'utf8')),envelope);
  });
});

test('publication rejects malformed encryption fields and plaintext envelopes',async t=>{
  const valid=validEnvelope();
  const invalid=[
    ['object IV',{...valid,iv:{raw:'not ciphertext'}}],
    ['object ciphertext',{...valid,ciphertext:{balance:12345}}],
    ['plaintext instead of ciphertext',{...valid,ciphertext:'{"balance":12345}'}],
    ['extra plaintext property',{...valid,portfolio:{syntheticBalance:12345}}],
    ['short IV',{...valid,iv:Buffer.alloc(8).toString('base64')}],
    ['empty ciphertext',{...valid,ciphertext:''}],
    ['short authentication tag',{...valid,ciphertext:Buffer.alloc(8).toString('base64')}],
    ['noncanonical base64',{...valid,iv:valid.iv+'='}],
    ['wrong algorithm',{...valid,algorithm:'plaintext'}],
    ['plain state',{version:1,account:{cash:12345}}],
  ];
  for(const [name,envelope] of invalid)await t.test(name,async()=>{
    await withFixture(async root=>{
      await writeFile(path.join(root,'data/portfolio.enc.json'),JSON.stringify(envelope));
      const result=build(root);assert.notEqual(result.status,0,`${name} must stop publication`);
      assert.ok(!(await readdir(path.join(root,'dist/data'))).includes('portfolio.enc.json'),'Invalid private data must not enter the deploy directory.');
    });
  });
});
