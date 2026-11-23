# PaperTrading → paperTradeCodex

## Ownership and snapshot

- Destination and only authorized write repository: **https://github.com/akc302/paperTradeCodex**.
- Read-only source: https://github.com/akc302/PaperTrading.
- Imported source `main` snapshot: **f5563b2d5ca504ec7537650461af7a85e8bb47a8**, cloned November 23, 2026.
- Imported all 102 tracked files, including historical candle files, public demo/archive journals, the encrypted private journal, research, tests, workflows and third-party attribution. This is the complete working-tree snapshot, not the source's multi-gigabyte Git revision history.
- Source code and source repository settings are unchanged. This copy has independent Git history, starting from the destination's existing initial commit.
- All `data/` files are copied byte-for-byte. Imported timestamps, workflow IDs, health reports and agent reports describe the source snapshot; they do **not** prove that the destination's agents have run. No account reset, trading, fitting or review was performed during migration.

## Destination-specific changes

Runtime GitHub links, the encryption-secret setup link and health-check URL now point to `paperTradeCodex`. The future default Pages address is `https://akc302.github.io/paperTradeCodex/`; it is not claimed to be deployed by this migration.

All four workflow jobs require both:

```yaml
github.repository == 'akc302/paperTradeCodex' && vars.PAPERTRADE_CODEX_ENABLED == 'true'
```

This migration deliberately does not set that variable. The gate prevents the imported five-minute self-dispatch loop, recovery triggers, research, commits and Pages deployment from starting before the owner completes Actions setup. The cron definitions and all implementation steps are retained. Future dispatches use `${{ github.repository }}`, so their repository scope is the destination. Do not direct them back to the source.

## Scheduler and agent inventory

GitHub cron expressions below use UTC. They are configurations, not delivery guarantees.

| Component | Stored implementation | Copied timing / responsibility |
| --- | --- | --- |
| Trader / agent 1 | `.github/workflows/update.yml`, `scripts/update-market.mjs` | `*/5 * * * *`; paper execution, journal/cost updates, encrypted private updates, timer evidence, build/publication. The job also waits to the next five-minute boundary and dispatches itself. |
| Evidence collector | `.github/workflows/learning.yml`, `scripts/journal-learning.mjs collect` | `23 * * * *`; summarize hourly evidence without trading. |
| Daily reviewer | same workflow, `review` phase; history/sweep/rules/promotion scripts | `37 0 * * *`; refresh history, run research and assess challenger promotion. |
| Researcher / agent 2, deterministic portion | same workflow, `research` phase; `scripts/strategy-lab.mjs` | `17 */5 * * *`; hours 00, 05, 10, 15, 20 UTC. This cron has a four-hour overnight gap. Separately, `scripts/overdue.mjs` requests research after **three** hours without a lab update; the trader can dispatch it earlier than the cron. Both source behaviors are preserved. |
| Verifier | `.github/workflows/health.yml`, `scripts/health-check.mjs` | `41 * * * *`; destination data freshness, one updater retry, recovery verification. |
| Manager report | `scripts/team-report.mjs`, learning workflow | Runs after every collection/review/research phase; ledger integrity, readiness, scorecards, stalled-job checks and bounded workflow restarts. |
| Dashboard publisher | `.github/workflows/pages.yml` | Push to main or manual dispatch; tests, static build, Pages publication. Gated during setup. |
| Claude researcher, interactive AI work | Role description in team report / research notes | Described as every five hours; its external registration, exact prompt and execution environment are **not present in this repository**. Deterministic research code is copied. |
| Claude manager, interactive AI work | Role description in team report | Described as every six hours; external registration/prompt is not present. The stored manager report generator is copied. |
| Claude supervisor | Role description and `data/supervisor-report.json` | Described as every eight hours; external registration/prompt and a supervisor runner are not present. The existing report is copied as historical data. |

The last three external tasks cannot be cloned from Git. No external Claude/Cloud task was changed, and no new ChatGPT automation was registered. The two previously canceled ChatGPT tasks remain canceled. Recreating AI agents later requires their original task definitions or an explicit request to design replacements; do not claim that historical role labels are running agents.

## Trading/research implementation retained

The latest source includes trend following, range and dip rules, pending simulated maker entries, trailing stops, portfolio exposure controls, drawdown pauses, challenger accounts, rule sweeps, historical data, promotion guards, fee/rebate accounting, evidence collection and encrypted private UI. Strategy decisions and risk settings were not changed for the migration. The copied research plan records the evolution through several approaches; older source notes may be superseded by later code.

## Owner setup before activation

1. Configure GitHub Pages in **paperTradeCodex** with GitHub Actions as its source, and permit the required Actions/Pages permissions and `github-pages` environment.
2. Save the **existing key that decrypts the copied private journal** as the destination's Actions secret `PAPER_STATE_KEY`. Do not generate a different key for the existing ciphertext, place it in a repository variable, commit it, or share it in workflow inputs. No Coinbase credential is needed for public market data.
3. Review the copied workflows, including the self-dispatch loop, and complete any desired changes. Repo secrets, variables, environments, branch rules, app installations, Pages settings and external AI task registrations do not transfer with Git files. This integration could not inspect destination secrets (HTTP 403); their presence is unverified.
4. When ready, set the repository Actions variable **PAPERTRADE_CODEX_ENABLED** to the string **true**. This activates all four copied workflow jobs. Manually run the publisher/updater as appropriate and verify the destination's published state and encrypted private update before calling it operational.
5. Preserve `data/portfolio.enc.json` and unlock with the existing key to see the same private journal. The copy will develop an independent history once destination trading starts; it does not synchronize back to the source.

The migration does not activate Pages, trading, recovery, learning or external AI agents. The $85,000 target remains a paper research goal, not a guarantee or authorization for real orders.

## Validation

Validation results are recorded below after checks complete. The migration's scope is a prepared repository, not a live-site deployment.

- All **122 tests passed**; static build passed with its encrypted-envelope check and explicit publication whitelist.
- All **102 source files are present**: 93 unchanged and 9 adjusted only for destination links/documentation or the workflow activation gate.
- All **40 data files match the source byte-for-byte**, including `portfolio.enc.json` and the public journal/archive. `MIGRATION_MANIFEST.json` records source/destination SHA-256 checksums for every imported file.
- Known-key scan, credential-pattern scan, sensitive JSON-field scan, runtime destination checks and all four workflow-gate checks passed. No secrets or private plaintext were added. The private ciphertext remains decryptable with the existing key; public report provenance remains the separate demo account.
- Both local source checkouts have push URLs disabled. The destination's push remote is only `akc302/paperTradeCodex`; a local pre-push hook rejects other destinations.
