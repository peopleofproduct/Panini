# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Counterparty money-flow aggregates + account-conduct metrics —
Python port of @paniniapi/insights flows.ts. counterparty_flows groups
transactions into per-counterparty in/out/net totals (the deterministic
kernel behind money-trail products); detect_conduct_metrics computes
overdrawn days, EOD balance stats, and bounce rate."""

import math
import re
from typing import Optional

from .insights import _js_round, counterparty_key, epoch_day

FLOW_RULE_IDS = {
    "COUNTERPARTY": "PANINI-FLOW-CP-001",
    "CONDUCT": "PANINI-CONDUCT-001",
}

_BOUNCE_NARR_RE = re.compile(
    r"\b(bounce[ds]?|dishonou?r(?:ed)?|insufficient\s*funds?|unpaid|return\s*(?:chg|charge)"
    r"|nach\s*(?:rtn|return)|ecs\s*(?:rtn|return)|chq\s*ret|cheque\s*ret"
    r"|auto\s*debit\s*(?:fail|rej)|mandate\s*(?:fail|rej))\b",
    re.I,
)
_RETURN_CHG_RE = re.compile(r"return\s*(?:chg|charge)", re.I)


def counterparty_flows(transactions: list, options: Optional[dict] = None) -> dict:
    groups: dict = {}
    unattributed = 0
    for index, txn in enumerate(transactions):
        if txn is None:
            continue
        amount = txn.get("amountPaise")
        if (
            txn.get("direction") is None
            or amount is None
            or not math.isfinite(amount)
        ):
            continue
        key = counterparty_key(txn)
        if key is None:
            unattributed += 1
            continue
        g = groups.setdefault(
            key, {"inflow": 0, "outflow": 0, "idx": [], "first": None, "last": None}
        )
        if txn["direction"] == "CREDIT":
            g["inflow"] += amount
        else:
            g["outflow"] += amount
        g["idx"].append(index)
        if epoch_day(txn.get("date")) is not None:
            iso = txn["date"][:10]
            if g["first"] is None or iso < g["first"]:
                g["first"] = iso
            if g["last"] is None or iso > g["last"]:
                g["last"] = iso
    flows = [
        {
            "counterparty": k,
            "inflowPaise": g["inflow"],
            "outflowPaise": g["outflow"],
            "netPaise": g["inflow"] - g["outflow"],
            "txnCount": len(g["idx"]),
            "txnIndices": g["idx"],
            "firstSeen": g["first"],
            "lastSeen": g["last"],
        }
        for k, g in groups.items()
    ]
    flows.sort(key=lambda f: -(f["inflowPaise"] + f["outflowPaise"]))
    top = (options or {}).get("top")
    return {
        "flows": flows if top is None else flows[:top],
        "unattributedCount": unattributed,
        "warnings": [],
    }


def detect_conduct_metrics(transactions: list) -> dict:
    usable = [
        t
        for t in transactions
        if t is not None
        and t.get("amountPaise") is not None
        and math.isfinite(t["amountPaise"])
        and t.get("direction") is not None
    ]

    eod_by_day: dict = {}
    od_idx: list = []
    worst_od: Optional[float] = None
    min_day: Optional[int] = None
    max_day: Optional[int] = None
    for index, t in enumerate(usable):
        day = epoch_day(t.get("date"))
        if day is not None:
            min_day = day if min_day is None else min(min_day, day)
            max_day = day if max_day is None else max(max_day, day)
        bal = t.get("balancePaise")
        if bal is None or not math.isfinite(bal):
            continue
        if day is not None:
            eod_by_day[day] = bal
        if bal < 0:
            od_idx.append(index)
            worst_od = bal if worst_od is None else min(worst_od, bal)

    eod_values = list(eod_by_day.values())
    avg_eod = _js_round(sum(eod_values) / len(eod_values)) if eod_values else None
    eod_volatility = None
    if len(eod_values) >= 2 and avg_eod:
        variance = sum((v - avg_eod) ** 2 for v in eod_values) / len(eod_values)
        eod_volatility = _js_round(math.sqrt(variance) / abs(avg_eod) * 10000) / 100

    debits = [t for t in usable if t["direction"] == "DEBIT"]
    bounce_idx: list = []
    return_charges = 0
    for index, t in enumerate(usable):
        if t["direction"] != "DEBIT":
            continue
        if _BOUNCE_NARR_RE.search(t.get("narration") or ""):
            bounce_idx.append(index)
            if _RETURN_CHG_RE.search(t.get("narration") or ""):
                return_charges += 1
    bounce_rate = (
        _js_round(len(bounce_idx) / len(debits) * 10000) / 100 if debits else None
    )

    metrics = {
        "overdrawnDays": (
            sum(1 for b in eod_by_day.values() if b < 0) if eod_by_day else len(od_idx)
        ),
        "worstOverdraftPaise": worst_od,
        "averageEodBalancePaise": avg_eod,
        "eodVolatilityPct": eod_volatility,
        "bounceRatePct": bounce_rate,
        "bounceCount": len(bounce_idx),
        "daysCovered": (max_day - min_day + 1) if min_day is not None else 0,
        "returnChargeCount": return_charges,
        "evidence": (
            [
                {
                    "ruleId": FLOW_RULE_IDS["CONDUCT"],
                    "note": f"{len(od_idx)} row(s) with negative balance",
                    "txnIndices": od_idx,
                }
            ]
            if od_idx
            else []
        ),
    }

    signals: list = []
    if metrics["overdrawnDays"] >= 5:
        signals.append(
            {
                "ruleId": FLOW_RULE_IDS["CONDUCT"],
                "severity": "high" if metrics["overdrawnDays"] >= 15 else "medium",
                "note": f"{metrics['overdrawnDays']} day(s) closed overdrawn",
                "evidence": metrics["evidence"],
            }
        )
    if bounce_rate is not None and bounce_rate >= 5 and len(bounce_idx) >= 3:
        signals.append(
            {
                "ruleId": FLOW_RULE_IDS["CONDUCT"],
                "severity": "high" if bounce_rate >= 15 else "medium",
                "note": f"bounce rate {bounce_rate}% of debits ({len(bounce_idx)}/{len(debits)})",
                "evidence": [
                    {
                        "ruleId": FLOW_RULE_IDS["CONDUCT"],
                        "note": "bounce/return narrations",
                        "txnIndices": bounce_idx,
                    }
                ],
            }
        )
    if eod_volatility is not None and eod_volatility >= 80:
        signals.append(
            {
                "ruleId": FLOW_RULE_IDS["CONDUCT"],
                "severity": "low",
                "note": f"EOD balance volatility {eod_volatility}% — unstable daily balances",
                "evidence": [],
            }
        )
    return {"metrics": metrics, "signals": signals}
