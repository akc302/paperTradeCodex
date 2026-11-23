import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULT_CONFIG,createAccount} from '../engine.js';
import {ownerSwitchToHourly,migrateToTrend,OWNER_HOURLY_VERSION} from '../scripts/rules.mjs';
test('owner switch puts the hourly-legacy rules on the main paper account once, keeping caps, limit entries and ledgers',()=>{
 const pc={'BTC-USD':{patternRequired:true,maxHoldHours:24}};
 const state={rulesVersion:'trend-v1',config:{...DEFAULT_CONFIG,strategy:'trend-follow',trailAtrMultiplier:3,riskPct:0.02,maxAllocation:0.25,entryOrder:'limit'},productConfigs:{},account:createAccount(30000),
  challengers:[{id:'hourly-legacy',rules:{strategy:'aggressive',rewardRisk:1.5,maxHoldHours:2},productConfigs:pc,account:{...createAccount(30000),cash:30334}}]};
 const cash=state.account.cash;assert.equal(ownerSwitchToHourly(state,1.8e9),true);
 assert.equal(state.config.strategy,'aggressive');assert.equal(state.config.entryOrder,'limit');assert.equal(state.config.trailAtrMultiplier,undefined);
 assert.equal(state.config.riskPct,0.02);assert.equal(state.config.maxAllocation,0.25);assert.deepEqual(state.productConfigs,pc);
 assert.equal(state.account.cash,cash);assert.equal(state.challengers[0].account.cash,30334,'challenger ledger kept');
 assert.equal(state.rulesVersion,OWNER_HOURLY_VERSION);assert.equal(state.rulesHistory[0].previous.config.strategy,'trend-follow');
 assert.equal(ownerSwitchToHourly(state,1.8e9+60),false,'runs once');assert.equal(migrateToTrend(state,1.8e9+60),false,'never reverts to trend');
});
