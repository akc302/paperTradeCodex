# Research sources

Pattern research adapts ideas from [Jakeschincariol/day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill), reviewed at commit `3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd`, MIT, copyright 2026 Jake Schincariol. License: [third-party/day-trader-skill/LICENSE](third-party/day-trader-skill/LICENSE).

Read skills: trader-scanner, trader-entry, trader-exit and trader-timemachine. This is a JavaScript crypto adaptation, not a Claude plugin runtime or installation of all eleven skills. No broker skill or external Python dependency is executed by the app.

Adaptations: scanner closing-high breakout, MA reclaim and oversold bounce use completed 1-hour Coinbase candles instead of daily US stock closes. Wilder RSI uses a fixed rolling 31-hour input. Bull-flag consolidation is context only; entry confirmation additionally requires a close above the prior five-hour high. Volume is descriptive, not a requirement. The NYSE opening-range/calendar and stock-specific universe, earnings and congressional-trading features do not apply to this 24/7 crypto experiment.

The time-machine guidance informs chronological candle replay, fixed stop/target planning and conservative ambiguous-bar handling. We do not claim to run the upstream Monte Carlo program, thousands of stock charts, years of history, or all upstream skills. Each report states its actual candle count and split. The fixed pattern-filter comparison uses the same existing fee, rebate, slippage and risk configuration in both arms. It is shadow research and does not enable the filter in the automated account. Every new automated decision and entry records the confirmation available then; historical positions are not relabeled after the fact.
