# Changelog

All notable changes to Project Panini are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-10-16

### Added

- `@panini/core` — deterministic tokenizer, Indian date/amount parsers,
  grammar compiler, and `Normalizer` with a configurable display-casing hook;
  `OpsProxy` ops layer (in-memory rate limiter, usage metering,
  opt-in PII-free telemetry) and a framework-neutral HTTP adapter.
- `@panini/rules-engine` — JSON grammar sets for SBI, HDFC, ICICI, and
  generic cross-bank patterns; `BANK_NARRATION_RULE_SET` covering pipeline
  UPI, directional IMPS, and salary-credit narrations; `parseBankNarration()`
  with regex-driven acronym preservation.
- `@panini/standards-schema` — zero-dependency JSON schema validator;
  ReBIT v2.0 AA profile schema (`FIPId`, `FIUTimestamp`,
  `maskedAccountNumber`, `Transaction[]`) and OCEN 4.0 loan application
  schema with the `metadata` envelope.
- `@panini/simulator` — seeded mock ReBIT v2.0 payload factory with
  anomaly injection, plus a `panini-simulate` CLI.
