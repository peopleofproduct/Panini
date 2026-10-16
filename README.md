# Project Panini

An open-core, deterministic financial transaction normalization engine for the
Indian FinTech ecosystem. Named after Acharya Pāṇini, it treats chaotic banking
data (SMS alerts, statement narrations, Account Aggregator payloads) as a
structured language grammar and compiles it into clean, typed JSON.

## Design principles

- **Zero runtime dependencies.** The parsing core is pure TypeScript —
  deterministic regex grammars and tokenizers only. No network calls, no
  telemetry, no ML models. Safe to embed in an on-prem or sandboxed server.
- **Rules are data, not code.** Bank-specific grammars live in standalone JSON
  files in `@panini/rules-engine`. You can add or tweak a bank's narration
  layout without touching the parser.
- **Strictly typed.** Strict TypeScript throughout; no `any`.

## Packages

| Package | Purpose |
| --- | --- |
| `@panini/core` | Deterministic tokenizer + grammar-driven normalizer |
| `@panini/rules-engine` | JSON grammar sets for Indian banks (SBI, HDFC, ICICI, generic) + loader |
| `@panini/standards-schema` | Validation schemas mirroring Account Aggregator / OCEN-style payloads |

## Quick start

```ts
import { Normalizer } from '@panini/core';
import { loadBuiltinRuleSets, loadCategories } from '@panini/rules-engine';

const normalizer = new Normalizer({
  ruleSets: loadBuiltinRuleSets(),
  categories: loadCategories(),
});

const txn = normalizer.normalize('UPI-SWIGGY-826384@okaxis-20261015-REV-DEBIT');
// {
//   channel: 'UPI',
//   counterparty: 'Swiggy',
//   transactionId: '826384',
//   vpaHandle: 'okaxis',
//   type: 'DEBIT',
//   category: 'Food & Dining',
//   ...
// }
```

## Development

```bash
npm install
npm run build   # tsc -b (project references)
npm test        # jest
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
