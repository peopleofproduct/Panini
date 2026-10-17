# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Conformance gate: every corpus fixture must produce the expected
ParsedBankNarration fields — identical contract to the TS corpus.test.ts.
Run: python3 -m unittest discover tests -v   (or pytest)
"""

from __future__ import annotations

import glob
import json
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from panini import parse_narration  # noqa: E402

CORPUS_DIR = Path(__file__).resolve().parents[2] / "packages" / "rules-engine" / "rules" / "corpus"


def _samples():
    for path in sorted(glob.glob(str(CORPUS_DIR / "*.json"))):
        data = json.loads(Path(path).read_text())
        for s in data["samples"]:
            yield path, s


class CorpusConformance(unittest.TestCase):
    pass  # cases generated below


def _make(path, sample):
    def check(self):
        inp = {"text": sample["input"]}
        if sample.get("bankHint"):
            inp["bankHint"] = sample["bankHint"]
        result = parse_narration(inp)
        for key, expected in sample["expect"].items():
            self.assertEqual(
                result.get(key), expected,
                f"{Path(path).name}: {sample['input']!r} — field {key!r} "
                f"expected {expected!r}, got {result.get(key)!r}",
            )
    return check


for _i, (_p, _s) in enumerate(_samples()):
    name = f"test_{Path(_p).stem}_{_i}_{_s['input'][:28].replace(' ', '_')}"
    name = "".join(c if c.isalnum() or c == "_" else "_" for c in name)
    setattr(CorpusConformance, name, _make(_p, _s))


if __name__ == "__main__":
    unittest.main()
