# Contributing to Project Panini

Thanks for your interest in contributing! Panini is an open-core, zero-dependency
parsing engine — contributions that keep it deterministic, fast, and dependency-free
are very welcome.

## Development setup

```bash
npm install
npm run build    # tsc -b (project references)
npm test         # jest — must stay green
npm run lint     # eslint flat config
npm run format   # prettier
```

A pre-commit hook at `scripts/pre-commit.sh` runs lint + tests — install it with:

```bash
cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

## Adding a bank grammar

Bank rules are **data, not code** — drop a new JSON rule set into
`packages/rules-engine/rules/` (see `generic.json` / `sbi.json` for the shape)
and add fixture tests. No changes to `@paniniapi/core` should be needed.

Every grammar must ship **corpus samples** in
`packages/rules-engine/rules/corpus/<bank>.json` — real-world narration strings
with the fields you expect the parser to produce. The corpus is a CI gate:
`npm test` runs every sample through the engine and fails the build if an
expectation regresses. Prefer anonymized or synthetic narrations; never commit
real account numbers, names, or VPAs.

## Adding a bank statement layout

CSV/Excel/PDF statement layouts are also data-driven — see
[`docs/bank-layout-guide.md`](docs/bank-layout-guide.md). A layout is a
JSON entry in `packages/extract/formats/csv-layouts.json` plus a corpus
fixture in `packages/extract/formats/corpus/`. Same rule applies:
anonymized or synthetic inputs only, expectations verified by CI.

## Entity dictionaries

`packages/rules-engine/rules/entities/` holds the community dictionaries —
`merchants.json` (canonical names + narration aliases + category),
`vpa-handles.json` (UPI handle → app/bank), and `ifsc-codes.json` (IFSC prefix →
bank). Add entries by PR; enrichment uses them at parse time via
`parseBankNarration`'s `enrich` option.

## Pull requests

- Keep changes focused and atomic — one concern per PR.
- All tests must pass (`npm test`) and lint must be clean (`npm run lint`).
- Strict TypeScript — no `any`; use `unknown` at external boundaries.
- **Never** introduce outbound network calls, telemetry, or PII leakage in the core.
- Describe the _why_, not just the _what_.

## Ground rules

- No runtime dependencies in `@paniniapi/core` or `@paniniapi/standards-schema`.
- Bank/company vocabulary belongs in `rules-engine`, not in core.
- Deterministic behavior only — no ML, no randomness without a seed.

---

Maintained by **[People of Product™](https://theproduct.city)** — questions?
Open an issue or reach us on
[LinkedIn](https://www.linkedin.com/company/people-of-product) /
[X](https://x.com/PeopleOfProduct).
