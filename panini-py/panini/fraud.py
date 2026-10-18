# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Named fraud-indicator suite — Python port of @paniniapi/insights
fraud.ts. Deterministic checks mirroring the industry-standard list:
circular in/out pairs, holiday cash deposits, sub-floor RTGS,
round-figure clustering, gap months, wash months, salary anomalies,
dormant spikes, overdrawn days, penalty charges — plus portfolio-level
cross-account cycles and inflated turnover. Every flag carries evidence
indices back into the input."""

import math
import re
from datetime import date as _date, timedelta
from typing import Optional

from .consolidate import consolidate_accounts
from .insights import counterparty_key, epoch_day, median, month_key

FRAUD_RULE_IDS = {
    "CIRCULAR_PAIR": "PANINI-FRD-CIRC-001",
    "HOLIDAY_CASH": "PANINI-FRD-HOL-001",
    "RTGS_BELOW_FLOOR": "PANINI-FRD-RTGS-001",
    "ROUND_FIGURES": "PANINI-FRD-ROUND-001",
    "GAP_MONTH": "PANINI-FRD-GAP-001",
    "WASH_MONTH": "PANINI-FRD-EQDC-001",
    "SALARY_STOP": "PANINI-FRD-SALSTOP-001",
    "SALARY_STRIP": "PANINI-FRD-LSAL-001",
    "DORMANT_SPIKE": "PANINI-FRD-DORM-001",
    "OVERDRAWN_DAYS": "PANINI-FRD-OD-001",
    "PENALTY_CHARGES": "PANINI-FRD-MINB-001",
    "CROSS_ACCOUNT_CYCLE": "PANINI-FRD-ACIRC-001",
    "INFLATED_TURNOVER": "PANINI-FRD-SELFINFL-001",
}

CASH_RE = re.compile(r"\b(cash\s*(?:dep|deposit|dpt)|self\s*cash|cdm\b|cash\s*by)\b", re.I)
RTGS_RE = re.compile(r"\brtgs\b", re.I)
PENALTY_RE = re.compile(
    r"\b(min(?:imum)?\s*bal(?:ance)?\s*(?:chg|charge|penalty)|non[-\s]?maintenance"
    r"|penalty\s*chg|avg\s*bal\s*chg|qb\s*chg|amb\s*chg)\b",
    re.I,
)
SALARY_RE = re.compile(r"\b(salary|payroll|sal\s*cr|wages?|stipend)\b", re.I)

RTGS_FLOOR_PAISE = 200_000 * 100
ROUND_UNIT_PAISE = 1_000 * 100
_EPOCH = _date(1970, 1, 1)


def _within_tol(a: float, b: float, tol: float) -> bool:
    return abs(a - b) <= max(a, b) * tol


def _work(txns: list) -> tuple:
    usable: list = []
    dropped = 0
    for index, txn in enumerate(txns):
        amount = txn.get("amountPaise") if txn is not None else None
        if (
            txn is None
            or txn.get("direction") is None
            or amount is None
            or not math.isfinite(amount)
        ):
            dropped += 1
            continue
        usable.append({"txn": txn, "index": index, "day": epoch_day(txn.get("date"))})
    return usable, dropped


def _rotation_key(txn: dict) -> Optional[str]:
    key = counterparty_key(txn)
    if key is None:
        return None
    prev = ""
    while key != prev:
        prev = key
        key = re.sub(
            r"^(NEFT|RTGS|IMPS|UPI|NACH|ECS|TRF|TPT|FT|BY|TO|FROM|DR|CR|SELF)\s+",
            "",
            key,
        ).strip()
    return key if key else None


def _is_non_banking_day(iso_date: str, holidays: set) -> bool:
    day = epoch_day(iso_date)
    if day is None:
        return False
    dow = (_EPOCH + timedelta(days=day)).weekday()  # Mon=0 … Sun=6
    return dow >= 5 or iso_date[:10] in holidays


def _circular_pairs(usable: list, window_days: int, tolerance: float) -> list:
    credits = [w for w in usable if w["txn"]["direction"] == "CREDIT" and w["day"] is not None]
    debits = [w for w in usable if w["txn"]["direction"] == "DEBIT" and w["day"] is not None]
    evidence: list = []
    used: set = set()
    for c in credits:
        c_key = _rotation_key(c["txn"])
        for d in debits:
            if d["index"] in used or d["index"] == c["index"]:
                continue
            gap = d["day"] - c["day"]
            if gap < 0 or gap > window_days:
                continue
            if not _within_tol(c["txn"]["amountPaise"], d["txn"]["amountPaise"], tolerance):
                continue
            d_key = _rotation_key(d["txn"])
            if c_key is not None and d_key is not None and c_key == d_key:
                continue
            used.add(d["index"])
            evidence.append(
                {
                    "ruleId": FRAUD_RULE_IDS["CIRCULAR_PAIR"],
                    "note": f"₹{c['txn']['amountPaise'] / 100:.2f} in then ~same out "
                    f"within {gap} day(s), different counterparty",
                    "txnIndices": [c["index"], d["index"]],
                }
            )
            break
    return evidence


def _gap_months(usable: list) -> list:
    seen: set = set()
    min_day: Optional[int] = None
    max_day: Optional[int] = None
    for w in usable:
        mk = month_key(w["txn"].get("date"))
        if mk is not None:
            seen.add(mk)
        if w["day"] is not None:
            min_day = w["day"] if min_day is None else min(min_day, w["day"])
            max_day = w["day"] if max_day is None else max(max_day, w["day"])
    if min_day is None or max_day is None or max_day - min_day < 45:
        return []
    missing: list = []
    cursor = _date.fromordinal(_EPOCH.toordinal() + min_day).replace(day=1)
    end = _date.fromordinal(_EPOCH.toordinal() + max_day)
    while cursor <= end:
        mk = f"{cursor.year:04d}-{cursor.month:02d}"
        if mk not in seen:
            missing.append(mk)
        cursor = (cursor.replace(day=28) + timedelta(days=7)).replace(day=1)
    return [
        {
            "ruleId": FRAUD_RULE_IDS["GAP_MONTH"],
            "note": f"no transactions in {mk} — dormant month or missing statement pages",
            "txnIndices": [],
        }
        for mk in missing
    ]


def _salary_signals(usable: list, strip_fraction: float) -> tuple:
    salary = [
        w
        for w in usable
        if w["txn"]["direction"] == "CREDIT"
        and (
            w["txn"].get("is_salary") is True
            or SALARY_RE.search(w["txn"].get("narration") or "")
        )
        and w["day"] is not None
    ]
    if len(salary) < 2:
        return None, None
    months = sorted({month_key(w["txn"].get("date")) for w in salary} - {None})
    last_salary_month = months[-1]
    all_months = sorted({month_key(w["txn"].get("date")) for w in usable} - {None})
    last_month = all_months[-1]

    stop = None
    if len(months) >= 3 and last_month > last_salary_month:
        stop = {
            "ruleId": FRAUD_RULE_IDS["SALARY_STOP"],
            "note": f"salary credits present in {len(months)} month(s) but absent after "
            f"{last_salary_month}; statement runs to {last_month}",
            "txnIndices": [w["index"] for w in salary],
        }

    strip_pairs: list = []
    debits = [w for w in usable if w["txn"]["direction"] == "DEBIT" and w["day"] is not None]
    for s in salary:
        for d in debits:
            gap = d["day"] - s["day"]
            if gap < 0 or gap > 3:
                continue
            if d["txn"]["amountPaise"] < s["txn"]["amountPaise"] * strip_fraction:
                continue
            strip_pairs.extend([s["index"], d["index"]])
            break
    strip = (
        {
            "ruleId": FRAUD_RULE_IDS["SALARY_STRIP"],
            "note": f"{len(strip_pairs) // 2} salary credit(s) followed within 3 days by "
            f"debit(s) ≥ {round(strip_fraction * 100)}% of salary",
            "txnIndices": strip_pairs,
        }
        if len(strip_pairs) >= 4
        else None
    )
    return stop, strip


def detect_fraud_indicators(transactions: list, options: Optional[dict] = None) -> dict:
    options = options or {}
    warnings: list = []
    usable, dropped = _work(transactions)
    if dropped > 0:
        warnings.append(f"{dropped} transaction(s) skipped: missing direction/amount")
    indicators: list = []

    def push(rule_id: str, severity: str, note: str, evidence: list) -> None:
        indicators.append(
            {"ruleId": rule_id, "severity": severity, "note": note, "evidence": evidence}
        )

    window_days = options.get("circularWindowDays", 2)
    tolerance = options.get("amountTolerance", 0.02)
    holidays = set(options.get("holidays") or [])

    circ = _circular_pairs(usable, window_days, tolerance)
    if circ:
        push(
            FRAUD_RULE_IDS["CIRCULAR_PAIR"],
            "high" if len(circ) >= 3 else "medium",
            f"{len(circ)} same-amount in/out pair(s) across different counterparties"
            " — possible rotation",
            circ,
        )

    hol_idx = [
        w["index"]
        for w in usable
        if CASH_RE.search(w["txn"].get("narration") or "")
        and w["txn"]["direction"] == "CREDIT"
        and w["txn"].get("date") is not None
        and _is_non_banking_day(w["txn"]["date"], holidays)
    ]
    if hol_idx:
        push(
            FRAUD_RULE_IDS["HOLIDAY_CASH"],
            "high" if len(hol_idx) >= 3 else "low",
            f"{len(hol_idx)} cash deposit(s) dated on weekend/holiday — CDM/branch "
            "deposits don't settle on non-banking days",
            [
                {
                    "ruleId": FRAUD_RULE_IDS["HOLIDAY_CASH"],
                    "note": "cash-deposit narration on a non-banking day",
                    "txnIndices": hol_idx,
                }
            ],
        )

    rtgs_idx = [
        w["index"]
        for w in usable
        if RTGS_RE.search(w["txn"].get("narration") or "")
        and w["txn"]["amountPaise"] < RTGS_FLOOR_PAISE
    ]
    if rtgs_idx:
        push(
            FRAUD_RULE_IDS["RTGS_BELOW_FLOOR"],
            "medium",
            f"{len(rtgs_idx)} narration(s) claim RTGS below the ₹2,00,000 RBI floor",
            [
                {
                    "ruleId": FRAUD_RULE_IDS["RTGS_BELOW_FLOOR"],
                    "note": "RTGS minimum is ₹2L — sub-floor RTGS is mislabeled "
                    "or threshold-gaming",
                    "txnIndices": rtgs_idx,
                }
            ],
        )

    round_min = options.get("roundAmountMinPaise", 1_000_000)
    big = [w for w in usable if w["txn"]["amountPaise"] >= round_min]
    round_idx = [
        w["index"] for w in big if w["txn"]["amountPaise"] % ROUND_UNIT_PAISE == 0
    ]
    share = len(round_idx) / len(big) if big else 0
    if len(round_idx) >= 5 and share >= options.get("roundShareThreshold", 0.4):
        push(
            FRAUD_RULE_IDS["ROUND_FIGURES"],
            "high" if share >= 0.7 else "medium",
            f"{len(round_idx)}/{len(big)} transactions ≥ ₹10,000 are exact "
            f"₹1,000 multiples ({round(share * 100)}%)",
            [
                {
                    "ruleId": FRAUD_RULE_IDS["ROUND_FIGURES"],
                    "note": "round-figure clustering is an anomaly pattern, not proof",
                    "txnIndices": round_idx,
                }
            ],
        )

    for g in _gap_months(usable):
        push(FRAUD_RULE_IDS["GAP_MONTH"], "medium", g["note"], [g])

    by_month: dict = {}
    for w in usable:
        mk = month_key(w["txn"].get("date"))
        if mk is None:
            continue
        cur = by_month.setdefault(mk, {"cr": 0, "dr": 0, "idx": []})
        if w["txn"]["direction"] == "CREDIT":
            cur["cr"] += w["txn"]["amountPaise"]
        else:
            cur["dr"] += w["txn"]["amountPaise"]
        cur["idx"].append(w["index"])
    wash_tol = options.get("washTolerance", 0.05)
    wash: list = []
    for mk, v in by_month.items():
        if v["cr"] < 500_000 or v["dr"] < 500_000:
            continue
        if abs(v["cr"] - v["dr"]) <= max(v["cr"], v["dr"]) * wash_tol:
            wash.append(
                {
                    "ruleId": FRAUD_RULE_IDS["WASH_MONTH"],
                    "note": f"{mk}: credits ≈ debits (₹{v['cr'] / 100:.0f} / "
                    f"₹{v['dr'] / 100:.0f}) — turnover wash",
                    "txnIndices": v["idx"],
                }
            )
    if wash:
        push(
            FRAUD_RULE_IDS["WASH_MONTH"],
            "high" if len(wash) >= 2 else "medium",
            f"{len(wash)} month(s) with near-equal inflow/outflow",
            wash,
        )

    stop, strip = _salary_signals(usable, options.get("salaryStripFraction", 0.8))
    if stop is not None:
        push(FRAUD_RULE_IDS["SALARY_STOP"], "medium", stop["note"], [stop])
    if strip is not None:
        push(FRAUD_RULE_IDS["SALARY_STRIP"], "high", strip["note"], [strip])

    dated = sorted((w for w in usable if w["day"] is not None), key=lambda w: w["day"])
    credit_amounts = [w["txn"]["amountPaise"] for w in dated if w["txn"]["direction"] == "CREDIT"]
    credit_median = median(credit_amounts) if credit_amounts else math.nan
    dormant_gap = options.get("dormantGapDays", 45)
    dorm: list = []
    for i in range(1, len(dated)):
        gap = dated[i]["day"] - dated[i - 1]["day"]
        if gap < dormant_gap:
            continue
        after = dated[i]
        if (
            after["txn"]["direction"] == "CREDIT"
            and math.isfinite(credit_median)
            and credit_median > 0
            and after["txn"]["amountPaise"] >= credit_median * 3
        ):
            dorm.append(
                {
                    "ruleId": FRAUD_RULE_IDS["DORMANT_SPIKE"],
                    "note": f"{gap}-day lull then credit ₹{after['txn']['amountPaise'] / 100:.2f} "
                    "(>3× median credit)",
                    "txnIndices": [after["index"]],
                }
            )
    if dorm:
        push(
            FRAUD_RULE_IDS["DORMANT_SPIKE"],
            "medium",
            f"{len(dorm)} dormant-period→large-credit pattern(s)",
            dorm,
        )

    od_idx = [
        w["index"]
        for w in usable
        if w["txn"].get("balancePaise") is not None and w["txn"]["balancePaise"] < 0
    ]
    if od_idx:
        push(
            FRAUD_RULE_IDS["OVERDRAWN_DAYS"],
            "high" if len(od_idx) >= 10 else "low",
            f"{len(od_idx)} transaction row(s) show a negative balance — overdrawn days",
            [
                {
                    "ruleId": FRAUD_RULE_IDS["OVERDRAWN_DAYS"],
                    "note": "negative running balance observed",
                    "txnIndices": od_idx,
                }
            ],
        )

    pen_idx = [
        w["index"]
        for w in usable
        if PENALTY_RE.search(w["txn"].get("narration") or "")
        and w["txn"]["direction"] == "DEBIT"
    ]
    if len(pen_idx) >= 2:
        push(
            FRAUD_RULE_IDS["PENALTY_CHARGES"],
            "low",
            f"{len(pen_idx)} minimum-balance/penalty charge(s) — conduct signal",
            [
                {
                    "ruleId": FRAUD_RULE_IDS["PENALTY_CHARGES"],
                    "note": "balance-maintenance penalty narrations",
                    "txnIndices": pen_idx,
                }
            ],
        )

    return {"indicators": indicators, "warnings": warnings}


def detect_portfolio_indicators(accounts: list, options: Optional[dict] = None) -> dict:
    options = options or {}
    warnings: list = []
    portfolio = consolidate_accounts(accounts, options)
    warnings.extend(portfolio["warnings"])
    indicators: list = []

    window_days = options.get("circularWindowDays", 2)
    tolerance = options.get("amountTolerance", 0.02)
    cycles: list = []
    for t1 in portfolio["internalTransfers"]:
        for t2 in portfolio["internalTransfers"]:
            if t2 is t1:
                continue
            if t2["fromAccount"] != t1["toAccount"] or t2["toAccount"] != t1["fromAccount"]:
                continue
            if not _within_tol(t1["amountPaise"], t2["amountPaise"], tolerance):
                continue
            if abs(t1["daysApart"] + t2["daysApart"]) > window_days * 2:
                continue
            cycles.append(
                {
                    "ruleId": FRAUD_RULE_IDS["CROSS_ACCOUNT_CYCLE"],
                    "note": f"₹{t1['amountPaise'] / 100:.2f} rotated "
                    f"{t1['fromAccount']}→{t1['toAccount']}→{t1['fromAccount']}",
                    "txnIndices": [],
                }
            )
            break
    if cycles:
        indicators.append(
            {
                "ruleId": FRAUD_RULE_IDS["CROSS_ACCOUNT_CYCLE"],
                "severity": "high",
                "note": f"{len(cycles)} cross-account rotation cycle(s) — money "
                "returned to its origin account",
                "evidence": cycles,
            }
        )

    total_cr = portfolio["consolidated"]["totalCreditsPaise"]
    internal_vol = portfolio["consolidated"]["internalVolumePaise"]
    share = internal_vol / total_cr if total_cr > 0 else 0
    if share >= 0.3 and len(portfolio["internalTransfers"]) >= 3:
        indicators.append(
            {
                "ruleId": FRAUD_RULE_IDS["INFLATED_TURNOVER"],
                "severity": "high" if share >= 0.6 else "medium",
                "note": f"{round(share * 100)}% of raw credits are transfers between "
                "the borrower's own accounts — turnover inflated",
                "evidence": [
                    {
                        "ruleId": FRAUD_RULE_IDS["INFLATED_TURNOVER"],
                        "note": f"{t['fromAccount']} → {t['toAccount']}: "
                        f"₹{t['amountPaise'] / 100:.2f}",
                        "txnIndices": [],
                    }
                    for t in portfolio["internalTransfers"]
                ],
            }
        )

    return {"indicators": indicators, "warnings": warnings}
