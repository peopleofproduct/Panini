"""Document ↔ Account Aggregator cross-verification — the ground-truth
fraud check. Diff a claimed statement against the bank's own AA feed:
rows the document claims but the bank doesn't know (inside the AA
coverage window) are fabrication evidence; rows the bank carries that
the document omits in-period are omissions. Python port of
packages/forensics/src/reconcile.ts — same semantics, same verdicts.

The AA feed is encrypted end-to-end from the bank's FIP — the borrower
cannot edit it, so unlike consistency checks this proves the document
against ground truth, not just internal coherence.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

DAY_MS = 86_400_000


def _rupees_to_paise(value: Any) -> Optional[int]:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n != n:  # NaN
        return None
    return round(n * 100)


def _date_ms(iso: Optional[str]) -> Optional[float]:
    if not iso or not isinstance(iso, str):
        return None
    try:
        text = iso.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            dt = datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        else:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp() * 1000
    except ValueError:
        return None


def _norm_narration(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _canon_doc(transactions: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "index": i,
            "dateMs": _date_ms(t.get("date")),
            "amountPaise": t.get("amountPaise"),
            "direction": t.get("direction"),
            "narration": t.get("narration") or "",
            "balancePaise": t.get("balancePaise"),
        }
        for i, t in enumerate(transactions)
    ]


def _canon_aa(txns: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i, t in enumerate(txns):
        out.append(
            {
                "index": i,
                "dateMs": _date_ms(t.get("valueDate")),
                "amountPaise": _rupees_to_paise(t.get("amount")),
                "direction": t.get("type")
                if t.get("type") in ("DEBIT", "CREDIT")
                else "OTHERS",
                "narration": t.get("narration") or "",
                "balancePaise": _rupees_to_paise(
                    t.get("currentBalance", t.get("balance"))
                ),
            }
        )
    return out


def _incomparable(message: str) -> dict[str, Any]:
    return {
        "verdict": "incomparable",
        "matchedRows": 0,
        "documentOnlyRows": [],
        "aaOnlyRows": [],
        "unverifiableRows": [],
        "mismatches": [],
        "summary": message,
    }


def reconcile_with_aa(
    statement: dict[str, Any],
    aa_transactions: Iterable[dict[str, Any]],
    *,
    amount_tolerance_paise: int = 0,
    date_window_days: int = 1,
    compare_narrations: bool = True,
) -> dict[str, Any]:
    """Deterministic multiset diff — same inputs, same report."""
    doc = _canon_doc(statement.get("transactions", []))
    aa = _canon_aa(aa_transactions)
    if not doc:
        return _incomparable("document carries no transactions to reconcile")
    if not aa:
        return _incomparable("AA feed carries no transactions to reconcile against")

    date_tol = date_window_days * DAY_MS
    aa_dates = [r["dateMs"] for r in aa if r["dateMs"] is not None]
    aa_min, aa_max = (min(aa_dates), max(aa_dates)) if aa_dates else (None, None)
    doc_dates = [r["dateMs"] for r in doc if r["dateMs"] is not None]
    doc_min, doc_max = (min(doc_dates), max(doc_dates)) if doc_dates else (None, None)

    def in_aa_window(d: Optional[float]) -> bool:
        return (
            d is not None
            and aa_min is not None
            and aa_max is not None
            and aa_min - date_tol <= d <= aa_max + date_tol
        )

    def in_doc_window(d: Optional[float]) -> bool:
        return (
            d is not None
            and doc_min is not None
            and doc_max is not None
            and doc_min - date_tol <= d <= doc_max + date_tol
        )

    pool = sorted(
        aa,
        key=lambda r: (r["dateMs"] or 0, r["amountPaise"] or 0, r["index"]),
    )
    used: set[int] = set()

    def key_match(d: dict[str, Any], a: dict[str, Any]) -> bool:
        if d["direction"] != a["direction"]:
            return False
        if d["amountPaise"] is None or a["amountPaise"] is None:
            return False
        if abs(d["amountPaise"] - a["amountPaise"]) > amount_tolerance_paise:
            return False
        if d["dateMs"] is None or a["dateMs"] is None:
            return True
        return abs(d["dateMs"] - a["dateMs"]) <= date_tol

    mismatches: list[dict[str, Any]] = []
    document_only: list[int] = []
    unverifiable: list[int] = []
    matched = 0

    for d in doc:
        hit = next(
            (a for a in pool if a["index"] not in used and key_match(d, a)),
            None,
        )
        if hit is None:
            if in_aa_window(d["dateMs"]):
                document_only.append(d["index"])
            else:
                unverifiable.append(d["index"])
            continue
        used.add(hit["index"])
        matched += 1
        if (
            d["balancePaise"] is not None
            and hit["balancePaise"] is not None
            and d["balancePaise"] != hit["balancePaise"]
        ):
            mismatches.append(
                {
                    "documentRow": d["index"],
                    "aaRow": hit["index"],
                    "field": "balance",
                    "documentValue": f"₹{d['balancePaise'] / 100:.2f}",
                    "aaValue": f"₹{hit['balancePaise'] / 100:.2f}",
                    "severity": "soft",
                }
            )
        if compare_narrations and _norm_narration(d["narration"]) != _norm_narration(
            hit["narration"]
        ):
            mismatches.append(
                {
                    "documentRow": d["index"],
                    "aaRow": hit["index"],
                    "field": "narration",
                    "documentValue": d["narration"][:80],
                    "aaValue": hit["narration"][:80],
                    "severity": "soft",
                }
            )

    aa_only = sorted(
        a["index"]
        for a in pool
        if a["index"] not in used and in_doc_window(a["dateMs"])
    )

    hard = len(document_only) + len(aa_only)
    verdict = (
        "fabrication_evidence" if hard > 0 else "partial" if mismatches else "consistent"
    )

    parts = [f"{matched}/{len(doc)} document rows confirmed against AA feed"]
    if document_only:
        parts.append(f"{len(document_only)} document rows unknown to the bank feed")
    if aa_only:
        parts.append(f"{len(aa_only)} bank transactions omitted from the document")
    if mismatches:
        parts.append(f"{len(mismatches)} soft-field mismatches")
    if unverifiable:
        parts.append(f"{len(unverifiable)} rows outside AA coverage (unverifiable)")

    return {
        "verdict": verdict,
        "matchedRows": matched,
        "documentOnlyRows": document_only,
        "aaOnlyRows": aa_only,
        "unverifiableRows": unverifiable,
        "mismatches": mismatches,
        "summary": "; ".join(parts),
    }


def transactions_from_aa_data(fi_data: Any) -> list[dict[str, Any]]:
    """Find the transaction array inside an AA FI payload — handles the
    ReBIT shape ({Account:{Transactions:{Transaction:[…]}}}) plus any
    nested variant. Deterministic depth-first search; [] when nothing fits."""

    def looks_like_txn(o: Any) -> bool:
        return isinstance(o, dict) and (
            "amount" in o or "valueDate" in o or "type" in o
        ) and ("valueDate" in o or "transactionTimestamp" in o or "amount" in o)

    seen: set[int] = set()

    def walk(node: Any) -> Optional[list[dict[str, Any]]]:
        if not isinstance(node, (dict, list)) or id(node) in seen:
            return None
        seen.add(id(node))
        if isinstance(node, list):
            if node and all(looks_like_txn(i) for i in node):
                return node
            for item in node:
                found = walk(item)
                if found is not None:
                    return found
            return None
        for key in node:
            found = walk(node[key])
            if found is not None:
                return found
        return None

    return walk(fi_data) or []
