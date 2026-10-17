# panini-py — Python port of Panini

Deterministic, privacy-preserving parser for Indian bank narrations.
This package is the Python port of `@paniniapi/rules-engine` and shares the
**same grammar JSONs and conformance corpus** — both runtimes are tested
against the identical fixture set, so parity is enforced, not assumed.

## Quick start

```python
from panini import parse_narration

txn = parse_narration("UPI/20261015/DR/826384910234/SWIGGY@okaxis/Cooking/")
# {
#   "channel": "UPI", "type": "DEBIT", "ref_no": "826384910234",
#   "merchant": "Swiggy", "vpa": "okaxis", "vpa_app": "Google Pay",
#   "vpa_bank": "Axis Bank", "category": "Food & Dining", ...
# }
```

## Where the grammars live

The grammar JSONs ship **inside the wheel** under `panini/rules/` — a
pip install works standalone with no repo checkout. In a development
checkout the engine falls back to `packages/rules-engine/rules/`; the
bundled copy is kept byte-identical and drift is enforced by
`tests/test_bundled_rules.py`. Resolution order:

1. `PANINI_RULES_DIR` env var or `rules_dir=Path(...)` argument
2. bundled `panini/rules/` package data
3. repo path (`packages/rules-engine/rules/`) for dev checkouts

## Conformance

```
python3 -m unittest discover tests
```

runs every fixture in `packages/rules-engine/rules/corpus/*.json` through
the Python engine and asserts the same `expect` fields the TypeScript
corpus gate checks — channel, type, ref_no, counterparty, vpa,
merchant/vpa/IFSC enrichment, is_salary, date, category.

## Status

Alpha scaffold: narration pipeline (tokenizer → grammar match →
normalize → enrich) is at full corpus parity (76/76) and grammar data
is bundled for PyPI distribution. SMS `media` routing and
`normalizePayload` land next.
