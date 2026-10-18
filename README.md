# Panini — the open financial-data layer for India's DPI

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](./tsconfig.base.json)
[![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](./package.json)
[![Tests](https://img.shields.io/badge/tests-530%2B%20passing-brightgreen)](#-development)
[![Maintained by People of Product™](https://img.shields.io/badge/maintained%20by-People%20of%20Product%E2%84%A2-orange)](#-maintained-by-people-of-product)

> **Bank statements in — credit decisions out. Free, deterministic, and it never phones home.**

Named after Acharya Pāṇini — the ancient architect of formal rule-based grammar — **Panini** is a zero-runtime-dependency TypeScript + Python engine that does what Indian fintechs currently pay vendors per-call for:

- **Extract** messy bank statements — CSV, Excel, password-protected PDFs, SMS alerts, pluggable OCR
- **Normalize** every narration through community-editable grammar rules — 15 bank layouts, UPI/IMPS/NEFT/RTGS/ATM/POS/wallets, merchants, IFSC, VPA handles
- **Analyze** deterministically — income, obligations, EMI, FOIR, cash flow, trends, bounce/round-trip/self-transfer risk signals — every claim carrying a rule ID + evidence
- **Flag fraud** — the industry-standard indicator suite (circular flows, holiday cash deposits, RTGS-threshold gaming, round-figure clusters, gap months, salary anomalies, overdrawn days) plus **multi-account consolidation**: own-account transfers netted, A→B→A rotation cycles, inflated-turnover share. See [`docs/fraud-indicators.md`](docs/fraud-indicators.md)
- **Validate** against India's open-finance standards — the only public free validators for ReBIT AA payloads, the complete ONDC action surface, and the OCEN 4.0 loan lifecycle
- **Speak the AA protocol itself** — consent lifecycle, Rahasya-compatible X25519/HKDF/AES-256-GCM decryption, and multi-AA orchestration (handle→AA routing, bounded parallel fan-out) in ~600 auditable lines
- **Run anywhere** — server, edge, or entirely inside the browser: statement → BSA report with zero network calls

> Just as Pāṇini's Aṣṭādhyāyī reduced a language to deterministic rules ~2500 years ago, Panini treats bank narrations as a grammar — not an AI problem. Fully free under Apache-2.0, forever.

---

---

## 🏗️ Core Architecture & Operational Topology

The platform isolates the parsing core from the optional self-hosted ops layer (rate limiting, metering, telemetry) to guarantee absolute privacy data sandboxing — everything is free and runs in memory on your host.

```
                 ┌─────────────────────────────────────────────────────┐
                 │                Client / Host Server / Browser        │
                 │                                                     │
   statements ──►│  @paniniapi/extract  (CSV · XLSX · PDF · SMS · OCR)  │
                 │                       │                             │
   narrations ──►│  @paniniapi/rules-engine ──► @paniniapi/core         │
   AA payloads ─►│     (JSON grammars)          (Normalizer)            │
                 │            │                                        │
                 │            ▼                                        │
                 │     NormalizedTransaction / AAProfile               │
                 │            │                                        │
                 │            ├──────────────► @paniniapi/insights      │
                 │            │     (income · FOIR · trends · signals)  │
                 │            │                                        │
                 │            ▼                                        │
                 │  @paniniapi/standards-schema (ReBIT · ONDC · OCEN)   │
                 │                                                     │
   AA consent ──►│  @paniniapi/fiu-client (consent→decrypt, multi-AA)   │
   files ───────►│  @paniniapi/bsa  (statement files → BSA report)      │
   browser ─────►│  @paniniapi/browser (ESM/CJS/IIFE, all data inlined) │
                 └───────────┬─────────────────────────────────────────┘
                             │  (optional, self-hosted ops layer)
                 ┌───────────▼────────────────────────────────────┐
                 │  OpsProxy + HTTP adapter                        │
                 │  rate-limit • usage meter • opt-in telemetry    │
                 │  (PII-free by construction — no raw narrations) │
                 └────────────────────────────────────────────────┘
```

| Package                       | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@paniniapi/core`             | Deterministic tokenizer + grammar-driven normalizer; optional self-hosted ops layer (rate limiting, metering, HTTP adapter).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `@paniniapi/rules-engine`     | Community-extendable JSON grammars — 14 Indian banks + wallet formats + generic archetypes — plus entity dictionaries (merchants, 90+ UPI handles, IFSC→bank) and a corpus coverage gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@paniniapi/standards-schema` | Zero-dependency validators for ReBIT v2.0 AA payloads (full FI-type matrix + consent request/artefact), the complete ONDC action surface (envelope, FIS search, catalog, order lifecycle, track/cancel/update), and OCEN 4.0 loan lifecycle (13-state status, disbursement, repayment schedule, eNACH, RBI KFS).                                                                                                                                                                                                                                                                                                                                                   |
| `@paniniapi/extract`          | Statement extraction — data-driven CSV/Excel layouts (17 banks + generic, [`docs/bank-coverage.md`](docs/bank-coverage.md)), bank-name sniffing across ~125 banks (PSBs, SFBs, payments banks, co-ops, RRBs, foreign banks with India ops), **credit-card + PhonePe UPI-app statements**, caller-extensible `extraFormatsDir`, **native zero-dependency XLSX reader** (ZIP+XML internally, date serials → ISO), **password-protected PDF unlock** (RC4/AES Standard handler, per-bank password patterns), PDF text-layer parsing, bank SMS alerts, and a pluggable OCR provider seam.                                                                              |
| `@paniniapi/insights`         | Deterministic credit-relevant analytics — income/salary detection, recurring obligations, EMI, FOIR, cash-flow summaries, bounce/round-trip/self-transfer risk signals, a **13-rule fraud-indicator suite** + **multi-account consolidation** (internal-transfer netting, A→B→A cycles, inflated turnover — see [`docs/fraud-indicators.md`](docs/fraud-indicators.md)), explainable `evaluateScorecard` scaffold, and a **recurring-monitoring kernel** (`statementDiff`, `detectMonitoringEvents`, `runMonitorCycle` — [`docs/monitoring.md`](docs/monitoring.md)). Every claim carries a rule ID + evidence indices.                                            |
| `@paniniapi/simulator`        | Generative sandbox producing seeded, anomaly-injected ReBIT payloads **and bank-layout statement files** — feeds the extraction round-trip corpus gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@paniniapi/fiu-client`       | Open FIU client for the AA ecosystem — consent lifecycle (build/parse/track — `consentStatus` + `sweepConsents` over a caller-owned store), X25519/ECDH ephemeral key exchange, AES-256-GCM FI decryption per the ReBIT spec (Rahasya-compatible), JWS artefact verification, **multi-AA orchestration** (community AA directory, handle→AA routing, bounded parallel fan-out), injectable transport. Zero deps; no implicit network calls. See [`docs/fiu-sandbox-certification.md`](docs/fiu-sandbox-certification.md).                                                                                                                                          |
| `@paniniapi/forensics`        | Deterministic document-integrity forensics — running-balance chain verification (one edited amount breaks every link), opening/closing reconciliation, PDF structural signals (incremental updates, editor producers, invisible/overlaid text), **full CMS/PKCS#7 signature validation** with caller trust stores, and **AA ↔ document reconciliation** (`reconcileWithAa` — diffs a claimed statement against the bank's own AA feed; fabricated or omitted rows are evidence-listed). Explainable signals, never a black-box score. See [`docs/statement-integrity.md`](docs/statement-integrity.md) + [`docs/aa-reconciliation.md`](docs/aa-reconciliation.md). |
| `@paniniapi/bsa`              | BSA-in-a-box — statement files in, report out: extraction → narration enrichment → insights → deterministic JSON + Markdown report with per-file integrity verdicts. Includes the `panini-bsa` CLI (exits `3` on tamper evidence).                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@paniniapi/browser`          | Self-contained browser/edge bundles (ESM, CJS, IIFE) — narration parsing, CSV/SMS extraction and insights with all grammar/dictionary data inlined. Zero `node:` imports; nothing leaves the page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `panini-py/`                  | Python port sharing the same grammar JSONs, extraction formats, and corpus — conformance-gated against the TypeScript corpus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `playground/`                 | Self-contained browser playground (zero network calls) + `npm run parse` CLI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## ✨ Design Guarantees

- **Zero runtime dependencies.** The parsing core is pure TypeScript — deterministic regex grammars and tokenizers only. No network calls, no ML models, no phone-home telemetry. Safe to embed inside on-prem or sandboxed environments.
- **Rules are data, not code.** Bank-specific grammars live in standalone JSON files loaded at runtime; updating a bank's narration layout never requires touching the TypeScript engine.
- **Strictly typed.** Strict TypeScript throughout — no `any`, `unknown` at external boundaries, `exactOptionalPropertyTypes` enabled.
- **PII isolation.** The optional telemetry channel is opt-in only and its event type has _structurally no field_ for raw narrations, counterparties, references, VPAs, or amounts.

## � Security, Privacy & DPDP

Panini is architected so that **sensitive financial data never has to leave your boundary** — and that isn't a privacy policy promise, it's a code property:

- **Zero network calls, anywhere in the stack.** No `fetch`/`axios`/socket in any library code path — the FIU client's transport is _injected by you_, so every outbound call is one you wrote. A `grep -r "fetch\|http" packages/*/src` is an audit a security team can run in a minute.
- **Zero runtime dependencies → near-zero supply-chain surface.** No third-party code executes on your data. Every line that touches a bank statement is in this repo, in the open.
- **In-memory only.** No writes to disk, no caching, no logging of payloads — statement bytes live and die inside your process. The browser bundle literally cannot persist or transmit anything.
- **Deterministic + auditable.** Same input → same output, always. Every extracted field and every credit-relevant claim carries a rule ID and evidence indices — an auditor can replay _how_ a conclusion was reached, not just what it was.
- **Secrets stay out.** The AA directory ships endpoints, never credentials. The sandbox-certification runbook reads everything from environment variables; there is nothing to leak.

### Why this matters under DPDP 2023

India's Digital Personal Data Protection Act makes the _processor_ question expensive: any vendor that touches a bank statement on your behalf sits inside your compliance perimeter — data-processing agreements, purpose-limitation audits, breach-notification chains, cross-border transfer reviews. **A library you run yourself is not a processor.** Panini keeps the entire statement→insight pipeline inside your own infrastructure, so the vendor-data-processing surface simply doesn't exist. For FIUs — entities already carrying fiduciary-grade obligations over AA data — this is not a nice-to-have: it's the difference between "we vetted our vendor" and "there is no vendor."

### What FIUs get beyond the price

- **Full customization ownership.** Grammar rules, dictionaries, AA directory entries, schema validators — all editable JSON/TS in your fork. When a bank changes a narration format, _you_ fix it in 20 minutes instead of filing a vendor ticket and waiting a sprint.
- **Contribution flywheel.** Grammars and layouts you contribute back are maintained by the community forever — a bug fixed by one FIU benefits every FIU. This is how public infrastructure gets better: shared maintenance instead of per-vendor SLAs.
- **No renegotiation cliff.** Per-call pricing punishes growth; a library's cost curve is flat at any volume. Scale your consent volume 10× — your parsing cost stays ₹0.

### Honest limits — read before you deploy

- **Scoring**: Panini emits evidence-backed facts and a transparent, JSON-declared scorecard engine — **not** a calibrated credit score. Your risk team owns the model (which RBI accountability rules require anyway). See [docs/scorecard.md](docs/scorecard.md).
- **Operations**: it's a pinned library, not a fork you maintain — but grammar vigilance is real. The cost answer and ops checklist live in [docs/operating-panini.md](docs/operating-panini.md).
- **Liability**: Apache-2.0 — no SLA, no indemnity. The shield is auditability: replayable decisions, evidence on every claim, public CI-gated quality receipts. Deployment checklist: [docs/accountability.md](docs/accountability.md).

```bash
npm install
npm run build   # tsc -b (project references)
npm test        # jest — 662 tests across 35 suites
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
//   category_id: 'food_dining',      // stable taxonomy id
//   category_group: 'Essentials',    // taxonomy rollup group
//   category_source: 'keyword',      // grammar | keyword | merchant | mcc | none
//   counterparty_kind: 'merchant',   // merchant | self | unknown
//   ref_kind: 'rrn',                 // utr | rrn | cheque | ref | none
//   schema_version: 2,
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

// XLSX works out of the box — a zero-dependency reader parses
// workbook/sharedStrings/styles internally (date serials → ISO dates).
// Corrupt or non-workbook archives degrade to warnings, never throws:
await extractStatement(xlsxBytes);

// You can still plug in SheetJS/exceljs via the provider seam if you
// need caller-controlled parsing, and scanned input uses the OCR seam:
import { createSheetJsProvider, createTesseractProvider } from '@paniniapi/extract';
await extractStatement(xlsxBytes, { spreadsheet: createSheetJsProvider(XLSX) });
await extractStatement(scannedPdf, { ocr: createTesseractProvider(tesseractWorker) });
// Word-level OCR boxes keep column anchoring — same table pipeline as a
// real text layer. Flat OCR text degrades to whitespace-split rows.

// For scans too degraded for one engine, the router escalates across
// tiers — local OCR → on-prem open-weight VLM → queue-priced batch TSP —
// and every result must pass verifyStatement's deterministic arithmetic
// gate (balance-chain, opening→closing reconciliation). Optional dual-
// engine consensus flags the exact cells two engines disagree on.
// See docs/ocr-playbook.md — "any eyes, proven numbers".
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
TypeScript packages — parity is enforced by the conformance suite (84/84),
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

When a bank changes its narration format overnight, you do not have to
redeploy the engine: `analyzeNarrationBatch` compares a live batch against
the corpus baseline (`drift: true` on collapse), `panini-bsa doctor`
prints the unmatched shapes plus corpus-tested draft rules, and a hotfix
is one JSON file in a `loadRuleSets(dir)` overlay directory. The full
playbook is [`docs/rules-hotpatch.md`](docs/rules-hotpatch.md).

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
