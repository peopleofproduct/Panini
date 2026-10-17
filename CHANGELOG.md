# Changelog

All notable changes to Project Panini are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Fixed

- `parsePaise` now accepts negative amounts (`-1,29,788.94`); a `Dr`-suffixed
  balance cell parses negative — overdrawn statements were silently
  reporting null/incorrect balances.

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
