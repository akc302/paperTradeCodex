import {decryptState} from './scripts/private-state.mjs';
import {markToMarket} from './engine.js';

// The key and decrypted portfolio live only in this module's current tab memory.
// Never place them in browser storage, URLs, logs, or a network request.
let privateState=null;
let privateKey=null;
let epoch=0;
let privateStatus={configured:false,automation:'unconfigured',updatedAt:null};
let refreshWarning='';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const money=value=>finite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value):'Unknown';
const pct=value=>finite(value)?`${(value*100).toFixed(2)}%`:'Unknown';
const utc=value=>{if(!value)return 'Not yet';const time=new Date(typeof value==='number'?value*1000:value);return Number.isFinite(time.getTime())?time.toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC'):'Not yet';};
const quantity=value=>value===null||value===undefined?'Unknown':esc(typeof value==='number'?value.toLocaleString('en-US',{maximumFractionDigits:12}):value);
const settingsUrl='https://github.com/akc302/paperTradeCodex/settings/secrets/actions/new';

function validateState(state){
  const a=state?.account;
  if(!state||state.version!==1||!a||!finite(a.initial)||a.initial<=0||!finite(a.cash)||a.cash<0||!Array.isArray(a.positions)||!Array.isArray(a.trades)||!Array.isArray(a.equityHistory)||!state.snapshot||!Array.isArray(state.snapshot.holdings))throw new Error('The unlocked file is not a valid private paper account.');
  for(const p of a.positions){if(typeof p.product!=='string'||![p.entry,p.quantity,p.entryFee,p.stop,p.target].every(finite)||p.entry<=0||p.quantity<=0||p.entryFee<0)throw new Error('The private paper account contains an invalid position.');}
  if(!a.trades.every(t=>finite(t.pnl)&&finite(t.fees)))throw new Error('The private paper account contains an invalid journal.');
  if(!a.equityHistory.every(p=>finite(p.equity)))throw new Error('The private paper account contains invalid equity history.');
  return state;
}

function normalizedStatus(value){
  const allowed=['updated','awaiting-key','awaiting-data','error','unconfigured'];
  return {configured:value?.configured===true,automation:allowed.includes(value?.automation)?value.automation:'unconfigured',updatedAt:typeof value?.updatedAt==='string'?value.updatedAt:null};
}

function parseKey(text){
  if(typeof text!=='string'||text.length>4096)throw new Error('Choose the private paper unlock file.');
  let key=text.trim();
  if(key.startsWith('{')){
    try{key=JSON.parse(key)?.key;}catch{throw new Error('The unlock file is not valid JSON.');}
  }
  if(typeof key!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(key.trim()))throw new Error('The unlock file must contain the generated 32-byte paper key.');
  return key.trim();
}

export const getPrivateState=()=>privateState;
export const getPrivateStatus=()=>({...privateStatus,warning:refreshWarning});

export function lockPrivate(){epoch++;privateKey=null;privateState=null;refreshWarning='';}

export async function refreshPrivate(fetchJson){
  const started=epoch;
  try{const status=await fetchJson('./data/private-status.json');if(started===epoch)privateStatus=normalizedStatus(status);}catch{/* An absent optional status file must not break the public app. */}
  if(!privateKey||started!==epoch)return privateState;
  const key=privateKey;
  try{
    const envelope=await fetchJson('./data/portfolio.enc.json');
    const next=validateState(await decryptState(envelope,key));
    if(started===epoch&&privateKey===key){privateState=next;refreshWarning='';}
  }catch{
    if(started===epoch)refreshWarning='The latest encrypted update could not be loaded. Showing the last successfully unlocked state; check its timestamp.';
  }
  return privateState;
}

export async function unlockPrivate(keyText,fetchJson){
  lockPrivate();
  const started=epoch,key=parseKey(keyText);
  try{
    const envelope=await fetchJson('./data/portfolio.enc.json');
    const state=validateState(await decryptState(envelope,key));
    if(started!==epoch)throw new Error('Unlock was cancelled.');
    privateKey=key;privateState=state;refreshWarning='';
    return state;
  }catch(error){
    if(started===epoch){privateKey=null;privateState=null;}
    if(error.message==='Unlock was cancelled.')throw error;
    throw new Error('Could not unlock the private paper account. Check the key file and refresh the page.');
  }
}

function automationPanel(){
  const automation=privateStatus.automation;
  const label=automation==='updated'?'ENCRYPTED UPDATE SAVED':automation==='awaiting-key'?'PRIVATE SCHEDULER NEEDS KEY':automation==='awaiting-data'?'PRIVATE SIMULATION WAITING FOR DATA':automation==='error'?'PRIVATE UPDATE NEEDS ATTENTION':'PRIVATE AUTOMATION NOT CONFIGURED';
  const message=automation==='updated'
    ?'The latest workflow saved an encrypted private update. The five-minute schedule is best effort; compare the paper-account timestamp below with the workflow time.'
    :automation==='awaiting-key'
      ?'Public market checks are running. Private paper updates are paused until the repository Actions secret PAPER_STATE_KEY contains the generated unlock key. This is an app encryption key, not a Coinbase credential.'
      :automation==='awaiting-data'
        ?'One or more enabled markets have unavailable or incomplete price history. Private processing for those markets is paused. Unlock the account for details; the last successful paper-account update timestamp is retained.'
        :automation==='error'
        ?'The workflow could not update the private paper account. The previous encrypted state was retained. Check the GitHub workflow and key configuration before relying on the account timestamp.'
        :'The public dashboard is available. The private encrypted account has not reported a configured workflow yet.';
  return `<div class="info-box"><span class="status ${automation==='updated'?'':'wait'}">${label}</span><p>${message}</p><span class="small muted">Latest workflow check: ${esc(utc(privateStatus.updatedAt))}</span>${automation==='awaiting-key'?`<div class="form-actions"><a class="button secondary" href="${settingsUrl}" target="_blank" rel="noopener">Configure private scheduler key</a></div>`:''}</div>`;
}

function card(label,value,detail){return `<div class="metric"><div class="metric-head">${label}</div><div class="metric-value">${value}</div><div class="metric-sub">${detail}</div></div>`;}

export function renderPrivatePanel(prices={}){
  if(!privateState)return `${automationPanel()}<section class="panel"><div class="panel-head"><div><h2>Your private paper portfolio</h2><p>Encrypted account · unlock in this tab</p></div><span class="status">LOCKED</span></div><div class="body-pad"><h3>Keep your portfolio out of the public page.</h3><p class="prose">Your portfolio snapshot, simulated balances, and private journal are stored as encrypted data. Choose the generated unlock file to view them. The key stays in this tab's memory and is never sent to Coinbase or written to the repository.</p><label for="private-key-file">Private paper unlock file<input id="private-key-file" type="file" accept=".txt,.json,text/plain,application/json"></label><p class="small muted">Use the paper unlock file provided in this chat. Do not upload Coinbase credentials, an API key, a wallet seed phrase, or a private wallet key. Closing or reloading this tab locks the view again.</p></div></section>`;
  const state=privateState,snapshot=state.snapshot,stats=markToMarket(state.account,prices);
  const fees=state.feeProfile;
  const feeNotice=fees?`<div class="info-box"><strong>Fee model: ${esc(fees.feeTier)}</strong> · Maker ${pct(fees.makerFeeRate)} · Taker ${pct(fees.takerFeeRate)}<br>Observed ${esc(utc(fees.feeObservedAt))}. Saved snapshot, not an authenticated per-trade refresh. ${fees.rebateVerified?'Premium eligibility is user-confirmed: modeled 25% rebates credit virtual USDC; no real Coinbase payment occurs.':'Rebate estimates remain pending and are excluded from cash/P&amp;L until eligibility and allowance are verified.'}</div>`:'';
  const goal=finite(state.goal)&&state.goal>0?state.goal:85000;
  const gap=Math.max(0,goal-stats.equity),required=stats.equity>0?Math.max(0,goal/stats.equity-1):null;
  const reached=stats.equity>=goal;
  const holdings=snapshot.holdings.map(h=>`<tr><td>${esc(h.asset)}</td><td>${quantity(h.quantity)}</td><td>${quantity(h.available)}</td><td>${money(h.usdValue)}</td></tr>`).join('');
  const unavailable=Array.isArray(snapshot.unavailablePortfolios)?snapshot.unavailablePortfolios:[];
  const accountErrors=Array.isArray(state.errors)?state.errors:[];
  const errorsPanel=accountErrors.length?`<div class="info-box"><strong>Private market-data warnings</strong><p>The simulation retained its last successful account timestamp while waiting for complete data.</p>${accountErrors.map(error=>`<p>${esc(typeof error==='string'?error:[error?.product,error?.message].filter(Boolean).join(' · ')||'A private market-data check needs attention.')}</p>`).join('')}</div>`:'';
  return `${automationPanel()}${errorsPanel}${refreshWarning?`<div class="info-box">${esc(refreshWarning)}</div>`:''}<div class="metrics">${card('Modeled paper equity',money(stats.equity),'Virtual account · after modeled execution costs')}${card('Paper target',money(goal),'Your chosen goal · no return guarantee')}${card(reached?'Target reached':'Remaining paper gap',money(gap),reached?'This is a simulated result.':`${pct(required)} additional gain needed from current paper equity`)}${card('Snapshot value',money(snapshot.totalUsd),`Coinbase read-only snapshot · ${esc(utc(snapshot.capturedAt))}`)}</div><section class="panel"><div class="panel-head"><div><h2>Private portfolio snapshot</h2><p>Paper simulation source · ${esc(utc(snapshot.capturedAt))}</p></div><button class="button secondary" data-action="lock-private">Lock private view</button></div><div class="body-pad"><p class="prose">This simulation began from a read-only Coinbase snapshot. Its trades change only virtual holdings. The real Coinbase account is unchanged, and this page does not continuously synchronize your actual portfolio. Historical cost basis was not supplied; paper P&amp;L is measured from the snapshot, not from your original purchases.</p><p class="small muted">Last encrypted paper-account update: ${esc(utc(state.updatedAt))}. ${unavailable.length?`Unverified accounts: ${unavailable.map(esc).join(', ')}. Their balances are unknown and excluded.`:''}</p></div><div class="table-wrap"><table><thead><tr><th>SNAPSHOT ASSET</th><th>TOTAL QUANTITY</th><th>AVAILABLE QUANTITY</th><th>SNAPSHOT USD VALUE</th></tr></thead><tbody>${holdings||'<tr><td colspan="4">No snapshot holdings were supplied.</td></tr>'}</tbody></table></div><div class="body-pad"><p class="small muted">The holdings above are the starting snapshot. The current simulated positions, trades, and hourly decisions appear in the private trade journal. Small differences in source valuations can come from Coinbase rounding and price timing.</p></div></section>`;
}
