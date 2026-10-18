# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Drift gate: the grammar JSONs bundled inside panini/rules/ must be
byte-identical to the TypeScript source of truth in
packages/rules-engine/rules/. If this fails, re-sync the data files:

    cp packages/rules-engine/rules/*.json panini-py/panini/rules/
    cp packages/rules-engine/rules/entities/*.json panini-py/panini/rules/entities/
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC = REPO_ROOT / "packages" / "rules-engine" / "rules"
BUNDLED = Path(__file__).resolve().parents[1] / "panini" / "rules"
SRC_FORMATS = REPO_ROOT / "packages" / "extract" / "formats"
BUNDLED_FORMATS = Path(__file__).resolve().parents[1] / "panini" / "formats"


class BundledRulesDrift(unittest.TestCase):
    def test_all_grammars_present_and_identical(self):
        src_files = {p.name: p for p in SRC.glob("*.json")}
        bundled_files = {p.name: p for p in BUNDLED.glob("*.json")}
        self.assertEqual(
            set(src_files), set(bundled_files),
            "bundled rule set differs from repo source — re-sync panini/rules",
        )
        for name, path in src_files.items():
            self.assertEqual(
                json.loads(path.read_text()),
                json.loads((BUNDLED / name).read_text()),
                f"bundled {name} diverged from packages/rules-engine/rules/{name}",
            )

    def test_corpus_present_and_identical(self):
        src_corpus = SRC / "corpus"
        bnd_corpus = BUNDLED / "corpus"
        src_files = {p.name for p in src_corpus.glob("*.json")}
        bnd_files = {p.name for p in bnd_corpus.glob("*.json")}
        self.assertEqual(src_files, bnd_files, "bundled corpus diverged — re-sync")
        for name in src_files:
            self.assertEqual(
                json.loads((src_corpus / name).read_text()),
                json.loads((bnd_corpus / name).read_text()),
                f"bundled corpus/{name} diverged",
            )

    def test_entities_present_and_identical(self):
        src_ent = SRC / "entities"
        bnd_ent = BUNDLED / "entities"
        for path in src_ent.glob("*.json"):
            bundled = bnd_ent / path.name
            self.assertTrue(bundled.exists(), f"missing bundled entities/{path.name}")
            self.assertEqual(
                json.loads(path.read_text()), json.loads(bundled.read_text()),
                f"bundled entities/{path.name} diverged",
            )

    def test_extract_formats_present_and_identical(self):
        for name in ("csv-layouts.json", "sms-patterns.json"):
            bundled = BUNDLED_FORMATS / name
            self.assertTrue(bundled.exists(), f"missing bundled formats/{name}")
            self.assertEqual(
                json.loads((SRC_FORMATS / name).read_text()),
                json.loads(bundled.read_text()),
                f"bundled formats/{name} diverged from packages/extract/formats/{name}",
            )


if __name__ == "__main__":
    unittest.main()
