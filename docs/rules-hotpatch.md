# The 2 AM Playbook — grammar drift response

Banks change narration formats without notice. A deterministic parser's
honest answer to "what happens then?" is this document: **detect loudly,
diagnose in minutes, patch with one JSON file, upstream permanently.**

## 1. Detect — never silently mis-parse

Wire `analyzeNarrationBatch` into your ingest path (or run the doctor CLI
on batches):

```ts
import { analyzeNarrationBatch } from '@paniniapi/rules-engine';

const report = analyzeNarrationBatch(todaysNarrations, { bankHint: 'HDFC' });
if (report.drift) {
  alertOps(report.warnings); // match rate dropped >20pp below corpus baseline
}
```

`report.drift` fires when the observed `matched_rule` rate falls below the
bank's corpus baseline (corpus = the per-bank verified samples in
`rules/corpus/`). `unmatchedClusters` groups every failure by token
skeleton so you see the new shape, not 10,000 raw strings.

For extraction-level drift (bank changed CSV/PDF column headers):
`ExtractedStatement.warnings` already carries `no layout matched` and
`bank`/`layoutId` metadata — alert when a previously-detected bank starts
returning `layoutId: null`.

## 2. Diagnose — `panini-bsa doctor`

```bash
npx panini-bsa doctor todays-narrations.txt --bank HDFC
# narrations: 12841
# rule-matched: 78.2%  (baseline 100%)
# ⚠ match rate 78.2% is 22pp below the HDFC corpus baseline — ...
#
# unmatched clusters (1):
#   UPI-N-STAR-*-N  ×2731
#     UPI-123456789012-STAR-BHIM-SOMENAME-...
#   → draft rule: ^UPI[-/: ]\d{9,12}[-/: ]STAR[-/: ](?<counterparty>…)...
#   → draft matches all samples and flips zero corpus expectations
```

The draft rule is machine-generated and corpus-self-tested: Panini runs
every verified corpus sample through the engine _with the draft injected_
and counts expectation flips. `safe: true` means merging it regresses
nothing known. `corpusImpact > 0` means it would shadow an existing
format — narrow it first.

## 3. Patch — no redeploy required

Grammar rules are JSON data, not compiled code. Every entry point accepts
a caller-supplied rules directory:

```bash
mkdir /etc/panini-rules
cat > /etc/panini-rules/hdfc-2026-oct.json <<'JSON'
{ "id": "hdfc-hotfix", "bank": "HDFC", "version": "2026.10.19",
  "patterns": [ /* paste the doctor draft here */ ] }
JSON
```

```ts
import { loadRuleSets } from '@paniniapi/rules-engine';
const ruleSets = loadRuleSets('/etc/panini-rules'); // overlays bundled rules
parseBankNarration(text, { ruleSets });
```

Restart the process — new format parses. Total outage: one JSON file + a
restart, measured in minutes, no dependency bumps, no redeploy of the
engine itself.

## 4. Upstream — make it permanent for everyone

Open a PR adding the pattern to `rules/<bank>.json` plus a corpus sample
in `rules/corpus/<bank>.json`. The corpus ratchet in CI then guarantees
the bank's new format can never regress for any Panini user. The issue
template `.github/ISSUE_TEMPLATE/bank_grammar_request.yml` has the shape.

## Why this beats "the vendor's engineer fixes it in an hour"

The vendor's hour is opaque — you file a ticket and wait. Here the fix is
a data file you can write yourself in minutes, the detector tells you
_exactly_ which narrations broke, and the suggester hands you a
corpus-verified draft. No vendor lock-in, no waiting on someone else's
on-call rotation — and when you upstream it, every deployment benefits.
