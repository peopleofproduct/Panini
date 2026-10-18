# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Parity tests for panini.scorecard — mirrors
packages/insights/tests/scorecard.test.ts against a shared fixture spec."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from panini import (
    ScorecardSpecError,
    analyze_transactions,
    evaluate_scorecard,
    validate_scorecard_spec,
)

REPO = Path(__file__).resolve().parents[2]
REFERENCE_SPEC = json.loads(
    (REPO / "packages" / "insights" / "scorecards" / "reference.json").read_text()
)


def stub_report(**over):
    report = {
        "income": {
            "credits": [],
            "sources": [],
            "monthlyAveragePaise": None,
            "consistency": "insufficient_data",
            "monthsObserved": 0,
        },
        "obligations": {
            "recurring": [],
            "emis": [],
            "monthlyObligationPaise": None,
        },
        "foir": {
            "ratio": None,
            "monthlyIncomePaise": None,
            "monthlyObligationPaise": None,
            "note": "",
        },
        "cashflow": {
            "totalCreditsPaise": 0,
            "totalDebitsPaise": 0,
            "netPaise": 0,
            "monthsObserved": 0,
            "averageMonthlyNetPaise": None,
            "minBalancePaise": None,
            "maxBalancePaise": None,
            "closingBalancePaise": None,
        },
        "trends": {
            "monthly": [],
            "netFlowDirection": "insufficient_data",
            "balanceVelocityPaisePerDay": None,
            "creditVolatilityPct": None,
            "debitVolatilityPct": None,
        },
        "signals": [],
        "warnings": [],
        "analyzedTransactions": 0,
    }
    report.update(over)
    return report


HEALTHY = stub_report(
    income={
        "credits": [],
        "sources": ["ACME Corp"],
        "monthlyAveragePaise": 5_000_000,
        "consistency": "regular",
        "monthsObserved": 6,
    },
    foir={
        "ratio": 0.4,
        "monthlyIncomePaise": 5_000_000,
        "monthlyObligationPaise": 2_000_000,
        "note": "",
    },
    cashflow={
        "totalCreditsPaise": 30_000_000,
        "totalDebitsPaise": 20_000_000,
        "netPaise": 10_000_000,
        "monthsObserved": 6,
        "averageMonthlyNetPaise": 1_666_600,
        "minBalancePaise": 500_000,
        "maxBalancePaise": 12_000_000,
        "closingBalancePaise": 10_000_000,
    },
    trends={
        "monthly": [],
        "netFlowDirection": "improving",
        "balanceVelocityPaisePerDay": 500,
        "creditVolatilityPct": 2,
        "debitVolatilityPct": 5,
    },
    analyzedTransactions=120,
)


class ValidateSpec(unittest.TestCase):
    def test_reference_spec_valid(self):
        validate_scorecard_spec(REFERENCE_SPEC)  # must not raise

    def test_unknown_metric_rejected(self):
        with self.assertRaises(ScorecardSpecError):
            validate_scorecard_spec({
                "id": "x", "version": "1",
                "rules": [{"id": "r", "points": 1,
                           "when": {"metric": "bogus.m", "op": "gt", "value": 0}}],
            })

    def test_duplicate_rule_ids_rejected(self):
        with self.assertRaises(ScorecardSpecError):
            validate_scorecard_spec({
                "id": "x", "version": "1",
                "rules": [
                    {"id": "a", "points": 1,
                     "when": {"metric": "foir.ratio", "op": "lt", "value": 1}},
                    {"id": "a", "points": 1,
                     "when": {"metric": "foir.ratio", "op": "lt", "value": 1}},
                ],
            })


class Evaluate(unittest.TestCase):
    def test_healthy_report_top_band_full_trace(self):
        r = evaluate_scorecard(HEALTHY, REFERENCE_SPEC)
        self.assertEqual(r["score"], 95)
        self.assertEqual(r["maxScore"], 100)
        self.assertEqual(r["band"], "strong_facts")
        self.assertEqual(r["coveragePct"], 100)
        trace = next(c for c in r["contributions"] if c["ruleId"] == "foir.comfortable")
        self.assertTrue(trace["matched"])
        self.assertEqual(trace["observed"][0],
                         {"metric": "foir.ratio", "value": 0.4})

    def test_missing_data_drops_coverage_and_warns(self):
        r = evaluate_scorecard(stub_report(), REFERENCE_SPEC)
        self.assertEqual(r["score"], 0)
        self.assertEqual(r["coveragePct"], 50)
        self.assertTrue(any("thin file" in w for w in r["warnings"]))

    def test_signals_rule_arg(self):
        spec = {
            "id": "t", "version": "1",
            "rules": [{"id": "bounced", "points": 10,
                       "when": {"metric": "signals.rule:risk.bounce",
                                "op": "eq", "value": 0}}],
        }
        bounced = stub_report(
            signals=[{"ruleId": "risk.bounce", "severity": "high",
                      "note": "", "evidence": []}]
        )
        self.assertEqual(evaluate_scorecard(bounced, spec)["score"], 0)
        self.assertEqual(evaluate_scorecard(HEALTHY, spec)["score"], 10)

    def test_deterministic(self):
        self.assertEqual(evaluate_scorecard(HEALTHY, REFERENCE_SPEC),
                         evaluate_scorecard(HEALTHY, REFERENCE_SPEC))

    def test_end_to_end(self):
        txns = [
            {"date": "2026-01-01", "amountPaise": 8_000_000,
             "direction": "CREDIT", "narration": "SALARY ACME CORP",
             "category": "Income"},
            {"date": "2026-02-01", "amountPaise": 8_000_000,
             "direction": "CREDIT", "narration": "SALARY ACME CORP",
             "category": "Income"},
            {"date": "2026-03-01", "amountPaise": 8_000_000,
             "direction": "CREDIT", "narration": "SALARY ACME CORP",
             "category": "Income"},
            {"date": "2026-01-05", "amountPaise": 2_000_000,
             "direction": "DEBIT", "narration": "EMI HDFC BANK",
             "category": "Loan & EMI"},
        ]
        report = analyze_transactions(txns)
        r = evaluate_scorecard(report, REFERENCE_SPEC)
        self.assertGreater(r["scorePct"], 0)
        self.assertGreater(r["coveragePct"], 0)


if __name__ == "__main__":
    unittest.main()
