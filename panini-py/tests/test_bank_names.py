# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Parity tests for bank-name detection + extra_formats_dir — mirrors
packages/extract/tests/bankNames.test.ts."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from panini.extract import detect_bank_id, extract_csv_statement

_FORMATS = Path(__file__).resolve().parents[1] / "panini" / "formats"
_NAMES = json.loads((_FORMATS / "bank-names.json").read_text())

_GENERICT_CSV = (
    "BANDHAN BANK LTD\n"
    "Account No : XXXXXX7777\n"
    "Posting Date,Details,Debit,Credit,Running Balance\n"
    "2026-10-15,UPI-SALARY,,50000.00,95000.00\n"
    "2026-10-16,CARD PURCHASE POS ZOMATO,450.00,,94550.00"
)


class TestDetectBankId(unittest.TestCase):
    def test_letterhead_line(self):
        self.assertEqual(
            detect_bank_id("BANDHAN BANK LTD\nAccount No : XXXX1\n", _NAMES),
            "BANDHAN",
        )

    def test_longest_name_on_line_wins(self):
        self.assertEqual(detect_bank_id("UNION BANK OF INDIA\n", _NAMES), "UNION")
        self.assertEqual(detect_bank_id("SOUTH INDIAN BANK\n", _NAMES), "SIB")
        self.assertEqual(
            detect_bank_id("CENTRAL BANK OF INDIA\n", _NAMES), "CENTRAL_BANK"
        )

    def test_word_bounded(self):
        self.assertEqual(detect_bank_id("CITY UNION BANK LTD\n", _NAMES), "CUB")

    def test_outside_scan_window(self):
        text = "\n".join(["noise line"] * 25) + "\nNEFT CREDIT FROM HDFC BANK"
        self.assertIsNone(detect_bank_id(text, _NAMES))

    def test_ampersand_names_detect(self):
        # Input text is normalized before matching ('&' -> ' '), so names
        # stored with punctuation must still hit.
        self.assertEqual(detect_bank_id("Jammu & Kashmir Bank Ltd\n", _NAMES), "JAKB")
        self.assertEqual(detect_bank_id("Punjab & Sind Bank\n", _NAMES), "PSB")


class TestExtractionBankDetection(unittest.TestCase):
    def test_uncovered_bank_names_itself_on_generic_parse(self):
        result = extract_csv_statement(_GENERICT_CSV)
        self.assertEqual(result["bank"], "BANDHAN")
        self.assertEqual(result["metadata"].get("bankSource"), "preamble")
        self.assertEqual(len(result["transactions"]), 2)
        joined = " ".join(result["warnings"])
        self.assertIn("generic fallback", joined)
        self.assertIn("BANDHAN", joined)

    def test_dedicated_layout_keeps_layout_provenance(self):
        csv = (
            "HDFC BANK LTD\n"
            "Account No : XXXXXX1111\n"
            "Date,Narration,Chq Ref No,Withdrawal Amt,Deposit Amt,Closing Balance\n"
            "15/10/2026,UPI/123/CR/SALARY,R1,,50000.00,95000.00"
        )
        result = extract_csv_statement(csv)
        self.assertEqual(result["bank"], "HDFC")
        self.assertEqual(result["metadata"].get("bankSource"), "layout")
        self.assertNotIn("generic fallback", " ".join(result["warnings"]))


class TestExtraFormatsDir(unittest.TestCase):
    def test_private_bank_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            layout = {
                "layouts": [
                    {
                        "id": "private_bank_statement",
                        "bank": "PRIVATEBANK",
                        "requiredHeaders": [
                            "posting date", "memo", "dr amt", "cr amt",
                        ],
                        "columns": {
                            "date": ["posting date"],
                            "narration": ["memo"],
                            "debit": ["dr amt"],
                            "credit": ["cr amt"],
                            "balance": ["running total"],
                        },
                    }
                ]
            }
            (Path(tmp) / "csv-layouts.json").write_text(json.dumps(layout))
            csv = (
                "PRIVATE CO-OP BANK\n"
                "Posting Date,Memo,Dr Amt,Cr Amt,Running Total\n"
                "15/10/2026,UPI-INWARD,,1000.00,11000.00"
            )
            result = extract_csv_statement(csv, extra_formats_dir=Path(tmp))
            self.assertEqual(result["bank"], "PRIVATEBANK")
            self.assertEqual(result["layoutId"], "private_bank_statement")
            self.assertEqual(len(result["transactions"]), 1)


if __name__ == "__main__":
    unittest.main()
