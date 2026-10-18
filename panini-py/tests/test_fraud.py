# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Python parity tests for consolidate_accounts / detect_fraud_indicators —
same scenarios and verdicts as packages/insights/tests/fraud.test.ts."""

import unittest

from panini import (
    FRAUD_RULE_IDS,
    consolidate_accounts,
    detect_fraud_indicators,
    detect_portfolio_indicators,
)

R = 100


def txn(**kw):
    base = {"date": "2024-01-15", "direction": "CREDIT", "amountPaise": 1000 * R}
    base.update(kw)
    return base


def ids(report):
    return [i["ruleId"] for i in report["indicators"]]


class TestFraudIndicators(unittest.TestCase):
    def test_circular_pair_different_counterparty(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-10", amountPaise=50_000 * R,
                narration="NEFT FROM ALPHA TRADERS"),
            txn(date="2024-01-11", direction="DEBIT", amountPaise=50_000 * R,
                narration="NEFT TO BETA HOLDINGS"),
        ])
        self.assertIn(FRAUD_RULE_IDS["CIRCULAR_PAIR"], ids(r))

    def test_same_counterparty_not_circular(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-10", amountPaise=50_000 * R,
                narration="NEFT FROM ALPHA TRADERS"),
            txn(date="2024-01-11", direction="DEBIT", amountPaise=50_000 * R,
                narration="NEFT TO ALPHA TRADERS"),
        ])
        self.assertNotIn(FRAUD_RULE_IDS["CIRCULAR_PAIR"], ids(r))

    def test_weekend_cash_deposits(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-13", narration="CASH DEP SELF"),   # Sat
            txn(date="2024-01-14", narration="CASH DEPOSIT AT BRANCH"),  # Sun
            txn(date="2024-01-15", narration="CASH DEP"),        # Mon
        ])
        ind = next(i for i in r["indicators"]
                   if i["ruleId"] == FRAUD_RULE_IDS["HOLIDAY_CASH"])
        self.assertEqual(len(ind["evidence"][0]["txnIndices"]), 2)

    def test_supplied_holiday_list(self):
        r = detect_fraud_indicators(
            [txn(date="2024-01-26", narration="CASH DEP")],
            {"holidays": ["2024-01-26"]},
        )
        self.assertIn(FRAUD_RULE_IDS["HOLIDAY_CASH"], ids(r))

    def test_rtgs_below_floor(self):
        r = detect_fraud_indicators([
            txn(amountPaise=150_000 * R, narration="RTGS-UTR123-VENDOR PAYMENT"),
            txn(amountPaise=250_000 * R, narration="RTGS-UTR456-GENUINE LARGE"),
        ])
        ind = next(i for i in r["indicators"]
                   if i["ruleId"] == FRAUD_RULE_IDS["RTGS_BELOW_FLOOR"])
        self.assertEqual(ind["evidence"][0]["txnIndices"], [0])

    def test_round_figures(self):
        txns = [txn(date=f"2024-01-{10 + i}", amountPaise=20_000 * R) for i in range(8)]
        txns.append(txn(date="2024-02-01", amountPaise=12_345 * R))
        txns.append(txn(date="2024-02-02", amountPaise=9_876 * R))
        self.assertIn(FRAUD_RULE_IDS["ROUND_FIGURES"], ids(detect_fraud_indicators(txns)))

    def test_gap_months(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-10"),
            txn(date="2024-01-20", direction="DEBIT"),
            txn(date="2024-04-05"),
            txn(date="2024-04-06", direction="DEBIT"),
        ])
        gaps = [i["note"] for i in r["indicators"]
                if i["ruleId"] == FRAUD_RULE_IDS["GAP_MONTH"]]
        self.assertTrue(any("2024-02" in n for n in gaps))
        self.assertTrue(any("2024-03" in n for n in gaps))

    def test_wash_month(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-05", amountPaise=400_000 * R, narration="NEFT IN"),
            txn(date="2024-01-10", amountPaise=300_000 * R, narration="UPI IN"),
            txn(date="2024-01-20", direction="DEBIT", amountPaise=699_000 * R),
            txn(date="2024-02-05", amountPaise=100_000 * R),
            txn(date="2024-02-10", direction="DEBIT", amountPaise=10_000 * R),
        ])
        wash = next(i for i in r["indicators"]
                    if i["ruleId"] == FRAUD_RULE_IDS["WASH_MONTH"])
        self.assertIn("2024-01", wash["evidence"][0]["note"])

    def test_salary_stop(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-01", amountPaise=75_000 * R, is_salary=True),
            txn(date="2024-02-01", amountPaise=75_000 * R, is_salary=True),
            txn(date="2024-03-01", amountPaise=75_000 * R, is_salary=True),
            txn(date="2024-05-15", direction="DEBIT", amountPaise=5_000 * R),
        ])
        stop = next(i for i in r["indicators"]
                    if i["ruleId"] == FRAUD_RULE_IDS["SALARY_STOP"])
        self.assertIn("absent after 2024-03", stop["note"])

    def test_salary_strip(self):
        txns = []
        for m in ("01", "02", "03"):
            txns.append(txn(date=f"2024-{m}-01", amountPaise=80_000 * R, is_salary=True))
            txns.append(txn(date=f"2024-{m}-02", direction="DEBIT",
                            amountPaise=78_000 * R, narration="NEFT TO X"))
        self.assertIn(FRAUD_RULE_IDS["SALARY_STRIP"], ids(detect_fraud_indicators(txns)))

    def test_dormant_spike(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-05", amountPaise=10_000 * R),
            txn(date="2024-01-10", amountPaise=12_000 * R),
            txn(date="2024-03-20", amountPaise=500_000 * R),
        ])
        self.assertIn(FRAUD_RULE_IDS["DORMANT_SPIKE"], ids(r))

    def test_overdrawn_days(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-05", balancePaise=10_000 * R),
            txn(date="2024-01-06", direction="DEBIT", amountPaise=20_000 * R,
                balancePaise=-10_000 * R),
            txn(date="2024-01-07", direction="DEBIT", amountPaise=1_000 * R,
                balancePaise=-11_000 * R),
        ])
        od = next(i for i in r["indicators"]
                  if i["ruleId"] == FRAUD_RULE_IDS["OVERDRAWN_DAYS"])
        self.assertEqual(od["evidence"][0]["txnIndices"], [1, 2])

    def test_penalty_charges(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-31", direction="DEBIT", amountPaise=590 * R,
                narration="MIN BAL CHG"),
            txn(date="2024-02-29", direction="DEBIT", amountPaise=590 * R,
                narration="NON MAINTENANCE CHARGE"),
        ])
        self.assertIn(FRAUD_RULE_IDS["PENALTY_CHARGES"], ids(r))

    def test_clean_statement_no_indicators(self):
        r = detect_fraud_indicators([
            txn(date="2024-01-02", amountPaise=45_231 * R,
                narration="NEFT SALARY ACME CORP"),
            txn(date="2024-01-03", direction="DEBIT", amountPaise=12_345 * R,
                narration="UPI-SWIGGY"),
            txn(date="2024-01-05", direction="DEBIT", amountPaise=3_210 * R,
                narration="UPI-UBER"),
        ])
        self.assertEqual(r["indicators"], [])

    def test_malformed_rows_warn_not_throw(self):
        r = detect_fraud_indicators([txn(), {"date": "2024-01-01", "direction": None,
                                             "amountPaise": 100}])
        self.assertIn("skipped", r["warnings"][0])


class TestConsolidate(unittest.TestCase):
    def test_internal_transfer_netted(self):
        r = consolidate_accounts([
            {"accountKey": "A", "transactions": [
                txn(date="2024-01-10", direction="DEBIT", amountPaise=60_000 * R)]},
            {"accountKey": "B", "transactions": [
                txn(date="2024-01-11", amountPaise=60_000 * R)]},
        ])
        self.assertEqual(len(r["internalTransfers"]), 1)
        t = r["internalTransfers"][0]
        self.assertEqual((t["fromAccount"], t["toAccount"]), ("A", "B"))
        self.assertEqual(r["consolidated"]["externalCreditsPaise"], 0)
        self.assertEqual(r["consolidated"]["internalVolumePaise"], 60_000 * R)

    def test_same_account_not_internal(self):
        r = consolidate_accounts([
            {"accountKey": "A", "transactions": [
                txn(date="2024-01-10", direction="DEBIT", amountPaise=60_000 * R),
                txn(date="2024-01-11", amountPaise=60_000 * R)]},
        ])
        self.assertEqual(r["internalTransfers"], [])

    def test_duplicate_ref_no(self):
        r = consolidate_accounts([
            {"accountKey": "A-jan", "transactions": [
                txn(date="2024-01-10", refNo="UTR12345678")]},
            {"accountKey": "A-feb", "transactions": [
                txn(date="2024-01-10", refNo="UTR12345678")]},
        ])
        self.assertEqual(len(r["duplicates"]), 1)
        self.assertEqual(r["duplicates"][0]["refNo"], "UTR12345678")

    def test_rollup_period(self):
        r = consolidate_accounts([
            {"accountMask": "XX1234", "bank": "HDFC", "transactions": [
                txn(date="2024-01-05"),
                txn(date="2024-03-15", direction="DEBIT")]},
        ])
        a = r["accounts"][0]
        self.assertEqual(a["accountKey"], "HDFC-XX1234")
        self.assertEqual((a["periodStart"], a["periodEnd"]), ("2024-01-05", "2024-03-15"))


class TestPortfolioIndicators(unittest.TestCase):
    def test_cycle_a_b_a(self):
        r = detect_portfolio_indicators([
            {"accountKey": "A", "transactions": [
                txn(date="2024-01-10", direction="DEBIT", amountPaise=50_000 * R),
                txn(date="2024-01-12", amountPaise=50_000 * R)]},
            {"accountKey": "B", "transactions": [
                txn(date="2024-01-10", amountPaise=50_000 * R),
                txn(date="2024-01-12", direction="DEBIT", amountPaise=50_000 * R)]},
        ])
        self.assertIn(FRAUD_RULE_IDS["CROSS_ACCOUNT_CYCLE"], ids(r))

    def test_inflated_turnover(self):
        r = detect_portfolio_indicators([
            {"accountKey": "A", "transactions": [
                txn(date="2024-01-05", direction="DEBIT", amountPaise=40_000 * R),
                txn(date="2024-01-10", direction="DEBIT", amountPaise=40_000 * R),
                txn(date="2024-01-15", direction="DEBIT", amountPaise=40_000 * R),
                txn(date="2024-01-20", amountPaise=10_000 * R)]},
            {"accountKey": "B", "transactions": [
                txn(date="2024-01-05", amountPaise=40_000 * R),
                txn(date="2024-01-10", amountPaise=40_000 * R),
                txn(date="2024-01-15", amountPaise=40_000 * R)]},
        ])
        ind = next(i for i in r["indicators"]
                   if i["ruleId"] == FRAUD_RULE_IDS["INFLATED_TURNOVER"])
        self.assertIn("92%", ind["note"])


if __name__ == "__main__":
    unittest.main()
