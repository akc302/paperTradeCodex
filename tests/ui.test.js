import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_CONFIG,createAccount} from '../engine.js';
import {encryptState} from '../scripts/private-state.mjs';

// Application event smoke checks, with only the DOM surface used by this app.
// These check behavior and account boundaries; they do not replace visual browser QA.
class Element {
  constructor(dataset={}){this.dataset=dataset;this.listeners={};this.innerHTML='';this.textContent='';this.value='';this.hidden=false;this.open=false;this.attributes={};const values=new Set();this.classList={add:x=>values.add(x),remove:x=>values.delete(x),toggle:(x,on)=>on?values.add(x):values.delete(x)};}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  setAttribute(k,v){this.attributes[k]=v;}
  removeAttribute(k){delete this.attributes[k];}
  showModal(){this.open=true;}
  close(){this.open=false;}
  async emit(type,event={}){for(const fn of this.listeners[type]??[])await fn({preventDefault(){},target:this,...event});}
}
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
let sequence=0;
async function harness({staleQuote=false,oldSchedule=false,privateFixture=null}={}){
  const names=['document','window','location','localStorage','fetch','setTimeout','clearTimeout','setInterval','confirm'];
  const saved=Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const selectors=new Map(),element=s=>{if(!selectors.has(s))selectors.set(s,new Element());return selectors.get(s)};
  const nav=['overview','journal','strategy','updates','settings'].map(nav=>new Element({nav}));
  const modes=['shared','personal','private'].map(account=>new Element({account}));
  const doc=new Element();doc.querySelector=element;doc.querySelectorAll=s=>s==='[data-nav]'?nav:s==='[data-account]'?modes:[];doc.hidden=false;
  const win=new Element();win.scrollTo=()=>{};
  const store=new Map([['level-lab-account-v1',JSON.stringify(createAccount(5000))]]);
  const calls=[],hour=Math.floor(Date.now()/3600000)*3600;
  const bars=Array.from({length:96},(_,i)=>({time:hour-(96-i)*3600,open:100+Math.sin(i)*2,high:105,low:95,close:101+Math.sin(i)*2,volume:50}));
  const products=Object.fromEntries(['BTC-USD','ETH-USD','SOL-USD','XRP-USD','ADA-USD','DOGE-USD','LINK-USD','AVAX-USD'].map(p=>[p,{candles:bars,source:'fixture',fetchedAt:new Date().toISOString()}]));
  const shared={account:createAccount(),config:{...DEFAULT_CONFIG},products:['BTC-USD'],updatedAt:new Date(Date.now()-(oldSchedule?3*86400000:0)).toISOString()};
  shared.account.lastProcessed['BTC-USD']=hour-3600-(oldSchedule?3*86400:0);
  const snapshots={market:{products,errors:[]},paper:shared,reviews:{reviews:[]},'private-status':{configured:true,status:'awaiting-key'}};
  Object.assign(globalThis,{
    document:doc,window:win,location:{hash:'#overview'},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
    setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,confirm:()=>false,
    fetch:async url=>{
      calls.push(String(url));let value;
      const snapshot=String(url).match(/\.\/data\/([\w-]+)\.json/);
      if(String(url).includes('./data/portfolio.enc.json'))value=privateFixture;
      else if(snapshot)value=snapshots[snapshot[1]];
      else if(String(url).includes('/candles'))value=bars.map(b=>[b.time,b.low,b.high,b.open,b.close,b.volume]);
      else if(String(url).includes('/ticker'))value={price:'102',time:new Date(Date.now()-(staleQuote?300000:0)).toISOString()};
      else throw new Error(`Unexpected request: ${url}`);
      return {ok:true,json:async()=>structuredClone(value)};
    }
  });
  const instance=sequence++;
  const module=source.replace("from './engine.js'",`from '${new URL('../engine.js',import.meta.url).href}'`).replace("from './scripts/private-state.mjs'",`from '${new URL('../scripts/private-state.mjs',import.meta.url).href}'`).replace("from './private-ui.js'",`from '${new URL(`../private-ui.js?smoke=${instance}`,import.meta.url).href}'`)+`\n// smoke instance ${instance}`;
  await import(`data:text/javascript;base64,${Buffer.from(module).toString('base64')}`);
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  const click=async (selector,dataset)=>doc.emit('click',{target:{closest:s=>s===selector?new Element(dataset):null}});
  return {
    element,store,calls,shared,
    route:async key=>{globalThis.location.hash='#'+key;await win.emit('hashchange')},
    click,
    unlock:async text=>doc.emit('change',{target:{id:'private-key-file',value:'synthetic-key.txt',files:[{name:'synthetic-key.txt',size:text.length,text:async()=>text}]}}),
    dispose(){for(const key of names){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}}
  };
}

test('frontend routes render real empty accounts and keep manual practice isolated',async()=>{
  const h=await harness();
  try{
    assert.match(h.element('#view').innerHTML,/\$10,000\.00/);
    assert.match(h.element('#view').innerHTML,/No open paper positions/);
    assert.match(h.element('#view').innerHTML,/Waiting for the first closed trade/);
    for(const [route,content] of [['journal','A fresh page in your journal'],['strategy','Historical replay'],['updates','No reviews yet'],['settings','Practice risk settings']]){
      await h.route(route);assert.match(h.element('#view').innerHTML,new RegExp(content));
    }
    await h.route('overview');
    await h.click('[data-market]',{market:'DOGE-USD'});
    assert.match(h.element('#view').innerHTML,/Dogecoin/);
    assert.match(h.element('#view').innerHTML,/Day-trade patterns/);
    assert.match(h.element('#view').innerHTML,/OBSERVE ONLY/);
    await h.click('[data-hours]',{hours:'4'});
    assert.match(h.element('#view').innerHTML,/4H CANDLES/);
    await h.click('[data-hours]',{hours:'1'});
    assert.match(h.element('#view').innerHTML,/1H CANDLES/);
    await h.click('[data-market]',{market:'BTC-USD'});
    await h.click('[data-account]',{account:'personal'});
    assert.match(h.element('#view').innerHTML,/\$5,000\.00/);
    await h.click('[data-action]',{action:'trade'});
    assert.equal(h.element('#trade-dialog').open,true);
    h.element('#trade-stop').value='95';h.element('#trade-target').value='115';
    await h.element('#trade-form').emit('submit');
    assert.equal(h.element('#trade-dialog').open,false);
    const practice=JSON.parse(h.store.get('level-lab-account-v1'));
    assert.equal(practice.positions.length,1);assert.ok(practice.cash<5000);
    await h.click('[data-account]',{account:'shared'});
    assert.match(h.element('#view').innerHTML,/No open paper positions/);
    assert.match(h.element('#view').innerHTML,/\$10,000\.00/);
    assert.equal(h.shared.account.positions.length,0);
    for(const request of h.calls)assert.ok(request.startsWith('./data/')||/^https:\/\/api\.exchange\.coinbase\.com\/products\/(BTC|ETH|SOL|XRP|ADA|DOGE|LINK|AVAX)-USD\/(candles|ticker)\?/.test(request),request);
  }finally{h.dispose()}
});

test('stale Coinbase quotes cannot open a manual paper trade',async()=>{
  const h=await harness({staleQuote:true});
  try{
    await h.click('[data-action]',{action:'trade'});
    assert.equal(h.element('#trade-dialog').open,false);
    assert.match(h.element('#toast').textContent,/fresh Coinbase quote is required/);
    assert.equal(JSON.parse(h.store.get('level-lab-account-v1')).positions.length,0);
  }finally{h.dispose()}
});

test('fresh public prices do not conceal a stale scheduled account',async()=>{
  const h=await harness({oldSchedule:true});
  try{
    assert.equal(h.element('#notice').hidden,false);
    assert.match(h.element('#notice').textContent,/scheduled|paper account/i);
  }finally{h.dispose()}
});

test('private portfolio unlock rejects wrong keys, keeps plaintext out of storage, and relocks',async()=>{
  const key=Buffer.alloc(32,7).toString('base64');
  const wrongKey=Buffer.alloc(32,8).toString('base64');
  const total=43210.87;
  const privateState={
    version:1,updatedAt:new Date().toISOString(),autoTrade:true,
    products:['BTC-USD','ETH-USD','SOL-USD','XRP-USD','ADA-USD','DOGE-USD','LINK-USD','AVAX-USD'],
    config:{...DEFAULT_CONFIG},account:createAccount(total),goal:85000,reviews:[],events:[],
    snapshot:{capturedAt:new Date().toISOString(),totalUsd:total,source:'Synthetic test fixture only',unavailablePortfolios:['Perpetuals'],holdings:[{asset:'SYNTHETIC-ONLY',quantity:123.456789,available:123.456789,usdValue:total}]}
  };
  privateState.strategyLab={experiment:'SYNTHETIC-LAB',updatedAt:privateState.updatedAt,outcomes:{closedTrades:3,wins:1,losses:2,netPnl:-7,grossFees:5,rebatesCredited:1},costDiagnosis:{costFlippedLosses:1},models:{status:'collecting-data',eligible:3,minimum:100,reason:'Synthetic research only'},products:{},limitations:['Synthetic shadow report']};
  const envelope=await encryptState(privateState,key);
  const h=await harness({privateFixture:envelope});
  try{
    await h.click('[data-account]',{account:'private'});
    assert.match(h.element('#view').innerHTML,/LOCKED/);
    assert.doesNotMatch(h.element('#view').innerHTML,/43,210\.87|SYNTHETIC-ONLY|123\.456789|SYNTHETIC-LAB/);
    assert.ok(!h.calls.some(url=>url.includes('portfolio.enc.json')),'Locked view need not request encrypted portfolio data.');
    await h.unlock(wrongKey);
    assert.match(h.element('#toast').textContent,/Unable to unlock/);
    assert.match(h.element('#view').innerHTML,/LOCKED/);
    assert.doesNotMatch(h.element('#view').innerHTML,/43,210\.87|SYNTHETIC-ONLY/);
    await h.unlock(JSON.stringify({key}));
    assert.match(h.element('#view').innerHTML,/43,210\.87/);
    assert.match(h.element('#view').innerHTML,/SYNTHETIC-ONLY/);
    assert.match(h.element('#view').innerHTML,/Strategy research lab/);
    assert.match(h.element('#view').innerHTML,/SYNTHETIC-LAB/);
    const persisted=[...h.store.values()].join('\n');
    assert.ok(!persisted.includes(key));
    assert.ok(!persisted.includes('SYNTHETIC-ONLY'));
    assert.ok(!persisted.includes(String(total)));
    assert.ok(h.calls.every(url=>!url.includes(key)),'Unlock key is never sent in a request.');
    await h.route('updates');
    assert.match(h.element('#view').innerHTML,/Day-trade patterns/);
    await h.click('[data-action]',{action:'lock-private'});
    assert.match(h.element('#view').innerHTML,/LOCKED/);
    assert.doesNotMatch(h.element('#view').innerHTML,/43,210\.87|SYNTHETIC-ONLY|123\.456789|SYNTHETIC-LAB/);
    await h.route('journal');
    assert.match(h.element('#view').innerHTML,/LOCKED/);
    assert.doesNotMatch(h.element('#view').innerHTML,/43,210\.87|SYNTHETIC-ONLY/);
  }finally{h.dispose()}
});
