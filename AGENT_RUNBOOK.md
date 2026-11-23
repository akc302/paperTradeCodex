# paperTradeCodex operational agents

Only `akc302/paperTradeCodex` may be modified or receive workflow dispatches. The original `akc302/PaperTrading` project and its Cloud agents must remain untouched. Five destination-only roles run through two Codex tasks: the dedicated two-hour Trader and an hourly Agent Team coordinator. The account plan allows only five scheduled tasks overall, so creating five additional independent tasks was rejected. The coordinator uses `scripts/agent-cycle.mjs` and `data/codex-agent-status.json` to run verifier/researcher/manager/supervisor only when each is due; research is not fitted every hour. Existing unrelated tasks and old canceled tasks are unchanged.

| Role | Cadence | Work |
| --- | --- | --- |
| Trader | Every 2 hours | `node scripts/trade-cycle.mjs`, then `node scripts/timer-evidence.mjs`; fresh public Coinbase quotes, simulated entries/exits, encrypted private account, successful-check receipt. |
| Researcher | Every 5 hours | Review losses/costs, run `scripts/strategy-lab.mjs` on new evidence, maintain research notes. The existing hourly evidence and UTC daily review remain separate. |
| Verifier | Hourly | Inspect destination Actions and receipt freshness. A successful paper check is stale after 135 minutes. Recover once only when due; never bypass the two-hour guard. |
| Manager | Every 6 hours | Refresh evidence and `scripts/team-report.mjs`, check arithmetic, jobs and researcher notes, repair bounded operational defects with tests. |
| Supervisor | Every 8 hours | Independently audit the manager/researcher, privacy and fee assumptions; run `scripts/supervisor-report.mjs`; record blockers without changing ledgers or risk caps. |

These are scheduled tasks, not continuously running processes. Delivery depends on resource/tool availability. The source's configured research cron remains a secondary trigger; all actual task results must be verified. The source's five-minute self-dispatch loop was removed. GitHub trading cron is `15 1-23/2 * * *` UTC (01:15, 03:15, …, 23:15), aligned with the Codex trader task. Successful execution receipts prevent other roles/manual retries from adding extra checks inside two hours. A scheduled check may generate WAIT or risk-skip records instead of a trade. Stops and pending fills are observed only when the two-hour check executes, not continuously.

## Safe execution

1. Use a clean isolated checkout/worktree of the destination; do not reuse another running agent's dirty directory. Pull latest main and verify the only push destination is `akc302/paperTradeCodex`.
2. Load the existing private-state key from the attached private workspace into **process environment only**; never print it, commit it, put it in workflow arguments, or upload it as an artifact. Do not generate a replacement key for the existing encrypted journal. If unavailable, report the inspection/execution limit instead of exposing private state or pretending success.
3. Node 24 in this proxy environment needs `--use-env-proxy` for network updates. `trade-cycle.mjs` forwards Node runtime flags to its child updater. Node 22 on GitHub uses ordinary networking. All execution is simulated; never invoke real Coinbase order, cancellation, conversion, transfer or payment APIs.
4. Trader must run `trade-cycle.mjs`, not the unguarded updater. Research/manager/supervisor do not execute trades. A verifier may request one guarded recovery only when the successful-check receipt is due.
5. Before committing, audit changed file paths, encryption-envelope structure and credentials. Commit only intended public files and encrypted private state. Test code changes and build. Fetch before push; on conflict replay on new main, never force-push or overwrite a newer journal.
6. Inspect resulting workflow/deployment evidence. Do not claim cron delivery from a Codex/manual run. Do not repeatedly dispatch while another destination job is running. Publish only to the destination.
7. Preserve current strategy/risk settings and existing positions unless the owner explicitly requests a strategy change or an existing validated research gate applies. Do not invent trades, backdate fills, hide losses or tune until historical wins appear.
8. Notify for meaningful results/fixes or blockers; avoid routine all-clear spam. Keep private metrics in encrypted reports or the owner's private response.

## Known setup limits

The GitHub integration returned HTTP 403 when setting `PAPER_STATE_KEY` and creating the Pages site. It can push code and dispatch workflows, but cannot grant itself repository settings permissions. Workspace Codex tasks can use the already-present private key to run and commit encrypted simulation updates. GitHub-only private execution requires the owner to add that same key as the **destination** secret. Pages must be enabled for this destination through repository settings. Never commit a key as a workaround.

The copied runtime diagnostics now use a two-hour cadence. Evidence coverage denotes a successful observed check within the preceding two hours; an hourly window can be covered by this schedule while containing zero checks. The journal retains the actual observed check count. This is weaker sampling than the old five-minute cadence and must not be presented as continuous market coverage.

## Baseline and continuity

Latest source snapshot imported for activation: `ae429e7a00261e0f8adbfa980f86741f95627a54` on November 23, 2026. All source data was imported before destination execution. After the first destination check, do not overwrite this independent journal with new source data. Future source code refreshes must merge code separately and preserve destination state and scheduling.

If a Codex trader invocation arrives at most five minutes before the 7200-second receipt deadline due to scheduler jitter, wait in short intervals until due and recheck current main. Do not skip a whole two-hour cycle for a few seconds of early delivery. When a destination updater is already running, wait/pull/check instead of racing it. The hard receipt guard remains unchanged.
