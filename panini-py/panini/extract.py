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


def _load_maybe(name: str, formats_dir: Optional[Path]) -> Optional[dict[str, Any]]:
    path = (formats_dir or _formats_dir()) / name
    return json.loads(path.read_text()) if path.exists() else None


def _load_merged(
    name: str,
    formats_dir: Optional[Path],
    extra_formats_dir: Optional[Path],
) -> dict[str, Any]:
    """Bundled formats + caller's extra_formats_dir merged on top —
    caller entries are checked first and shadow same-id bundled ones."""
    base = _load(name, formats_dir)
    if extra_formats_dir is None:
        return base
    extra = _load_maybe(name, Path(extra_formats_dir))
    if extra is None:
        return base
    merged = dict(base)
    for key in ("layouts", "patterns", "banks"):
        if key in extra or key in base:
            extra_items = list(extra.get(key, []))
            extra_ids = {
                item.get("id") for item in extra_items if item.get("id") is not None
            }
            merged[key] = extra_items + [
                item for item in base.get(key, []) if item.get("id") not in extra_ids
            ]
    return merged


# ── UPI-app statements (PhonePe) ────────────────────────────────────────────
#
# PhonePe's emailed transaction statement is not a table — every record is a
# ~7-line vertical block (date line, Paid to, Transaction ID, UTR, Paid by,
# Debit/Credit amount line). Detected by field markers, parsed line-wise.

_UPI_DATE_RE = re.compile(r"^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})")
_UPI_TIME_RE = re.compile(r"^\d{1,2}:\d{2}\s*(?::\d{2})?\s*[AP]M", re.IGNORECASE)
_UPI_AMOUNT_RE = re.compile(
    r"^(debit(?:ed)?|credit(?:ed)?)\b[^\d]*([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE
)
_UPI_TXN_ID_RE = re.compile(r"^transaction\s*id\s*:\s*(\S+)", re.IGNORECASE)
_UPI_UTR_RE = re.compile(r"^utr\s*(?:no\.?|number)?\s*:\s*(\S+)", re.IGNORECASE)
_UPI_NARRATION_RE = re.compile(
    r"^(paid to|received from|bill paid|refund(?:\s+from)?)\s*[-–:]?\s*(.+)",
    re.IGNORECASE,
)
_UPI_PAID_BY_RE = re.compile(r"^paid by\s+(.+)", re.IGNORECASE)
_UPI_PAID_BY_MASK_RE = re.compile(r"[-–*xX]{2,}\s*(\d{3,6})\b")

_UPI_MONTHS = {
    "jan": "01", "january": "01", "feb": "02", "february": "02",
    "mar": "03", "march": "03", "apr": "04", "april": "04", "may": "05",
    "jun": "06", "june": "06", "jul": "07", "july": "07", "aug": "08",
    "august": "08", "sep": "09", "september": "09", "oct": "10",
    "october": "10", "nov": "11", "november": "11", "dec": "12",
    "december": "12",
}


def looks_like_upi_app_statement(text: str) -> bool:
    return bool(
        re.search(r"transaction\s*id\s*:", text, re.IGNORECASE)
        and re.search(r"^paid to\b", text, re.IGNORECASE | re.MULTILINE)
    )


def parse_upi_app_statement(text: str, fmt: str = "csv") -> dict[str, Any]:
    warnings: list[str] = []
    metadata = {"statementIssuer": "phonepe", "accountKind": "upi_app"}
    transactions: list[dict[str, Any]] = []

    date: Optional[str] = None
    narration = ""
    raw_parts: list[str] = []
    txn_id: Optional[str] = None
    utr: Optional[str] = None
    paid_by = ""

    for line in (l.strip() for l in re.split(r"\r\n|\n|\r", text) if l.strip()):
        dm = _UPI_DATE_RE.match(line)
        if dm:
            mm = _UPI_MONTHS.get(dm.group(1).lower())
            date = f"{dm.group(3)}-{mm}-{dm.group(2).zfill(2)}" if mm else None
            narration = ""
            raw_parts = [line]
            txn_id = utr = None
            continue
        if date is None:
            continue
        raw_parts.append(line)
        if _UPI_TIME_RE.match(line):
            continue
        m = _UPI_TXN_ID_RE.match(line)
        if m:
            txn_id = m.group(1)
            continue
        m = _UPI_UTR_RE.match(line)
        if m:
            utr = m.group(1)
            continue
        m = _UPI_PAID_BY_RE.match(line)
        if m:
            if paid_by == "":
                paid_by = m.group(1)
            continue
        m = _UPI_AMOUNT_RE.match(line)
        if m:
            amount = parse_statement_amount(m.group(2))
            if amount is not None:
                transactions.append({
                    "date": date,
                    "narration": narration or "PhonePe transaction",
                    "amountPaise": amount[0],
                    "direction": "DEBIT" if m.group(1).lower().startswith("deb") else "CREDIT",
                    "refNo": utr or txn_id,
                    "balancePaise": None,
                    "raw": " ".join(raw_parts),
                    "warnings": [],
                })
            else:
                warnings.append(f"unparseable amount line: '{line[:60]}'")
            date = None
            narration = ""
            raw_parts = []
            txn_id = utr = None
            continue
        m = _UPI_NARRATION_RE.match(line)
        if m:
            narration = f"{m.group(1)} {m.group(2)}".strip()

    if date is not None:
        warnings.append("final record had no amount line — dropped")
    if not transactions:
        warnings.append("UPI-app statement markers found but no records parsed")

    mask = (
        _find_account_mask(paid_by)
        or (mm.group(1) if (mm := _UPI_PAID_BY_MASK_RE.search(paid_by)) else None)
        or _find_account_mask(" ".join(text.split("\n")[:10]))
    )
    return {
        "format": fmt,
        "bank": "PHONEPE",
        "layoutId": "phonepe_statement",
        "accountMask": mask,
        "transactions": transactions,
        "warnings": warnings,
        "metadata": metadata,
    }


def detect_bank_id(text: str, names_file: dict[str, Any]) -> Optional[str]:
    """Identify the issuing bank from statement preamble lines. Word-bounded
    matching; on a line with several hits the longest name wins so
    'union bank of india' beats the 'bank of india' inside it."""
    max_lines = int(names_file.get("maxScanLines", 20))
    for line in text.split("\n")[:max_lines]:
        norm = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", line.lower())).strip()
        if not norm:
            continue
        padded = f" {norm} "
        best: Optional[str] = None
        best_len = 0
        for bank in names_file.get("banks", []):
            for name in bank.get("names", []):
                if len(name) > best_len and f" {name} " in padded:
                    best, best_len = bank["id"], len(name)
        if best is not None:
            return best
    return None


# ── dates & amounts ─────────────────────────────────────────────────────────

_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7,
    "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12,
    "december": 12,
}

_NAMED_DATE = re.compile(r"^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ](\d{2,4})$")
# Day-first numeric dates with 1-2 digit day/month: 5/1/2026, 5-1-26.
_SHORT_DMY = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$")
# A trailing clock time (24h or 12h) with optional fraction and zone.
_TIME_SUFFIX = re.compile(
    r"[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AP]M)?\s*(?:Z|[+-]\d{2}:?\d{2})?$",
    re.IGNORECASE,
)


def parse_statement_date(value: str) -> Optional[str]:
    """Statement dates: everything parse_indian_date handles plus month-name
    shapes, single-digit day/month (read day-first) and date-times whose
    clock part is discarded."""
    v = _TIME_SUFFIX.sub("", value.strip()).strip()
    direct = parse_indian_date(v)
    if direct:
        return direct
    short = _SHORT_DMY.match(v)
    if short:
        return parse_indian_date(
            f"{int(short.group(1)):02d}-{int(short.group(2)):02d}-{short.group(3)}"
        )
    m = _NAMED_DATE.match(v)
    if not m:
        return None
    month = _MONTHS.get(m.group(2).lower())
    if month is None:
        return None
    return parse_indian_date(f"{int(m.group(1)):02d}-{month:02d}-{m.group(3)}")


_BODY = re.compile(r"^(?:(\d+(?:,\d+)*)(?:\.(\d{1,2}))?|\.(\d{1,2}))$")
_CURRENCY_PREFIX = re.compile(r"^(?:rs\.?|inr|₹)\s*", re.IGNORECASE)
_MAX_INTEGER_DIGITS = 13


def parse_statement_amount(value: str) -> Optional[tuple[int, Optional[str]]]:
    """Statement-cell amount -> (magnitude paise, sign) or None.

    sign is 'neg' for -x, (x), x-; 'pos' for an explicit +x; None when
    unsigned. Handles Rs./INR/rupee prefixes, a '/-' suffix and '.50'.
    Pure decimal-string arithmetic, so paise are exact."""
    s = value.strip()
    if s == "":
        return None
    neg = pos = False
    paren = re.match(r"^\((.*)\)$", s)
    if paren:
        neg = True
        s = paren.group(1).strip()

    def take_leading_sign(text: str) -> Optional[str]:
        nonlocal neg, pos
        if text[:1] not in ("-", "+"):
            return text
        if neg or pos:
            return None
        if text[0] == "-":
            neg = True
        else:
            pos = True
        return text[1:].strip()

    t = take_leading_sign(s)
    if t is None:
        return None
    t = _CURRENCY_PREFIX.sub("", t)
    t = take_leading_sign(t)
    if t is None:
        return None
    if t.endswith("/-"):
        t = t[:-2].strip()
    if t.endswith("-"):
        if neg or pos:
            return None
        neg = True
        t = t[:-1].strip()

    m = _BODY.match(t)
    if not m:
        return None
    int_part = (m.group(1) or "").replace(",", "")
    frac = (m.group(2) or m.group(3) or "").ljust(2, "0")
    if len(int_part) > _MAX_INTEGER_DIGITS:
        return None
    paise = int(int_part or "0") * 100 + int(frac)
    return paise, ("neg" if neg else "pos" if pos else None)


_AMOUNT_BODY = re.compile(r"^-?\d+(?:\.\d{1,2})?$")


def _parse_paise(value: str) -> Optional[int]:
    """Plain amount parser used by the SMS tier (CSV cells use
    parse_statement_amount)."""
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


def _direction_from_column(value: str) -> Optional[str]:
    """A dedicated type column may hold a bare D / C indicator."""
    t = value.strip().upper()
    if re.fullmatch(r"(?:D|DB|DR|DBT)\.?", t):
        return "DEBIT"
    if re.fullmatch(r"(?:C|CR)\.?", t):
        return "CREDIT"
    return _direction_from_text(value)


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

    debit = parse_statement_amount(debit_raw) if debit_raw is not None else None
    credit = parse_statement_amount(credit_raw) if credit_raw is not None else None
    if debit_raw is not None and debit is None:
        warnings.append(f"unparseable debit '{debit_raw}'")
    if credit_raw is not None and credit is None:
        warnings.append(f"unparseable credit '{credit_raw}'")

    # Banks routinely zero-fill the opposite column ('0.00'), so only a
    # non-zero side can carry the amount.
    debit_value = debit[0] if debit is not None and debit[0] > 0 else None
    credit_value = credit[0] if credit is not None and credit[0] > 0 else None
    if debit_value is not None:
        amount_paise, direction = debit_value, "DEBIT"
        if credit_value is not None:
            warnings.append("row carries both debit and credit; debit kept")
    elif credit_value is not None:
        amount_paise, direction = credit_value, "CREDIT"
    elif debit is not None or credit is not None:
        amount_paise = 0
        warnings.append("zero amount in the debit/credit columns")
    elif debit_raw is not None:
        direction = "DEBIT"

    if amount_paise is None and amount_raw is not None:
        suffix = _DR_CR_SUFFIX.search(amount_raw)
        bare = _DR_CR_SUFFIX.sub("", amount_raw).strip() if suffix else amount_raw
        parsed = parse_statement_amount(bare)
        if parsed is None:
            warnings.append(f"unparseable amount '{amount_raw}'")
        else:
            amount_paise = parsed[0]
            if suffix:
                direction = _direction_from_text(suffix.group(1))
            elif direction_raw is not None:
                direction = _direction_from_column(direction_raw)
            if direction is None and not suffix:
                direction = (
                    "DEBIT" if parsed[1] == "neg" else "CREDIT" if parsed[1] == "pos" else None
                )
    if direction is None and direction_raw is not None:
        direction = _direction_from_column(direction_raw)

    balance_paise = None
    balance_raw = cell("balance")
    if balance_raw is not None:
        bal_suffix = _DR_CR_SUFFIX.search(balance_raw)
        stripped = _DR_CR_SUFFIX.sub("", balance_raw).strip()
        parsed_bal = parse_statement_amount(stripped)
        if parsed_bal is None:
            warnings.append(f"unparseable balance '{balance_raw}'")
        else:
            overdrawn = parsed_bal[1] == "neg" or (
                bal_suffix is not None and _direction_from_text(bal_suffix.group(1)) == "DEBIT"
            )
            balance_paise = -parsed_bal[0] if overdrawn and parsed_bal[0] != 0 else parsed_bal[0]

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


_MAX_CONTINUATION_ROWS = 3
_MAX_CONTINUATION_LENGTH = 120
# Footer / boilerplate lines that must never be glued onto a narration.
_FOOTER_RE = re.compile(
    r"^(?:page\s+\d|statement\s+(?:summary|of)|total\b|closing\s+balance|"
    r"opening\s+balance|this\s+is\s+a\s+computer|registered\s+office|\*|"
    r"disclaimer|note\b|end\s+of\s+statement)",
    re.IGNORECASE,
)
# A row that only states a balance carried into / out of the period.
_BALANCE_MARKER_RE = re.compile(
    r"^(?:(opening)\s+bal(?:ance)?|(b/f)|(brought\s+forward)|"
    r"(closing)\s+bal(?:ance)?|(c/f)|(carried\s+forward))[\s:.-]*$",
    re.IGNORECASE,
)
_NUMERIC_DATE_RE = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}")


def _cell_text(cells: list[str], idx: Optional[int]) -> str:
    return "" if idx is None or idx >= len(cells) else cells[idx].strip()


def extract_csv_statement(
    text: str,
    formats_dir: Optional[Path] = None,
    bank_hint: Optional[str] = None,
    extra_formats_dir: Optional[Path] = None,
) -> dict[str, Any]:
    layouts_file = _load_merged("csv-layouts.json", formats_dir, extra_formats_dir)
    names_file = _load_merged("bank-names.json", formats_dir, extra_formats_dir)
    if looks_like_upi_app_statement(text):
        return parse_upi_app_statement(text, "csv")
    rows = parse_csv(text)
    warnings: list[str] = []
    max_scan = int(layouts_file.get("maxHeaderScanRows", 15))
    preamble = " ".join(" ".join(r) for r in rows[:max_scan])
    detected_bank = detect_bank_id(preamble, names_file) if names_file else None
    account_mask = _find_account_mask(preamble)

    table = detect_table(rows, layouts_file, bank_hint)
    if table is None:
        return {
            "format": "csv",
            "bank": detected_bank or bank_hint,
            "layoutId": None,
            "accountMask": account_mask,
            "transactions": [],
            "warnings": ["no statement table detected in input"],
            "metadata": {},
        }

    columns = table["columns"]
    header_width = len(rows[table["headerRowIndex"]])
    transactions: list[dict[str, Any]] = []
    metadata: dict[str, str] = {}
    last_base_warnings: list[str] = []
    continuation_rows = 0
    can_continue = False
    first_gt12 = second_gt12 = False

    for i in range(table["headerRowIndex"] + 1, len(rows)):
        cells = rows[i]
        if not cells or all(c.strip() == "" for c in cells):
            can_continue = False
            continue

        date_text = _cell_text(cells, columns.get("date"))
        dm = _NUMERIC_DATE_RE.match(date_text)
        if dm:
            if int(dm.group(1)) > 12:
                first_gt12 = True
            if int(dm.group(2)) > 12:
                second_gt12 = True

        narration_text = _cell_text(cells, columns.get("narration"))
        no_amounts = all(
            _cell_text(cells, columns.get(f)) == "" for f in ("debit", "credit", "amount")
        )
        no_balance = _cell_text(cells, columns.get("balance")) == ""

        # Opening / closing balance marker rows are statement metadata, not
        # transactions.
        marker = _BALANCE_MARKER_RE.match(narration_text)
        if marker is not None and no_amounts and not no_balance:
            mapped = map_row(cells, columns)
            if mapped["balancePaise"] is not None:
                is_opening = any(marker.group(g) for g in (1, 2, 3))
                key = "openingBalancePaise" if is_opening else "closingBalancePaise"
                metadata.setdefault(key, str(mapped["balancePaise"]))
                can_continue = False
                continue

        date_idx = columns.get("date")
        plausible = (
            date_idx is not None
            and date_text != ""
            and parse_statement_date(date_text) is not None
            and len(cells) <= header_width + 2
        )
        if not plausible:
            is_continuation = (
                can_continue
                and continuation_rows < _MAX_CONTINUATION_ROWS
                and date_text == ""
                and no_amounts
                and no_balance
                and narration_text != ""
                and len(narration_text) <= _MAX_CONTINUATION_LENGTH
                and not _FOOTER_RE.match(narration_text)
            )
            if is_continuation:
                prev = transactions[-1]
                continuation_rows += 1
                prev["narration"] = f"{prev['narration']} {narration_text}".strip()
                prev["raw"] = f"{prev['raw']} {' '.join(cells).strip()}".strip()
                prev["warnings"] = last_base_warnings + [
                    f"narration continued across {continuation_rows} row(s)"
                ]
                continue
            can_continue = False
            preview = " ".join(cells).strip()
            if preview:
                warnings.append(f"skipped non-transaction row {i + 1}: '{preview[:60]}'")
            continue

        mapped = map_row(cells, columns)
        transactions.append(mapped)
        last_base_warnings = list(mapped["warnings"])
        continuation_rows = 0
        can_continue = True

    if second_gt12 and not first_gt12:
        warnings.append(
            "date column looks month-first (MM/DD/YYYY) — values were read day-first "
            "(DD/MM/YYYY); rows with an impossible day-first date were skipped, not guessed"
        )

    if not transactions:
        warnings.append("header detected but no transaction rows parsed")

    layout = table["layout"]
    if layout and layout.get("kind") is not None:
        metadata["accountKind"] = layout["kind"]
    bank = layout["bank"] if layout else (detected_bank or bank_hint)
    bank_source = (
        "layout"
        if layout
        else "preamble" if detected_bank else "hint" if bank_hint else None
    )
    if bank_source is not None:
        metadata["bankSource"] = bank_source
    if layout is None or layout["id"] == "generic_statement":
        suffix = (
            f" (detected bank: {detected_bank}; a dedicated layout would improve accuracy)"
            if detected_bank
            else ""
        )
        warnings.append(
            f"no bank-specific layout matched — parsed via generic fallback{suffix}"
        )
    return {
        "format": "csv",
        "bank": bank,
        "layoutId": layout["id"] if layout else "generic_heuristic",
        "accountMask": account_mask,
        "transactions": transactions,
        "warnings": warnings,
        "metadata": metadata,
    }


# ── SMS ─────────────────────────────────────────────────────────────────────

def extract_sms(
    body: str,
    formats_dir: Optional[Path] = None,
    bank_hint: Optional[str] = None,
    extra_formats_dir: Optional[Path] = None,
) -> dict[str, Any]:
    file = _load_merged("sms-patterns.json", formats_dir, extra_formats_dir)
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
