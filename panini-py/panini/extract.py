# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Statement extraction — Python port of @paniniapi/extract (CSV + SMS
tiers). Shares the same formats JSONs and corpus fixtures as the
TypeScript package; PDF/xlsx/image tiers are seams upstream and
intentionally not ported.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
from pathlib import Path
from typing import Any, Optional

from .dates import parse_indian_date

# ── format resolution ────────────────────────────────────────────────────────

def _formats_dir() -> Path:
    env = os.environ.get("PANINI_FORMATS_DIR")
    if env:
        return Path(env)
    bundled = Path(__file__).resolve().parent / "formats"
    if (bundled / "csv-layouts.json").exists():
        return bundled
    return (
        Path(__file__).resolve().parents[2] / "packages" / "extract" / "formats"
    )


def _load(name: str, formats_dir: Optional[Path]) -> dict[str, Any]:
    return json.loads(((formats_dir or _formats_dir()) / name).read_text())


# ── dates & amounts ─────────────────────────────────────────────────────────

_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7,
    "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12,
    "december": 12,
}

_NAMED_DATE = re.compile(r"^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ](\d{2,4})$")


def parse_statement_date(value: str) -> Optional[str]:
    direct = parse_indian_date(value)
    if direct:
        return direct
    m = _NAMED_DATE.match(value.strip())
    if not m:
        return None
    month = _MONTHS.get(m.group(2).lower())
    if month is None:
        return None
    return parse_indian_date(f"{int(m.group(1)):02d}-{month:02d}-{m.group(3)}")


_AMOUNT_BODY = re.compile(r"^\d+(?:\.\d{1,2})?$")
_CURRENCY_PREFIX = re.compile(r"^(?:rs\.?|inr|₹)\s*", re.IGNORECASE)


def _parse_paise(value: str) -> Optional[int]:
    stripped = _CURRENCY_PREFIX.sub("", value.strip()).replace(",", "")
    if not _AMOUNT_BODY.match(stripped):
        return None
    return round(float(stripped) * 100)


def _js_regex(pattern: str) -> re.Pattern[str]:
    """JS named groups `(?<name>…)` → Python `(?P<name>…)`."""
    return re.compile(re.sub(r"\(\?<([A-Za-z])", r"(?P<\1", pattern), re.IGNORECASE)


_ACCOUNT_RE = re.compile(
    r"(?:a/c|account)\s*(?:no\.?|number|#)?\s*[:-]?\s*"
    r"(?:x{2,}|\*{2,}|\d{2,}[x*]{2,})?(\d{3,6})\b",
    re.IGNORECASE,
)

_DR_CR_SUFFIX = re.compile(r"\b(dr|cr|debit|credit)\b\.?\s*$", re.IGNORECASE)


def _find_account_mask(text: str) -> Optional[str]:
    m = _ACCOUNT_RE.search(text)
    return m.group(1) if m else None


def _direction_from_text(value: str) -> Optional[str]:
    upper = value.upper()
    if re.search(r"\b(DR|DEBIT|WITHDRAWAL|WDL)\b", upper):
        return "DEBIT"
    if re.search(r"\b(CR|CREDIT|DEPOSIT|DEP)\b", upper):
        return "CREDIT"
    return None


# ── CSV parsing ──────────────────────────────────────────────────────────────

def parse_csv(text: str) -> list[list[str]]:
    """RFC-4180 rows via the stdlib reader; a leading BOM is stripped."""
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    return [row for row in reader]


def _norm_cell(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower())).strip()


def detect_table(
    rows: list[list[str]], layouts_file: dict[str, Any],
    bank_hint: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    max_scan = min(int(layouts_file.get("maxHeaderScanRows", 15)), len(rows))
    norm_rows = [[_norm_cell(c) for c in row] for row in rows]

    layouts = list(layouts_file.get("layouts", []))
    if bank_hint:
        hint = bank_hint.upper()
        layouts.sort(
            key=lambda l: (0 if l["bank"] == hint else 2 if l["bank"] == "GENERIC" else 1)
        )

    for layout in layouts:
        required = set(layout.get("requiredHeaders", []))
        for i in range(max_scan):
            cells = norm_rows[i]
            if required.issubset(set(cells)):
                columns: dict[str, int] = {}
                for field, candidates in layout.get("columns", {}).items():
                    for idx, cell in enumerate(cells):
                        if cell in candidates:
                            columns[field] = idx
                            break
                if "date" in columns:
                    return {"layout": layout, "headerRowIndex": i, "columns": columns}

    # Heuristic fallback: canonical keyword coverage with a date column.
    generic = next(
        (l for l in layouts_file.get("layouts", []) if l["id"] == "generic_statement"),
        None,
    )
    keyword_fields: dict[str, list[str]] = generic["columns"] if generic else {}
    best: Optional[dict[str, Any]] = None
    best_score = 0
    for i in range(max_scan):
        cells = norm_rows[i]
        columns = {}
        score = 0
        for field, candidates in keyword_fields.items():
            for idx, cell in enumerate(cells):
                if cell in candidates:
                    columns[field] = idx
                    score += 1
                    break
        if (
            score > best_score
            and "date" in columns
            and any(k in columns for k in ("narration", "debit", "amount"))
        ):
            best_score = score
            best = {"layout": None, "headerRowIndex": i, "columns": columns}
    return best


def map_row(cells: list[str], columns: dict[str, int]) -> dict[str, Any]:
    warnings: list[str] = []

    def cell(field: str) -> Optional[str]:
        idx = columns.get(field)
        if idx is None or idx >= len(cells) or cells[idx].strip() == "":
            return None
        return cells[idx].strip()

    date = None
    raw_date = cell("date")
    if raw_date:
        date = parse_statement_date(raw_date)
        if not date:
            warnings.append(f"unparseable date '{raw_date}'")

    amount_paise: Optional[int] = None
    direction: Optional[str] = None

    debit_raw, credit_raw = cell("debit"), cell("credit")
    amount_raw, direction_raw = cell("amount"), cell("direction")

    if debit_raw is not None:
        amount_paise = _parse_paise(debit_raw)
        direction = "DEBIT"
        if amount_paise is None:
            warnings.append(f"unparseable debit '{debit_raw}'")
    if credit_raw is not None:
        credit = _parse_paise(credit_raw)
        if credit is None:
            warnings.append(f"unparseable credit '{credit_raw}'")
        elif amount_paise is None:
            amount_paise = credit
            direction = "CREDIT"
        else:
            warnings.append("row carries both debit and credit; debit kept")
    if amount_paise is None and amount_raw is not None:
        suffix = _DR_CR_SUFFIX.search(amount_raw)
        bare = _DR_CR_SUFFIX.sub("", amount_raw).strip() if suffix else amount_raw
        parsed = _parse_paise(bare)
        if parsed is None:
            warnings.append(f"unparseable amount '{amount_raw}'")
        else:
            amount_paise = parsed
            direction = _direction_from_text(suffix.group(1)) if suffix else direction
    if direction is None and direction_raw is not None:
        direction = _direction_from_text(direction_raw)
    if direction is None and amount_paise is not None and amount_raw is not None:
        if not _DR_CR_SUFFIX.search(amount_raw) and amount_raw.strip().startswith("-"):
            direction = "DEBIT"

    balance_paise = None
    balance_raw = cell("balance")
    if balance_raw is not None:
        stripped = _DR_CR_SUFFIX.sub("", balance_raw).strip()
        balance_paise = _parse_paise(stripped)
        if balance_paise is None:
            warnings.append(f"unparseable balance '{balance_raw}'")

    return {
        "date": date,
        "narration": cell("narration") or "",
        "refNo": cell("refNo"),
        "direction": direction,
        "amountPaise": amount_paise,
        "balancePaise": balance_paise,
        "raw": " ".join(cells).strip(),
        "warnings": warnings,
    }


def extract_csv_statement(
    text: str,
    formats_dir: Optional[Path] = None,
    bank_hint: Optional[str] = None,
) -> dict[str, Any]:
    layouts_file = _load("csv-layouts.json", formats_dir)
    rows = parse_csv(text)
    warnings: list[str] = []
    max_scan = int(layouts_file.get("maxHeaderScanRows", 15))
    preamble = " ".join(" ".join(r) for r in rows[:max_scan])
    account_mask = _find_account_mask(preamble)

    table = detect_table(rows, layouts_file, bank_hint)
    if table is None:
        return {
            "format": "csv",
            "bank": bank_hint,
            "layoutId": None,
            "accountMask": account_mask,
            "transactions": [],
            "warnings": ["no statement table detected in input"],
            "metadata": {},
        }

    columns = table["columns"]
    header_width = len(rows[table["headerRowIndex"]])
    transactions = []
    for i in range(table["headerRowIndex"] + 1, len(rows)):
        cells = rows[i]
        if not cells or all(c.strip() == "" for c in cells):
            continue
        date_idx = columns.get("date")
        date_cell = cells[date_idx].strip() if date_idx is not None and date_idx < len(cells) else None
        if not date_cell or not parse_statement_date(date_cell) or len(cells) > header_width + 2:
            preview = " ".join(cells).strip()
            if preview:
                warnings.append(f"skipped non-transaction row {i + 1}: '{preview[:60]}'")
            continue
        transactions.append(map_row(cells, columns))

    if not transactions:
        warnings.append("header detected but no transaction rows parsed")

    layout = table["layout"]
    return {
        "format": "csv",
        "bank": layout["bank"] if layout else None,
        "layoutId": layout["id"] if layout else "generic_heuristic",
        "accountMask": account_mask,
        "transactions": transactions,
        "warnings": warnings,
        "metadata": {},
    }


# ── SMS ─────────────────────────────────────────────────────────────────────

def extract_sms(
    body: str,
    formats_dir: Optional[Path] = None,
    bank_hint: Optional[str] = None,
) -> dict[str, Any]:
    file = _load("sms-patterns.json", formats_dir)
    warnings: list[str] = []
    text = body.strip()

    direction: Optional[str] = None
    amount_paise: Optional[int] = None
    account_mask = _find_account_mask(text)
    matched = None

    for pattern in file.get("patterns", []):
        if bank_hint and pattern.get("bank") not in ("GENERIC", bank_hint.upper()):
            continue
        try:
            m = _js_regex(pattern["regex"]).search(text)
        except re.error:
            continue
        if not m:
            continue
        matched = pattern["id"]
        if pattern.get("direction") in ("DEBIT", "CREDIT"):
            direction = pattern["direction"]
        amount = m.groupdict().get("amount")
        if amount:
            amount_paise = _parse_paise(amount)
        mask = m.groupdict().get("accountMask")
        if not account_mask and mask:
            account_mask = mask
        break

    balance_paise = None
    bal_re = file.get("balanceRegex")
    bal_match = _js_regex(bal_re).search(text) if bal_re else None
    if bal_match:
        raw = bal_match.groupdict().get("balance") or bal_match.group(1)
        if raw:
            balance_paise = _parse_paise(raw)

    date = None
    date_re = file.get("dateRegex")
    date_match = _js_regex(date_re).search(text) if date_re else None
    if date_match:
        raw = date_match.groupdict().get("date") or date_match.group(1)
        if raw:
            date = parse_statement_date(raw)
            if not date:
                warnings.append(f"unparseable sms date '{raw}'")

    if not matched:
        warnings.append("no sms pattern matched; narration passed through for grammar parsing")

    transactions = (
        []
        if amount_paise is None and not matched
        else [
            {
                "date": date,
                "narration": text,
                "refNo": None,
                "direction": direction,
                "amountPaise": amount_paise,
                "balancePaise": balance_paise,
                "raw": text,
                "warnings": [] if matched else ["unmatched sms pattern"],
            }
        ]
    )

    return {
        "format": "sms",
        "bank": bank_hint,
        "layoutId": matched,
        "accountMask": account_mask,
        "transactions": transactions,
        "warnings": warnings,
        "metadata": {},
    }
