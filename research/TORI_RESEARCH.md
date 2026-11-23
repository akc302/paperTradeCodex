# Tori research ledger

Status: initial source review, not an exhaustive video/transcript corpus. Persist original summaries and factual implementation mappings rather than republishing full third-party transcripts.

## Primary sources inspected
- https://toritradez.com/blog/all/trend-line-trading-masterclass-a-to-z — three-touch break, opposing safety line, top-down structure, four-hour execution. Implementation approximates confirmed pivots/lines; it does not replicate discretionary chart selection.
- https://toritradez.com/blog/all/perfect-trade-trend-line-setup — action/safety line distinction. Pending: separate dynamic opposing-safety-line exit backtest versus current fixed stop/target.
- https://toritradez.com/blog/all/low-risk-trend-line-trading-break-retest-bounce — valid structure, break/retest/bounce distinction. Pending: retest-specific variant with independent holdout.
- https://www.youtube.com/watch?v=Y8efWZ2M1y8 — official Full Guide; public chapter metadata identifies support/resistance (17:57), order types (20:48), exits (22:47), risk (27:42), three-touch break (30:20), backtesting (38:47), journaling (41:52). Transcript not retrieved; do not imply its full spoken content was analyzed.
- https://www.youtube.com/watch?v=Z2dpqNIJTnE — official short explanation; public description verified, full transcript not retrieved.

## Prioritized next review
Find and verify official URLs for the popular trendline tutorials and recent top-down analysis videos, then record URL, publication date, accessible captions, original summary, candidate rule, ambiguity, and backtest result. Search rankings/view counts are not evidence that a strategy works. Missing/unavailable subtitles must remain marked unavailable; don't fabricate text or bypass access restrictions.

## Experiment protocol
Compare rising-support bounce, descending-resistance breakout, retest, opposing safety-line exit, and fixed target variants independently. Keep fee-inclusive baseline, chronological holdout, frozen rules, sample counts and drawdown. Shadow first; never promote solely because of a recent win or loss.

## 2026-11-20 source review update

Exa returned 10 search results across two targeted searches. Three primary articles were additionally fetched, yielding eight unique primary URLs after deduplication. Indexed transcript excerpts are now available for the videos below; coverage is partial, not an exhaustive transcript corpus or an assertion that every video was watched.

| Official video | Evidence available | Original rule summary and implementation boundary |
| --- | --- | --- |
| https://www.youtube.com/watch?v=Y8efWZ2M1y8 | Indexed spoken excerpts plus chapters | Higher-timeframe context, clean lines that have not already cut through price, then four-hour execution. She explicitly discusses normal losing trades. Our 1h features and fixed targets are separate modeling choices. |
| https://www.youtube.com/watch?v=yHAC0xtBR2Q | Indexed spoken excerpts | Defines a break entry and an opposing exit boundary; a losing example is part of the explanation. This is not evidence of a 100% win rate. |
| https://www.youtube.com/watch?v=qLtq73bTPBA | Indexed spoken excerpts | Stop placement beyond a safety line, rather than exactly on it. Tick precision, market mechanics and line selection remain discretionary. |
| https://www.youtube.com/watch?v=zT2hSb9IEZw | Indexed spoken excerpts | Downward-line break for a long reversal and progressively protecting an advancing position. A shown successful example does not establish general profitability. |
| https://www.youtube.com/watch?v=Bkysd0luZfo | Indexed spoken excerpts | Opposing line manages trailing exits; choose a low and recent valid higher-low anchor without slicing through price. A separate trailing-line variant still needs testing against the fixed-exit baseline. |

The active aggressive experiment deliberately accepts weaker exploratory triggers and is NOT the strict three-touch Tori method. Its increased turnover generates observations and costs; it is not a research finding that more trading improves returns. The shadow logistic model predicts a fee-hurdle label on historical data with a chronological holdout. Its classification accuracy must never be advertised as the win rate of executed trades.
