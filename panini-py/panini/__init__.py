# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Panini — deterministic Indian bank-narration parsing. Python port of
@panini/rules-engine, sharing grammar JSONs and the conformance corpus."""

from .engine import Normalizer, parse_narration  # noqa: F401
from .dates import parse_indian_date, is_plausible_date  # noqa: F401
from .tokenizer import tokenize  # noqa: F401
from .extract import (  # noqa: F401
    detect_bank_id,
    extract_csv_statement,
    extract_sms,
    parse_statement_date,
)
from .insights import analyze_transactions  # noqa: F401
from .consolidate import consolidate_accounts  # noqa: F401
from .fraud import (  # noqa: F401
    detect_fraud_indicators,
    detect_portfolio_indicators,
    FRAUD_RULE_IDS,
)
from .flows import (  # noqa: F401
    counterparty_flows,
    detect_conduct_metrics,
    FLOW_RULE_IDS,
)
from .documents import (  # noqa: F401
    detect_document_type,
    extract_document,
    extract_form26as,
    extract_itrv,
    extract_payslip,
)
from .drift import (  # noqa: F401
    analyze_narration_batch,
    corpus_baseline,
    skeleton_of,
)
from .suggest import suggest_grammar_rule  # noqa: F401
from .scorecard import (  # noqa: F401
    ScorecardSpecError,
    evaluate_scorecard,
    validate_scorecard_spec,
)
from .reconcile import (  # noqa: F401
    reconcile_with_aa,
    transactions_from_aa_data,
)

__version__ = "0.5.4"
__all__ = [
    "Normalizer", "parse_narration", "parse_indian_date",
    "is_plausible_date", "tokenize", "extract_csv_statement",
    "extract_sms", "parse_statement_date", "analyze_transactions",
    "detect_bank_id",
    "analyze_narration_batch", "corpus_baseline", "skeleton_of",
    "suggest_grammar_rule",
    "evaluate_scorecard", "validate_scorecard_spec", "ScorecardSpecError",
    "reconcile_with_aa", "transactions_from_aa_data",
    "consolidate_accounts", "detect_fraud_indicators",
    "detect_portfolio_indicators", "FRAUD_RULE_IDS",
    "counterparty_flows", "detect_conduct_metrics", "FLOW_RULE_IDS",
    "detect_document_type", "extract_document", "extract_payslip",
    "extract_itrv", "extract_form26as",
]
