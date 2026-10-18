# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Multi-account consolidation — Python port of @paniniapi/insights
consolidate.ts. Pairs a debit in one of a borrower's accounts with the
matching credit in another (internal transfers), flags cross-account
refNo duplicates, and nets internal legs out of consolidated flow.
Dict-in, dict-out, identical semantics to the TypeScript version."""

import re
from typing import Optional

from .insights import epoch_day


def _slice_key(slice_: dict, position: int) -> str:
    key = slice_.get("accountKey")
    if key is not None and str(key).strip() != "":
        return str(key)
    mask = slice_.get("accountMask")
    if mask is not None and str(mask) != "":
        return f"{slice_.get('bank') or 'BANK'}-{mask}"
    return f"account-{position}"


def _normalize_ref_no(ref: Optional[str]) -> Optional[str]:
    if ref is None:
        return None
    cleaned = re.sub(r"[^A-Za-z0-9]", "", str(ref)).upper()
    return cleaned if len(cleaned) >= 6 else None


def _rollup(slice_: dict, key: str) -> dict:
    credits = 0
    debits = 0
    start: Optional[str] = None
    end: Optional[str] = None
    for t in slice_.get("transactions", []):
        amount = t.get("amountPaise")
        if amount is not None:
            if t.get("direction") == "CREDIT":
                credits += amount
            if t.get("direction") == "DEBIT":
                debits += amount
        if epoch_day(t.get("date")) is not None:
            iso = t["date"][:10]
            if start is None or iso < start:
                start = iso
            if end is None or iso > end:
                end = iso
    return {
        "accountKey": key,
        "bank": slice_.get("bank"),
        "accountMask": slice_.get("accountMask"),
        "txnCount": len(slice_.get("transactions", [])),
        "totalCreditsPaise": credits,
        "totalDebitsPaise": debits,
        "netPaise": credits - debits,
        "periodStart": start,
        "periodEnd": end,
    }


def consolidate_accounts(accounts: list, options: Optional[dict] = None) -> dict:
    options = options or {}
    warnings: list = []
    tolerance = options.get("amountTolerance", 0.02)
    window_days = options.get("transferWindowDays", 3)
    dup_window = options.get("duplicateWindowDays", 1)

    if len(accounts) == 0:
        warnings.append("no accounts supplied — portfolio report is empty")
    if len(accounts) == 1:
        warnings.append(
            "single account supplied — consolidation is identical to per-account analysis"
        )

    keyed = [
        {"slice": s, "key": _slice_key(s, i)} for i, s in enumerate(accounts)
    ]
    keys = [k["key"] for k in keyed]
    if len(set(keys)) != len(keys):
        warnings.append(
            "duplicate accountKey values — internal-transfer detection may misfire"
        )

    debit_legs: list = []
    credit_legs: list = []
    for k in keyed:
        for index, t in enumerate(k["slice"].get("transactions", [])):
            amount = t.get("amountPaise")
            if amount is None:
                continue
            leg = {
                "account": k["key"],
                "index": index,
                "amountPaise": amount,
                "day": epoch_day(t.get("date")),
            }
            if t.get("direction") == "DEBIT":
                debit_legs.append(leg)
            if t.get("direction") == "CREDIT":
                credit_legs.append(leg)

    internal_transfers: list = []
    matched_credits: set = set()
    for d in debit_legs:
        for c in credit_legs:
            if c["account"] == d["account"]:
                continue
            cid = f"{c['account']}:{c['index']}"
            if cid in matched_credits:
                continue
            if abs(c["amountPaise"] - d["amountPaise"]) > max(
                c["amountPaise"], d["amountPaise"]
            ) * tolerance:
                continue
            days_apart = (
                c["day"] - d["day"]
                if d["day"] is not None and c["day"] is not None
                else None
            )
            if days_apart is not None and (
                days_apart < -window_days or days_apart > window_days
            ):
                continue
            matched_credits.add(cid)
            internal_transfers.append(
                {
                    "fromAccount": d["account"],
                    "toAccount": c["account"],
                    "fromIndex": d["index"],
                    "toIndex": c["index"],
                    "amountPaise": d["amountPaise"],
                    "daysApart": days_apart if days_apart is not None else 0,
                }
            )
            break

    by_ref: dict = {}
    for k in keyed:
        for index, t in enumerate(k["slice"].get("transactions", [])):
            ref = _normalize_ref_no(t.get("refNo"))
            if (
                ref is None
                or t.get("amountPaise") is None
                or t.get("direction") is None
            ):
                continue
            ref_key = f"{t['direction']}:{ref}"
            by_ref.setdefault(ref_key, []).append(
                {
                    "account": k["key"],
                    "index": index,
                    "amountPaise": t["amountPaise"],
                    "day": epoch_day(t.get("date")),
                    "ref": ref,
                }
            )
    duplicates: list = []
    for legs in by_ref.values():
        for i in range(len(legs)):
            for j in range(i + 1, len(legs)):
                a, b = legs[i], legs[j]
                if a["amountPaise"] != b["amountPaise"]:
                    continue
                apart = (
                    abs(a["day"] - b["day"])
                    if a["day"] is not None and b["day"] is not None
                    else 0
                )
                if a["day"] is not None and b["day"] is not None and apart > dup_window:
                    continue
                if a["account"] == b["account"] and a["index"] == b["index"]:
                    continue
                duplicates.append(
                    {
                        "accountA": a["account"],
                        "indexA": a["index"],
                        "accountB": b["account"],
                        "indexB": b["index"],
                        "refNo": a["ref"],
                        "amountPaise": a["amountPaise"],
                        "daysApart": apart,
                    }
                )

    rollups = [_rollup(k["slice"], k["key"]) for k in keyed]
    total_credits = sum(r["totalCreditsPaise"] for r in rollups)
    total_debits = sum(r["totalDebitsPaise"] for r in rollups)
    internal_volume = sum(t["amountPaise"] for t in internal_transfers)

    return {
        "accounts": rollups,
        "internalTransfers": internal_transfers,
        "duplicates": duplicates,
        "consolidated": {
            "totalCreditsPaise": total_credits,
            "totalDebitsPaise": total_debits,
            "externalCreditsPaise": total_credits - internal_volume,
            "externalDebitsPaise": total_debits - internal_volume,
            "netPaise": total_credits - total_debits,
            "internalVolumePaise": internal_volume,
        },
        "warnings": warnings,
    }
