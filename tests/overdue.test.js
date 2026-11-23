import test from 'node:test';import assert from 'node:assert/strict';
import {overduePhases} from '../scripts/overdue.mjs';
const now=Date.parse('2026-11-23T10:00:00Z')/1000,iso=s=>new Date(s*1000).toISOString();
test('research is due after 2h; the daily review is due once per UTC day after 01:00',()=>{
 assert.deepEqual(overduePhases({strategyLab:{updatedAt:iso(now-3600)},promotion:{reviewDate:'2026-11-23'}},now),[]);
 assert.deepEqual(overduePhases({strategyLab:{updatedAt:iso(now-2.5*3600)},promotion:{reviewDate:'2026-11-23'}},now),['research']);
 assert.deepEqual(overduePhases({strategyLab:{updatedAt:iso(now-4*3600)},promotion:{reviewDate:'2026-11-23'}},now),['research']);
 assert.deepEqual(overduePhases({strategyLab:{updatedAt:iso(now-60)},promotion:{reviewDate:'2026-11-22'}},now),['review']);
 assert.deepEqual(overduePhases({},Date.parse('2026-11-23T00:30:00Z')/1000),['research'],'no review before 01:00 UTC');
});
