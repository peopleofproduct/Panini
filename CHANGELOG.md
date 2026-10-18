# Changelog

All notable changes to Project Panini are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2] — 2026-10-18 — Phase 0 defect sweep (extraction + narration)

### Added

- **`@paniniapi/rules-engine` (0.2.2)** — three new grammar patterns:
  `upi_slashed_payment_remark` and `upi_slashed_name_vpa` for the
  `UPI/RRN/remark-or-name/user@handle/bank` shape (the VPA user is the
  counterparty when segment 3 is a generic "Payment from …" remark), and
  `chq_paid` for `CHQ PAID …` narrations; `hdfc_upi_name_vpa` for the
  HDFC `UPI-name-vpa@handle-IFSC-RRN-note` shape; `icici_bil_payment` now
  skips `BIL/{BPAY|INFT|ONL|…}` channel codes and captures the reference
  number; `bank_charges` accepts `CHRGS`. Category keywords: `TO SELF` /
  `OWN ACCOUNT` → Transfers; `CHRGS` / `ANNUAL FEE` / `JOINING FEE` →
  Bank Charges; `FD CLOSURE`/`FD MATURITY`/`FD PREMATURE`/`RD INSTALMENT`/
  `RD MATURITY` → Investments; `TOPUP`/`TOP UP` → Wallet Top-up. Merchant
  dictionary grows 115 → 127 with the major NBFC lenders (Tata Capital,
  Bajaj Finance, HDB Financial, Aditya Birla Finance, Mahindra Finance,
  Cholamandalam, LIC Housing Finance, Poonawalla, Shriram, Muthoot,
  Manappuram, SMFG) mapped to Loan & EMI. Corpus grows 76 → 84 samples.
- **`@paniniapi/extract` (0.2.3)** — exact decimal amount parser
  (`statementAmount.ts`): `Rs/-`, parentheses, trailing minus, signed and
  Indian-grouped forms; UTF-16LE/UTF-16BE/UTF-8 BOM decoding; continuation
  narration rows appended to the previous transaction (bounded, footer-safe);
  opening/closing and B/F–C/F rows surface as statement metadata instead of
  phantom transactions; D/C indicator columns; zero-filled debit/credit
  cells no longer mask the real amount; single-digit and timestamp-bearing
  date cells parse; month-first dates warn instead of guessing. All fixes
  shared with `panini-py` via the new `formats/corpus/quirks-csv.json`
  fixture (14 cases, run by both runtimes).
- **`@paniniapi/core` (0.1.3)** — `tokenizePieces()` export; `INB` channel
  keyword (net banking).
- **`@paniniapi/standards-schema` (0.3.2)** — `balancePaise` accepts
  negative values (overdrawn accounts are legitimate).
- **`panini-py` (0.3.2)** — `tokenize_pieces`, `INB` keyword, heuristic
  parity with the TS normalizer, and a per-rules-dir cache so
  `parse_narration` no longer re-reads/re-compiles grammar JSON per call.

### Added — enrichment depth pass (taxonomy, MCC, merchants, typed JSON v2)

- **`@paniniapi/rules-engine` (0.2.2)** —
  - **Governed taxonomy**: 39 → 43 categories (+Government Benefits,
    Home & Furniture, Pet Care, Alcohol & Bars) and ~120 evidence-probed
    keywords; new `rules/taxonomy.json` assigns every label a stable `id`
    and rollup `group` (loadTaxonomy()/loader exclude it from grammar
    parsing; a lockstep test fails CI if the two files drift).
    `ipo_asba` grammar rule fixes merchant keywords stealing
    `IPO-ASBA-<name>` narrations out of Investments.
  - **MCC table**: 98 → 235 ISO-18245 codes — full 5960–5969 direct
    marketing (incl. `5968` continuity/subscription), 5815–5818 digital
    goods, apparel/retail, auto trades, home trades and furnishings,
    5552 EV charging, 5983 fuel dealers, 0742 veterinary, 6513 rentals →
    Housing, 4829/6050/6536-40 money movement; 5712/5813 remapped to the
    finer categories.
  - **Merchant dictionary**: 127 → 360 canonical entries — fills six
    previously-empty categories (Pet Care, Postage & Courier, Donations
    incl. temple trusts and PM relief funds, Forex, Home & Furniture,
    Wallet Top-up) plus AMCs, hospital/diagnostic chains, state
    electricity boards, LPG, DTH, brokerages, insurers, regional OTT,
    news, jewellery. Ambiguous bare aliases (`CCD`, `MERU`, `KALYAN`,
    `ISHA`) deliberately excluded so person-name narrations stay null.
  - **Typed narration JSON v2**: `schema_version: 2` additive fields —
    `category_source` (grammar/keyword/merchant/mcc/none),
    `category_id`, `category_group`, `counterparty_kind`
    (merchant/self/unknown), `ref_kind` (utr/rrn/cheque/ref/none), and
    passthrough `bank`/`amount_paise`/`balance_paise`/`account_mask`/
    `currency`. Exact TS↔Python parity; `setTaxonomy()` injector feeds
    the browser bundle.
- **`@paniniapi/extract` (0.2.3)** — **native zero-dependency XLSX
  reader**: parses ZIP central-directory members (stored + raw deflate,
  CRC32-verified), resolves workbook → rels → first worksheet, handles
  sharedStrings/inlineStr/sparse cells, and renders date-formatted
  serials (builtin + custom date numFmts, 1904 epoch) as `YYYY-MM-DD`.
  Used automatically when no `SpreadsheetProvider` is supplied;
  `createNativeXlsxProvider` is exported for explicit wiring, and
  corrupt/non-workbook archives degrade to warnings — never throws.
- **Eval infrastructure** — `eval/` gold sets (narration, category,
  merchant, MCC) with a `baseline.json` ratchet that forbids coverage
  regressions (`PANINI_EVAL_UPDATE=1` re-baselines deliberately);
  `generateQuirkyCsvStatement` corruption simulator with layout×quirk
  round-trip coverage; `check-pins` script gates devDep/lockfile drift.

### Fixed

- **Narration** — `SELF`/`ECS`/`NACH` keywords removed from the category
  table: `IB FUNDS TRANSFER TO SELF` was mislabelled Cash Withdrawal (now
  Transfers), `NACH-DR-SOMEBILLER` was mislabelled Loan & EMI purely for
  riding the NACH rail (now Uncategorized unless EMI/LOAN wording or a
  lender dictionary entry applies); `CHQ PAID-MICR INWARD CLEARING` parsed
  as a CREDIT because INWARD was read as a remittance direction — clearing
  narrations now suppress INWARD/OUTWARD evidence (ambiguous across banks);
  heuristic counterparty extraction kept only the first name token —
  `RAMESH KUMAR` was reported as `Ramesh` (now spans whitespace-separated
  name words, stopping at field separators); `UPI/…/Payment from PhonePe/
user@ybl/…` took the remark as counterparty (now the VPA user);
  `BIL/BPAY/123456/BESCOM/…` took `BPAY` as the biller (now skips the
  channel code and captures the reference).
- Golden-diff guardrail: a snapshot of 108 corpus+probe narrations was
  diffed before/after — every changed field is an intended fix listed
  above; no unintended `category`/`type`/`counterparty` drift.

## [0.3.0] — 2026-10-17

### Added

- `@paniniapi/standards-schema` — full ReBIT FI-type matrix:
  `validateFiData(fiType, payload)` dispatches to per-shape schemas —
  deposit summary (TERM-/RECURRING_DEPOSIT), holdings matrix
  (EQUITIES/MF/ETF/BONDS/SIP/AIF/REIT/…), insurance policies, and NPS
  (PRAN-validated); plus the consent lifecycle:
  `validateAAConsentRequest` (ConsentDetail envelope) and
  `validateAAConsentArtefact` (signed artefact + ConsentUse).
- `@paniniapi/extract` — statement extraction for Indian banking documents.
  Data-driven CSV/Excel layouts for 15 banks (HDFC, ICICI, SBI, Axis, Kotak,
  PNB, BOB, YES, IndusInd, Union, IDFC FIRST, Canara, Federal, RBL, AU SFB)
  plus a generic heuristic fallback (`formats/csv-layouts.json`); zero-dependency
  RFC-4180 CSV parser; PDF text-layer extraction (FlateDecode streams,
  Tj/TJ operators, header-anchored column reconstruction, multi-page,
  multi-line narration stitching); **password-protected PDF unlock** —
  Standard security handler R2–R4 (RC4/AES-128) with `/Encrypt` parsing,
  per-object decryption, and per-bank password templates
  (`formats/pdf-passwords.json`) driven by `options.credentials`;
  statement metadata mining (period, IFSC, account holder,
  opening/closing balance); bank SMS alert patterns
  (`formats/sms-patterns.json`); word-box OCR fragments feeding the same
  x-anchored table pipeline; pluggable `SpreadsheetProvider`/`OcrProvider`
  seams with `createSheetJsProvider`/`createTesseractProvider` adapters —
  XLSX and scanned input work without bundling heavy dependencies.
- `@paniniapi/insights` — deterministic, explainable credit analytics over
  normalized transactions: income/salary detection (flag, keyword, and
  regular-credit bases) with consistency grading, recurring-obligation and
  EMI detection, FOIR, cash-flow summaries, and bounce / round-trip /
  self-transfer risk signals. Every claim carries a stable `PANINI-*` rule
  ID and evidence transaction indices; malformed rows degrade to warnings.
- `@paniniapi/rules-engine` — `mcc-codes.json` entity dictionary
  (~90 ISO 18245 codes → description + taxonomy category); `parseBankNarration`
  now surfaces `mcc`/`mcc_description` from narration `MCC-####` tokens or
  merchant dictionary entries, with MCC-based category fallback.
- `@paniniapi/simulator` — `generateCsvStatement` + `STATEMENT_SPECS`:
  seeded deterministic statement files rendered through all 15 bank layouts
  (Indian digit grouping, `Dr`-suffixed overdraft balances, optional anomaly
  injection) with ground-truth rows — powers the extraction round-trip
  corpus gate.
- `panini-py` — Python `extract_csv_statement` / `extract_sms` ports sharing
  the same formats JSONs and corpus fixtures; MCC enrichment parity in
  `parse_narration`.
- Multi-AA orchestration (`@paniniapi/fiu-client`): community AA directory
  with deterministic handle resolution, per-AA clients, bounded consent and
  data-pull fan-out with per-AA latency and failure isolation
  (`createMultiFiuClient`, `requestConsentAcross`, `decryptFiAcross`).
- `@paniniapi/browser` — self-contained browser/edge bundle (narration
  parsing, SMS/CSV extraction, insights) with build-time-bundled grammars
  and dictionaries; zero runtime imports of Node-only modules.
- `@paniniapi/bsa` — statement-to-report pipeline and markdown renderer.

### Fixed

- `parsePaise` now accepts negative amounts (`-1,29,788.94`); a `Dr`-suffixed
  balance cell parses negative — overdrawn statements were silently
  reporting null/incorrect balances.

## [0.3.1] — 2026-10-17

### Fixed

- **`@paniniapi/insights` (0.2.1)** — audit-confirmed correctness fixes:
  `closingBalancePaise` now selects the latest-dated balance instead of the
  last row in input order (newest-first bank exports reported the oldest
  balance); ISO date-time strings (`2024-01-15T10:00:00Z`, the AA
  `transactionTimestamp` shape) now parse instead of fabricating balance
  velocity through a `null → 0` coercion; non-finite balances no longer
  poison min/max/closing (previously `NaN`, rendered as `₹NaN.NaN`);
  recurring obligations sum per calendar month before medians, so a
  counterparty paid twice monthly counts at full monthly value (FOIR no
  longer understated). All four mirrored into `panini-py` with the shared
  conformance fixture regenerated.
- **`@paniniapi/fiu-client` (0.2.1)** — a FAILED FI session now surfaces as
  a `STATE` error from `fetchAndDecryptFi` / `decryptFiAcross` instead of a
  silent `ok: true, value: []` outcome; ephemeral session key material is
  discarded after its first decrypt instead of accumulating for process
  lifetime; `xorNonces` rejects non-32-byte nonces per the Rahasya contract
  instead of wrapping short ones; unparseable FIP key expiry is rejected;
  base64 inputs are validated against the strict RFC 4648 alphabet (no
  silent character drops); JWS segments are base64url-validated and capped
  at 1 MB; invalid verification keys wrap as `FiuError('JWS')`; non-JSON
  AA responses wrap as `FiuError('SCHEMA')` instead of raw `TypeError`;
  `suggestAas('')` returns no suggestions; `maxConcurrency: NaN` falls
  back to the default instead of an empty worker pool; `waitForFi` /
  `fetchAndDecryptFi` no longer depend on `this` binding (destructure-safe).
- **`@paniniapi/extract` (0.2.2)** — two-column CSVs (one delimiter per line)
  now sniff as `csv` instead of silently routing to the SMS pipeline and
  extracting zero rows; the bundled formats directory is parsed once and
  cached per process (no per-statement disk reads); malformed
  `OcrProvider`/`SpreadsheetProvider` results degrade to warnings instead
  of throwing.
- **`@paniniapi/standards-schema` (0.3.1)** — validator hardening:
  prototype-chain properties (`toString`, `__proto__`) no longer satisfy
  `required` or evade `additionalProperties: false` (`hasOwnProperty`, not
  `in`); `additionalProperties: false` without `properties` now rejects
  every property per the JSON Schema spec; `format: 'date'`/`'date-time'`
  validate calendar realness (`2024-13-45` and `2023-02-29` rejected,
  leap years honored); nesting is capped at 64 levels with a clear error
  instead of a stack-overflow `RangeError`.
- **`@paniniapi/bsa` (0.1.1)** — `formatInr(NaN)` renders as `—` instead of
  `₹NaN.NaN`.
- **`@paniniapi/rules-engine` (0.2.1)** — `lookupVpaHandle` accepts
  `@handle` and `user@handle` spellings; `loadRuleSets` reports invalid
  JSON / non-rule-set files by name instead of crashing on a raw
  `TypeError`.
- **`@paniniapi/core` (0.1.2)** — `normalizePayload` narration search caps
  container recursion at 8 levels (adversarial deep payloads no longer
  overflow the stack).
- Inter-package dependency pins realigned to current releases
  (`bsa`/`insights` no longer pin the pre-fix `extract@0.2.0`; `simulator`
  no longer pins `standards-schema@0.2.0`).

## [0.1.0] — 2026-10-16

### Added

- `@paniniapi/core` — deterministic tokenizer, Indian date/amount parsers,
  grammar compiler, and `Normalizer` with a configurable display-casing hook;
  `OpsProxy` ops layer (in-memory rate limiter, usage metering,
  opt-in PII-free telemetry) and a framework-neutral HTTP adapter.
- `@paniniapi/rules-engine` — JSON grammar sets for SBI, HDFC, ICICI, and
  generic cross-bank patterns; `BANK_NARRATION_RULE_SET` covering pipeline
  UPI, directional IMPS, and salary-credit narrations; `parseBankNarration()`
  with regex-driven acronym preservation.
- `@paniniapi/standards-schema` — zero-dependency JSON schema validator;
  ReBIT v2.0 AA profile schema (`FIPId`, `FIUTimestamp`,
  `maskedAccountNumber`, `Transaction[]`) and OCEN 4.0 loan application
  schema with the `metadata` envelope.
- `@paniniapi/simulator` — seeded mock ReBIT v2.0 payload factory with
  anomaly injection, plus a `panini-simulate` CLI.
