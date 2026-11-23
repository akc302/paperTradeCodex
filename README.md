# Level Lab — paperTradeCodex

> Destination activation: trading checks now run every **two hours**. Five Codex roles are coordinated through a dedicated trader task and one hourly team task with independent role deadlines. Read [AGENT_RUNBOOK.md](AGENT_RUNBOOK.md). Source-era five-minute timing descriptions below are historical; destination code and the runbook take precedence. Pages and the GitHub private-key secret remain pending repository-settings access. All writes belong only to `akc302/paperTradeCodex`.

[Open the dashboard](https://akc302.github.io/paperTradeCodex/) · [Source repository](https://github.com/akc302/paperTradeCodex)

A paper-only crypto research dashboard. No Coinbase credentials are embedded, no real order/account endpoints are called by the app or scheduler, and no real portfolio funds move.

## Accounts and privacy

- **My Coinbase paper portfolio:** an AES-256-GCM encrypted simulation initialized from a read-only, authorized spot-portfolio snapshot. The original snapshot and all its virtual balances, trades, decisions, and reviews are encrypted before they enter GitHub or Pages assets. Other portfolios that could not be verified are excluded and marked unknown. Original purchase costs are unknown; the user-supplied $85,000 figure is a research goal, not verified cost basis.
- **Public demo account:** a separate fictional $10,000 account. Its journal and reviews are public. It does not reveal the private account's results.
- **My practice account:** manual virtual trades in this browser's local storage, independent of either scheduled account.

The private simulation virtually rebalances the starting holdings and includes small initial exploration positions in XRP, SOL, ETH, and BTC. These are explicitly labeled **exploration, not confirmed trendline signals**. Snapshot rebalance entries and exits are paper ledger events, not real Coinbase sales. The original holdings remain visible in the unlocked snapshot table.

### Enable private unattended updates

1. Obtain the generated **paper-state-key.txt** from the originating private chat. It contains a random 32-byte app encryption key. It is not a Coinbase credential.
2. In [repository Actions secrets](https://github.com/akc302/paperTradeCodex/settings/secrets/actions/new), create **PAPER_STATE_KEY** with the file's contents as its value. Use an Actions secret, never a repository variable, source file, issue, workflow input, or commit.
3. Run **Update paper account** from the repository Actions tab, or wait for the next five-minute run. The private dashboard must report a successful encrypted update before treating private automation as active.
4. In the app select **My Coinbase paper portfolio**, then choose the generated key file to unlock it in the current tab. Reloading or closing the tab locks it again. The key and decrypted state are held only in tab memory, never localStorage, a URL, or a request payload.

The connected integration cannot configure repository secrets; this one setup step requires the repository owner's account. Without the key secret, public market/demo updates continue while the private account stays unchanged with an **awaiting-key** status. Wrong keys, corrupted data, incomplete feeds, and gaps retain the previous encrypted account and show a status warning. Keep the key file secure; losing it prevents decrypting the existing private journal.

The key is passed only to the updater step. Tests, builds, artifact uploads, and deploy steps do not receive it. Publishing uses an explicit data-file whitelist; the private state file must contain only a validated encrypted envelope. No plaintext private file belongs anywhere in this repository. Exported private CSV files are local user downloads and should not be uploaded to the public repository.

## Market data and Coinbase MCP

The initial public candle snapshot was read through the user's Coinbase MCP and is preserved in `data/mcp-seed.json`. A separate read-only MCP query supplied the encrypted private portfolio baseline. No Coinbase API key, OAuth credential, account identifier, or raw account response is saved in source.

An authenticated ChatGPT MCP connection cannot be inherited by a static GitHub Pages website or GitHub Actions. Ongoing prices therefore use Coinbase's public Exchange API. The scheduler **does not continuously resync actual Coinbase quantities**, transfer funds, or place orders. It updates the paper copy and estimates its value using public prices. Deposits, withdrawals, or real trades made separately on Coinbase require a new explicitly imported snapshot.

## Five-minute checks and hourly strategy

The fixed liquid research universe is **XRP-USD, SOL-USD, ETH-USD, BTC-USD, ADA-USD, DOGE-USD, LINK-USD, AVAX-USD**. This is a bounded universe, not a claim to scan every coin or predict which coins will be bullish.

The algorithm is a **Tori-inspired mechanical approximation**, based on her public [action/safety trendlines](https://toritradez.com/blog/all/perfect-trade-trend-line-setup) and [four-hour/top-down framework](https://toritradez.com/blog/all/trend-line-trading-masterclass-a-to-z). Her method is discretionary; our pivot windows, weekly touch thresholds, next-open simulation, fixed risk caps, and time exits are explicit research choices, not a verified or endorsed reproduction.

- Complete aligned **4-hour candles** establish confirmed trendline structure. Missing or partial groups are excluded.
- At least three separated touches spanning a week define a rising support line or descending resistance line.
- A support bounce or resistance break must have bullish structure and a bullish closed **1-hour confirmation**.
- The nearest confirmed overhead horizontal resistance must offer at least **2:1 net reward/risk** after modeled fees and slippage.
- Paper entries use the next five-minute open; stops, targets, gap handling, and 48-hour maximum holds govern exits.
- All markets share one cash ledger, position cap, aggregate planned-risk budget, and daily loss pause. Known stops can still be exceeded by gaps.
- Initial synchronization does not invent historical profits. Each new hourly candle is processed once; every evaluated market records its action, setup, reason, and configuration.

Private configuration starts at **0.5% equity stop-risk per new trade**, **3% aggregate planned risk**, **15% allocation per position**, **four open positions**, and a **4% daily loss pause**. These are paper modeling controls, not assurances of safe profits. Default fee/slippage assumptions are 0.60%/0.05% per side, not a query of the user's Coinbase fee tier.

The scheduler checks at minutes **2, 7, 12, …, 57 each hour** (every five minutes), independent of whether the page is open. A five-minute check does not force a trade or change the completed-candle signal. Daily learning remains once per UTC day, when there is outcome data to evaluate. GitHub's technical minimum is five minutes, and five minutes is the chosen check cadence; trade signals still use completed one-hour/four-hour candles. Runs can be delayed, dropped under load, or disabled after prolonged public-repository inactivity. [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Journal and daily learning

The journal separates open positions, closed trades, costs, original strategy signals, executed actions, and WAIT/risk-skip decisions. Exploration trades and initial snapshot rebalances remain identifiable by source.

Once per UTC day and enabled market, reviews summarize the previous day's closed-trade outcomes, fees, stop/time exits, decision counts, bullish signals, risk skips, and common rejection reasons. Hindsight four-hour moves after WAIT are clearly counterfactual diagnostics, not executable profits or proof the bot could have caught them.

A small fixed candidate set is trained on earlier data and checked on a later holdout. Historical context can warm indicators, but holdout fills and decisions start only at its boundary. All comparison samples need at least five closed trades. A promotion requires improved training and holdout return without higher holdout drawdown, and affects future entries only. Each market keeps its own adopted configuration.

Daily research is a deterministic retrospective and backtest, **not unattended web browsing or an AI that can guarantee improvement**. Rolling overlapping samples can overfit. It is valid to keep existing parameters or make no confirmed strategy trades. Reaching the $85,000 paper goal does not recover losses in the real Coinbase account.

## Checks, updates, and publishing

Requires Node 22+; no npm installation or runtime packages are needed.

```sh
npm test
npm run build
npm run update
```

For proxy-managed Node 24 environments use `node --use-env-proxy scripts/update-market.mjs`. Private updates require `PAPER_STATE_KEY` in that process environment. Never print the key or plaintext state.

Pages uses GitHub Actions as its source. `pages.yml` publishes main-branch changes; `update.yml` fetches public markets, advances virtual accounts, encrypts private output, commits safe data, and deploys directly. A `GITHUB_TOKEN` commit does not trigger a second workflow, hence the direct deployment step.

| Path | Purpose |
| --- | --- |
| `app.js`, `private-ui.js`, `index.html`, `styles.css` | Responsive frontend and in-memory private unlock |
| `engine.js` | Price analysis, virtual accounting, execution and research |
| `data/market.json`, `data/mcp-seed.json` | Public market data |
| `data/paper.json`, `data/reviews.json` | Public demo ledger and review history |
| `data/portfolio.enc.json` | Encrypted private snapshot, ledger and journal |
| `data/private-status.json` | Generic private automation status; no financial values |
| `scripts/private-state.mjs` | Portable authenticated encryption |
| `scripts/update-market.mjs` | Scheduled simulation |

The browser-local practice account evaluates observed quotes and closed candles only while open/refreshed; it does not run unattended. The scheduled accounts are separate. Fonts use Google Fonts with local fallbacks. GitHub Pages is public and has no private login; confidentiality of the private account depends on protecting the generated encryption key.

## November 20 experimental update

The operational audit found no GitHub `schedule` events, although manual updates had passed. The app therefore publishes actual timer-evidence metadata instead of treating a cron configuration as evidence of continuous execution. An independent hourly ChatGPT monitor was created as fallback. Neither is a guaranteed real-time host.

The active user-requested aggressive paper experiment uses fresh quotes when a job actually executes, rather than retrospective hourly opening fills. It logs weaker exploration triggers separately from the strict reference trendline strategy. Risk caps are 2% per entry, 8% aggregate planned loss, four positions, 25% allocation per slot, a two-hour holding cap and a 12% daily entry pause. Stops can still lose more during gaps/delays. This experiment is designed to collect evidence, not to maximize apparent returns by omitting costs.

A regularized logistic-regression shadow model fits historical fee-hurdle labels using only contemporaneous price features. Training labels must end before the chronological holdout begins (four-hour embargo). Reports include Brier loss versus a constant baseline and probability timestamps. Accuracy on historical labels is not a strategy win rate. The model currently does not control orders; daily fitting and per-market reviews are research tools.

Display prices use the Coinbase public WebSocket ticker where available, with existing REST refresh fallback. The private key is never sent through that socket. A live display tick cannot prove that the backend has traded; the separate server-update time and timer warning remain authoritative. The paper executor continues using authenticated-fee snapshots, not live per-trade tier refresh.

## Evidence gathering versus strategy review

The jobs have distinct responsibilities:

| Job | Configured cadence | Changes trades? | Fits/tunes? |
| --- | --- | --- | --- |
| update.yml | Every five minutes | Yes, simulated execution and management only | No |
| learning.yml collect | Hourly at :23 UTC | No | No; collects completed outcomes |
| learning.yml review | Daily at 00:37 UTC | No existing positions changed | Evaluates once per UTC day; gated future-entry changes only |

The normal updater defaults to trade-only, including manual invocations. The collector records wins/losses/flats, realized net outcomes, fees/rebates, expectancy, profit factor, drawdown and market/setup/exit categories. Sparse execution checks mark a window incomplete; a recent HTTP response alone does not prove the trader ran at its intended cadence. Daily tuning is refused when execution coverage is incomplete or sample counts are insufficient.

A separate ML report uses actual completed paper trades with frozen entry-time features. It requires at least 100 eligible closed outcomes and a chronological holdout with both winners and losers; trades crossing the training boundary are excluded. This is different from the existing historical-market-label model. Both remain shadow research, not a promised profitable filter.

Daily future-entry adjustments require at least 100 completed trades overall, 30 in a market with five wins and five losses, complete sampling coverage, a fresh execution heartbeat and the existing training/holdout checks. Risk/allocation/position/daily-loss caps remain fixed. The configured daily UTC review interval is not a guarantee of delivery: GitHub timer irregularity remains visible, and a separate hourly fallback can dispatch missing jobs.

Public evidence is in data/evidence.json and data/research.json. The corresponding private evidence/review/model is inside data/portfolio.enc.json. Collecting or reviewing it never refreshes the trading heartbeat or calls real Coinbase order endpoints.

### Day-trade pattern research

[Upstream skills and adaptation notes](THIRD_PARTY.md). The scanner/entry guidance is adapted to completed Coinbase 1h candles: 20-hour closing-high breakout, MA20 reclaim, oversold bounce, and a close-confirmed bull-flag breakout. Consolidation and oversold readings alone are context, not entry confirmations. US-stock opening-bell logic does not apply to this 24/7 crypto universe. No broker skill is included.

The dashboard shows the current confirmation and later-holdout comparison of the existing strategy against the same strategy requiring a pattern. A fixed 70/30 chronological split, actual modeled costs and at least five closed trades in each comparison arm guard the research verdict. The report states the available history, not years of data. Hourly replay differs from actual scheduled quote fills and is not proof of an edge. Reports refresh in the separate daily review, not every trading check.

The automated engine stays in **observation mode**. It records immutable entry-time pattern context in decisions, positions and closed trades, allowing hourly outcome collection to group confirmed, unconfirmed and unrecorded entries. Existing positions are not retroactively tagged. A promising backtest still needs forward evidence; this feature does not silently enable the filter or change risk caps. An explicit initial offline report can be generated with `node scripts/pattern-research.mjs` when PAPER_STATE_KEY is securely supplied; private results remain inside the encrypted envelope and the script does not execute trades or advance trading heartbeats.

## Trend following, execution and challengers (November 21)

- **History.** `scripts/fetch-history.mjs` keeps about two years of 6h and daily candles per market in `data/history/<product>-6h.json` / `-1d.json`. They come from Coinbase's public candles endpoint, at most 300 bars per request, with a delay between pages; after the first run it only fetches what is new. Coinbase has no 4h granularity, so the trend series is **6h**. The daily review refreshes it. All 16 files together stay well under the 4 MB size check.
- **Main rules: `trend-follow`.**
  - Entry: the daily close is above its 50-day EMA, the 20-day EMA is above the 50-day, and a 6h close makes a new 20-bar closing high.
  - Rank: only the top 2 trend-passing coins by 30-day return may be held.
  - Exit: a chandelier trailing stop (highest 6h close since entry − 3×ATR). It only moves up. There is no fixed target and no time exit; a ×20 safety target exists only for the ledger.
- **Execution.**
  - Entries are paper limit buys at bid/last − 0.05%. One counts as filled (maker fee) only if a later 5-minute quote trades at or below it, and it is cancelled after 3 checks.
  - Every fill records maker or taker.
  - Each position risks the same share of equity, sized by its ATR stop distance.
  - At most 60% of equity is invested in total.
- **Drawdown pause** (`pause` in `data/paper.json`). At 10% below the equity peak, new position sizes are halved. At 15%, new entries stop until a supervisor or manager sets `pause.cleared: true`, which also restarts the peak. Exits always keep running. The pause state shows on the dashboard and in the team report.
- **Challengers** (`challengers[]`). Five alternative rule sets trade as separate paper accounts on the same quotes, fees and caps, in the same five-minute run:
  - trend with k=2 and k=4;
  - the lab's 2-year trend leader;
  - the previous hourly rules;
  - the lab's hourly per-market rules.
- **Promotion.** The daily review (`scripts/promotion.mjs`) promotes at most one challenger a day, and only if it beats the main on both tests:
  - **Backtest:** the 2-year 6h portfolio replay, or the stored hourly window for hourly rules.
  - **Live:** at least 7 days and 20 closed trades, higher net after fees, profit factor ≥ 1.2, and drawdown no worse.
  - It must also pass a deflated-Sharpe penalty that grows with the number of rule sets tried.
  - Every promotion and rejection is kept in `promotionHistory`.
  - The five-hour strategy lab feeds the lab challengers; it no longer changes the main rules directly.
- **Dashboard scorecard.** For the main account and every challenger: net profit after fees, profit factor, max drawdown, win rate and average win vs average loss. It also shows the drawdown-pause state and the estimated time to $85,000 at the trailing 30-day growth rate (not a promise).

Risk caps (`riskPct`, `maxTotalRisk`, `maxAllocation`, `maxOpenPositions`, `maxDailyLoss`) are unchanged, and code refuses any change to them. This is still long-only spot paper trading only: no futures, leverage, shorting or real orders.
