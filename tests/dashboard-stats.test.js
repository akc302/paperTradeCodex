import test from 'node:test';import assert from 'node:assert/strict';
import {createAccount,DEFAULT_CONFIG,openPaperTrade,closePaperTrade,goalEstimate,performanceStats} from '../engine.js';
import {scorecard,teamReport} from '../scripts/team-report.mjs';
const DAY=86400,now=Date.parse('2026-11-21T12:00:00Z')/1000;
test('goal estimate uses the trailing 30-day growth rate and refuses short or shrinking histories',()=>{
 const a=createAccount(30000);assert.equal(goalEstimate(a,{now}).status,'insufficient-history');
 a.dailyRisk={[new Date((now-29*DAY)*1000).toISOString().slice(0,10)]:{openingEquity:30000}};a.cash=33000;
 const g=goalEstimate(a,{now});assert.equal(g.status,'estimated');assert.match(g.label,/trailing 30-day growth rate \(not a promise\)/);
 const daily=(33000/30000)**(1/((now-Date.parse(Object.keys(a.dailyRisk)[0])/1000)/DAY))-1;assert.ok(Math.abs(g.days-Math.log(85000/33000)/Math.log(1+daily))<1e-6);
 a.cash=29000;assert.equal(goalEstimate(a,{now}).status,'not-growing');a.cash=90000;assert.equal(goalEstimate(a,{now}).status,'reached');
});
test('scorecard reports net after fees, profit factor, drawdown, win rate and average win vs loss for main and challengers',()=>{
 const a=createAccount(30000),c={...DEFAULT_CONFIG,feeRate:.003};
 openPaperTrade(a,{product:'A',price:100,stop:95,target:120,time:1},c);closePaperTrade(a,a.positions[0].id,110,2,'target',c);
 openPaperTrade(a,{product:'A',price:100,stop:95,target:120,time:3},c);closePaperTrade(a,a.positions[0].id,96,4,'stop',c);
 const s=performanceStats(a);assert.equal(s.closedTrades,2);assert.equal(s.winRate,.5);assert.ok(s.avgWin>0&&s.avgLoss<0);assert.ok(Math.abs(s.profitFactor-s.avgWin/-s.avgLoss)<1e-9);
 const state={account:a,config:{strategy:'trend-follow'},pause:{state:'halved',drawdown:.11},challengers:[{id:'x',label:'X',account:createAccount(30000),pause:{}}],products:[],updatedAt:new Date(now*1000).toISOString()};
 const rows=scorecard(state);assert.deepEqual(rows.map(r=>r.id),['main','x']);assert.equal(rows[0].pause,'halved');assert.ok(Math.abs(rows[0].netPnl-s.netPnl)<1e-9);
 const r=teamReport(state,{products:{}},now);assert.equal(r.scorecard.length,2);assert.equal(r.goalEstimate.goal,85000);
});
