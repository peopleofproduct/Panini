# Changelog

All notable changes to Project Panini are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **AA-certification hardening** (`@paniniapi/fiu-client` 0.4.0) — the
  certification-surface gaps are closed: `validateConsentNotification`
  validates FIU-hosted `POST /Consent/Notification` bodies against the
  Sahamati scenarios (version → timestamp ±15 min replay window →
  notifier id/type → consentId/handle → status enum, returning spec error
  codes `NoSuchVersion`/`InvalidNotifier`/`InvalidConsentId`/…), plus
  `consentNotificationAck` for the 200 body. `specVersion` is now
  configurable per AA (`FiuClientConfig`/`AaClientConfig`), response
  `txnid` must echo the request's, and `client.heartbeat()` probes
  `GET /Heartbeat`. See `docs/aa-partner-readiness.md` — a conformance
  matrix + integration checklist for AA pilots.
- **Income-document parsers** (`@paniniapi/extract` 0.6.0) — three new
  deterministic document classes beyond statements: `extractPayslip`
  (label-preserved components + gross−deductions=net arithmetic check +
  PAN/UAN/PF/ESI ids), `extractItrV` (numbered-box fields: gross total
  income, chapter VI-A, total income, taxes paid, refund, ack no.), and
  `extractForm26as` (TAN-keyed TDS entries + totals). `detectDocumentType`
  - `extractDocument` route text layers to the right parser; `panini-bsa`
    renders them under "Income Documents" instead of zero-transaction
    silence. Python parity: `extract_payslip`, `extract_itrv`,
    `extract_form26as`, `extract_document`. See
    `docs/income-documents.md`.
- **Counterparty money-flow + conduct metrics** (`@paniniapi/insights`
  0.5.0) — `counterpartyFlows` aggregates every transaction into
  per-counterparty in/out/net totals with evidence indices (the
  deterministic kernel behind money-trail products; top-N, unattributed
  rows counted honestly). `detectConductMetrics` reports overdrawn
  days, worst overdraft, average EOD balance, EOD volatility, and
  bounce rate — the behavioural layer that complements fraud flags.
  `panini-bsa` renders "Account Conduct" and "Top Counterparties"
  sections. Python parity: `counterparty_flows`,
  `detect_conduct_metrics`.
- **Fraud-indicator suite + multi-account consolidation**
  (`@paniniapi/insights`) — `detectFraudIndicators` runs the
  industry-standard named checks (circular in/out pairs across
  different counterparties, holiday/weekend cash deposits, RTGS below
  the ₹2L floor, round-figure clustering, zero-transaction gap months,
  wash months, salary-stop and salary-strip patterns, dormant→spike,
  overdrawn days, minimum-balance penalties) — every flag a rule ID +
  evidence indices. `consolidateAccounts` merges a borrower's full
  account set: per-account rollups, inter-account transfer legs
  detected by amount+window and netted out of consolidated flow, and
  cross-statement refNo duplicates flagged. `detectPortfolioIndicators`
  adds the checks that only exist across accounts — `A→B→A` rotation
  cycles and own-account-inflated turnover. Python parity:
  `detect_fraud_indicators`, `detect_portfolio_indicators`,
  `consolidate_accounts`. See `docs/fraud-indicators.md`.
- **`panini-bsa` fraud + portfolio sections** — the CLI report now
  carries a "Fraud Indicators" section and a "Multi-Account
  Consolidation" table with external-only turnover; `--fail-on-fraud`
  exits `5` on any high-severity indicator, `--no-fraud` skips the
  suite.
- **RBI-licensed entity names** — `bank-names.json` now covers ~120
  entities: all scheduled commercial banks, SFBs, payments banks,
  major scheduled UCBs (SVC, Saraswat, Cosmos, TJSB, Abhyudaya, …),
  Regional Rural Banks (both current and pre-amalgamation names —
  old statements carry old names), and foreign banks with India ops.
- **Card-PDF column-collapse quirks** — amount cells that absorb a
  trailing column (Axis cashback `500.00 DR 5.00`, IndusInd trailing
  statement date `508.06 DR 15/09/2026`, HDFC CC stray `l` marker)
  keep the leading amount + direction marker and warn; HDFC CC's `+`
  credit-flag column marks rows CREDIT.
- **Deeper coverage wave** — layouts for **IDBI** (`CR/DR` + `Amount
(INR)`), **Bank of Baroda .xls** (signed `Amount (INR)` — new
  `unsignedAmount` layout hint maps unsigned positives to credits),
  **Shamrao Vithal Co-operative Bank (SVC)** — first co-op bank layout,
  **Kotak v2** (`Sl. No.` CSV export), **YES Bank credit card**
  (`Merchant Category` column), a **`cc_generic`** layout for
  SBI/Kotak-style card statements (`forbiddenHeaders` keeps it from
  stealing deposit tables; bank falls back to preamble detection), and
  **Paytm for Business merchant exports** (`kind: "merchant"`).
  Single-letter `C`/`D` amount suffixes now parse; `bank-names.json`
  gains SVC + Kerala Gramin; generic keyword coverage widened
  (`cr dr`, `instrument id`, `rrn`, `booking/entry/trade date`, …).
- **Wider layout coverage** — evidence-backed second export variants
  (`axis_statement_v2` SRL NO, `icici_statement_v2` S No. + value-date
  first, `bob_statement_v2` TRAN/VAL DATE), plus **credit-card
  statements** (`hdfc_cc_statement`, `axis_cc_statement` —
  `kind: "credit_card"`, signed amount + direction column, no running
  balance, reported as `metadata.accountKind`) and **PhonePe vertical
  statements** (`parseUpiAppStatement` — the emailed-PDF/text field
  record format, works on pasted text and scanned-as-text PDF pages;
  `bank: "PHONEPE"`, `metadata.statementIssuer`). 20 layout variants
  now corpus-gated; `Db`/`Cr` direction markers added. Python parity
  (`parse_upi_app_statement`, `accountKind`, `extra_formats_dir`).
- **Bank-name detection + coverage report** (`@paniniapi/extract`) —
  `formats/bank-names.json` carries ~50 Indian bank identities;
  `detectBankId` sniffs statement letterheads (word-bounded,
  longest-match-wins) so a recognised-but-uncovered bank reports its
  `bank` even when it parses via the generic fallback — with
  `metadata.bankSource` provenance (`layout`/`preamble`/`hint`) and a
  `generic fallback` warning that names the detected bank. Works across
  CSV, XLSX, PDF letterheads and OCR text. `npm run coverage:banks`
  regenerates `docs/bank-coverage.md`: 15 corpus-gated layouts + 38
  name-detectable banks.
- **`extraFormatsDir`** (`extractStatement`, `extractWithRouter`,
  `extract_csv_statement`, `extract_sms`) — append private formats
  (layouts, bank names, SMS patterns, PDF password patterns) on top of
  the bundled set without forking; caller entries check first and
  shadow same-id bundled entries. Regional/co-op bank layouts become a
  config file, not a fork.
- **`panini-bsa --aa <file>`** — pass a decrypted AA FI payload (JSON) and
  every statement is reconciled against the bank's own feed in the same
  report: `reconciliation` verdict per file, an "AA ↔ Document
  Reconciliation" section in Markdown output, and **exit code 4** on
  `fabrication_evidence` (CI-gateable).
- **`panini-parser` 0.4.0 (Python parity)** — `reconcile_with_aa` +
  `transactions_from_aa_data` ported with identical semantics and
  verdicts (11 parity tests mirroring the TS suite).
- **Recurring-monitoring kernel** (`@paniniapi/insights`) — the
  open-ended answer to hosted collections/monitoring products.
  `statementDiff` (deterministic multiset diff between snapshots) +
  `detectMonitoringEvents` (8 rule-Id'd change events: baseline,
  new_activity, income_source_lost, balance_drop, new_obligation,
  obligation_stopped, new risk signals, large_debit — all thresholds
  caller-tunable) + `runMonitorCycle` orchestrating three caller-owned
  seams: `StatementSource` (AA pull / TSP / file drop), `SnapshotStore`
  (any database), `AlertSink` (any webhook/queue). The lender's
  composition is the complete product. New doc:
  `docs/monitoring.md`.
- **Consent-lifecycle tracking** (`@paniniapi/fiu-client`) —
  `consentStatus(artefact, now, leadDays)` derives lifecycle state
  (active/expiring/expired/revoked…) + renewalDue as a pure function;
  `sweepConsents(store)` buckets every artefact in a caller-owned
  `ConsentStore` into renewing/expired/revoked — the nightly job for
  consent-fleet management.
- **AA ↔ document reconciliation** (`@paniniapi/forensics`) — the
  ground-truth fraud check. `reconcileWithAa(statement, aaTransactions)`
  diffs a claimed statement against the bank's own AA feed via
  deterministic multiset matching on (date ± window, amount, direction):
  fabricated rows the bank doesn't know and bank rows the document omits
  are `fabrication_evidence`; narration/balance drift on matched rows is
  a soft warning; rows outside AA coverage are `unverifiable`, not
  accused. `transactionsFromAaData` tolerantly extracts the transaction
  array from ReBIT FI payloads. Verdicts: `consistent` / `partial` /
  `fabrication_evidence` / `incomparable`. New doc:
  `docs/aa-reconciliation.md`.
- **Degraded-scan OCR orchestration kit** (`@paniniapi/extract`) — the
  "any eyes, proven numbers" architecture for scans too degraded for
  text-layer extraction:
  - `VisionProvider` seam — structured-table vision models (on-prem
    open-weight VLMs via any OpenAI-compatible endpoint: Ollama, vLLM).
    `createOpenAiVisionProvider` ships ready-made (caller-owned fetch,
    temperature 0, schema-checked output, optional raw-response audit).
  - `QueueOcrProvider` seam — submit→poll batch/TSP extraction for
    reduced-price queue workflows. `createHttpQueueProvider` adapts any
    generic HTTP job API; `maxPolls`/`pollIntervalMs` bound the wait.
  - `verifyStatement` — deterministic arithmetic gate every non-native
    result must pass: balance-chain continuity, opening→closing
    reconciliation, date plausibility, parse-rate floor. Hallucinated
    rows break the chain and get flagged, not underwritten.
  - `extractWithRouter` — tiered routing cheap→costly with
    `minVerifyScore`, `minProviderConfidence`, per-engine attempt
    audit trail, and `verified`/`degraded`/`failed` verdicts.
  - `consensusCompare` / `consensusWithVerification` — dual-engine
    field-level agreement on the same pages; differing cells are
    evidence-listed for human review. Two independent engines cannot
    hallucinate the same wrong number.
  - New doc: `docs/ocr-playbook.md` — tier guide, DPDP notes for hosted
    tiers, router policy, honest limits.
- **`@paniniapi/forensics` (0.1.0, new)** — deterministic document-integrity
  forensics for statement files. `inspectStatement(bytes)` returns an
  explainable `IntegrityReport` (verdict + rule-Id'd signals + evidence):
  - **Arithmetic consistency** (all formats): running-balance chain
    verification, opening/closing reconciliation, out-of-period dates,
    duplicate-row fabrication detection.
  - **PDF container signals**: incremental updates, consumer-editor
    `/Producer` fingerprints, post-period `ModDate`, AcroForm overlays,
    covering annotations, invisible text, stacked/overtyped fragments.
  - **Full CMS signature validation**: `/ByteRange` digest vs CMS
    `messageDigest`, RSA-PKCS#1/ECDSA signature over signedAttrs
    (`node:crypto`), embedded cert chain walked to a caller-supplied
    trust store. Post-sign appends flagged.
- **`@paniniapi/bsa`** — per-file `integrity` verdicts in the JSON report,
  a Document Integrity section in Markdown output, `--no-forensics` flag,
  and exit code `3` when any file shows `tamper_evidence` (CI-gateable).
- New doc: `docs/statement-integrity.md` — signal dictionary, verdict
  semantics, and honest limits (deterministic evidence ≠ ML forensics;
  AA-sourced data remains the tamper-proof channel).
- **Grammar-drift response kit** (`@paniniapi/rules-engine`) — the
  operational answer to "the bank changed its narration format overnight":
  - `analyzeNarrationBatch(narrations, { bankHint })` — batch match-rate /
    confidence vs the corpus baseline; `drift: true` + warnings when the
    rate collapses (>20pp default, tunable). Unmatched narrations are
    grouped into token-skeleton clusters so operators see the _new
    shape_, not thousands of raw strings.
  - `suggestGrammarRule(samples)` — drafts a candidate `GrammarPattern`
    from same-skeleton samples and **self-tests it against the whole
    corpus** (`corpusImpact`, `safe` flag). Suggestions never mutate
    production grammars; they are paste-ready drafts for human review.
  - `panini-bsa doctor <files...> [--bank id]` — CLI wrapper that runs
    the drift report on statement files or one-per-line `.txt` dumps and
    prints a draft rule per unmatched cluster. Exit `1` on drift.
  - New doc: `docs/rules-hotpatch.md` — the full detect → diagnose →
    overlay-patch → upstream playbook. Grammar fixes ship as JSON rule
    files via `loadRuleSets(dir)` — no engine redeploy required.
- **`panini-parser` 0.3.3 (Python parity)** — same drift kit on the
  Python engine: `analyze_narration_batch`, `corpus_baseline`,
  `skeleton_of`, `suggest_grammar_rule` (identical corpus self-test),
  plus `parse_narration(..., rule_sets=[...], bare=True)` mirroring the
  TS overlay options. Corpus fixtures now ship inside the wheel
  (`rules/corpus/*.json`, guarded by a bundled-drift test).
- **Deterministic scorecard engine** (`@paniniapi/insights`) —
  `evaluateScorecard(report, spec)` evaluates a JSON-declared, weighted
  rule card over the evidence-backed `InsightsReport`. Returns a score
  with a per-rule derivation trace and `coveragePct` (thin-file guard:
  a high score on low coverage is flagged, not hidden). Ships
  `scorecards/reference.json` — explicitly uncalibrated; the lender owns
  the risk policy. Python parity: `panini.evaluate_scorecard`.
- New docs: `docs/scorecard.md`, `docs/operating-panini.md` (honest TCO),
  `docs/accountability.md` (OSS liability posture + deployment
  checklist).

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
