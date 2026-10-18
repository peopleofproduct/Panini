# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Parity tests for panini.reconcile — mirrors
packages/forensics/tests/reconcile.test.ts."""

from __future__ import annotations

import unittest

from panini.reconcile import reconcile_with_aa, transactions_from_aa_data


def _doc_txn(date, narration, direction, amount, balance):
    return {
        "date": date,
        "narration": narration,
        "refNo": None,
        "direction": direction,
        "amountPaise": amount,
        "balancePaise": balance,
        "raw": "",
        "warnings": [],
    }


def _statement(txns):
    return {
        "format": "pdf",
        "bank": None,
        "layoutId": None,
        "accountMask": None,
        "transactions": txns,
        "warnings": [],
        "metadata": {},
    }


def _aa(date, typ, amount, narration, balance=None):
    t = {
        "txnId": f"T{date}{amount}",
        "amount": amount,
        "type": typ,
        "valueDate": date,
        "narration": narration,
    }
    if balance is not None:
        t["currentBalance"] = balance
    return t


def _doc():
    return _statement(
        [
            _doc_txn("2026-10-15", "UPI/SWIGGY", "DEBIT", 10000, 90000),
            _doc_txn("2026-10-16", "UPI/REFUND", "CREDIT", 20000, 110000),
            _doc_txn("2026-10-17", "UPI/AMAZON", "DEBIT", 30000, 80000),
        ]
    )


def _truth():
    return [
        _aa("2026-10-15", "DEBIT", "100.00", "UPI SWIGGY", "900.00"),
        _aa("2026-10-16", "CREDIT", "200.00", "UPI REFUND", "1100.00"),
        _aa("2026-10-17", "DEBIT", "300.00", "UPI AMAZON", "800.00"),
    ]


class ReconcileWithAa(unittest.TestCase):
    def test_consistent_when_document_matches_truth(self):
        r = reconcile_with_aa(_doc(), _truth())
        self.assertEqual(r["verdict"], "consistent")
        self.assertEqual(r["matchedRows"], 3)

    def test_fabricated_rows_flagged(self):
        doc = _doc()
        doc["transactions"].append(
            _doc_txn("2026-10-18", "SALARY CREDIT", "CREDIT", 5000000, 5080000)
        )
        r = reconcile_with_aa(doc, _truth())
        self.assertEqual(r["verdict"], "fabrication_evidence")
        self.assertEqual(r["documentOnlyRows"], [3])
        self.assertIn("unknown to the bank feed", r["summary"])

    def test_omitted_bank_rows_flagged(self):
        doc = _statement(
            [
                _doc_txn("2026-10-15", "UPI/SWIGGY", "DEBIT", 10000, 90000),
                _doc_txn("2026-10-16", "UPI/REFUND", "CREDIT", 20000, 110000),
            ]
        )
        r = reconcile_with_aa(doc, _truth())
        self.assertEqual(r["verdict"], "fabrication_evidence")
        self.assertEqual(r["aaOnlyRows"], [2])

    def test_amount_altered_rows_flagged(self):
        doc = _doc()
        doc["transactions"][1] = _doc_txn(
            "2026-10-16", "UPI/REFUND", "CREDIT", 50000, 140000
        )
        r = reconcile_with_aa(doc, _truth())
        self.assertEqual(r["verdict"], "fabrication_evidence")

    def test_one_day_value_posting_drift_tolerated(self):
        aa = _truth()
        aa[0] = _aa("2026-10-16", "DEBIT", "100.00", "UPI SWIGGY", "900.00")
        r = reconcile_with_aa(_doc(), aa)
        self.assertNotEqual(r["verdict"], "fabrication_evidence")
        self.assertEqual(r["matchedRows"], 3)

    def test_narration_drift_is_soft(self):
        aa = _truth()
        aa[0] = _aa(
            "2026-10-15", "DEBIT", "100.00", "UPI-SWIGGY BUNDY TECHNOLOGIES", "900.00"
        )
        r = reconcile_with_aa(_doc(), aa)
        self.assertEqual(r["verdict"], "partial")
        self.assertTrue(any(m["field"] == "narration" for m in r["mismatches"]))

    def test_outside_aa_coverage_is_unverifiable_not_suspect(self):
        doc = _doc()
        doc["transactions"].append(
            _doc_txn("2026-11-20", "LATER TXN", "DEBIT", 5000, 75000)
        )
        r = reconcile_with_aa(doc, _truth())
        self.assertEqual(r["verdict"], "consistent")
        self.assertEqual(r["unverifiableRows"], [3])
        self.assertEqual(r["documentOnlyRows"], [])

    def test_incomparable_on_empty(self):
        self.assertEqual(
            reconcile_with_aa(_statement([]), _truth())["verdict"], "incomparable"
        )
        self.assertEqual(reconcile_with_aa(_doc(), [])["verdict"], "incomparable")

    def test_deterministic(self):
        doc = _doc()
        doc["transactions"].append(
            _doc_txn("2026-10-18", "FAKE", "CREDIT", 100, 80100)
        )
        self.assertEqual(
            reconcile_with_aa(doc, _truth()), reconcile_with_aa(doc, _truth())
        )


class TransactionsFromAaData(unittest.TestCase):
    def test_extracts_rebit_transaction_shape(self):
        fi = {
            "Account": {
                "Transactions": {
                    "Transaction": [
                        {
                            "txnId": "1",
                            "amount": "100.00",
                            "type": "DEBIT",
                            "valueDate": "2026-10-15",
                        },
                        {
                            "txnId": "2",
                            "amount": "200.00",
                            "type": "CREDIT",
                            "valueDate": "2026-10-16",
                        },
                    ]
                }
            }
        }
        txns = transactions_from_aa_data(fi)
        self.assertEqual(len(txns), 2)
        self.assertEqual(txns[0]["type"], "DEBIT")

    def test_extractor_handles_bare_and_bad_shapes(self):
        self.assertEqual(
            len(
                transactions_from_aa_data(
                    [{"amount": "10.00", "valueDate": "2026-10-15"}]
                )
            ),
            1,
        )
        self.assertEqual(transactions_from_aa_data({"Profile": {"name": "x"}}), [])
        self.assertEqual(transactions_from_aa_data(None), [])
        self.assertEqual(transactions_from_aa_data("string"), [])


if __name__ == "__main__":
    unittest.main()
