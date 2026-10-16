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
`packages/rules-engine/rules/` (see `generic.json` / `sbi.json` for the shape),
register it in the loader, and add fixture tests. No changes to `@panini/core`
should be needed.

## Pull requests

- Keep changes focused and atomic — one concern per PR.
- All tests must pass (`npm test`) and lint must be clean (`npm run lint`).
- Strict TypeScript — no `any`; use `unknown` at external boundaries.
- **Never** introduce outbound network calls, telemetry, or PII leakage in the core.
- Describe the _why_, not just the _what_.

## Ground rules

- No runtime dependencies in `@panini/core` or `@panini/standards-schema`.
- Bank/company vocabulary belongs in `rules-engine`, not in core.
- Deterministic behavior only — no ML, no randomness without a seed.

---

Maintained by **[People of Product™](https://theproduct.city)** — questions?
Open an issue or reach us on
[LinkedIn](https://www.linkedin.com/company/people-of-product) /
[X](https://x.com/PeopleOfProduct).
