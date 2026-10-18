# OCR playbook — degraded scans without a vendor lock

> Audience: lenders / NBFCs integrating Panini who must handle scanned
> statements that native text extraction cannot read.

## The proposition: any eyes, proven numbers

Every commercial vendor asks you to trust their OCR engine's output.
Panini inverts the relationship: **you bring whatever engine you can
afford or are allowed to run; Panini proves or rejects the numbers.**

OCR and vision-model output never reaches underwriting directly. It
re-enters the same deterministic pipeline — line grouping, table
reconstruction, layout grammars — and must pass `verifyStatement`, a
deterministic arithmetic gate:

| Check                   | What it catches                               |
| ----------------------- | --------------------------------------------- |
| `verify.balance_chain`  | Running balance must move by the row's amount |
| `verify.reconciliation` | Opening → closing must match net of rows      |
| `verify.bad_date`       | Unparseable / malformed dates                 |
| `verify.low_parse_rate` | Rows lacking amount+direction beyond 50%      |

A hallucinated or misread row _breaks the chain_ — it is flagged, not
silently underwritten. The gate does **not** prove a document is
authentic (a fraudster can fabricate a self-consistent table; that is
what `@paniniapi/forensics` and AA-sourced data are for). It proves the
extraction is _internally consistent_.

## Architecture

```
page images (caller renders: pdf.js / mupdf / poppler)
        │
        ▼
extractWithRouter(pages, { tiers })
        │
        ├─ tier 1  ocr:    Tesseract / cloud OCR        (cheapest)
        ├─ tier 2  vision: local open-weight VLM        (on-prem)
        └─ tier 3  queue:  submit→poll batch TSP        (reduced pricing)
        │
        ▼  first tier whose result passes verifyStatement wins
RoutedExtraction { statement, engine, verdict, attempts[] }
```

- **Tiers are caller-configured.** Nothing is bundled — no model weights,
  no rasterizer, no HTTP client. Heavy dependencies stay caller-owned
  (the zero-dependency invariant).
- **Every result is provenance-labeled**: `extractionEngine`,
  `ocrProvider`, `visionModel`, `extractionVerdict`, and
  `extractionVerifyScore` land in `statement.metadata`, so reports say
  _which eyes_ read the page and _how well_ the numbers held.
- **Failure is isolated**: a throwing engine becomes an attempt record,
  not a crashed pipeline.

## Tier guide

### Tier 1 — classic OCR (`OcrProvider`)

```ts
import { createWorker } from 'tesseract.js';
import { createTesseractProvider } from '@paniniapi/extract';

const worker = await createWorker('eng');
const tier = { kind: 'ocr' as const, provider: createTesseractProvider(worker) };
```

Cheap and local. Word boxes preserve column anchoring. Weakness: very
degraded scans produce garbage text the verify gate then rejects —
which is the router's cue to escalate.

### Tier 2 — local open-weight VLM (`VisionProvider`)

```ts
import { createOpenAiVisionProvider } from '@paniniapi/extract';

const tier = {
  kind: 'vision' as const,
  provider: createOpenAiVisionProvider({
    baseUrl: 'http://localhost:11434', // Ollama / vLLM on-prem
    model: 'qwen2.5-vl:7b',
    fetchImpl: fetch, // caller-owned transport
  }),
};
```

- Any OpenAI-compatible chat/completions endpoint works — Ollama, vLLM,
  llama.cpp. Nothing leaves your network when the endpoint is on-prem,
  so the zero-egress posture survives.
- Requests are sent with `temperature: 0`.
- Model responses are schema-checked (JSON row arrays or an error);
  malformed output fails the tier.
- `retainRawResponse` is off by default — raw model output may carry
  narration PII.

### Tier 3 — queue-priced batch TSP (`QueueOcrProvider`)

```ts
import { createHttpQueueProvider } from '@paniniapi/extract';

const tier = {
  kind: 'queue' as const,
  provider: createHttpQueueProvider({
    submitUrl: 'https://tsp.example/v1/jobs',
    pollUrl: 'https://tsp.example/v1/jobs',
    fetchImpl: fetch,
    headers: { authorization: 'Bearer …' },
  }),
};
```

Batch/async OCR APIs are typically 5–10× cheaper than synchronous
calls — the cost-arbitrage path for overnight underwriting batches.
`maxPolls` and `pollIntervalMs` bound the wait; a timed-out job fails
its tier, not the document.

> **Privacy note**: hosted tiers send page images outside your stack —
> DPDP obligations apply. Keep tiers 1–2 first in the order; treat
> hosted tiers as an explicit, opted-in escalation.

## Dual-engine consensus

Two independent engines cannot hallucinate the _same_ wrong number.
Run a second engine in parallel and field-compare:

```ts
import { consensusWithVerification } from '@paniniapi/extract';

const r = consensusWithVerification(statementA, statementB, 'engine-b');
// r.verdict: 'agree' | 'partial' | 'disagree' | 'incomparable'
// r.disagreements: [{ row, field, primary, secondary }] — exact cells
```

- `agree` → accept; the provenance record names both engines.
- `partial` → the differing cells land in warnings as an evidence list
  for human review (`"row 4 balancePaise: '115000' vs '110000'"`).
- `disagree` / `incomparable` → escalate; do not underwrite.

This is the check that makes Tier-2 VLMs _safe_: a single model's
confident hallucination dies against a second engine, and what survives
still must pass the arithmetic gate.

## Router policy

```ts
const out = await extractWithRouter(pages, {
  tiers: [tier1, tier2, tier3],
  minVerifyScore: 0.85, // acceptance threshold (default 0.85)
  minProviderConfidence: 0.7, // optional self-report floor
  pollIntervalMs: 2000, // queue pacing
  maxPolls: 60,
  bankHint: 'hdfc', // layout steering, as usual
});

// out.verdict: 'verified' | 'degraded' | 'failed'
// out.attempts: per-engine { verifyScore, issues } audit trail
```

`degraded` means every engine ran but none passed the gate — the
statement is returned (marked, with the full attempt trail) so a human
can review rather than the document vanishing. `failed` means nothing
extracted at all. Only `verified` results should flow into automated
underwriting.

## Honest limits

- Panini does not ship an OCR model — the vision of "solves 100% of
  degraded scans" depends on the engine the caller plugs in. What Panini
  guarantees is that whatever comes out is **proven against arithmetic,
  cross-checked when consensus is enabled, and fully provenance-labeled**.
- The verify gate catches _internal inconsistency_, not sophisticated
  fabrication — pair with `@paniniapi/forensics` and prefer AA-sourced
  data where possible.
- No labeled public corpus of degraded Indian bank scans exists yet;
  quality claims per engine remain the caller's to measure (track
  `extractionVerifyScore` + `consensusVerdict` rates in production —
  that telemetry _is_ your corpus).
