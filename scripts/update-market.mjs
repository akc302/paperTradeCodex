/** Public market feeds and isolated paper ledgers. Never accesses a Coinbase account. */
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_CONFIG, normalizeCandles, createAccount, processBarBatch, processQuoteBatch, reviewStrategy } from '../engine.js';
import {trainShadow,featuresAt} from './learning.mjs';
import { encryptState, decryptState } from './private-state.mjs';
import { loadHistory } from './history.mjs';
import { runChallengers } from './challengers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const PRODUCTS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'LINK-USD', 'AVAX-USD'];
const HOUR = 3600;
// Normal updates execute only trades. Explicit 'all' preserves legacy integration fixtures.
const TRADE_ONLY=process.env.PAPER_JOB_MODE!=='all';
const MAX_BARS = 2160;
const stamp = new Date().toISOString();
const cutoff = Math.floor(Date.parse(stamp) / 1000 / HOUR) * HOUR;
const date = stamp.slice(0, 10);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readJSON(name, fallback) {
  try { return JSON.parse(await readFile(path.join(DATA, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function saveJSON(name, value) {
  await writeFile(path.join(DATA, name), JSON.stringify(value, null, 2) + '\n');
}
async function saveEncrypted(value) {
  const temporary = path.join(DATA, '.portfolio.enc.tmp');
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, path.join(DATA, 'portfolio.enc.json'));
  } finally { await rm(temporary, { force: true }); }
}

async function fetchCandles(product) {
  const rows = [];
  // Seed 30 days, then retain up to 90 days as updates accumulate.
  for (let start = cutoff - 720 * HOUR; start < cutoff; start += 240 * HOUR) {
    const end = Math.min(start + 240 * HOUR, cutoff);
    const url = new URL(`https://api.exchange.coinbase.com/products/${product}/candles`);
    url.searchParams.set('granularity', String(HOUR));
    url.searchParams.set('start', new Date(start * 1000).toISOString());
    url.searchParams.set('end', new Date(end * 1000).toISOString());
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Level-Lab-Paper-Research/2.0' },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`Coinbase market request failed (${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Coinbase returned an invalid candle response.');
    rows.push(...normalizeCandles(page));
    await sleep(500);
  }
  const bars = normalizeCandles(rows).filter(c => c.time + HOUR <= cutoff);
  if (bars.length < 48) throw new Error('Fewer than 48 valid completed market candles received.');
  if (bars.at(-1).time < cutoff - HOUR) throw new Error('Latest completed Coinbase candle is missing; paper trading paused.');
  return bars;
}

await mkdir(DATA, { recursive: true });
const market = await readJSON('market.json', { products: {} });
const paper = await readJSON('paper.json', {
  version: 1, updatedAt: stamp, autoTrade: true, products: [...PRODUCTS],
  config: { ...DEFAULT_CONFIG, strategy: 'trendline' }, account: createAccount(10000),
});
const reviews = await readJSON('reviews.json', { updatedAt: stamp, reviews: [] });
if (!market.products || typeof market.products !== 'object') throw new Error('Invalid saved market data.');
if (!paper.account || !Array.isArray(paper.products) || !Array.isArray(reviews.reviews)) throw new Error('Invalid saved public paper account.');
paper.products = [...PRODUCTS];
paper.config = { ...DEFAULT_CONFIG, ...paper.config, strategy: paper.config?.strategy ?? 'trendline' };
// The owner's current Coinbase tier applies to every account; open positions keep the fees they were opened with.
const feeTier = await readJSON('fee-tier.json', null);
if (feeTier) paper.feeProfile = { ...paper.feeProfile, ...feeTier };
paper.productConfigs ??= {};
market.errors = [];
const refreshed = new Set();

for (const product of PRODUCTS) {
  try {
    const received = await fetchCandles(product);
    const candles = normalizeCandles([...(market.products[product]?.candles ?? []), ...received])
      .filter(c => c.time + HOUR <= cutoff).slice(-MAX_BARS);
    market.products[product] = { candles, fetchedAt: stamp, source: 'Coinbase public Exchange API' };
    refreshed.add(product);
    console.log(`${product}: ${candles.length} completed hourly candles.`);
  } catch (error) {
    market.errors.push({ product, message: error.message, time: stamp });
    console.error(`${product}: market refresh failed; keeping previous data.`);
  }
}

// Stored 6h/daily Coinbase history (refreshed by the daily review) feeds trend-follow and trailing stops.
const history = await loadHistory(path.join(DATA, 'history'), PRODUCTS);
const productConfig = (state, product) => ({ ...DEFAULT_CONFIG, ...state.config, ...state.productConfigs?.[product], ...(state.feeProfile??{}) });

/** Preflight the whole enabled universe before any shared-ledger mutation. */
async function processAccount(state) {
  if(state.executionMode==='quotes'){
    const enabled=[...new Set(state.products)],problems=[];
    if(enabled.some(p=>!PRODUCTS.includes(p)||!refreshed.has(p)))return {ready:false,problems:[{product:null,message:'Live paper checks paused: all enabled feeds must be current.',time:stamp}],processed:0,markets:[]};
    const events=[];
    try{for(const product of enabled){const response=await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error();const quote=await response.json();events.push({product,quote,bars:market.products[product].candles,history:history[product],config:productConfig(state,product)});}
      const previous=state.account.lastQuoteBucket;const working=structuredClone(state.account),pause=structuredClone(state.pause??{});processQuoteBatch(working,events,{time:Date.now()/1000,pause});state.pause=pause;for(const p of working.positions){if(!p.learningContext){const e=events.find(v=>v.product===p.product);p.learningContext={featureTime:e.bars.at(-1).time,features:featuresAt(e.bars,e.bars.length-1),mode:'shadow',usedForExecution:false};}}state.account=working;runChallengers(state,events,Date.now()/1000);
      for(const e of events){market.products[e.product].quote={price:+e.quote.price,time:e.quote.time};state.account.lastProcessed[e.product]=e.bars.at(-1).time;}
      return {ready:true,problems,processed:state.account.lastQuoteBucket!==previous?events.length:0,markets:enabled};
    }catch{return {ready:false,problems:[{product:null,message:'Live paper check rejected: fresh complete quotes required for the whole account.',time:stamp}],processed:0,markets:[]};}
  }
  if (!state.account || !Array.isArray(state.products)) throw new Error('Invalid paper account.');
  const problems = [], contexts = [];
  const enabled = [...new Set(state.products)].filter(p => PRODUCTS.includes(p));
  if (!enabled.length) problems.push({ product: null, message: 'No supported markets are enabled; the shared paper account is paused.', time: stamp });
  for (const product of state.products.filter(p => !PRODUCTS.includes(p))) {
    problems.push({ product, message: 'An enabled market is outside the supported universe; the shared paper account is paused.', time: stamp });
  }
  const cursors = enabled.map(p => state.account.lastProcessed?.[p]).filter(t => t != null);
  const sharedCursor = cursors.length ? Math.min(...cursors) : null;
  if (cursors.some(t => !Number.isFinite(t)) || new Set(cursors).size > 1) {
    problems.push({ product: null, message: 'Enabled market cursors are inconsistent. The shared account is paused rather than replaying old bars against future cash.', time: stamp });
  }
  for (const product of enabled) {
    if (!refreshed.has(product)) {
      problems.push({ product, message: 'An enabled market did not refresh. The entire shared paper account is paused until all enabled feeds recover.', time: stamp });
      continue;
    }
    const bars = market.products[product].candles;
    const cursor = state.account.lastProcessed?.[product];
    const config = productConfig(state, product);
    const from = cursor ?? sharedCursor;
    if (from != null && (!Number.isFinite(from) || from > bars.at(-1).time || !bars.some(b => b.time === from))) {
      problems.push({ product, message: 'The shared account cursor is outside complete available history. All paper fills are paused.', time: stamp });
      continue;
    }
    let previous = from;
    const pending = from == null ? [] : bars.flatMap((bar, index) => bar.time > from ? [{ bar, index }] : []);
    const gap = pending.some(({ bar }) => { const missing = bar.time !== previous + HOUR; previous = bar.time; return missing; });
    if (gap) {
      problems.push({ product, message: 'A gap follows an enabled market cursor. The entire shared paper account is paused until complete history is restored.', time: stamp });
      continue;
    }
    contexts.push({ product, bars, config, pending, newlyEnabled: cursor == null });
  }
  if (problems.length) return { ready: false, problems, processed: 0, markets: [] };
  const newlyEnabled = contexts.filter(c => c.newlyEnabled);
  if (newlyEnabled.length) {
    // Align new markets with the existing ledger first. Their catch-up entries
    // remain disabled for this run; historical signals are never newly traded.
    const syncTime = sharedCursor ?? cutoff - HOUR;
    processBarBatch(state.account, newlyEnabled.map(c => ({ product: c.product, bars: c.bars.filter(b => b.time <= syncTime), config: c.config, autoTrade: false })), { autoTrade: false });
  }
  const timestamps = [...new Set(contexts.flatMap(c => c.pending.map(p => p.bar.time)))].sort((a,b) => a-b);
  let processed = 0;
  for (const time of timestamps) {
    const events = contexts.flatMap(c => {
      const event = c.pending.find(p => p.bar.time === time);
      return event ? [{ product: c.product, bars: c.bars.slice(0, event.index + 1), config: c.config, autoTrade: !c.newlyEnabled && state.autoTrade === true }] : [];
    });
    processBarBatch(state.account, events, { autoTrade: state.autoTrade === true });
    processed += events.length;
  }
  return { ready: true, problems, processed, markets: enabled };
}

function outcomesFor(state, product) {
  const end = Date.parse(`${date}T00:00:00Z`) / 1000, start = end - 86400;
  const trades = state.account.trades.filter(t => t.product === product && t.closedAt >= start && t.closedAt < end);
  const pnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const fees = trades.reduce((sum, t) => sum + t.fees, 0);
  const wins = trades.filter(t => t.pnl > 0).length;
  const stops = trades.filter(t => /stop/.test(t.reason)).length;
  const timeouts = trades.filter(t => /time|timeout|hold/.test(t.reason)).length;
  const decisions = (state.account.decisions ?? []).filter(d => d.product === product && d.time >= start && d.time < end);
  const actionCounts = {}, reasonCounts = new Map();
  for (const decision of decisions) {
    const action = decision.action ?? 'WAIT';
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    if (decision.reason) reasonCounts.set(decision.reason, (reasonCounts.get(decision.reason) ?? 0) + 1);
  }
  const bullishSignals = decisions.filter(d => d.action !== 'SYNC' && (d.observedSignal ?? d.signal) === 'BUY').length;
  const riskSkips = decisions.filter(d => d.action === 'WAIT' && /risk|exposure|loss circuit|allocation|position limit|maximum.*position|virtual cash|entry skipped/i.test(d.reason ?? '')).length;
  const topReasons = [...reasonCounts].map(([reason, count]) => ({ reason, count })).sort((a,b) => b.count-a.count || a.reason.localeCompare(b.reason)).slice(0, 3);
  const bars = market.products[product]?.candles ?? [];
  let evaluatedWaits = 0, upMovesAboveThreshold = 0;
  for (const decision of decisions.filter(d => d.action === 'WAIT' && Number.isFinite(d.price) && d.price > 0)) {
    // Decisions are recorded at a bar's open. Its close is the first later close,
    // so four contiguous bars beginning there end exactly four hours later.
    const later = bars.filter(b => b.time >= decision.time).slice(0, 4);
    if (later.length !== 4 || later.some((b, i) => b.time !== decision.time + i*HOUR)) continue;
    evaluatedWaits++;
    if (later[3].close / decision.price - 1 >= 0.02) upMovesAboveThreshold++;
  }
  const counterfactual = { horizonHours: 4, thresholdPct: 0.02, evaluatedWaits, upMovesAboveThreshold, method: 'Compare the recorded decision reference price with the fourth later contiguous completed candle close. Hindsight only; excludes execution, costs, risk, and opportunity feasibility.' };
  const lessons = [];
  if (!trades.length) lessons.push('No paper trades closed in the previous UTC day; there is no new outcome evidence for this market.');
  else {
    lessons.push(`${trades.length} paper trade(s) closed; evaluate net results after both entry and exit costs.`);
    if (stops) lessons.push('Stop exits occurred. Keep fixed risk and aggregate exposure limits; a recent loss alone does not justify changing parameters.');
    if (timeouts) lessons.push('Timed exits occurred. Revisit setup follow-through during the next guarded review.');
    if (pnl <= 0) lessons.push('Net daily outcome was nonpositive. Require independent holdout evidence before changing the model.');
    else lessons.push('Net daily outcome was positive. One day does not establish repeatable improvement.');
  }
  lessons.push(`Reviewed ${decisions.length} recorded decisions: ${actionCounts.WAIT ?? 0} WAIT, ${bullishSignals} bullish signals, ${riskSkips} risk-related skips.`);
  if (evaluatedWaits) lessons.push(`${upMovesAboveThreshold} of ${evaluatedWaits} evaluated WAIT decisions preceded a later four-hour close at least 2% above the reference price. This is a hindsight counterfactual, not executable profit or evidence every move could be caught.`);
  else lessons.push('No WAIT decisions had four later contiguous completed candles for the hindsight comparison.');
  return { periodStart: new Date(start * 1000).toISOString(), periodEnd: new Date(end * 1000).toISOString(), closedTrades: trades.length, wins, losses: trades.length - wins, pnl, fees, stops, timeouts, decisionCount: decisions.length, actionCounts, waitCount: actionCounts.WAIT ?? 0, bullishSignals, riskSkips, topReasons, counterfactual, lessons };
}

/** Daily retrospective plus forward-only adoption of guarded training/holdout candidates. */
function dailyReviews(state, journal, blocked = new Set()) {
  state.productConfigs ??= {};
  let added = 0;
  for (const product of [...new Set(state.products)].filter(p => PRODUCTS.includes(p))) {
    if (!refreshed.has(product) || blocked.has(product) || journal.some(r => r.date === date && r.product === product)) continue;
    const before = productConfig(state, product);
    const review = reviewStrategy(market.products[product].candles, before);
    const promoted = review.status === 'candidate';
    if (promoted) state.productConfigs[product] = { ...review.config };
    journal.unshift({
      date, time: stamp, product,
      status: promoted ? 'promoted' : review.status,
      reason: promoted
        ? 'Training-selected parameters passed the later holdout and were adopted for future paper entries. Future performance is uncertain.'
        : review.reason,
      before, after: productConfig(state, product), baseline: review.baseline, candidate: review.candidate,
      training: review.training, holdout: review.holdout, outcomes: outcomesFor(state, product),
    });
    added++;
  }
  journal.splice(365 * PRODUCTS.length);
  return added;
}

const publicUpdate = await processAccount(paper);
market.errors.push(...publicUpdate.problems);
if (!TRADE_ONLY && publicUpdate.ready && dailyReviews(paper, reviews.reviews)) reviews.updatedAt = stamp;
market.updatedAt = refreshed.size ? stamp : market.updatedAt ?? null;
market.source = 'Coinbase public Exchange API';
market.granularity = HOUR;
market.universe = [...PRODUCTS];
paper.lastRunAt = stamp;
if (publicUpdate.ready) {
  paper.updatedAt = stamp;
  paper.lastMarketAt = market.updatedAt;
}
paper.errors = market.errors;
await saveJSON('market.json', market);
await saveJSON('paper.json', paper);
await saveJSON('reviews.json', reviews);

// Private paper state is encrypted both at rest and in published assets. Its key
// is supplied only to this process. Never log or write clear private state.
const stateKey = process.env.PAPER_STATE_KEY?.trim();
let envelope = null, unreadableEnvelope = false;
try { envelope = await readJSON('portfolio.enc.json', null); }
catch { unreadableEnvelope = true; }
let privateStatus;
if (unreadableEnvelope) {
  privateStatus = { configured: true, updatedAt: stamp, automation: 'error', message: 'Encrypted private paper state could not be read. The original file was preserved.' };
} else if (!envelope) {
  privateStatus = { configured: false, updatedAt: stamp, automation: 'unconfigured', message: 'No encrypted private paper account is configured.' };
} else if (!stateKey) {
  privateStatus = { configured: true, updatedAt: stamp, automation: 'awaiting-key', message: 'Encrypted paper account preserved. Add PAPER_STATE_KEY as a repository Actions secret to enable private scheduled updates.' };
} else {
  try {
    const state = await decryptState(envelope, stateKey);
    if (!state.account || !Array.isArray(state.products) || !Array.isArray(state.reviews) || !Array.isArray(state.events)) throw new Error();
    state.config = { ...DEFAULT_CONFIG, ...state.config, strategy: state.config?.strategy ?? 'trendline' };
    if (feeTier) state.feeProfile = { ...state.feeProfile, ...feeTier };
    const beforeTrades = state.account.trades.length;
    if(!TRADE_ONLY&&state.learning?.trainedOnDate!==date)state.learning={...trainShadow(market.products,{feeRate:productConfig(state,state.products[0]).feeRate}),trainedOnDate:date,updatedAt:stamp};
    const update = await processAccount(state);
    const enabled = [...new Set(state.products)].filter(p => PRODUCTS.includes(p));
    const ready = update.ready;
    const addedReviews = ready && !TRADE_ONLY ? dailyReviews(state, state.reviews) : 0;
    if (ready) {
      state.updatedAt = stamp;
      state.lastMarketAt = market.updatedAt;
    }
    state.errors = [...market.errors.filter(e => enabled.includes(e.product) && !publicUpdate.problems.includes(e)), ...update.problems];
    if(state.learning)state.learning.executedTradeEvidence={closedTrades:state.account.trades.filter(t=>!String(t.reason).includes('rebalance')).length,minimumForTradeOutcomeTraining:100,status:'collecting executed outcomes; fitted model currently uses historical market labels'};
    state.events.unshift({ time: stamp, type: ready ? 'paper-update' : 'paper-update-awaiting-data', processedBars: update.processed, markets: update.markets, closedTrades: state.account.trades.length - beforeTrades, dailyReviews: addedReviews, message: ready ? 'Completed-candle paper simulation updated; decisions and risk controls recorded in encrypted ledger.' : 'Some enabled markets could not be processed. Last successful private update timestamp retained; details recorded in encrypted errors.' });
    state.events = state.events.slice(0, 2000);
    await saveEncrypted(await encryptState(state, stateKey));
    privateStatus = ready
      ? { configured: true, updatedAt: stamp, automation: 'updated', message: 'Encrypted private paper simulation updated. Unlock the dashboard to inspect its ledger and reviews.' }
      : { configured: true, updatedAt: stamp, automation: 'awaiting-data', message: 'Private simulation is waiting for complete market data. Unlock for details; last successful update time was retained.' };
    console.log('Encrypted private paper simulation preserved.');
  } catch {
    privateStatus = { configured: true, updatedAt: stamp, automation: 'error', message: 'Private simulation could not be updated. Original ciphertext preserved; check configured unlock key and encrypted state.' };
    console.error('Private paper update unavailable; original encrypted state preserved.');
  }
}
await saveJSON('private-status.json', privateStatus);
if (!refreshed.size) console.error('No markets refreshed. Previous candles/account retained with visible public market errors.');


const previousLearning=await readJSON('learning.json',{});
if(!TRADE_ONLY&&refreshed.size===PRODUCTS.length&&previousLearning.trainedOnDate!==date)await saveJSON('learning.json',{...trainShadow(market.products),trainedOnDate:date,updatedAt:stamp});
