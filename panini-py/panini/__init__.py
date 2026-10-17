# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Panini — deterministic Indian bank-narration parsing. Python port of
@panini/rules-engine, sharing grammar JSONs and the conformance corpus."""

from .engine import Normalizer, parse_narration  # noqa: F401
from .dates import parse_indian_date, is_plausible_date  # noqa: F401
from .tokenizer import tokenize  # noqa: F401

__version__ = "0.1.0"
__all__ = ["Normalizer", "parse_narration", "parse_indian_date",
           "is_plausible_date", "tokenize"]
