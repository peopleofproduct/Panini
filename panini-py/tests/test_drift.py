# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Parity tests for panini.drift + panini.suggest — mirrors
packages/rules-engine/tests/drift.test.ts."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from panini import (
    analyze_narration_batch,
    corpus_baseline,
    parse_narration,
    skeleton_of,
    suggest_grammar_rule,
)

CORPUS_DIR = (
    Path(__file__).resolve().parents[1] / "panini" / "rules" / "corpus"
)

KNOWN = [
    "UPI/402345678912/DR/SWIGGY@okaxis/RENT/",
    "NEFT-N3452618902-SALARY-TCS LTD",
    "POS 415982XXXXXX0342 ZOMATO",
]


def _corpus_inputs(bank: str):
    for p in CORPUS_DIR.glob("*.json"):
        data = json.loads(p.read_text())
        if data.get("bank") == bank:
            return [
                {"text": s["input"], "bankHint": s["bankHint"]}
                if s.get("bankHint")
                else s["input"]
                for s in data["samples"]
            ]
    raise AssertionError(f"no corpus file for {bank}")


class AnalyzeNarrationBatch(unittest.TestCase):
    def test_corpus_at_baseline_no_drift(self):
        report = analyze_narration_batch(
            _corpus_inputs("KOTAK"), bank_hint="KOTAK"
        )
        self.assertFalse(report.drift)
        self.assertGreater(report.baseline_match_rate, 0.8)
        self.assertGreaterEqual(
            report.match_rate, report.baseline_match_rate - 0.05
        )

    def test_unseen_format_triggers_drift(self):
        alien = [
            f"XNACH|TXN|{100000000 + i}|MERCHANT {i}|ONLINE" for i in range(20)
        ]
        report = analyze_narration_batch(KNOWN + alien, bank_hint="KOTAK")
        self.assertTrue(report.drift)
        self.assertIn("below", report.warnings[0])
        cluster = report.unmatched_clusters[0]
        self.assertEqual(cluster.count, 20)

    def test_custom_threshold(self):
        half = KNOWN + [f"XYZZY-{n}" for n in KNOWN]
        report = analyze_narration_batch(
            half, bank_hint="KOTAK", drop_threshold=0.9
        )
        self.assertFalse(report.drift)

    def test_empty_batch(self):
        report = analyze_narration_batch([])
        self.assertEqual(report.total, 0)
        self.assertFalse(report.drift)


class SkeletonOf(unittest.TestCase):
    def test_literals_and_digits(self):
        self.assertEqual(
            skeleton_of("UPI/402345678912/DR/SWIGGY@okaxis/RENT/"),
            "UPI-N-DR-A-RENT",
        )


class SuggestGrammarRule(unittest.TestCase):
    def test_drafts_working_pattern(self):
        samples = [
            "XNACH|TXN|100000001|MERCHANT A|ONLINE",
            "XNACH|TXN|100000002|MERCHANT B|ONLINE",
            "XNACH|TXN|100000003|MERCHANT C|ONLINE",
        ]
        s = suggest_grammar_rule(samples)
        self.assertIsNotNone(s)
        self.assertTrue(s.safe)
        parsed = parse_narration(
            samples[0],
            bare=True,
            rule_sets=[
                {
                    "id": "test-overlay",
                    "bank": "GENERIC",
                    "version": "0",
                    "patterns": [s.pattern],
                }
            ],
        )
        # with only the draft loaded, it must be the match
        self.assertIsNotNone(parsed["matched_rule"])
        self.assertTrue(parsed["matched_rule"].startswith("test-overlay:"))

    def test_heterogeneous_no_safe_draft(self):
        s = suggest_grammar_rule(
            ["ALPHA-BETA-GAMMA", "1-2-3-4-5-6", "TOTALLY DIFFERENT TEXT"]
        )
        self.assertTrue(s is None or s.safe is False)


class CorpusBaseline(unittest.TestCase):
    def test_known_bank(self):
        self.assertGreater(corpus_baseline("KOTAK"), 0.8)


if __name__ == "__main__":
    unittest.main()
