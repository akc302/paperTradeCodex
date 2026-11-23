/** One-off owner request: restart the public demo at a new virtual balance, archiving the old ledger. */
import {readFile,writeFile} from 'node:fs/promises';import {createAccount} from '../engine.js';
const amount=Number(process.argv[2]);if(!(amount>0))throw Error('usage: node scripts/reset-demo.mjs <amount>');
const paper=JSON.parse(await readFile('data/paper.json','utf8')),stamp=new Date().toISOString();
const file=`data/archive/demo-${paper.account.initial}-until-${stamp.slice(0,10)}.json`;
await import('node:fs').then(fs=>fs.mkdirSync('data/archive',{recursive:true}));
await writeFile(file,JSON.stringify({archivedAt:stamp,reason:'Owner restarted the public demo at $'+amount,account:paper.account},null,1)+'\n');
paper.account={...createAccount(amount),resetFrom:{file,initial:paper.account.initial,closedTrades:paper.account.trades.length,at:stamp}};
await writeFile('data/paper.json',JSON.stringify(paper,null,2)+'\n');console.log('Demo reset to',amount,'archived',file);
