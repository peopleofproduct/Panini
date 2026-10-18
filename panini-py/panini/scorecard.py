# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Deterministic scorecard evaluation — Python parity of
packages/insights/src/scorecard.ts.

Panini deliberately does NOT ship a calibrated credit score — that
requires default-history data we do not have, and under RBI's
accountable-lender rules the risk model must belong to the regulated
entity anyway. This module provides the honest middle ground: a
JSON-declared, weighted rule set evaluated over the evidence-backed
``analyze_transactions`` report, producing a score with a full
derivation trace.
"""

from __future__ import annotations

import math
from typing import Any, Optional

_OPS = ("lt", "lte", "eq", "neq", "gte", "gt", "in")


def _compare(op: str, a: Any, b: Any) -> bool:
    if op == "lt":
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and a < b
    if op == "lte":
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and a <= b
    if op == "gt":
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and a > b
    if op == "gte":
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and a >= b
    if op == "eq":
        return a == b
    if op == "neq":
        return a != b
    if op == "in":
        return isinstance(b, (list, tuple)) and a in b
    return False


# metric key → extractor over the report dict; returns None for missing data
_METRICS = {
    "foir.ratio": lambda r, arg=None: r["foir"].get("ratio"),
    "income.monthlyAveragePaise": lambda r, arg=None: r["income"].get("monthlyAveragePaise"),
    "income.consistency": lambda r, arg=None: r["income"].get("consistency"),
    "income.monthsObserved": lambda r, arg=None: r["income"].get("monthsObserved"),
    "income.sources": lambda r, arg=None: len(r["income"].get("sources", [])),
    "obligations.monthlyObligationPaise": (
        lambda r, arg=None: r["obligations"].get("monthlyObligationPaise")
    ),
    "obligations.emiCount": lambda r, arg=None: len(r["obligations"].get("emis", [])),
    "cashflow.averageMonthlyNetPaise": (
        lambda r, arg=None: r["cashflow"].get("averageMonthlyNetPaise")
    ),
    "cashflow.minBalancePaise": lambda r, arg=None: r["cashflow"].get("minBalancePaise"),
    "cashflow.netPaise": lambda r, arg=None: r["cashflow"].get("netPaise"),
    "trends.netFlowDirection": lambda r, arg=None: r["trends"].get("netFlowDirection"),
    "trends.creditVolatilityPct": lambda r, arg=None: r["trends"].get("creditVolatilityPct"),
    "trends.debitVolatilityPct": lambda r, arg=None: r["trends"].get("debitVolatilityPct"),
    "signals.count": lambda r, arg=None: len(r["signals"]),
    "signals.count.high": (
        lambda r, arg=None: sum(1 for s in r["signals"] if s.get("severity") == "high")
    ),
    "signals.count.medium": (
        lambda r, arg=None: sum(1 for s in r["signals"] if s.get("severity") == "medium")
    ),
    "signals.count.low": (
        lambda r, arg=None: sum(1 for s in r["signals"] if s.get("severity") == "low")
    ),
    "signals.rule": lambda r, arg=None: sum(
        1 for s in r["signals"] if s.get("ruleId") == (arg or "")
    ),
    "analyzedTransactions": lambda r, arg=None: r.get("analyzedTransactions"),
}


class ScorecardSpecError(ValueError):
    """Raised when a scorecard spec fails validation."""


def _resolve_metric(raw: str) -> tuple[str, Optional[str]]:
    """`signals.rule:risk.bounce` → ('signals.rule', 'risk.bounce')."""
    idx = raw.find(":")
    return (raw, None) if idx == -1 else (raw[:idx], raw[idx + 1:])


def _validate_when(when: Any, where: str) -> None:
    if not isinstance(when, dict):
        raise ScorecardSpecError(f"{where}: missing 'when'")
    if "metric" in when:
        key, _ = _resolve_metric(when["metric"])
        if key not in _METRICS:
            raise ScorecardSpecError(f"{where}: unknown metric '{when['metric']}'")
        if when.get("op") not in _OPS:
            raise ScorecardSpecError(f"{where}: bad op '{when.get('op')}'")
        if "value" not in when:
            raise ScorecardSpecError(f"{where}: missing value")
        return
    lst = when.get("all") or when.get("any")
    if not isinstance(lst, list) or not lst:
        raise ScorecardSpecError(
            f"{where}: 'when' needs metric/op/value or non-empty all/any"
        )
    for inner in lst:
        if "all" in inner or "any" in inner:
            raise ScorecardSpecError(f"{where}: nested all/any not supported")
        _validate_when(inner, where)


def validate_scorecard_spec(spec: Any) -> None:
    """Validate a spec dict; raises ScorecardSpecError on first defect."""
    if not isinstance(spec, dict):
        raise ScorecardSpecError("spec must be an object")
    if not spec.get("id"):
        raise ScorecardSpecError("spec.id required")
    if not spec.get("version"):
        raise ScorecardSpecError("spec.version required")
    rules = spec.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ScorecardSpecError("spec.rules must be a non-empty array")
    seen: set = set()
    for rule in rules:
        rid = rule.get("id")
        if not rid:
            raise ScorecardSpecError("rule.id required")
        if rid in seen:
            raise ScorecardSpecError(f"duplicate rule id '{rid}'")
        seen.add(rid)
        pts = rule.get("points")
        if not isinstance(pts, (int, float)) or not math.isfinite(pts):
            raise ScorecardSpecError(f"rule '{rid}' needs numeric points")
        _validate_when(rule.get("when"), f"rule '{rid}'")
    for band in spec.get("bands") or []:
        if not isinstance(band.get("label"), str) or not isinstance(
            band.get("minScorePct"), (int, float)
        ):
            raise ScorecardSpecError("each band needs label + numeric minScorePct")


def _eval_condition(cond: dict, report: dict) -> tuple[str, dict]:
    """Returns ('matched'|'missed'|'unknown', observed)."""
    key, arg = _resolve_metric(cond["metric"])
    observed = _METRICS[key](report, arg)
    if observed is None:
        return "unknown", {"metric": cond["metric"], "value": observed}
    verdict = "matched" if _compare(cond["op"], observed, cond["value"]) else "missed"
    return verdict, {"metric": cond["metric"], "value": observed}


def _eval_when(when: dict, report: dict) -> tuple[str, list]:
    if "metric" in when:
        verdict, obs = _eval_condition(when, report)
        return verdict, [obs]
    lst = when.get("all") or when.get("any") or []
    observed, verdicts = [], []
    for c in lst:
        v, o = _eval_condition(c, report)
        verdicts.append(v)
        observed.append(o)
    if "all" in when:
        verdict = (
            "matched"
            if all(v == "matched" for v in verdicts)
            else ("missed" if "missed" in verdicts else "unknown")
        )
    else:
        verdict = (
            "matched"
            if "matched" in verdicts
            else ("missed" if "missed" in verdicts else "unknown")
        )
    return verdict, observed


def evaluate_scorecard(report: dict, spec: dict) -> dict:
    """Evaluate a scorecard spec against an insights report.
    Pure and deterministic — same report + same spec → identical result."""
    validate_scorecard_spec(spec)

    contributions: list[dict] = []
    warnings: list[str] = []
    score = max_score = evaluable_max = 0.0

    for rule in spec["rules"]:
        max_score += rule["points"]
        verdict, observed = _eval_when(rule["when"], report)
        if verdict != "unknown":
            evaluable_max += rule["points"]
        if verdict == "matched":
            score += rule["points"]
        if verdict == "unknown":
            metrics = ", ".join(o["metric"] for o in observed)
            warnings.append(
                f"rule '{rule['id']}' skipped — metric data missing ({metrics})"
            )
        entry = {
            "ruleId": rule["id"],
            "points": rule["points"],
            "matched": verdict == "matched",
            "observed": observed,
        }
        if rule.get("description") is not None:
            entry["description"] = rule["description"]
        contributions.append(entry)

    score_pct = score / max_score * 100 if max_score else 0.0
    coverage_pct = evaluable_max / max_score * 100 if max_score else 0.0
    if coverage_pct < 60:
        warnings.append(
            f"thin file — only {coverage_pct:.0f}% of scoreable rules had data; "
            "treat the score as low-confidence"
        )

    band = None
    for b in sorted(
        (spec.get("bands") or []), key=lambda b: -b["minScorePct"]
    ):
        if score_pct >= b["minScorePct"]:
            band = b["label"]
            break

    return {
        "specId": spec["id"],
        "specVersion": spec["version"],
        "score": score,
        "maxScore": max_score,
        "scorePct": score_pct,
        "coveragePct": coverage_pct,
        "band": band,
        "contributions": contributions,
        "warnings": warnings,
    }


__all__ = [
    "ScorecardSpecError",
    "evaluate_scorecard",
    "validate_scorecard_spec",
]
