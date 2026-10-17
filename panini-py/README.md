# panini-py — Python port of Panini

Deterministic, privacy-preserving parser for Indian bank narrations.
This package is the Python port of `@panini/rules-engine` and shares the
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

`panini` loads rule sets from `packages/rules-engine/rules/` (resolved
relative to the repo root). Override with `PANINI_RULES_DIR`:

```bash
PANINI_RULES_DIR=/path/to/rules python3 -m unittest discover tests
```

or pass `rules_dir=Path(...)` to `parse_narration()`.

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
normalize → enrich) is at full corpus parity (71/71). SMS `media`
routing, `normalizePayload`, and packaged bundling of `rules/` for PyPI
distribution land next.
