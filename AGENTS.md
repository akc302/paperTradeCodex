# Repository ownership and working rules

The only authorized write/push repository for this project is **akc302/paperTradeCodex**.

- Treat `akc302/PaperTrading` as a read-only reference. Do not commit, push, dispatch workflows, change settings, or modify external agent schedules for that repository.
- Verify `git remote -v` before pushing. Push explicitly to `origin main` only when origin resolves to `akc302/paperTradeCodex`; otherwise stop and fix the local remote.
- Preserve the copied journal, private encrypted envelope, PIN gate, current strategies and risk settings. All trading is simulated; never call real order, cancellation, conversion, transfer or payment APIs.
- Never print, commit, upload, or expose credentials, unlock keys, raw account responses, or private plaintext financial state. Do not copy workspace-private files or source repository secrets. Public demo data is separate from the encrypted private portfolio.
- Run relevant tests and `npm run build`, then audit the publication whitelist and private envelope before pushing implementation changes.
- Read `MIGRATION.md` for snapshot provenance, copied schedules, external agent limitations and activation requirements. Original `TASKS.md` and `RESEARCH_PLAN.md` contain historical source-project notes; their old activation claims do not prove this destination is running.
- The owner authorized activation on November 23, 2026. Trading checks must be at least two hours apart. Use `scripts/trade-cycle.mjs`; never bypass its successful-check receipt. The repository-only workflow gate must remain. Read `AGENT_RUNBOOK.md` for the five destination-only roles.
- Do not restart the two canceled ChatGPT automations from the original project. External Claude/Cloud registrations remain under the owner's control.
- Record future project work here. Do not modify the source project's code as part of follow-up tasks.

- Scheduled agents must use isolated clean worktrees or clones, pull latest destination main before acting, and never overwrite another agent's changes. A rejected push requires replaying the operation on latest main; never force-push. Do not copy source journals again after destination trading starts.
