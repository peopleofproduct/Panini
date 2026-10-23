# Visual assets

Brand/diagram SVGs used by the README and docs. Each visual ships a `*-light`
and `*-dark` variant; docs embed them with `<picture>` so GitHub picks the
variant matching the reader's theme:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/NAME-dark.svg">
  <img alt="…" src="docs/assets/NAME-light.svg" width="100%">
</picture>
```

## Regenerating

The SVGs are generated, not hand-drawn — edit strings/colors in the generator
and re-run:

```bash
python3 generate_visuals.py          # ecosystem, pipeline, privacy boundary, evidence chain
python3 generate_visuals_extra.py    # before/after, credit-file stack (imports the kit above)
```

Output lands back in this directory. Keep text claims accurate to the codebase —
rule IDs (e.g. `PANINI-FRD-CIRC-001`), severities (`low/medium/high`), and counts
in the README stats row should match the real implementation.

## Scope rule

Only public-facing assets belong here. Internal/competitive visuals (vendor
matrices, strategy diagrams, investor material) must **never** be committed to
this repository — keep them in local storage outside the repo.
