# Accountability — what Apache-2.0 means for a lending stack

Panini is Apache-2.0 open source: **no warranty, no SLA, no indemnity**.
If a misparse contributes to a bad underwriting decision, there is no
vendor contract to invoke. This document is the honest version of what
you get instead — and what you must do to deploy it responsibly.

## The shield you get is evidence, not indemnity

A vendor SLA compensates you _after_ a failure. Determinism helps you
_prove what happened_ — which is often worth more:

- **Every output is replayable.** Same input bytes → same parse, same
  insights, same scorecard result — forever, on any machine. When a
  decision is disputed, you replay it line-by-line instead of asking a
  vendor what their model did on a Tuesday.
- **Every claim carries evidence.** Insights attach `ruleId` + the exact
  transaction indices they rest on. Forensics attaches rule-Id'd
  findings with byte-level evidence. Scorecards emit a full derivation
  trace. Nothing is a black box.
- **Quality receipts are public and CI-gated.** The gold corpus,
  coverage baselines, quirk round-trips, and fuzz suites run on every
  commit — you can verify our accuracy claims yourself instead of
  trusting a sales deck.

## Panini is a decision _input_, never the decision

The same legal posture every tool in your stack already takes: like
Postgres or Excel, Panini computes facts. The credit decision — the
regulated act — belongs to your policy engine and your risk officers.
Under RBI's outsourcing and model-risk expectations, **your entity is
accountable for the model regardless of who built the parser** — a
vendor score doesn't transfer that accountability, it only feels like
it does.

## What you must do before trusting it in production

1. **Replay-validate on your own data.** Run a week of real (or
   anonymized) statements through; diff against whatever you use today.
   Determinism means any divergence you find is permanent and fixable —
   not a probabilistic shrug.
2. **Build your corpus gate.** Corpus JSON files in
   `rules/corpus/` + `panini-bsa doctor` in CI = _your_ accuracy
   contract, not ours.
3. **Gate on forensics.** Wire `inspectStatement` into intake;
   `tamper_evidence` halts auto-flow.
4. **Own the scorecard.** If you use `evaluateScorecard`, treat our
   reference card as a format example only — calibrate weights on your
   own portfolio and document your derivation (see
   [`scorecard.md`](scorecard.md)).
5. **Run the overlay drill once.** Deliberately break a format, run the
   [`rules-hotpatch.md`](rules-hotpatch.md) playbook end-to-end. The
   team that has done it once does it in minutes during a real incident.

## Honest residual risk

- A grammar bug can misparse — like any parser. The mitigations are
  detection (drift kit), fast repair (overlays), and evidence (every
  output names the rule that produced it).
- No insures you. If your policy requires contractual indemnity, Panini
  alone doesn't satisfy it — that is a real constraint, stated plainly.
  Many deployments pair Panini with their own QA gates precisely because
  the evidence trail makes _internal_ accountability workable.
