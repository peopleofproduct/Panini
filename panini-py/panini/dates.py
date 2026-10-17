# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Indian date-shape parsing — mirrors @panini/core dates.ts."""

from __future__ import annotations

import re
from datetime import date

MIN_YEAR = 1990
MAX_YEAR = 2100


def _iso(year: int, month: int, day: int) -> str | None:
    if not (MIN_YEAR <= year <= MAX_YEAR and 1 <= month <= 12 and 1 <= day <= 31):
        return None
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _yy(yy: int) -> int:
    return 1900 + yy if yy >= 90 else 2000 + yy


_ATTEMPTS = [
    (re.compile(r"^(\d{4})(\d{2})(\d{2})$"), lambda m: (int(m[1]), int(m[2]), int(m[3]))),
    (re.compile(r"^(\d{2})(\d{2})(\d{4})$"), lambda m: (int(m[3]), int(m[2]), int(m[1]))),
    (re.compile(r"^(\d{2})(\d{2})(\d{2})$"), lambda m: (_yy(int(m[3])), int(m[2]), int(m[1]))),
    (re.compile(r"^(\d{4})[-/.](\d{2})[-/.](\d{2})$"), lambda m: (int(m[1]), int(m[2]), int(m[3]))),
    (re.compile(r"^(\d{2})[-/.](\d{2})[-/.](\d{4})$"), lambda m: (int(m[3]), int(m[2]), int(m[1]))),
    (re.compile(r"^(\d{2})[-/.](\d{2})[-/.](\d{2})$"), lambda m: (_yy(int(m[3])), int(m[2]), int(m[1]))),
]


def parse_indian_date(value: str) -> str | None:
    """YYYYMMDD / DDMMYYYY / DDMMYY / YYYY-MM-DD / DD-MM-YY[YY] → ISO date."""
    v = value.strip()
    for pattern, extract in _ATTEMPTS:
        m = pattern.match(v)
        if m:
            iso = _iso(*extract(m))
            if iso is not None:
                return iso
    return None


def is_plausible_date(value: str) -> bool:
    return parse_indian_date(value) is not None
