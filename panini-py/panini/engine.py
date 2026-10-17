# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Deterministic narration engine — Python port of @panini/core Normalizer.

Shares the same grammar JSONs and corpus fixtures as the TypeScript
packages; the two runtimes are conformance-tested against each other.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from .dates import is_plausible_date, parse_indian_date
from .tokenizer import CHANNEL_KEYWORDS, DIRECTION_KEYWORDS, tokenize

# ── regex translation (JS → Python) ─────────────────────────────────────────

def translate_flags(flags: str) -> int:
    out = 0
    for f in flags:
        if f == "i":
            out |= re.IGNORECASE
        elif f == "m":
            out |= re.MULTILINE
        elif f == "s":
            out |= re.DOTALL
    return out


def _translate(js_regex: str, flags: str = "") -> re.Pattern[str]:
    """JS named groups `(?<name>…)` → Python `(?P<name>…)`. Lookbehinds
    `(?<=`/`(?<!` and non-capturing `(?:` are already valid Python."""
    py = re.sub(r"\(\?<([A-Za-z])", r"(?P<\1", js_regex)
    return re.compile(py, translate_flags(flags))


# ── data model ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Pattern:
    name: str
    rule_set_id: str
    bank: str
    regex: re.Pattern[str]
    media: str
    channel: Optional[str]
    type: Optional[str]
    category: Optional[str]
    priority: int
    confidence: float
    flags: dict[str, str]
    set_metadata: dict[str, str]


@dataclass(frozen=True)
class NormalizedTransaction:
    channel: str
    counterparty: Optional[str]
    transaction_id: Optional[str]
    vpa_handle: Optional[str]
    type: str
    category: str
    date: Optional[str]
    amount_paise: Optional[int]
    balance_paise: Optional[int]
    currency: str
    account_mask: Optional[str]
    raw: str
    matched_rule: Optional[str]
    bank: Optional[str]
    confidence: float
    metadata: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ── casing ───────────────────────────────────────────────────────────────────

_CORPORATE_SUFFIXES = {"LTD", "PVT", "INC", "CORP", "CO"}
_ACRONYM_RE = re.compile(r"^[A-Z]{2,5}$")


def _title(word: str) -> str:
    return word[0].upper() + word[1:].lower() if word else word


def preserve_acronym_case(value: str) -> str:
    words = [w for w in value.strip().split() if w]
    if len(words) <= 1:
        word = words[0] if words else value
        return word if re.fullmatch(r"[A-Z]{2,4}", word) else _title(word)
    out = []
    for w in words:
        if w.upper() in _CORPORATE_SUFFIXES:
            out.append(_title(w))
        elif _ACRONYM_RE.match(w):
            out.append(w)
        else:
            out.append(_title(w))
    return " ".join(out)


# ── helpers ──────────────────────────────────────────────────────────────────

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_SMS_SIGNAL = re.compile(r"\b(debited|credited|avl\s*bal|a/c\s*(?:no|xx|\*+))", re.IGNORECASE)
_CURRENCY_PREFIX = re.compile(r"^(?:rs\.?|inr|₹)", re.IGNORECASE)
_AMOUNT_BODY = re.compile(r"^\d+(?:\.\d{1,2})?$")

_DIRECTION_TYPES = {"DEBIT", "CREDIT"}
_REVERSAL_TYPES = {"REVERSAL", "REFUND"}


def _sanitize(text: str) -> str:
    return re.sub(r"\s+", " ", _CONTROL_CHARS.sub(" ", text)).strip()


def _detect_source(text: str) -> str:
    return "sms" if _SMS_SIGNAL.search(text) else "narration"


def _parse_paise(value: str) -> Optional[int]:
    stripped = _CURRENCY_PREFIX.sub("", value.strip()).replace(",", "")
    if not _AMOUNT_BODY.match(stripped):
        return None
    return round(float(stripped) * 100)


def _clean_counterparty(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = re.sub(
        r"^(?:(?:M/S|TO|BY|FROM|AT|THE|UPI|IMPS|NEFT|RTGS|ECS|ACH|NACH)[\s\-/]+)+",
        "", value, flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"[\s\-./]+$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return preserve_acronym_case(cleaned) if cleaned else None


def _resolve_type(pattern_type, direction_group, flag_types) -> str:
    if pattern_type:
        return pattern_type
    if direction_group:
        mapped = DIRECTION_KEYWORDS.get(direction_group.upper())
        if mapped:
            return mapped
    for t in flag_types:
        if t in _DIRECTION_TYPES:
            return t
    for t in flag_types:
        if t in _REVERSAL_TYPES:
            return t
    return "UNKNOWN"


# ── grammar compilation ──────────────────────────────────────────────────────

def compile_rule_sets(rule_sets: list[dict[str, Any]]) -> list[Pattern]:
    """Ordering: priority desc, bank-specific before GENERIC, stable."""
    compiled: list[Pattern] = []
    for rs in rule_sets:
        for p in rs.get("patterns", []):
            compiled.append(Pattern(
                name=p["name"],
                rule_set_id=rs["id"],
                bank=rs["bank"],
                regex=_translate(p["regex"], p.get("regexFlags", "")),
                media=p.get("media", "any"),
                channel=p.get("channel"),
                type=p.get("type"),
                category=p.get("category"),
                priority=p.get("priority", 0),
                confidence=p.get("confidence", 0.9),
                flags=p.get("flags", {}),
                set_metadata=p.get("setMetadata", {}),
            ))
    return sorted(
        compiled,
        key=lambda p: (-p.priority, p.bank == "GENERIC"),
    )


def load_builtin_rules(rules_dir: Path) -> tuple[list[dict], dict[str, str]]:
    grammars, corpus = [], {}
    for path in sorted(rules_dir.glob("*.json")):
        if path.name == "categories.json":
            corpus = json.loads(path.read_text())
            continue
        grammars.append(json.loads(path.read_text()))
    return grammars, corpus


# ── normalizer ───────────────────────────────────────────────────────────────

class Normalizer:
    def __init__(self, rule_sets: list[dict], categories: dict[str, str]):
        self.patterns = compile_rule_sets(rule_sets)
        merged: dict[str, str] = {}
        for rs in rule_sets:
            merged.update(rs.get("categories", {}))
        merged.update(categories)
        self.category_rules = [
            (kw, cat, re.compile(r"\b" + re.escape(kw) + r"\b", re.IGNORECASE))
            for kw, cat in sorted(merged.items(), key=lambda kv: -len(kv[0]))
        ]

    def _candidates(self, source: str, bank_hint: Optional[str]) -> list[Pattern]:
        applicable = [p for p in self.patterns if p.media in ("any", source)]
        if not bank_hint:
            return applicable
        hint = bank_hint.upper()
        preferred = [p for p in applicable if p.bank.upper() == hint]
        rest = [p for p in applicable if p.bank.upper() != hint]
        return preferred + rest

    def _channel_from_tokens(self, tokens) -> Optional[str]:
        for t in tokens:
            ch = CHANNEL_KEYWORDS.get(t.value.upper())
            if ch:
                return ch
        return None

    def _categorize(self, text: str) -> Optional[str]:
        for _, cat, matcher in self.category_rules:
            if matcher.search(text):
                return cat
        return None

    def _empty(self, raw: str, warnings: list[str]) -> NormalizedTransaction:
        return NormalizedTransaction(
            channel="UNKNOWN", counterparty=None, transaction_id=None,
            vpa_handle=None, type="UNKNOWN", category="Uncategorized",
            date=None, amount_paise=None, balance_paise=None,
            currency="INR", account_mask=None, raw=raw,
            matched_rule=None, bank=None, confidence=0.0,
            warnings=list(warnings),
        )

    def _from_match(self, pattern: Pattern, m: re.Match, text: str,
                    raw: str, warnings: list[str]) -> NormalizedTransaction:
        groups = {k: v for k, v in (m.groupdict() or {}).items()}
        metadata: dict[str, str] = {}

        flag_types, applied = [], []
        if groups.get("tail"):
            for tok in tokenize(groups["tail"], is_plausible_date):
                upper = tok.value.upper()
                mapped = pattern.flags.get(upper) or DIRECTION_KEYWORDS.get(upper)
                if mapped:
                    flag_types.append(mapped)
                    applied.append(upper)
        if applied:
            metadata["flags"] = ",".join(applied)
        if groups.get("remarks"):
            metadata["remarks"] = groups["remarks"].strip()
        if groups.get("bankCode"):
            metadata["bank_code"] = groups["bankCode"].strip()
        metadata.update(pattern.set_metadata)

        tokens = tokenize(text, is_plausible_date)
        channel = pattern.channel or self._channel_from_tokens(tokens) or "UNKNOWN"
        txn_type = _resolve_type(pattern.type, groups.get("direction"), flag_types)

        counterparty = _clean_counterparty(groups.get("counterparty"))
        txn_id = (groups.get("txnId") or "").strip() or None

        vpa = groups.get("vpaHandle")
        if vpa is not None:
            vpa = vpa.lstrip("@").lower()

        date_val = self._parse_field(groups.get("date"), parse_indian_date, "date", warnings)
        amount = self._parse_field(groups.get("amount"), _parse_paise, "amount", warnings)
        balance = self._parse_field(groups.get("balance"), _parse_paise, "balance", warnings)
        account_mask = (groups.get("accountMask") or "").strip() or None

        category = (
            pattern.category
            or self._categorize(f"{counterparty or ''} {text}")
            or "Uncategorized"
        )

        return NormalizedTransaction(
            channel=channel, counterparty=counterparty, transaction_id=txn_id,
            vpa_handle=vpa, type=txn_type, category=category, date=date_val,
            amount_paise=amount, balance_paise=balance, currency="INR",
            account_mask=account_mask, raw=raw,
            matched_rule=f"{pattern.rule_set_id}:{pattern.name}",
            bank=None if pattern.bank == "GENERIC" else pattern.bank,
            confidence=pattern.confidence, metadata=metadata,
            warnings=list(warnings),
        )

    @staticmethod
    def _parse_field(value, parser, label, warnings):
        if value is None or not value.strip():
            return None
        parsed = parser(value.strip())
        if parsed is None:
            warnings.append(f"unparseable {label} '{value.strip()}'")
        return parsed

    def _heuristic(self, text: str, raw: str, bank_hint, warnings) -> NormalizedTransaction:
        tokens = tokenize(text, is_plausible_date)
        metadata: dict[str, str] = {}
        flag_types, applied = [], []
        for t in tokens:
            mapped = DIRECTION_KEYWORDS.get(t.value.upper())
            if mapped:
                flag_types.append(mapped)
                applied.append(t.value.upper())
        if applied:
            metadata["flags"] = ",".join(applied)

        channel = self._channel_from_tokens(tokens) or "UNKNOWN"
        txn_type = _resolve_type(None, None, flag_types)

        txn_id, vpa = None, None
        vpa_tok = next((t for t in tokens if t.kind == "VPA"), None)
        if vpa_tok:
            left, _, right = vpa_tok.value.partition("@")
            if left.isdigit():
                txn_id = left
            if re.fullmatch(r"[a-zA-Z0-9]+", right or ""):
                vpa = right.lower()
        if txn_id is None:
            nums = sorted(
                (t for t in tokens if t.kind == "NUMERIC" and len(t.value) >= 6),
                key=lambda t: -len(t.value),
            )
            txn_id = nums[0].value if nums else None

        date_tok = next((t for t in tokens if t.kind == "DATE"), None)
        date_val = parse_indian_date(date_tok.value) if date_tok else None
        amt_tok = next((t for t in tokens if t.kind == "AMOUNT"), None)
        amount = _parse_paise(amt_tok.value) if amt_tok else None

        channel_pos = next(
            (t.position for t in tokens if t.value.upper() in CHANNEL_KEYWORDS), None
        )
        cp_tok = next(
            (t for t in tokens
             if t.kind in ("ALPHA", "ALNUM") and len(t.value) >= 3
             and t.value.upper() not in CHANNEL_KEYWORDS
             and t.value.upper() not in DIRECTION_KEYWORDS
             and (channel_pos is None or t.position > channel_pos)),
            None,
        )
        counterparty = preserve_acronym_case(cp_tok.value) if cp_tok else None

        category = self._categorize(f"{counterparty or ''} {text}") or "Uncategorized"
        warnings.append("no grammar pattern matched; applied heuristic tokenization")

        return NormalizedTransaction(
            channel=channel, counterparty=counterparty, transaction_id=txn_id,
            vpa_handle=vpa, type=txn_type, category=category, date=date_val,
            amount_paise=amount, balance_paise=None, currency="INR",
            account_mask=None, raw=raw, matched_rule=None,
            bank=bank_hint, confidence=0.5, metadata=metadata,
            warnings=list(warnings),
        )

    def normalize(self, input_: str | dict) -> NormalizedTransaction:
        req = {"text": input_} if isinstance(input_, str) else dict(input_)
        raw = req.get("text", "")
        text = _sanitize(raw)
        if not text:
            return self._empty(raw, ["input is empty"])
        source = req.get("source")
        if source in (None, "auto"):
            source = _detect_source(text)
        bank_hint = req.get("bankHint")
        warnings: list[str] = []
        for pattern in self._candidates(source, bank_hint):
            m = pattern.regex.search(text)
            if m:
                return self._from_match(pattern, m, text, raw, warnings)
        return self._heuristic(text, raw, bank_hint, warnings)


# ── dictionaries + facade ────────────────────────────────────────────────────

_RULES_DIR = Path(os.environ.get(
    "PANINI_RULES_DIR",
    Path(__file__).resolve().parents[2] / "packages" / "rules-engine" / "rules",
))


def _load_entities() -> dict[str, Any]:
    ent = _RULES_DIR / "entities"
    out: dict[str, Any] = {"merchants": [], "vpa-handles": {}, "ifsc-codes": {}}
    for name in ("merchants", "vpa-handles", "ifsc-codes"):
        p = ent / f"{name}.json"
        if p.exists():
            data = json.loads(p.read_text())
            if name == "merchants":
                out[name] = data.get("merchants", [])
            elif name == "vpa-handles":
                out[name] = data.get("handles", {})
            else:
                out[name] = data.get("banks", {})
    return out


def _normalize_key(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", value.upper())).strip()


def _lookup_merchant(counterparty: Optional[str], merchants: list[dict]) -> Optional[dict]:
    if not counterparty:
        return None
    key = _normalize_key(counterparty)
    for entry in merchants:
        for alias in [entry["canonical"], *entry.get("aliases", [])]:
            if _normalize_key(alias) == key:
                return entry
    best, best_len = None, 0
    for entry in merchants:
        for alias in [entry["canonical"], *entry.get("aliases", [])]:
            norm = _normalize_key(alias)
            if len(norm) > best_len and key.startswith(norm + " "):
                best, best_len = entry, len(norm)
    return best


_IFSC_RE = re.compile(r"([A-Z]{4})0[A-Z0-9]{6}")


def _lookup_ifsc(value: Optional[str], banks: dict) -> Optional[dict]:
    if not value:
        return None
    upper = value.upper()
    m = _IFSC_RE.search(upper)
    if m:
        prefix = m.group(1)
    elif re.fullmatch(r"[A-Z]{4}", upper.strip()):
        prefix = upper.strip()
    else:
        return None
    return banks.get(prefix)


def parse_narration(input_: str | dict, *, enrich: bool = True,
                    rules_dir: Optional[Path] = None) -> dict[str, Any]:
    """Parse a bank narration into the flattened ParsedBankNarration shape —
    the same output contract as parseBankNarration() in TypeScript."""
    rd = rules_dir or _RULES_DIR
    rule_sets, categories = load_builtin_rules(rd)
    norm = Normalizer(rule_sets, categories)
    txn = norm.normalize(input_)

    merchant_entry = vpa_info = ifsc_info = None
    if enrich:
        entities = _load_entities()
        merchant_entry = _lookup_merchant(txn.counterparty, entities["merchants"])
        if txn.vpa_handle:
            vpa_info = entities["vpa-handles"].get(txn.vpa_handle)
        ifsc_src = txn.metadata.get("bank_code") or txn.raw
        ifsc_info = _lookup_ifsc(ifsc_src, entities["ifsc-codes"])

    merchant = (merchant_entry or {}).get("canonical") or txn.counterparty
    category = (
        merchant_entry["category"]
        if txn.category == "Uncategorized" and merchant_entry
        else txn.category
    )
    return {
        "channel": txn.channel,
        "type": txn.type,
        "ref_no": txn.transaction_id,
        "merchant": merchant,
        "counterparty": txn.counterparty,
        "vpa": txn.vpa_handle,
        "is_salary": txn.metadata.get("is_salary") == "true",
        "date": txn.date,
        "category": category,
        "confidence": txn.confidence,
        "matched_rule": txn.matched_rule,
        "warnings": txn.warnings,
        "merchant_canonical": (merchant_entry or {}).get("canonical"),
        "vpa_app": (vpa_info or {}).get("app"),
        "vpa_bank": (vpa_info or {}).get("bank"),
        "ifsc_bank": (ifsc_info or {}).get("name"),
    }
