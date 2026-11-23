/** Compact two-year Coinbase candle history: data/history/<product>-6h.json and -1d.json. Public prices only. */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {normalizeCandles} from '../engine.js';
export const HISTORY_PRODUCTS=Object.freeze(['BTC-USD','ETH-USD','SOL-USD','XRP-USD','ADA-USD','DOGE-USD','LINK-USD','AVAX-USD']);
// Coinbase Exchange has no 4h granularity (60/300/900/3600/21600/86400 only), so the trend series is 6h.
export const GRANULARITIES=Object.freeze({'6h':21600,'1d':86400,'1h':3600});
export const HISTORY_DAYS=730;
// Hourly candles are kept for one year: enough for hundreds of out-of-sample trades in the automatic rule sweep.
export const DAYS_BY_LABEL=Object.freeze({'6h':730,'1d':730,'1h':365});
export const historyFile=(dir,product,label)=>path.join(dir,`${product}-${label}.json`);
/** Rows are [time, low, high, open, close, volume], the Coinbase candle order normalizeCandles already accepts. */
export function compact(product,label,bars,fetchedAt){
 const sig=v=>+Number(v).toPrecision(8);
 return {product,granularity:GRANULARITIES[label],source:'Coinbase public Exchange API candles',fetchedAt,fields:['time','low','high','open','close','volume'],candles:normalizeCandles(bars).map(b=>[b.time,sig(b.low),sig(b.high),sig(b.open),sig(b.close),+b.volume.toFixed(2)])};
}
export async function readHistoryFile(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
/** {product:{sixHour,daily}} for the trader, lab and promotion. Missing files give empty arrays (trend-follow then waits). */
export async function loadHistory(dir='data/history',products=HISTORY_PRODUCTS){
 const out={};
 for(const p of products){const [s,d]=await Promise.all(['6h','1d'].map(l=>readHistoryFile(historyFile(dir,p,l)).catch(()=>null)));out[p]={sixHour:normalizeCandles(s?.candles??[]),daily:normalizeCandles(d?.candles??[])};}
 return out;
}
