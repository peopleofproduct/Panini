# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Deterministic, explainable credit-relevant insights — Python port of
@paniniapi/insights. Output dicts mirror the TypeScript report shape
byte-for-byte (verified by the insights conformance fixture)."""

import math
import re
from datetime import date as _date
from typing import Any, Iterable, Optional

RULE_IDS = {
    "SALARY_FLAG": "PANINI-INC-001",
    "SALARY_KEYWORD": "PANINI-INC-002",
    "REGULAR_CREDIT": "PANINI-INC-003",
    "RECURRING_DEBIT": "PANINI-OBL-001",
    "EMI": "PANINI-EMI-001",
    "FOIR": "PANINI-FOIR-001",
    "CASHFLOW": "PANINI-CF-001",
    "BOUNCE": "PANINI-RSK-BOUNCE-001",
    "ROUND_TRIP": "PANINI-RSK-RT-001",
    "SELF_TRANSFER": "PANINI-RSK-SELF-001",
}

SALARY_KEYWORD_RE = re.compile(r"\b(salary|payroll|sal\s*cr|wages?|stipend)\b", re.I)
EMI_KEYWORD_RE = re.compile(
    r"\b(emi|loan\s*(?:repay|emi|pmt)|nach[\s-]|ecs[\s-]|bajaj\s*fin|finserv|home\s*credit"
    r"|tata\s*capital|capital\s*first|cholamandalam|aditya\s*birla\s*fin|fullerton|muthoot"
    r"|shriram\s*(?:fin|transport)|mahindra\s*fin|tvs\s*credit|credila|l&t\s*fin|piramal"
    r"|idfc\s*loan|poonawalla|hdb\s*fin|kissht|zestmoney|axio|simpl|lazypay)\b",
    re.I,
)
BOUNCE_RE = re.compile(
    r"\b(bounce[ds]?|dishonou?r(?:ed)?|insufficient\s*funds?|unpaid|return\s*(?:chg|charge)"
    r"|nach\s*(?:rtn|return)|ecs\s*(?:rtn|return)|chq\s*ret|cheque\s*ret"
    r"|auto\s*debit\s*(?:fail|rej)|mandate\s*(?:fail|rej))\b",
    re.I,
)
SELF_RE = re.compile(
    r"\b(self|own\s*a\/?c|own\s*(?:acct|account|transfer|trf)|trf\s*to\s*self|self\s*trf"
    r"|by\s*self|to\s*self)\b",
    re.I,
)

_EPOCH = _date(1970, 1, 1).toordinal()


def _js_round(x: float) -> int:
    """Match Math.round: halves round toward +infinity."""
    return int(math.floor(x + 0.5))


def month_key(date: Optional[str]) -> Optional[str]:
    if date is not None and re.match(r"^\d{4}-\d{2}", date):
        return date[:7]
    return None


def epoch_day(date: Optional[str]) -> Optional[int]:
    if date is None:
        return None
    try:
        return _date.fromisoformat(date[:10]).toordinal() - _EPOCH
    except ValueError:
        return None


def counterparty_key(txn: dict) -> Optional[str]:
    raw = txn.get("merchant") or txn.get("counterparty")
    if raw is not None and str(raw).strip() != "":
        k = re.sub(r"[^A-Z0-9 ]", " ", str(raw).upper())
        k = re.sub(r"\s+", " ", k).strip()
        return k if k else None
    narration = txn.get("narration") or ""
    m = re.search(r"(?:to|cr|dr|from)\s+([A-Za-z][A-Za-z0-9 &]{2,30})", narration)
    if m is not None:
        return re.sub(r"\s+", " ", m.group(1).upper()).strip()
    tail = re.split(r"[-/]", narration)[-1].strip()
    cleaned = re.sub(r"[^A-Za-z0-9 &]", " ", tail)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned.upper() if re.match(r"^[A-Za-z][A-Za-z0-9 &]{2,30}$", cleaned) else None


def median(values: Iterable[float]) -> float:
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 == 1 else (s[mid - 1] + s[mid]) / 2


def _within_tol(a: float, b: float, tol: float) -> bool:
    return abs(a - b) <= max(a, b) * tol


def _detect_income(usable: list, warnings: list) -> tuple:
    credits = [w for w in usable if w["txn"].get("direction") == "CREDIT" and w["txn"].get("amountPaise") is not None]
    events: list = []
    evidence: list = []

    for w in credits:
        t = w["txn"]
        narration = t.get("narration") or ""
        if t.get("is_salary") is True:
            events.append({"index": w["index"], "date": t.get("date"),
                           "amountPaise": t["amountPaise"], "employer": counterparty_key(t),
                           "basis": "is_salary_flag"})
        elif SALARY_KEYWORD_RE.search(narration):
            events.append({"index": w["index"], "date": t.get("date"),
                           "amountPaise": t["amountPaise"], "employer": counterparty_key(t),
                           "basis": "salary_keyword"})

    by_source: dict = {}
    for w in credits:
        key = counterparty_key(w["txn"])
        if key is None:
            continue
        by_source.setdefault(key, []).append(w)
    claimed = {e["index"] for e in events}
    for source, lst in by_source.items():
        months = {month_key(w["txn"].get("date")) for w in lst}
        months.discard(None)
        if len(months) < 2:
            continue
        amounts = [w["txn"]["amountPaise"] for w in lst]
        med = median(amounts)
        if not all(_within_tol(a, med, 0.2) for a in amounts):
            continue
        for w in lst:
            if w["index"] in claimed:
                continue
            claimed.add(w["index"])
            events.append({"index": w["index"], "date": w["txn"].get("date"),
                           "amountPaise": w["txn"]["amountPaise"], "employer": source,
                           "basis": "regular_credit"})

    if events:
        evidence.append({"ruleId": RULE_IDS["SALARY_FLAG"],
                         "note": f"{len(events)} income credit(s) detected",
                         "txnIndices": [e["index"] for e in events]})

    months = {month_key(e.get("date")) for e in events}
    months.discard(None)
    sources = list(dict.fromkeys(e["employer"] for e in events if e["employer"] is not None))
    by_month: dict = {}
    for e in events:
        mk = month_key(e.get("date"))
        if mk is not None:
            by_month[mk] = by_month.get(mk, 0) + e["amountPaise"]
    monthly_avg = _js_round(sum(by_month.values()) / len(by_month)) if by_month else None

    consistency = "insufficient_data"
    if len(events) >= 2 and len(months) >= 2:
        primary = by_source.get(sources[0]) if sources else None
        amounts = ([w["txn"]["amountPaise"] for w in primary] if primary and len(primary) >= 2
                   else [e["amountPaise"] for e in events])
        med = median(amounts)
        consistency = "regular" if len(amounts) >= 2 and all(
            _within_tol(a, med, 0.2) for a in amounts) else "irregular"
    if not events and credits:
        warnings.append("credits present but none identified as income — check enrichment/labels")

    summary = {
        "credits": sorted(events, key=lambda e: e.get("date") or ""),
        "sources": sources,
        "monthlyAveragePaise": monthly_avg,
        "consistency": consistency,
        "monthsObserved": len(months),
    }
    return summary, evidence


def _detect_obligations(usable: list, min_occurrences: int) -> tuple:
    debits = [w for w in usable if w["txn"].get("direction") == "DEBIT" and w["txn"].get("amountPaise") is not None]
    by_key: dict = {}
    for w in debits:
        key = counterparty_key(w["txn"])
        if key is None:
            continue
        by_key.setdefault(key, []).append(w)

    recurring: list = []
    evidence: list = []
    for key, lst in by_key.items():
        # Sum per calendar month first: a counterparty paid twice in one
        # month is a 2x monthly obligation, not two half-obligations.
        per_month: dict = {}
        for w in lst:
            mk = month_key(w["txn"].get("date"))
            if mk is None:
                continue
            per_month[mk] = per_month.get(mk, 0) + w["txn"]["amountPaise"]
        if len(per_month) < min_occurrences:
            continue
        month_sums = list(per_month.values())
        typical = median(month_sums)
        if not all(_within_tol(s, typical, 0.1) for s in month_sums):
            continue
        is_emi = any(
            EMI_KEYWORD_RE.search(w["txn"].get("narration") or "")
            or EMI_KEYWORD_RE.search(key)
            or w["txn"].get("category") == "Loan & EMI"
            for w in lst
        )
        recurring.append({
            "counterparty": key,
            "occurrences": [w["index"] for w in lst],
            "typicalAmountPaise": _js_round(typical),
            "monthsHit": sorted(per_month.keys()),
            "isEmi": is_emi,
        })

    if recurring:
        evidence.append({"ruleId": RULE_IDS["RECURRING_DEBIT"],
                         "note": f"{len(recurring)} recurring obligation(s) detected",
                         "txnIndices": [i for r in recurring for i in r["occurrences"]]})
    emis = [r for r in recurring if r["isEmi"]]
    if emis:
        evidence.append({"ruleId": RULE_IDS["EMI"],
                         "note": f"{len(emis)} EMI pattern(s) detected",
                         "txnIndices": [i for r in emis for i in r["occurrences"]]})

    summary = {
        "recurring": recurring,
        "emis": emis,
        "monthlyObligationPaise": (sum(r["typicalAmountPaise"] for r in recurring)
                                 if recurring else None),
    }
    return summary, evidence


def _compute_foir(income: dict, obligations: dict) -> dict:
    monthly_income = income["monthlyAveragePaise"]
    if monthly_income is None or monthly_income <= 0:
        return {"ratio": None, "monthlyIncomePaise": monthly_income,
                "monthlyObligationPaise": obligations["monthlyObligationPaise"],
                "note": "income undetected — FOIR not computable"}
    obligation = obligations["monthlyObligationPaise"] or 0
    return {
        "ratio": _js_round((obligation / monthly_income) * 1000) / 1000,
        "monthlyIncomePaise": monthly_income,
        "monthlyObligationPaise": obligations["monthlyObligationPaise"],
        "note": ("no recurring obligations detected — FOIR floor is 0"
                 if obligations["monthlyObligationPaise"] is None
                 else f"obligations {obligation} / income {monthly_income}"),
    }


def _summarize_cashflow(usable: list) -> dict:
    credits = debits = 0
    min_bal = max_bal = closing = None
    closing_day = None
    months = set()
    for w in usable:
        t = w["txn"]
        if t.get("direction") == "CREDIT" and t.get("amountPaise") is not None:
            credits += t["amountPaise"]
        if t.get("direction") == "DEBIT" and t.get("amountPaise") is not None:
            debits += t["amountPaise"]
        mk = month_key(t.get("date"))
        if mk is not None:
            months.add(mk)
        bal = t.get("balancePaise")
        if bal is not None and isinstance(bal, (int, float)) and math.isfinite(bal):
            min_bal = bal if min_bal is None else min(min_bal, bal)
            max_bal = bal if max_bal is None else max(max_bal, bal)
            # Closing = balance of the latest dated row (input order breaks
            # same-day ties); undated rows fall back to last-seen.
            day = epoch_day(t.get("date"))
            if day is not None:
                if closing_day is None or day >= closing_day:
                    closing = bal
                    closing_day = day
            elif closing_day is None:
                closing = bal
    return {
        "totalCreditsPaise": credits,
        "totalDebitsPaise": debits,
        "netPaise": credits - debits,
        "monthsObserved": len(months),
        "averageMonthlyNetPaise": _js_round((credits - debits) / len(months)) if months else None,
        "minBalancePaise": min_bal,
        "maxBalancePaise": max_bal,
        "closingBalancePaise": closing,
    }


def _compute_trends(usable: list) -> dict:
    by_month: dict = {}
    for w in usable:
        t = w["txn"]
        mk = month_key(t.get("date"))
        if mk is None or t.get("amountPaise") is None:
            continue
        cur = by_month.get(mk, {"month": mk, "creditsPaise": 0, "debitsPaise": 0, "netPaise": 0})
        credits = cur["creditsPaise"] + (t["amountPaise"] if t.get("direction") == "CREDIT" else 0)
        debits = cur["debitsPaise"] + (t["amountPaise"] if t.get("direction") == "DEBIT" else 0)
        by_month[mk] = {"month": mk, "creditsPaise": credits, "debitsPaise": debits,
                        "netPaise": credits - debits}
    monthly = sorted(by_month.values(), key=lambda m: m["month"])

    direction = "insufficient_data"
    if len(monthly) >= 3:
        half = len(monthly) // 2
        first, second = monthly[:half], monthly[-half:]
        f = sum(r["netPaise"] for r in first) / len(first)
        s = sum(r["netPaise"] for r in second) / len(second)
        band = max(abs(f), 1) * 0.1
        direction = "improving" if s - f > band else ("declining" if f - s > band else "stable")

    # Median per-day balance change across consecutive dated balances,
    # sorted by date so input order cannot fabricate velocity sign/magnitude.
    dated = []
    for w in usable:
        t = w["txn"]
        day = epoch_day(t.get("date"))
        bal = t.get("balancePaise")
        if day is None or bal is None:
            continue
        if not isinstance(bal, (int, float)) or not math.isfinite(bal):
            continue
        dated.append((day, bal))
    dated.sort(key=lambda e: e[0])
    velocities = []
    for i in range(1, len(dated)):
        d2, d1 = dated[i][0], dated[i - 1][0]
        if d2 == d1:
            continue
        velocities.append((dated[i][1] - dated[i - 1][1]) / (d2 - d1))

    def volatility(key: str) -> Optional[float]:
        if len(monthly) < 2:
            return None
        values = [m[key] for m in monthly]
        mean = sum(values) / len(values)
        if mean == 0:
            return None
        var = sum((v - mean) ** 2 for v in values) / len(values)
        return _js_round((math.sqrt(var) / mean) * 10000) / 100

    return {
        "monthly": monthly,
        "netFlowDirection": direction,
        "balanceVelocityPaisePerDay": _js_round(median(velocities)) if velocities else None,
        "creditVolatilityPct": volatility("creditsPaise"),
        "debitVolatilityPct": volatility("debitsPaise"),
    }


def _detect_signals(usable: list, window_days: int, tolerance: float) -> list:
    signals: list = []

    bounce_idx = [w["index"] for w in usable if BOUNCE_RE.search(w["txn"].get("narration") or "")]
    if bounce_idx:
        signals.append({
            "ruleId": RULE_IDS["BOUNCE"],
            "severity": "high" if len(bounce_idx) >= 3 else "medium",
            "note": f"{len(bounce_idx)} bounced/returned payment narration(s)",
            "evidence": [{"ruleId": RULE_IDS["BOUNCE"],
                          "note": "narration carries bounce/return/dishonour keywords",
                          "txnIndices": bounce_idx}],
        })

    credits = [w for w in usable if w["txn"].get("direction") == "CREDIT"
               and w["txn"].get("amountPaise") is not None and w["txn"].get("date") is not None]
    debits = [w for w in usable if w["txn"].get("direction") == "DEBIT"
              and w["txn"].get("amountPaise") is not None and w["txn"].get("date") is not None]
    rt_evidence: list = []
    used = set()
    for c in credits:
        key, day = counterparty_key(c["txn"]), epoch_day(c["txn"]["date"])
        if key is None or day is None:
            continue
        for d in debits:
            if d["index"] in used or d["index"] == c["index"]:
                continue
            if counterparty_key(d["txn"]) != key:
                continue
            d_day = epoch_day(d["txn"]["date"])
            if d_day is None or d_day < day or d_day - day > window_days:
                continue
            if not _within_tol(c["txn"]["amountPaise"], d["txn"]["amountPaise"], tolerance):
                continue
            used.add(d["index"])
            rt_evidence.append({
                "ruleId": RULE_IDS["ROUND_TRIP"],
                "note": (f"credit ₹{c['txn']['amountPaise'] / 100:.2f} mirrored by debit of "
                         f"₹{d['txn']['amountPaise'] / 100:.2f} to {key} within {d_day - day} day(s)"),
                "txnIndices": [c["index"], d["index"]],
            })
            break
    if rt_evidence:
        signals.append({
            "ruleId": RULE_IDS["ROUND_TRIP"],
            "severity": "high" if len(rt_evidence) >= 3 else "medium",
            "note": f"{len(rt_evidence)} round-trip pattern(s) — credit mirrored by matching debit",
            "evidence": rt_evidence,
        })

    self_idx = [w["index"] for w in usable if SELF_RE.search(w["txn"].get("narration") or "")]
    if self_idx:
        signals.append({
            "ruleId": RULE_IDS["SELF_TRANSFER"],
            "severity": "low",
            "note": f"{len(self_idx)} self/own-account transfer narration(s)",
            "evidence": [{"ruleId": RULE_IDS["SELF_TRANSFER"],
                          "note": "narration carries self/own-account keywords",
                          "txnIndices": self_idx}],
        })

    return signals


def analyze_transactions(transactions: list, options: Optional[dict] = None) -> dict:
    """Python port of `analyzeTransactions` — never raises; malformed rows are
    dropped with a warning and every claim carries evidence indices."""
    options = options or {}
    warnings: list = []
    usable: list = []
    dropped = 0
    for index, txn in enumerate(transactions):
        if txn is None:
            dropped += 1
            continue
        amt = txn.get("amountPaise")
        if txn.get("direction") is None or amt is None or not isinstance(amt, (int, float)) or not math.isfinite(amt):
            dropped += 1
            continue
        usable.append({"txn": txn, "index": index})
    if dropped:
        warnings.append(f"{dropped} transaction(s) dropped: missing direction or amount")
    if not usable:
        warnings.append("no usable transactions — report reflects an empty input")

    income_summary, _ = _detect_income(usable, warnings)
    obl_summary, _ = _detect_obligations(usable, options.get("minRecurringOccurrences", 3))
    foir = _compute_foir(income_summary, obl_summary)
    cashflow = _summarize_cashflow(usable)
    trends = _compute_trends(usable)
    signals = _detect_signals(usable, options.get("roundTripWindowDays", 5),
                              options.get("amountTolerance", 0.02))

    return {
        "income": income_summary,
        "obligations": obl_summary,
        "foir": foir,
        "cashflow": cashflow,
        "trends": trends,
        "signals": signals,
        "warnings": warnings,
        "analyzedTransactions": len(usable),
    }
