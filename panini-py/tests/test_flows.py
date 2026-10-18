# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Python parity tests for counterparty_flows / detect_conduct_metrics —
mirroring packages/insights/tests/flows.test.ts."""

import unittest

from panini import counterparty_flows, detect_conduct_metrics

R = 100


def txn(**kw):
    base = {"date": "2024-01-15", "direction": "CREDIT", "amountPaise": 1000 * R}
    base.update(kw)
    return base


class TestCounterpartyFlows(unittest.TestCase):
    def test_in_out_net_sorted_by_volume(self):
        r = counterparty_flows([
            txn(counterparty="ACME CORP", amountPaise=80_000 * R),
            txn(counterparty="Swiggy", direction="DEBIT", amountPaise=500 * R),
            txn(counterparty="ACME CORP", amountPaise=80_000 * R, date="2024-02-01"),
            txn(counterparty="swiggy", direction="DEBIT", amountPaise=300 * R),
        ])
        self.assertEqual(r["flows"][0]["counterparty"], "ACME CORP")
        self.assertEqual(r["flows"][0]["inflowPaise"], 160_000 * R)
        self.assertEqual(r["flows"][1]["counterparty"], "SWIGGY")
        self.assertEqual(r["flows"][1]["outflowPaise"], 800 * R)
        self.assertEqual(r["flows"][1]["netPaise"], -800 * R)
        self.assertEqual(r["flows"][1]["txnIndices"], [1, 3])

    def test_unattributed_count(self):
        r = counterparty_flows([
            txn(counterparty="KNOWN", amountPaise=5000 * R),
            txn(narration="1234 5678 9012", amountPaise=100 * R),
        ])
        self.assertEqual(r["unattributedCount"], 1)
        self.assertEqual(len(r["flows"]), 1)

    def test_top_limit(self):
        txns = [txn(counterparty=f"CP-{i}", amountPaise=(i + 1) * 1000 * R)
                for i in range(30)]
        self.assertEqual(len(counterparty_flows(txns, {"top": 5})["flows"]), 5)

    def test_first_last_seen(self):
        r = counterparty_flows([
            txn(counterparty="X", date="2024-03-10"),
            txn(counterparty="X", date="2024-01-05"),
            txn(counterparty="X", date="2024-02-20"),
        ])
        f = r["flows"][0]
        self.assertEqual((f["firstSeen"], f["lastSeen"]), ("2024-01-05", "2024-03-10"))


class TestConductMetrics(unittest.TestCase):
    def test_overdrawn_eod_days(self):
        m = detect_conduct_metrics([
            txn(date="2024-01-05", balancePaise=5000 * R),
            txn(date="2024-01-05", direction="DEBIT", amountPaise=8000 * R,
                balancePaise=-3000 * R),
            txn(date="2024-01-06", direction="DEBIT", amountPaise=500 * R,
                balancePaise=-3500 * R),
            txn(date="2024-01-07", amountPaise=10_000 * R, balancePaise=6500 * R),
        ])["metrics"]
        self.assertEqual(m["overdrawnDays"], 2)
        self.assertEqual(m["worstOverdraftPaise"], -3500 * R)

    def test_bounce_rate(self):
        m = detect_conduct_metrics([
            txn(date="2024-01-05", amountPaise=50_000 * R),
            txn(date="2024-01-06", direction="DEBIT", amountPaise=5000 * R,
                narration="NACH RTN CHG"),
            txn(date="2024-01-07", direction="DEBIT", amountPaise=1000 * R,
                narration="UPI-SWIGGY"),
            txn(date="2024-01-08", direction="DEBIT", amountPaise=500 * R,
                narration="ECS RETURN"),
            txn(date="2024-01-09", direction="DEBIT", amountPaise=200 * R,
                narration="UPI-UBER"),
        ])["metrics"]
        self.assertEqual(m["bounceCount"], 2)
        self.assertEqual(m["bounceRatePct"], 50)

    def test_overdrawn_signal(self):
        txns = [
            txn(date=f"2024-01-{d:02d}", direction="DEBIT", amountPaise=100 * R,
                balancePaise=-500 * R)
            for d in range(1, 11)
        ]
        signals = detect_conduct_metrics(txns)["signals"]
        self.assertIn("overdrawn", signals[0]["note"])

    def test_clean_account(self):
        r = detect_conduct_metrics([
            txn(date="2024-01-05", amountPaise=45_231 * R, balancePaise=60_000 * R),
            txn(date="2024-01-06", direction="DEBIT", amountPaise=1_234 * R,
                balancePaise=58_766 * R),
        ])
        self.assertEqual(r["metrics"]["overdrawnDays"], 0)
        self.assertEqual(r["metrics"]["bounceCount"], 0)
        self.assertIsNotNone(r["metrics"]["averageEodBalancePaise"])
        self.assertEqual(r["signals"], [])


if __name__ == "__main__":
    unittest.main()
