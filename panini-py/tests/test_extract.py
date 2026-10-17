# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Extraction conformance gate: every fixture in
packages/extract/formats/corpus/*.json runs through the Python extractor
and must produce the same rows the TypeScript corpus gate checks."""

from __future__ import annotations

import glob
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from panini import extract_csv_statement, extract_sms  # noqa: E402

CORPUS_DIR = (
    Path(__file__).resolve().parents[2]
    / "packages" / "extract" / "formats" / "corpus"
)


def _fixtures():
    for path in sorted(glob.glob(str(CORPUS_DIR / "*.json"))):
        yield path, json.loads(Path(path).read_text())


class ExtractConformance(unittest.TestCase):
    pass  # cases generated below


def _check_csv(path, fixture):
    def check(self):
        result = extract_csv_statement(fixture["input"])
        expect = fixture["expect"]
        self.assertEqual(result["bank"], expect["bank"], f"{Path(path).name} bank")
        self.assertEqual(
            result["layoutId"], expect["layoutId"], f"{Path(path).name} layout"
        )
        if "accountMask" in expect:
            self.assertEqual(result["accountMask"], expect["accountMask"])
        self.assertEqual(
            len(result["transactions"]), expect["count"],
            f"{Path(path).name} row count: {result['warnings']}",
        )
        for i, want in enumerate(expect.get("rows", [])):
            got = result["transactions"][i]
            for key, val in want.items():
                self.assertEqual(
                    got.get(key), val,
                    f"{Path(path).name} row {i} field {key!r}: "
                    f"expected {val!r}, got {got.get(key)!r}",
                )

    return check


def _check_sms(path, sample, idx):
    def check(self):
        result = extract_sms(sample["input"])
        self.assertEqual(len(result["transactions"]), 1, f"{Path(path).name}[{idx}]")
        txn = result["transactions"][0]
        got = {
            "direction": txn["direction"],
            "amountPaise": txn["amountPaise"],
            "balancePaise": txn["balancePaise"],
            "date": txn["date"],
            "accountMask": result["accountMask"],
        }
        for key, want in sample["expect"].items():
            self.assertEqual(
                got.get(key), want,
                f"{Path(path).name}[{idx}] field {key!r}: "
                f"expected {want!r}, got {got.get(key)!r}",
            )

    return check


for _path, _fixture in _fixtures():
    _name = Path(_path).stem
    if _fixture.get("format") == "csv":
        setattr(ExtractConformance, f"test_{_name}", _check_csv(_path, _fixture))
    elif _fixture.get("format") == "sms":
        for _i, _s in enumerate(_fixture.get("samples", [])):
            setattr(ExtractConformance, f"test_{_name}_{_i}", _check_sms(_path, _s, _i))


if __name__ == "__main__":
    unittest.main()
