# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Grammar-drift detection — Python parity of
packages/rules-engine/src/drift.ts.

Compare a live batch of narrations against the corpus-derived baseline
for a bank. When a bank changes its narration format, the match rate
collapses — this surfaces it as a signal with the exact unmatched
samples, instead of silently mis-parsing.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Union

from .engine import _RULES_DIR, parse_narration

_SEPARATORS = re.compile(r"[-/:| ]+")

# corpus fixtures live in rules/corpus — shipped in the wheel since 0.3.3
_CORPUS_DIR = _RULES_DIR / "corpus"


def skeleton_of(narration: str) -> str:
    """Rough skeleton: short channel literals stay ('UPI','DR','NEFT'),
    digit runs become 'N', longer alpha tokens wildcard to 'A'."""
    out = []
    for tok in _SEPARATORS.split(narration):
        if tok == "":
            continue
        if re.fullmatch(r"\d+", tok):
            out.append("N")
        elif re.fullmatch(r"[A-Z]{4}\d{6,7}", tok):
            out.append("IFSC")
        elif re.fullmatch(r"\d{2}[-/.]?\d{2}[-/.]?\d{2,4}", tok):
            out.append("DATE")
        elif re.fullmatch(r"[A-Z]{2,4}", tok):
            out.append(tok)
        else:
            out.append("A" if re.fullmatch(r"[A-Za-z@._]+", tok) else "*")
    return "-".join(out)


def _load_corpus(corpus_dir: Optional[Path] = None) -> list[dict[str, Any]]:
    d = corpus_dir or _CORPUS_DIR
    if not d.is_dir():
        return []
    return [json.loads(p.read_text()) for p in sorted(d.glob("*.json"))]


def _rate_of_file(file: dict[str, Any]) -> float:
    samples = file.get("samples", [])
    if not samples:
        return 0.0
    matched = 0
    for s in samples:
        hint = s.get("bankHint")
        parsed = parse_narration(
            {"text": s["input"], "bankHint": hint} if hint else s["input"]
        )
        if parsed.get("matched_rule") is not None:
            matched += 1
    return matched / len(samples)


def corpus_baseline(bank_hint: Optional[str] = None) -> Optional[float]:
    """Baseline matched-rule rate for a bank from its corpus file;
    None when absent."""
    want = (bank_hint or "GENERIC").upper()
    files = _load_corpus()
    hit = None
    for f in files:
        bank = (f.get("bank") or "").upper()
        if bank == want or bank == "LEGACY":
            hit = f
            if bank == want:
                break
    if hit is None:
        return None
    return _rate_of_file(hit)


@dataclass(frozen=True)
class DriftCluster:
    skeleton: str
    count: int
    samples: tuple[str, ...]


@dataclass(frozen=True)
class DriftReport:
    total: int
    matched: int
    match_rate: float
    avg_confidence: float
    baseline_match_rate: Optional[float]
    drift: bool
    unmatched_clusters: tuple[DriftCluster, ...]
    warnings: tuple[str, ...]


Narration = Union[str, dict]


def analyze_narration_batch(
    narrations: list[Narration],
    *,
    bank_hint: Optional[str] = None,
    drop_threshold: float = 0.2,
    max_cluster_samples: int = 5,
    rules_dir: Optional[Path] = None,
) -> DriftReport:
    """Parse a batch and report drift vs the corpus baseline.
    Deterministic; never raises on garbage narrations."""
    warnings: list[str] = []
    matched = 0
    confidence_sum = 0.0
    unmatched: dict[str, list[str]] = {}

    for item in narrations:
        if isinstance(item, dict):
            text = item["text"]
            hint = item.get("bankHint") or bank_hint
        else:
            text, hint = item, bank_hint
        parsed = parse_narration(
            {"text": text, "bankHint": hint} if hint else text,
            rules_dir=rules_dir,
        )
        confidence_sum += parsed.get("confidence", 0.0)
        if parsed.get("matched_rule") is not None:
            matched += 1
        else:
            unmatched.setdefault(skeleton_of(text), []).append(text)

    total = len(narrations)
    match_rate = matched / total if total else 0.0
    avg_confidence = confidence_sum / total if total else 0.0
    baseline = corpus_baseline(bank_hint)
    drift = baseline is not None and total > 0 and match_rate < baseline - drop_threshold

    if drift:
        warnings.append(
            f"match rate {match_rate * 100:.1f}% is "
            f"{(baseline - match_rate) * 100:.0f}pp below the "
            f"{bank_hint or 'GENERIC'} corpus baseline "
            f"({baseline * 100:.1f}%) — the bank likely changed its "
            f"narration format"
        )

    clusters = tuple(
        DriftCluster(
            skeleton=sk,
            count=len(samples),
            samples=tuple(samples[:max_cluster_samples]),
        )
        for sk, samples in sorted(
            unmatched.items(), key=lambda kv: -len(kv[1])
        )
    )
    return DriftReport(
        total=total,
        matched=matched,
        match_rate=match_rate,
        avg_confidence=avg_confidence,
        baseline_match_rate=baseline,
        drift=drift,
        unmatched_clusters=clusters,
        warnings=tuple(warnings),
    )


__all__ = [
    "DriftCluster",
    "DriftReport",
    "skeleton_of",
    "corpus_baseline",
    "analyze_narration_batch",
]
