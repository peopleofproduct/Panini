# Operating Panini — the honest TCO picture

"Free library, but you'll spend the savings on a backend developer
maintaining a fork" — the most common objection to self-hosted parsing.
Here is what Panini actually costs to run, and why that objection
doesn't survive contact with the architecture.

## You don't maintain a fork. You pin a dependency.

```jsonc
"dependencies": {
  "@paniniapi/extract": "0.2.3",
  "@paniniapi/rules-engine": "0.2.3"
}
```

Panini is a zero-dependency, in-memory library — not a service you host.
There is no database, no queue, no JVM, no licence server. Production
operation is the same lifecycle as `lodash` or `zod`: pin a version,
upgrade deliberately, let CI prove nothing regressed.

## What maintenance actually looks like

| Event                                         | Vendor path                                       | Panini path                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Bank changes narration format**             | Support ticket → vendor's sprint → days/weeks     | `panini-bsa doctor` flags it in your CI/cron → JSON overlay rule → minutes. Playbook: [`rules-hotpatch.md`](rules-hotpatch.md) |
| **Library upgrade**                           | Coordinated migration window                      | `npm update` + your test suite                                                                                                 |
| **New bank format needed**                    | "Is it in our 4,000-format library?" → sales call | One layout JSON + one corpus sample → PR or local file                                                                         |
| **Suspicious statement in underwriting**      | Vendor's black-box fraud flag                     | `@paniniapi/forensics` → explainable evidence                                                                                  |
| **Audit asks "why was this categorized so?"** | "Trust the vendor"                                | `category_source` + `matched_rule` fields replay the exact rule                                                                |

## Honest cost accounting

Real maintenance tasks and their true weight:

- **Dependency upgrades** — like any npm package. Minutes per quarter.
- **Grammar vigilance** — banks change formats. `analyzeNarrationBatch`
  in a scheduled job surfaces it before your ops team does.
- **Your own corpus** — the highest-value ongoing investment: collect
  ~20 anonymized narrations per bank you care about, drop them into a
  corpus JSON, and `panini-bsa doctor` + CI keep you green forever.
- **No infra** — nothing to monitor, scale, or patch. It runs inside
  your existing process.

Honest total: **hours per quarter of a developer you already employ** —
versus ₹49/statement (the cheapest published BSA floor) at, say, 5,000
statements/month = ₹2.45 lakh/month, or quote-priced enterprise tiers
materially above that. The "you need a backend dev" objection assumes
maintenance is a full-time job; it isn't — and even a full-time engineer
is cheaper than vendor fees at meaningful volume.

## Operational checklist

1. **Pin versions** — treat Panini like crypto: upgrade on your schedule.
2. **Your corpus in CI** — 10–20 real (anonymized) narrations per bank
   you underwrite; `checkSample`-style expectations catch regressions
   _and_ vendor-independent proof of accuracy.
3. **`panini-bsa doctor` on a schedule** — drift detection before users
   report it; exit code 1 = page someone.
4. **Forensics on every underwritten file** — `inspectStatement` first;
   `tamper_evidence` → manual review, never auto-approve.
5. **Overlay directory** — an ops-writable `rules/` dir wired into
   `loadRuleSets(dir)` so hotfixes don't need a deploy.

## The real question to ask vendors instead

"Can I replay a decision from six months ago and prove exactly which
rule produced it?" Panini can. A hosted ML pipeline generally cannot —
and that property is worth more than an SLA clause when the audit comes.
