import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { encryptState, decryptState } from '../scripts/private-state.mjs';
import { createAccount } from '../engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('scheduled updater preserves honest paper history across repeats, gaps, outages, and encrypted updates', async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'level-lab-updater-'));
  const read = name => JSON.parse(readFileSync(path.join(fixture, 'data', name), 'utf8'));
  const run = (offset = 0, extra = {}) => {
    const result = spawnSync(process.execPath, ['--import', path.join(fixture, 'mock.mjs'), path.join(fixture, 'scripts/update-market.mjs')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PAPER_STATE_KEY: '', PAPER_JOB_MODE: 'all', TEST_OFFSET: String(offset), TEST_FAIL: '', TEST_FAIL_PRODUCT: '', TEST_MISSING: '', TEST_MISSING_PRODUCT: '', ...extra },
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    return result;
  };
  try {
    mkdirSync(path.join(fixture, 'scripts'));
    copyFileSync(path.join(root, 'engine.js'), path.join(fixture, 'engine.js'));
    copyFileSync(path.join(root, 'scripts/update-market.mjs'), path.join(fixture, 'scripts/update-market.mjs'));
    copyFileSync(path.join(root,'scripts/learning.mjs'),path.join(fixture,'scripts/learning.mjs'));
    copyFileSync(path.join(root,'scripts/history.mjs'),path.join(fixture,'scripts/history.mjs'));
    copyFileSync(path.join(root,'scripts/challengers.mjs'),path.join(fixture,'scripts/challengers.mjs'));
    copyFileSync(path.join(root, 'scripts/private-state.mjs'), path.join(fixture, 'scripts/private-state.mjs'));
    writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
    // Test fixtures are isolated from shipped data. No real network calls or waits.
    writeFileSync(path.join(fixture, 'mock.mjs'), `
      import assert from 'node:assert/strict';
      const RealDate = Date;
      const clock = RealDate.parse('2026-11-19T12:17:00Z') + Number(process.env.TEST_OFFSET);
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      };
      const realTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 500 ? 0 : ms, ...args);
      globalThis.fetch = async (input, options) => {
        const url = new URL(input);
        assert.equal(url.origin, 'https://api.exchange.coinbase.com');
        assert.match(url.pathname, /^\\/products\\/(BTC|ETH|SOL|XRP|ADA|DOGE|LINK|AVAX)-USD\\/candles$/);
        assert.equal(options.method ?? 'GET', 'GET');
        const product = url.pathname.split('/')[2];
        if (process.env.TEST_FAIL === '1' || process.env.TEST_FAIL_PRODUCT === product) throw new Error('Test market outage');
        const rows = [];
        for (let t = RealDate.parse(url.searchParams.get('start')) / 1000; t <= RealDate.parse(url.searchParams.get('end')) / 1000; t += 3600) {
          if (t === Number(process.env.TEST_MISSING) && (!process.env.TEST_MISSING_PRODUCT || process.env.TEST_MISSING_PRODUCT === product)) continue;
          const price = 60000 + 2000 * Math.sin(t / 3600 / 5);
          rows.push([t, price - 500, price + 500, price - 100, price, 100]);
        }
        return { ok: true, json: async () => rows };
      };
    `);

    run();
    const initial = read('paper.json');
    const firstMarket = read('market.json');
    assert.equal(initial.account.cash, 10000);
    assert.deepEqual(initial.account.trades, []);
    assert.deepEqual(initial.account.positions, []);
    assert.equal(initial.account.equityHistory.length, 1, 'initial synchronization records one portfolio baseline, not historical profits');
    assert.equal(initial.account.equityHistory[0].equity, 10000);
    assert.equal(initial.products.length, 8);
    for (const product of initial.products) {
      const bars = firstMarket.products[product].candles;
      assert.equal(bars.length, 720);
      assert.equal(bars.at(-1).time, Date.parse('2026-11-19T11:00:00Z') / 1000);
      assert.equal(new Set(bars.map(b => b.time)).size, bars.length);
    }
    assert.equal(read('reviews.json').reviews.length, 8);
    assert.equal(read('private-status.json').automation, 'unconfigured');

    run();
    assert.deepEqual(read('paper.json').account, initial.account, 'same bars must not generate repeated fills or equity history');
    assert.equal(read('reviews.json').reviews.length, 8, 'one review per enabled market per UTC day');

    run(2 * 3600 * 1000);
    const advanced = read('paper.json');
    assert.equal(advanced.account.equityHistory.length, 3, 'two new same-hour batches record exactly two new portfolio equity points');
    assert.deepEqual([...advanced.account.equityHistory].map(p => p.time), [...advanced.account.equityHistory].map(p => p.time).sort((a,b) => a-b), 'shared account processes bars chronologically');
    assert.equal(advanced.account.lastProcessed['BTC-USD'], Date.parse('2026-11-19T13:00:00Z') / 1000);
    assert.equal(read('reviews.json').reviews.length, 8);

    run(4 * 3600 * 1000, { TEST_MISSING: String(Date.parse('2026-11-19T14:00:00Z') / 1000), TEST_MISSING_PRODUCT: 'BTC-USD' });
    const gap = read('paper.json');
    assert.deepEqual(gap.account, advanced.account, 'one missing BTC bar must pause the entire shared ledger, including seven healthy markets');
    assert.ok(gap.errors.some(e => e.product === 'BTC-USD' && /gap/i.test(e.message)));
    assert.equal(gap.updatedAt, advanced.updatedAt, 'blocked shared ledger retains last successful account timestamp');
    run(4 * 3600 * 1000, { TEST_FAIL_PRODUCT: 'BTC-USD' });
    assert.deepEqual(read('paper.json').account, advanced.account, 'one unavailable feed must pause all healthy markets sharing its cash ledger');

    const beforeOutage = read('market.json');
    run(4 * 3600 * 1000, { TEST_FAIL: '1' });
    const outage = read('market.json');
    assert.deepEqual(outage.products, beforeOutage.products, 'outage must preserve all previously fetched candles and their timestamps');
    assert.equal(outage.updatedAt, beforeOutage.updatedAt, 'outage must not claim a fresh market update');
    assert.equal(outage.errors.filter(e => e.message === 'Test market outage').length, 8);
    assert.deepEqual(read('paper.json').account, advanced.account, 'outage must preserve the complete paper ledger');

    run(24 * 3600 * 1000);
    const dailyReviews = read('reviews.json').reviews;
    assert.equal(dailyReviews.length, 16);
    assert.equal(dailyReviews[0].date, '2026-11-20');
    assert.equal(dailyReviews[8].date, '2026-11-19');
    assert.ok(dailyReviews.every(r => r.before && r.after && r.reason), 'daily review records parameter history and rationale');
    assert.ok(dailyReviews.every(r => r.outcomes && Array.isArray(r.outcomes.lessons)), 'retrospective daily lessons are based on closed paper outcomes');

    // Synthetic private state is only ever serialized in encrypted form in the
    // isolated fixture. Production data is never read by this test.
    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    const privateState = { version: 1, updatedAt: '2026-11-19T00:00:00Z', products: ['XRP-USD', 'BTC-USD'], autoTrade: true, config: { ...initial.config }, account: createAccount(12345), snapshot: { source: 'PRIVATE-SYNTHETIC-MARKER', holdings: [{ asset: 'TEST', quantity: 4321 }] }, reviews: [], events: [] };
    privateState.account.decisions = [
      { product: 'BTC-USD', time: Date.parse('2026-11-19T10:00:00Z')/1000, action: 'WAIT', signal: 'WAIT', observedSignal: 'BUY', price: 40000, reason: 'Aggregate exposure risk limit reached.' },
      { product: 'BTC-USD', time: Date.parse('2026-11-19T11:00:00Z')/1000, action: 'WAIT', signal: 'WAIT', observedSignal: 'WAIT', price: 40000, reason: 'Waiting for confirmation.' },
    ];
    const envelope = await encryptState(privateState, secret);
    const encryptedPath = path.join(fixture, 'data/portfolio.enc.json');
    writeFileSync(encryptedPath, JSON.stringify(envelope));
    const beforeLocked = readFileSync(encryptedPath, 'utf8');
    run(24 * 3600 * 1000);
    assert.equal(read('private-status.json').automation, 'awaiting-key');
    assert.equal(readFileSync(encryptedPath, 'utf8'), beforeLocked, 'missing key preserves exact ciphertext');

    const unlockedRun = run(24 * 3600 * 1000, { PAPER_STATE_KEY: secret });
    assert.equal(read('private-status.json').automation, 'updated');
    const unlocked = await decryptState(read('portfolio.enc.json'), secret);
    assert.equal(unlocked.account.cash, 12345);
    assert.deepEqual(unlocked.snapshot, privateState.snapshot);
    assert.deepEqual(unlocked.account.trades, [], 'private initial sync also creates no retroactive paper trades');
    assert.equal(unlocked.reviews.length, 2);
    const btcOutcome = unlocked.reviews.find(r => r.product === 'BTC-USD').outcomes;
    assert.equal(btcOutcome.waitCount, 2);
    assert.equal(btcOutcome.bullishSignals, 1);
    assert.equal(btcOutcome.riskSkips, 1);
    assert.equal(btcOutcome.topReasons.length, 2);
    assert.equal(btcOutcome.counterfactual.evaluatedWaits, 2);
    assert.equal(btcOutcome.counterfactual.upMovesAboveThreshold, 2);
    assert.ok(btcOutcome.lessons.some(l => l.includes('hindsight counterfactual')));
    assert.equal(unlocked.events.length, 1);
    assert.ok(!JSON.stringify(read('portfolio.enc.json')).includes('PRIVATE-SYNTHETIC-MARKER'));
    assert.ok(!unlockedRun.stdout.includes(secret) && !unlockedRun.stderr.includes(secret));
    assert.ok(!unlockedRun.stdout.includes('12345') && !unlockedRun.stdout.includes('PRIVATE-SYNTHETIC-MARKER'));
    assert.ok(!JSON.stringify(read('private-status.json')).includes('12345'));

    run(26 * 3600 * 1000, { PAPER_STATE_KEY: secret, TEST_MISSING: String(Date.parse('2026-11-20T12:00:00Z') / 1000), TEST_MISSING_PRODUCT: 'BTC-USD' });
    assert.equal(read('private-status.json').automation, 'awaiting-data');
    const blocked = await decryptState(read('portfolio.enc.json'), secret);
    assert.equal(blocked.updatedAt, unlocked.updatedAt, 'private gap must preserve its last successful update time');
    assert.equal(blocked.lastMarketAt, unlocked.lastMarketAt);
    assert.deepEqual(blocked.account, unlocked.account, 'gap must not advance private account bars');
    assert.ok(blocked.errors.length > 0);
    run(26 * 3600 * 1000, { PAPER_STATE_KEY: secret, TEST_FAIL_PRODUCT: 'XRP-USD' });
    const partialPrivateOutage = await decryptState(read('portfolio.enc.json'), secret);
    assert.equal(read('private-status.json').automation, 'awaiting-data');
    assert.deepEqual(partialPrivateOutage.account, unlocked.account, 'one private market outage must also pause every healthy market sharing its ledger');
    run(26 * 3600 * 1000, { PAPER_STATE_KEY: secret, TEST_FAIL: '1' });
    assert.equal(read('private-status.json').automation, 'awaiting-data');
    const privateOutage = await decryptState(read('portfolio.enc.json'), secret);
    assert.equal(privateOutage.updatedAt, unlocked.updatedAt, 'private outage must preserve its last successful update time');
    assert.deepEqual(privateOutage.account, unlocked.account);

    const beforeInvalid = readFileSync(encryptedPath, 'utf8');
    run(26 * 3600 * 1000, { PAPER_STATE_KEY: Buffer.alloc(32).toString('base64') });
    assert.equal(read('private-status.json').automation, 'error');
    assert.equal(readFileSync(encryptedPath, 'utf8'), beforeInvalid, 'invalid key preserves exact ciphertext');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
