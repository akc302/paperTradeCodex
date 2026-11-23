/** Records whether the trader actually ran on a ~5-minute cadence, from real run history (scheduled or self-dispatched). */
import {writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const api=q=>JSON.parse(execFileSync('gh',['api',q],{encoding:'utf8'})),repo=process.env.GH_REPO;
const count=api(`repos/${repo}/actions/workflows/update.yml/runs?event=schedule&per_page=1`).total_count;
const runs=api(`repos/${repo}/actions/workflows/update.yml/runs?per_page=6`).workflow_runs.map(r=>({createdAt:r.created_at,event:r.event,status:r.status,conclusion:r.conclusion}));
const times=runs.filter(r=>r.conclusion==='success').map(r=>Date.parse(r.createdAt)).slice(0,3);
const verified=times.length===3&&Date.now()-times[0]<900000&&times.slice(1).every((t,i)=>times[i]-t<=600000);
writeFileSync('data/operations.json',JSON.stringify({updatedAt:new Date().toISOString(),triggerEvent:process.env.TRIGGER_EVENT,scheduleEventCount:count,fiveMinuteCadenceVerified:verified,recentRuns:runs,note:'The trader re-dispatches itself every ~5 minutes because GitHub cron delivery is throttled; cadence is verified from actual successful runs.'},null,2)+'\n');
