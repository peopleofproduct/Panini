# Panini (`@paniniapi/core`)

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](./tsconfig.base.json)
[![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](./package.json)
[![Tests](https://img.shields.io/badge/tests-295%20passing-brightgreen)](#-development)
[![Maintained by People of Product™](https://img.shields.io/badge/maintained%20by-People%20of%20Product%E2%84%A2-orange)](#-maintained-by-people-of-product)

> **The First Grammatical Open-Finance Orchestration Core for India's Digital Public Infrastructure (DPI).**

Named after Acharya Pāṇini — the ancient architect of formal rule-based grammar — **Panini** is a zero-runtime-dependency TypeScript engine built to parse, structure, and normalize chaotic financial data ecosystems. It is a **fully free and open-source** local sandbox for processing **ReBIT v2.0 Account Aggregator payload schemas** and **OCEN 4.0 lending networks**, shipped with framework-neutral ops extensions for teams self-hosting at scale.

> Just as Pāṇini's Aṣṭādhyāyī reduced a language to deterministic rules ~2500 years ago, Panini treats bank narrations as a grammar — not an AI problem. Fully free under Apache-2.0, forever.

---

---

## 🏗️ Core Architecture & Operational Topology

The platform isolates the parsing core from the optional self-hosted ops layer (rate limiting, metering, telemetry) to guarantee absolute privacy data sandboxing — everything is free and runs in memory on your host.

```
                 ┌─────────────────────────────────────────────────────┐
                 │                Client / Host Server                 │
                 │                                                     │
   statements ──►│  @paniniapi/extract  (CSV · XLSX · PDF · SMS · OCR)  │
                 │                       │                             │
   narrations ──►│  @paniniapi/rules-engine ──► @paniniapi/core         │
   AA payloads ─►│     (JSON grammars)          (Normalizer)            │
                 │            │                                        │
                 │            ▼                                        │
                 │     NormalizedTransaction / AAProfile               │
                 │            │                                        │
                 │            ▼                                        │
                 │  @paniniapi/standards-schema  (ReBIT / OCEN)         │
                 └───────────┬─────────────────────────────────────────┘
                             │  (optional, self-hosted ops layer)
                 ┌───────────▼────────────────────────────────────┐
                 │  OpsProxy + HTTP adapter                        │
                 │  rate-limit • usage meter • opt-in telemetry    │
                 │  (PII-free by construction — no raw narrations) │
                 └────────────────────────────────────────────────┘
```

| Package                       | Role                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@paniniapi/core`             | Deterministic tokenizer + grammar-driven normalizer; optional self-hosted ops layer (rate limiting, metering, HTTP adapter).                                                                                                                                                                                                                                                                                                            |
| `@paniniapi/rules-engine`     | Community-extendable JSON grammars — 13 Indian banks + wallet formats + generic archetypes — plus entity dictionaries (merchants, 90+ UPI handles, IFSC→bank) and a corpus coverage gate.                                                                                                                                                                                                                                               |
| `@paniniapi/standards-schema` | Zero-dependency validators for ReBIT v2.0 AA payloads (full FI-type matrix + consent request/artefact), the complete ONDC action surface (envelope, FIS search, catalog, order lifecycle, track/cancel/update), and OCEN 4.0 loan lifecycle (13-state status, disbursement, repayment schedule, eNACH, RBI KFS).                                                                                                                        |
| `@paniniapi/extract`          | Statement extraction — data-driven CSV/Excel layouts (15 banks + generic), **password-protected PDF unlock** (RC4/AES Standard handler, per-bank password patterns), PDF text-layer parsing, bank SMS alerts, and pluggable XLSX/OCR provider seams.                                                                                                                                                                                    |
| `@paniniapi/insights`         | Deterministic credit-relevant analytics — income/salary detection, recurring obligations, EMI, FOIR, cash-flow summaries, and bounce/round-trip/self-transfer risk signals. Explainable: every claim carries a rule ID + evidence indices.                                                                                                                                                                                              |
| `@paniniapi/simulator`        | Generative sandbox producing seeded, anomaly-injected ReBIT payloads **and bank-layout statement files** — feeds the extraction round-trip corpus gate.                                                                                                                                                                                                                                                                                 |
| `@paniniapi/fiu-client`       | Open FIU client for the AA ecosystem — consent lifecycle, X25519/ECDH ephemeral key exchange, AES-256-GCM FI decryption per the ReBIT spec (Rahasya-compatible), JWS artefact verification, **multi-AA orchestration** (community AA directory, handle→AA routing, bounded parallel fan-out), injectable transport. Zero deps; no implicit network calls. See [`docs/fiu-sandbox-certification.md`](docs/fiu-sandbox-certification.md). |
| `@paniniapi/bsa`              | BSA-in-a-box — statement files in, report out: extraction → narration enrichment → insights → deterministic JSON + Markdown report. Includes the `panini-bsa` CLI.                                                                                                                                                                                                                                                                      |
| `@paniniapi/browser`          | Self-contained browser/edge bundles (ESM, CJS, IIFE) — narration parsing, CSV/SMS extraction and insights with all grammar/dictionary data inlined. Zero `node:` imports; nothing leaves the page.                                                                                                                                                                                                                                      |
| `panini-py/`                  | Python port sharing the same grammar JSONs, extraction formats, and corpus — conformance-gated against the TypeScript corpus.                                                                                                                                                                                                                                                                                                           |
| `playground/`                 | Self-contained browser playground (zero network calls) + `npm run parse` CLI.                                                                                                                                                                                                                                                                                                                                                           |

## ✨ Design Guarantees

- **Zero runtime dependencies.** The parsing core is pure TypeScript — deterministic regex grammars and tokenizers only. No network calls, no ML models, no phone-home telemetry. Safe to embed inside on-prem or sandboxed environments.
- **Rules are data, not code.** Bank-specific grammars live in standalone JSON files loaded at runtime; updating a bank's narration layout never requires touching the TypeScript engine.
- **Strictly typed.** Strict TypeScript throughout — no `any`, `unknown` at external boundaries, `exactOptionalPropertyTypes` enabled.
- **PII isolation.** The optional telemetry channel is opt-in only and its event type has _structurally no field_ for raw narrations, counterparties, references, VPAs, or amounts.

## 🚀 Quick Start

```bash
npm install
npm run build   # tsc -b (project references)
npm test        # jest — 329 tests across 22 suites
```

### Parse a narration

```ts
import { parseBankNarration } from '@paniniapi/rules-engine';

parseBankNarration('NEFT-N3452618902-SALARY-OCTOBER 2026-TCS LTD');
// {
//   channel: 'NEFT',
//   type: 'CREDIT',
//   ref_no: 'N3452618902',
//   counterparty: 'TCS Ltd',
//   is_salary: true,
//   category: 'Income',
//   ...
// }

parseBankNarration('UPI/20261015/DR/826384910234/SWIGGY@okaxis/Cooking/');
// {
//   channel: 'UPI',
//   type: 'DEBIT',
//   merchant: 'Swiggy',           // dictionary-canonicalised
//   counterparty: 'Swiggy',
//   vpa: 'okaxis',
//   vpa_app: 'Google Pay',        // enrichment: PSP app behind the handle
//   vpa_bank: 'Axis Bank',        // enrichment: sponsor bank
//   merchant_canonical: 'Swiggy',
//   category: 'Food & Dining',
//   confidence: 0.95,
//   ...
// }
```

Or use the raw engine for custom grammars:

```ts
import { Normalizer } from '@paniniapi/core';
import { loadBuiltinRuleSets, loadCategories } from '@paniniapi/rules-engine';

const normalizer = new Normalizer({
  ruleSets: loadBuiltinRuleSets(),
  categories: loadCategories(),
});
normalizer.normalize('UPI-SWIGGY-826384@okaxis-20261015-REV-DEBIT');
```

### Extract transactions from a statement

```ts
import { extractStatement } from '@paniniapi/extract';

const statement = await extractStatement(csvText); // or PDF bytes, XLSX, SMS
// {
//   format: 'csv', bank: 'HDFC', layoutId: 'hdfc_statement',
//   accountMask: '1234',
//   transactions: [
//     { date: '2026-10-15', narration: 'UPI/40234...', direction: 'DEBIT',
//       amountPaise: 125000, balancePaise: 4523050, refNo: '402345678912' },
//     ...
//   ]
// }

// Password-protected statements — pass what you know; per-bank password
// patterns (formats/pdf-passwords.json) generate the candidates:
await extractStatement(pdfBytes, {
  credentials: { dob: '15-04-1990', name: 'Kapil Sharma' }, // or { passwords: ['…'] }
});

// XLSX and scanned input go through provider seams — Panini stays
// zero-dependency; you plug in SheetJS / Tesseract / cloud OCR:
import { createSheetJsProvider, createTesseractProvider } from '@paniniapi/extract';
await extractStatement(xlsxBytes, { spreadsheet: createSheetJsProvider(XLSX) });
await extractStatement(scannedPdf, { ocr: createTesseractProvider(tesseractWorker) });
// Word-level OCR boxes keep column anchoring — same table pipeline as a
// real text layer. Flat OCR text degrades to whitespace-split rows.
```

### Credit-relevant insights

```ts
import { analyzeTransactions } from '@paniniapi/insights';

const report = analyzeTransactions(statement.transactions);
// report.income       — salary credits, employer sources, monthly average,
//                       regular/irregular consistency
// report.obligations  — recurring debits, EMI patterns, monthly obligation
// report.foir         — fixed-obligation-to-income ratio (null when income
//                       is undetected — never fabricated)
// report.cashflow     — totals, net, balance range, closing balance
// report.signals      — PANINI-RSK-* bounce / round-trip / self-transfer
//                       signals, each with evidence txn indices
```

### Validate DPI payloads

```ts
import {
  validateAAProfile,
  validateFiData,
  validateAAConsentRequest,
  validateAAConsentArtefact,
  isOCENLoanApplication,
} from '@paniniapi/standards-schema';

const result = validateAAProfile(payload); // { valid, errors[] } — zero deps
validateFiData('MUTUAL_FUNDS', mfPayload); // FI-type-aware validation
validateAAConsentRequest(consentBody); // ReBIT ConsentDetail envelope
```

### Generate sandbox traffic

```bash
npm run simulate -- --count=50 --seed=7 --anomaly-rate=0.2
npm run simulate -- --count=50 -o mocks.json --pretty
```

Streams deterministic ReBIT v2.0 FI profiles — including deliberate anomalies (truncated narrations, corrupt timestamps, dropped fields) for exercising client-side error handling.

### Try it in the playground

```bash
npm run playground          # rebuilds playground/panini-web.js
# open playground/index.html — fully static, zero network calls

npm run parse -- 'UPI/P2M/123456789012/JOHN DOE@axisb/DR'
# → channel UPI, vpa axisb → CRED / Axis Bank
```

### Python port (`panini-py/`)

The Python engine shares the **same grammar JSONs and corpus fixtures** as the
TypeScript packages — parity is enforced by the conformance suite (76/76),
not assumed:

```python
from panini import parse_narration

parse_narration('UPI/20261015/DR/826384910234/SWIGGY@okaxis/Cooking/')
# → channel UPI, type DEBIT, vpa_app 'Google Pay', vpa_bank 'Axis Bank'
```

```bash
cd panini-py && python3 -m unittest discover tests   # corpus conformance gate
```

### Entity dictionaries & corpus gate

`packages/rules-engine/rules/entities/` holds community-editable datasets —
merchant canonical names + aliases + MCC, 90+ UPI VPA handles → PSP app/sponsor bank
(PhonePe, GPay, Paytm, CRED, WhatsApp Pay, BHIM, Navi, MobiKwik, super.money,
Amazon Pay, Flipkart, bank-direct…), IFSC prefix → bank, and ISO 18245
MCC → category/description (POS narrations carrying `MCC-5411` tokens resolve
to `Groceries`, not `Uncategorized`). Ambiguous handles
are never guessed — they resolve to `null` instead of a wrong attribution.

`rules/corpus/` holds per-bank narration fixtures; `tests/corpus.test.ts`
generates one test per sample, so grammar regressions fail CI.

### Self-hostable ops layer

```ts
import { createPaniniHttpHandler, OpsProxy } from '@paniniapi/core';

app.post('/v1/parse', createPaniniHttpHandler(proxy));
// bearer token → rate-limit bucket → normalize → usage meter → JSON
```

## 🛠️ Development

```bash
npm run build          # strict project-reference build
npm test               # full monorepo suite
npm run lint           # eslint flat config
npm run format         # prettier
```

A `pre-commit` gate (`scripts/pre-commit.sh`, installed at `.git/hooks/pre-commit`) runs lint + tests before any commit finalizes.

## 🤝 Maintained by People of Product™

**Project Panini** is an open-source initiative by **[People of Product™](https://theproduct.city)** — the team behind **[Product City](https://theproduct.city)**, built to empower professionals with leading tech capabilities and to make India's open-finance infrastructure more open for everyone.

Find us:

- 🌐 Website — [theproduct.city](https://theproduct.city)
- 💼 LinkedIn — [People of Product](https://www.linkedin.com/company/people-of-product) · [Kapil (founder)](https://www.linkedin.com/in/kapil0/)
- 🐦 X — [@PeopleOfProduct](https://x.com/PeopleOfProduct) · [@product_city](https://x.com/product_city) · [@Krazzy_Bunny](https://x.com/Krazzy_Bunny)

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Panini is free forever — if it saved your team money, you can [support the maintainers](./SUPPORT.md).

Accuracy claims are public and reproducible — see [benchmarks/BENCHMARKS.md](./benchmarks/BENCHMARKS.md) (`npm run bench`).

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
