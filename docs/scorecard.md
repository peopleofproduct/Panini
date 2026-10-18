# Scorecards — transparent, lender-owned scoring

Panini deliberately does **not** ship a calibrated credit score. Scores
like a "Precisa Score" are trained on millions of historical defaults —
data we don't have and can't fake. And under RBI's accountable-lender
framework, the regulated entity must own its risk model anyway; a
vendor's score is an input, never the decision.

What Panini provides is the honest middle ground: **a deterministic,
JSON-declared scorecard engine** that evaluates weighted rules over the
evidence-backed `InsightsReport`, emitting a score with a full
per-rule derivation trace. Every point is auditable down to transaction
indices.

## Quick start

```ts
import { analyzeTransactions, evaluateScorecard } from '@paniniapi/insights';
import spec from '@paniniapi/insights/scorecards/reference.json';

const report = analyzeTransactions(transactions);
const result = evaluateScorecard(report, spec);
// → { score, maxScore, scorePct, coveragePct, band, contributions[], warnings[] }
```

```python
from panini import analyze_transactions, evaluate_scorecard
result = evaluate_scorecard(analyze_transactions(txns), spec_dict)
```

## Spec format

```jsonc
{
  "id": "mylender.retail.v3",
  "version": "3.2.0",
  "rules": [
    {
      "id": "foir.comfortable",
      "points": 20,
      "when": { "metric": "foir.ratio", "op": "lte", "value": 0.5 },
    },
    {
      "id": "income.regular",
      "points": 25,
      "when": {
        "all": [
          { "metric": "income.consistency", "op": "eq", "value": "regular" },
          { "metric": "income.monthsObserved", "op": "gte", "value": 3 },
        ],
      },
    },
    {
      "id": "risk.noBounces",
      "points": 15,
      "when": { "metric": "signals.rule:risk.bounce", "op": "eq", "value": 0 },
    },
  ],
  "bands": [
    { "minScorePct": 75, "label": "strong_facts" },
    { "minScorePct": 0, "label": "weak_facts" },
  ],
}
```

- **Ops**: `lt lte eq neq gte gt in`.
- **Composites**: `all` / `any` (one level deep — deliberately kept
  readable; deeper nesting means the card is too complex to audit).
- **Validation**: `validateScorecardSpec` rejects unknown metrics, bad
  ops, duplicate rule ids, and nested composites at load time.

## Metric dictionary

| Metric                                                                                           | Source field                                              |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `foir.ratio`                                                                                     | `foir.ratio`                                              |
| `income.monthlyAveragePaise` / `income.consistency` / `income.monthsObserved` / `income.sources` | income summary                                            |
| `obligations.monthlyObligationPaise` / `obligations.emiCount`                                    | obligations summary                                       |
| `cashflow.averageMonthlyNetPaise` / `minBalancePaise` / `netPaise`                               | cashflow summary                                          |
| `trends.netFlowDirection` / `creditVolatilityPct` / `debitVolatilityPct`                         | trend summary                                             |
| `signals.count` / `.high` / `.medium` / `.low`                                                   | risk signals by severity                                  |
| `signals.rule:<ruleId>`                                                                          | count of one signal type, e.g. `signals.rule:risk.bounce` |
| `analyzedTransactions`                                                                           | input size                                                |

A metric that resolves to `null` (e.g. `foir.ratio` on a file with no
detected income) makes the whole rule **unknown** — it neither earns nor
loses points.

## `coveragePct` — the anti-thin-file guard

`coveragePct` = share of `maxScore` whose rules could be evaluated against
real data. A `scorePct` of 90 on `coveragePct` of 30 is a thin-file
artefact, not a strong applicant — the result carries a `thin file`
warning when coverage falls below 60%. **Always gate on coverage, not
just the score.**

## The derivation trace

Every rule contributes an audit row:

```jsonc
{
  "ruleId": "foir.comfortable",
  "points": 20,
  "matched": true,
  "observed": [{ "metric": "foir.ratio", "value": 0.4 }],
}
```

An auditor — or a borrower's lawyer — can replay the score end-to-end.
No feature importance charts, no model cards, no "the algorithm says so".

## What this is not

- **Not calibrated.** The shipped `scorecards/reference.json` is a
  conservative _format example_ — weights are illustrative. Your risk
  team must set weights and validate against your own portfolio before
  any production use.
- **Not a decision engine.** A Panini scorecard is a transparent input
  to your credit policy. Approvals/denials are your regulated decision.
- **Not predictive by construction.** Rules express policy ("FOIR ≤ 50%
  earns points"), not learned correlations. That is a feature: the card
  is fully explainable, fully reviewable, and fully yours.
