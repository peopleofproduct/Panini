# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Python parity tests for documents.py — same fixtures and expectations
as packages/extract/tests/documents.test.ts."""

import unittest

from panini import (
    detect_document_type,
    extract_document,
    extract_form26as,
    extract_itrv,
    extract_payslip,
)

PAYSLIP = """
ACME TECHNOLOGIES PVT LTD
Payslip for the month of March 2024
Employee Name    RAHUL SHARMA
Employee ID      EMP1234
Designation      Senior Engineer
PAN              AXYPD1234K
UAN              100912345678
PF No.           MH/BAN/1234567
Bank A/c         XXXX5678

EARNINGS
Basic            52,000.00
HRA              20,800.00
Special Allowance    15,000.00
Conveyance       1,600.00
Gross Earnings   89,400.00

DEDUCTIONS
PF               6,240.00
Professional Tax 200.00
TDS              3,500.00
Total Deductions 9,940.00

Net Pay          79,460.00
"""

ITRV = """
INDIAN INCOME TAX RETURN VERIFICATION FORM
ITR-V
Assessment Year 2024-25
Name RAHUL SHARMA
PAN AXYPD1234K
Form No. which has been electronically transmitted ITR-1
Status Individual
Original or Revised ORIGINAL
E-filing Acknowledgement Number 123456789012345
Date (DD-MM-YYYY) 17-10-2024
1 Gross Total Income 850000
2 Deductions under Chapter-VI-A 150000
3 Total Income 700000
3a Current Year loss, if any 0
4 Net Tax Payable 58500
5 Interest Payable 0
6 Total Tax and Interest Payable 58500
7a Advance Tax 0
7b TDS 81219
7c TCS 0
7d Self Assessment Tax 0
7e Total Taxes Paid (7a+7b+7c+7d) 81219
8 Tax Payable (6-7e) 0
9 Refund (7e-6) 22719
10 Exempt Income Agriculture 0 Others 0
VERIFICATION
"""

F26AS = """
FORM NO. 26AS
Annual Tax Statement under Section 203AA
Name of Assessee RAHUL SHARMA
PAN of Assessee AXYPD1234K
Assessment Year 2024-25
PART A - Details of Tax Deducted at Source
ACME TECHNOLOGIES PVT LTD MUMA12345E 192 31-03-2024 850000.00 81219.00 81219.00
XYZ BANK LIMITED MUMB67890F 194A 31-03-2024 15000.00 1500.00 1500.00
Total 865000.00 82719.00 82719.00
"""


class TestDetect(unittest.TestCase):
    def test_routes_each_kind(self):
        self.assertEqual(detect_document_type(PAYSLIP), "payslip")
        self.assertEqual(detect_document_type(ITRV), "itrv")
        self.assertEqual(detect_document_type(F26AS), "form26as")
        self.assertEqual(
            detect_document_type("Date,Narration,Withdrawal\n01/01/24,X,100"),
            "statement",
        )
        self.assertEqual(detect_document_type("hello world"), "unknown")


class TestPayslip(unittest.TestCase):
    def setUp(self):
        self.slip = extract_payslip(PAYSLIP)

    def test_identity_and_period(self):
        self.assertEqual(self.slip["kind"], "payslip")
        self.assertEqual(self.slip["employeeName"], "RAHUL SHARMA")
        self.assertIn("ACME TECHNOLOGIES", self.slip["employer"])
        self.assertEqual(self.slip["period"], "2024-03")
        self.assertEqual(self.slip["ids"]["pan"], "AXYPD1234K")
        self.assertEqual(self.slip["ids"]["uan"], "100912345678")

    def test_components(self):
        labels = {f"{c['side']}:{c['label']}" for c in self.slip["components"]}
        self.assertIn("earning:Basic", labels)
        self.assertIn("earning:HRA", labels)
        self.assertIn("deduction:PF", labels)
        self.assertIn("deduction:TDS", labels)
        self.assertIn("deduction:Professional Tax", labels)

    def test_totals_and_arithmetic(self):
        self.assertEqual(self.slip["grossPaise"], 8940000)
        self.assertEqual(self.slip["deductionsPaise"], 994000)
        self.assertEqual(self.slip["netPayPaise"], 7946000)
        self.assertEqual(self.slip["arithmeticCheck"], "ok")

    def test_mismatch_flagged(self):
        bad = extract_payslip(
            PAYSLIP.replace("Net Pay          79,460.00", "Net Pay          99,460.00")
        )
        self.assertEqual(bad["arithmeticCheck"], "mismatch")
        self.assertIn("≠", " ".join(bad["warnings"]))


class TestItrV(unittest.TestCase):
    def test_fields(self):
        doc = extract_itrv(ITRV)
        self.assertEqual(doc["kind"], "itrv")
        self.assertEqual(doc["pan"], "AXYPD1234K")
        self.assertEqual(doc["ackNo"], "123456789012345")
        self.assertEqual(doc["filingDate"], "17-10-2024")
        self.assertEqual(doc["assessmentYear"], "2024-25")
        self.assertEqual(doc["itrForm"], "ITR-1")
        self.assertEqual(doc["grossTotalIncomePaise"], 85000000)
        self.assertEqual(doc["deductionsChapterViaPaise"], 15000000)
        self.assertEqual(doc["totalIncomePaise"], 70000000)
        self.assertEqual(doc["tdsPaise"], 8121900)
        self.assertEqual(doc["refundPaise"], 2271900)
        self.assertEqual(doc["arithmeticCheck"], "ok")


class TestForm26as(unittest.TestCase):
    def test_entries(self):
        doc = extract_form26as(F26AS)
        self.assertEqual(doc["pan"], "AXYPD1234K")
        self.assertEqual(len(doc["entries"]), 2)
        e0 = doc["entries"][0]
        self.assertEqual(e0["deductor"], "ACME TECHNOLOGIES PVT LTD")
        self.assertEqual(e0["tan"], "MUMA12345E")
        self.assertEqual(e0["section"], "192")
        self.assertEqual(e0["paidPaise"], 85000000)
        self.assertEqual(e0["taxDeductedPaise"], 8121900)
        self.assertEqual(doc["totalTaxDeductedPaise"], 8271900)


class TestDispatcher(unittest.TestCase):
    def test_extract_document(self):
        self.assertEqual(extract_document(PAYSLIP)["kind"], "payslip")
        self.assertEqual(extract_document(ITRV)["kind"], "itrv")
        self.assertIsNone(extract_document("unstructured text"))


if __name__ == "__main__":
    unittest.main()
