# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Lexical pass over narration strings — mirrors @panini/core tokenizer."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

CHANNEL_KEYWORDS = {
    "UPI": "UPI", "IMPS": "IMPS", "NEFT": "NEFT", "RTGS": "RTGS",
    "ACH": "ACH", "ECS": "ACH", "NACH": "NACH", "E-NACH": "NACH",
    "ATM": "ATM", "CASH": "ATM", "WDL": "ATM", "POS": "POS",
    "CHQ": "CHEQUE", "CHEQUE": "CHEQUE", "CLG": "CHEQUE",
    "NETBANKING": "NETBANKING", "INET": "NETBANKING", "IB": "NETBANKING",
    "INB": "NETBANKING",
    "PAYTM": "WALLET", "PHONEPE": "WALLET", "GPAY": "WALLET",
    "GOOGLEPAY": "WALLET", "BHIM": "WALLET", "MOBIKWIK": "WALLET",
    "FREECHARGE": "WALLET", "AMAZONPAY": "WALLET", "WALLET": "WALLET",
}

DIRECTION_KEYWORDS = {
    "DR": "DEBIT", "D": "DEBIT", "DEBIT": "DEBIT", "DEBITED": "DEBIT",
    "WITHDRAWAL": "DEBIT", "WDL": "DEBIT",
    "CR": "CREDIT", "C": "CREDIT", "CREDIT": "CREDIT", "CREDITED": "CREDIT",
    "DEP": "CREDIT", "DEPOSIT": "CREDIT",
    "REV": "REVERSAL", "REVERSAL": "REVERSAL", "RTN": "REVERSAL",
    "REFUND": "REFUND", "RFD": "REFUND",
    "INBOUND": "CREDIT", "INW": "CREDIT", "INWARD": "CREDIT",
    "OUTBOUND": "DEBIT", "OUTWARD": "DEBIT",
}

_EXTRA_KEYWORDS = {"TRANSFER", "TRF", "TXN", "SALARY", "EMI", "AT", "TO",
                   "BY", "FROM", "A/C", "AC", "NO"}
KEYWORD_SET = set(CHANNEL_KEYWORDS) | set(DIRECTION_KEYWORDS) | _EXTRA_KEYWORDS

_TOKEN_SPLIT = re.compile(r"[\s\-/|:;]+")
_AMOUNT_RE = re.compile(r"^(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?$")
_DATE_CANDIDATE_RE = re.compile(
    r"^(?:\d{6}|\d{8}|\d{2}[-/.]\d{2}[-/.]\d{2,4}|\d{4}[-/.]\d{2}[-/.]\d{2})$"
)
_CURRENCY_PREFIX = re.compile(r"^(?:rs\.?|inr|₹)", re.IGNORECASE)


@dataclass(frozen=True)
class Token:
    kind: str  # KEYWORD | VPA | DATE | AMOUNT | NUMERIC | ALPHA | ALNUM | SYMBOL
    value: str
    position: int


def _classify(raw: str, is_plausible_date) -> str:
    if "@" in raw:
        return "VPA"
    value = _CURRENCY_PREFIX.sub("", raw) or raw
    upper = value.upper()
    if upper in KEYWORD_SET:
        return "KEYWORD"
    if _AMOUNT_RE.match(value) and ("." in value or "," in value):
        return "AMOUNT"
    if _DATE_CANDIDATE_RE.match(value) and is_plausible_date(value):
        return "DATE"
    if value.isdigit():
        return "NUMERIC"
    if value.isalpha() and value.isascii():
        return "ALPHA"
    if re.fullmatch(r"[A-Za-z0-9]+", value):
        return "ALNUM"
    return "SYMBOL"


def tokenize_pieces(text: str, is_plausible_date) -> list[list[Token]]:
    """Same pass as tokenize() but tokens stay grouped by whitespace piece.
    The piece boundary is where a multi-word name legitimately continues —
    the `-/|:;` splits inside a piece are field separators and must not be
    joined across."""
    pieces: list[list[Token]] = []
    position = 0
    for piece in text.strip().split():
        if not piece:
            continue
        group: list[Token] = []
        if _DATE_CANDIDATE_RE.match(piece) and is_plausible_date(piece):
            group.append(Token("DATE", piece, position))
            position += 1
        else:
            for part in _TOKEN_SPLIT.split(piece):
                if not part:
                    continue
                group.append(Token(_classify(part, is_plausible_date), part, position))
                position += 1
        if group:
            pieces.append(group)
    return pieces


def tokenize(text: str, is_plausible_date) -> list[Token]:
    """Mirror of the TS tokenizer: whitespace outer split, `-/|:;` inner."""
    return [t for piece in tokenize_pieces(text, is_plausible_date) for t in piece]
