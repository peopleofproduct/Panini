# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Grammar-rule suggestion — Python parity of
packages/rules-engine/src/suggest.ts.

Given narrations the current grammar can't match (e.g. after a bank
format change), align their token skeletons and draft a candidate
pattern. The draft is *self-tested* against the full corpus so a
suggestion that would shadow existing expectations is flagged unsafe
rather than silently shipped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from .drift import _load_corpus
from .engine import parse_narration

_SEPARATORS = re.compile(r"[-/:|]+|\s+")


def _escape_re(s: str) -> str:
    return re.sub(r"[.*+?^${}()|[\]\\]", r"\\\g<0>", s)


def _column_fragment(tokens: list[str], col: int) -> Optional[dict[str, str]]:
    """Classify one token column across samples → regex fragment + role.
    Regexes are emitted in JS named-group syntax `(?<x>…)` — the grammar
    format — and compiled through engine._translate on use."""
    if len(set(tokens)) == 1:
        return {"re": _escape_re(tokens[0]), "role": "literal"}
    if all(re.fullmatch(r"\d+", t) for t in tokens):
        lens = [len(t) for t in tokens]
        return {
            "re": f"\\d{{{min(lens)},{max(lens)}}}",
            "role": "txnId" if min(lens) >= 6 else "digits",
        }
    if all(
        re.fullmatch(r"\d{2}[-/.]\d{2}[-/.]\d{2,4}", t)
        or re.fullmatch(r"\d{6,8}", t)
        for t in tokens
    ):
        return {
            "re": r"\d{6,8}|\d{2}[-/.]\d{2}[-/.]\d{2,4}",
            "role": "date",
        }
    if all(re.fullmatch(r"[A-Za-z0-9._-]+@[A-Za-z0-9]+", t) for t in tokens):
        handles = {t.split("@")[1] for t in tokens}
        if len(handles) == 1:
            return {
                "re": (
                    rf"(?<vpaUser{col}>[A-Za-z0-9._-]+)@"
                    + _escape_re(tokens[0].split("@")[1])
                ),
                "role": "vpa",
            }
        return {
            "re": rf"(?<vpaUser{col}>[A-Za-z0-9._-]+)@(?<vpaHandle{col}>[A-Za-z0-9]+)",
            "role": "vpa",
        }
    if all(
        re.fullmatch(r"[A-Za-z0-9 .&'_]+", t) and re.search(r"[A-Za-z]", t)
        for t in tokens
    ):
        return {
            "re": rf"(?<counterparty{col}>[A-Za-z0-9 .&'_]+?)",
            "role": "counterparty",
        }
    return None  # heterogeneous column → can't generalise safely


@dataclass(frozen=True)
class RuleSuggestion:
    """Draft grammar pattern — paste-ready for a rules/<bank>.json entry,
    never auto-merged into production grammars."""

    pattern: dict[str, Any]
    column_roles: tuple[str, ...]
    corpus_impact: int
    safe: bool
    note: str


def suggest_grammar_rule(
    samples: list[str],
    *,
    id: str = "suggested-overlay",
    priority: int = 5,
) -> Optional[RuleSuggestion]:
    """Draft a grammar pattern from unmatched samples of the same
    skeleton. Returns None when samples are too heterogeneous to
    generalise safely."""
    if not samples:
        return None
    rows = [[t for t in _SEPARATORS.split(s) if t != ""] for s in samples]
    width = len(rows[0])
    if not all(len(r) == width for r in rows):
        if len({len(r) for r in rows}) > 2:
            return None
    target = [r for r in rows if len(r) == width]
    if not target:
        return None

    fragments: list[str] = []
    roles: list[str] = []
    for c in range(width):
        f = _column_fragment([r[c] for r in target], c)
        if f is None:
            return None
        fragments.append(f["re"])
        roles.append(f["role"])
    regex = "^" + "[-/|: ]".join(fragments) + r"(?<tail>[-/|: ].*)?$"

    anchor = next(
        (fragments[i] for i, role in enumerate(roles) if role == "literal"),
        None,
    )
    name = "suggested_" + re.sub(
        r"[^a-z0-9]+", "_", (anchor or "rule").lower()
    )
    draft = {
        "name": name,
        "priority": priority,
        "media": "narration",
        "regex": regex,
    }

    # Self-test: inject the draft and count corpus expectation flips.
    draft_set = {
        "id": id,
        "bank": "GENERIC",
        "version": "0.0.0",
        "patterns": [draft],
    }
    corpus_impact = 0
    for file in _load_corpus():
        for sample in file.get("samples", []):
            hint = sample.get("bankHint")
            parsed = parse_narration(
                {"text": sample["input"], "bankHint": hint}
                if hint
                else sample["input"],
                rule_sets=[draft_set],
            )
            for field_name, expected in (sample.get("expect") or {}).items():
                if parsed.get(field_name) != expected:
                    corpus_impact += 1

    safe = corpus_impact == 0
    return RuleSuggestion(
        pattern=draft,
        column_roles=tuple(roles),
        corpus_impact=corpus_impact,
        safe=safe,
        note=(
            "draft matches all samples and flips zero corpus expectations "
            "— review literals before merging"
            if safe
            else f"draft would flip {corpus_impact} corpus expectation(s) "
            "— DO NOT merge without narrowing"
        ),
    )


__all__ = ["RuleSuggestion", "suggest_grammar_rule"]
