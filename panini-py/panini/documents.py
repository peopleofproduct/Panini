# Copyright 2026 Kapil — Project Panini Contributors
# SPDX-License-Identifier: Apache-2.0
"""Document parsers beyond bank statements — Python port of
@paniniapi/extract documents.ts. Payslips (label-preserved components +
gross−deductions=net check), ITR-V (numbered-box fields), Form 26AS
(TAN-keyed TDS entries). Text-in, dict-out; deterministic."""

import re
from typing import Optional

from .extract import parse_statement_amount  # noqa: F401 — resolved below

PAN_RE = re.compile(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b")
TAN_RE = re.compile(r"\b([A-Z]{4}[0-9]{5}[A-Z])\b")
AY_RE = re.compile(r"\b(20\d{2}[-\s]?\d{2,4})\b")
_AMOUNT_RE = re.compile(r"(-?\d[\d,]*\.\d{2}|-?\d[\d,]*)")


def _paise(raw: str) -> Optional[int]:
    v = parse_statement_amount(raw)
    if v is None:
        return None
    paise, sign = v  # (magnitude, 'neg'|'pos'|None)
    return -paise if sign == "neg" else paise


def _labeled_amount(text: str, label_re, lookahead: int = 2) -> Optional[int]:
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not label_re.search(line):
            continue
        after = label_re.sub("", line)
        after = re.sub(r"\([^)]*\)", "", after)
        after = re.sub(r"^\s*\d{1,2}[a-z]?\s+", "", after)
        m = _AMOUNT_RE.search(after)
        if m is not None:
            v = _paise(m.group(1))
            if v is not None:
                return v
        for j in range(i + 1, min(i + lookahead, len(lines) - 1) + 1):
            lm = re.match(r"^\s*(-?\d[\d,]*(?:\.\d{2})?)\s*$", lines[j])
            if lm is not None:
                v = _paise(lm.group(1))
                if v is not None:
                    return v
            rest = re.sub(r"[A-Za-z]{3,}", "", lines[j])
            nm = _AMOUNT_RE.search(lines[j])
            if nm is not None and not re.search(r"[A-Za-z]{3,}", label_re.sub("", lines[j])):
                v = _paise(nm.group(1))
                if v is not None:
                    return v
    return None


def _labeled_text(text: str, label_re) -> Optional[str]:
    for line in text.splitlines():
        if not label_re.search(line):
            continue
        rest = re.sub(r"^[\s:–—-]+", "", label_re.sub("", line)).strip()
        if rest:
            return rest
    return None


# ── detection ────────────────────────────────────────────────────────────

_ITRV_HINT = re.compile(
    r"income\s*tax\s*return\s*[\s-]*verification|\bITR-V\b|e-?filing\s*acknowledgement",
    re.I,
)
_F26AS_HINT = re.compile(
    r"form\s*(?:no\.?\s*)?26as|annual\s*(?:tax|information)\s*statement|\bTDS\b.*deductor",
    re.I,
)
_PAYSLIP_HINT = re.compile(
    r"\b(pay\s*slip|payslip|salary\s*slip|salary\s*statement|pay\s*advice)\b", re.I
)
_PAYSLIP_STRUCT = re.compile(
    r"\b(net\s*pay|take\s*home|earnings|deductions|basic\s*(?:salary|pay)|\bhra\b)\b", re.I
)


def detect_document_type(text: str) -> str:
    if _ITRV_HINT.search(text):
        return "itrv"
    if _F26AS_HINT.search(text):
        return "form26as"
    if _PAYSLIP_HINT.search(text) and _PAYSLIP_STRUCT.search(text):
        return "payslip"
    if re.search(r"date.*narration|statement\s*(?:of\s*account|period)|opening\s*balance", text, re.I):
        return "statement"
    return "unknown"


# ── payslip ──────────────────────────────────────────────────────────────

_DEDUCTION_LABEL_RE = re.compile(
    r"\b(p\.?\s?f\.?|provident\s*fund|e\.?s\.?i\.?|professional\s*tax|prof\.?\s*tax|p\.?\s?tax"
    r"|t\.?d\.?s\.?|income\s*tax|labour\s*welfare|l\.?w\.?f\.?|loan|advance|recovery|vpf|gratuity"
    r"|canteen|insurance|society|fine)\b",
    re.I,
)
_EARNING_LABEL_RE = re.compile(
    r"\b(basic|h\.?r\.?a\.?|house\s*rent|special\s*allowance|conveyance|transport|l\.?t\.?a\.?"
    r"|medical|bonus|incentive|arrears?|overtime|ot\b|variable\s*pay|performance|retention"
    r"|other\s*allowance|dearness|da\b|city\s*compensatory|cca|shift|washing|uniform"
    r"|leave\s*encash|stipend|attendance)\b",
    re.I,
)
_SKIP_LABEL_RE = re.compile(
    r"\b(total|gross|net|earnings|deductions|pay\s*slip|payslip|name|pan|uan|designation"
    r"|department|bank|a\/?c|account|date|period|month|days?|lop|loss\s*of\s*pay|signature"
    r"|address|do[jb]|join)\b",
    re.I,
)
_COMPONENT_LINE = re.compile(
    r"^([A-Za-z][A-Za-z ./&()'\-]{1,40}?)[\s:]+(-?\d[\d,]*(?:\.\d{1,2})?)\s*$"
)

_MONTHS = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}


def _parse_period(text: str) -> Optional[str]:
    m = re.search(
        r"(?:month\s*of|pay\s*period|period|for\s*the\s*month\s*of|payslip\s*for)"
        r"\s*[:#\-]?\s*([A-Za-z]{3,9})\s*[-,']?\s*(20\d{2})",
        text,
        re.I,
    ) or re.search(r"\b([A-Za-z]{3,9})\s*[-,]\s*(20\d{2})\b", text)
    if m is None:
        return None
    mon = _MONTHS.get(m.group(1)[:3].lower())
    return f"{m.group(2)}-{mon}" if mon else None


def extract_payslip(text: str) -> dict:
    warnings: list = []
    components: list = []
    seen: set = set()

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _COMPONENT_LINE.match(line)
        if m is None:
            continue
        label = re.sub(r"\s+", " ", m.group(1)).strip()
        amount = _paise(m.group(2))
        if amount is None or _SKIP_LABEL_RE.search(label):
            continue
        if _DEDUCTION_LABEL_RE.search(label):
            side = "deduction"
        elif _EARNING_LABEL_RE.search(label):
            side = "earning"
        else:
            continue
        key = f"{side}:{label.upper()}"
        if key in seen:
            continue
        seen.add(key)
        components.append({"label": label, "side": side, "amountPaise": amount})

    gross = _labeled_amount(
        text, re.compile(r"\b(gross\s*(?:earnings?|pay|salary|total)|total\s*earnings?)\b", re.I)
    )
    if gross is None and any(c["side"] == "earning" for c in components):
        gross = sum(c["amountPaise"] for c in components if c["side"] == "earning")
    deductions_total = _labeled_amount(
        text, re.compile(r"\b(total\s*deductions?|deductions?\s*total)\b", re.I)
    )
    if deductions_total is None and any(c["side"] == "deduction" for c in components):
        deductions_total = sum(
            c["amountPaise"] for c in components if c["side"] == "deduction"
        )
    net_pay = _labeled_amount(
        text,
        re.compile(r"\b(net\s*(?:pay|salary|amount|payable)|take\s*home|net\s*payable)\b", re.I),
    )

    arithmetic = "incomplete"
    if gross is not None and deductions_total is not None and net_pay is not None:
        arithmetic = "ok" if abs(gross - deductions_total - net_pay) <= 100 else "mismatch"
        if arithmetic == "mismatch":
            warnings.append(
                f"gross({gross}) − deductions({deductions_total}) ≠ netPay({net_pay})"
            )
    if not components:
        warnings.append("no earnings/deduction components recognized")

    pan = (PAN_RE.search(text) or [None])[1] if PAN_RE.search(text) else None
    uan = (re.search(r"\bUAN\b[\s:]*(\d{12})\b", text, re.I) or [None, None])[1]
    pf = re.search(r"\bP\.?\s?F\.?\s*(?:No|Number|A\/?c|Account)\b\.?[\s:]*([A-Z0-9/\-]{6,25})", text, re.I)
    esi = re.search(r"\bE\.?S\.?I\.?\s*(?:No|Number)\b\.?[\s:]*(\d{10,17})", text, re.I)
    bank = re.search(r"(?:a\/?c|account)\s*(?:no\.?|number)?[\s:]*[xX*]*(\d{4})\b", text)

    employee = _labeled_text(
        text,
        re.compile(r"\b(?:employee\s*name|emp(?:loyee)?\s*name|name\s*of\s*(?:the\s*)?employee)\b", re.I),
    ) or _labeled_text(text, re.compile(r"^\s*name\b", re.I))
    employer = _labeled_text(
        text, re.compile(r"\b(?:employer|company|organization|organisation)\b", re.I)
    )
    if employer is None:
        for line in text.splitlines()[:5]:
            t = line.strip()
            if (
                re.search(
                    r"\b(ltd|limited|llp|pvt|private|inc|corp|technologies|solutions"
                    r"|industries|enterprises)\b",
                    t,
                    re.I,
                )
                and len(t) < 80
            ):
                employer = t
                break

    pay_date = re.search(
        r"(?:pay\s*date|date\s*of\s*payment)\s*[:#\-]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})",
        text,
        re.I,
    )

    return {
        "kind": "payslip",
        "employeeName": employee,
        "employer": employer,
        "period": _parse_period(text),
        "payDate": pay_date.group(1) if pay_date else None,
        "components": components,
        "grossPaise": gross,
        "deductionsPaise": deductions_total,
        "netPayPaise": net_pay,
        "ids": {
            "pan": pan,
            "uan": uan,
            "pfNo": pf.group(1) if pf else None,
            "esiNo": esi.group(1) if esi else None,
            "bankAccountMask": bank.group(1) if bank else None,
        },
        "arithmeticCheck": arithmetic,
        "warnings": warnings,
    }


# ── ITR-V ────────────────────────────────────────────────────────────────

def _itrv_box(text: str, *label_res) -> Optional[int]:
    for re_ in label_res:
        v = _labeled_amount(text, re_, 3)
        if v is not None:
            return v
    return None


def extract_itrv(text: str) -> dict:
    warnings: list = []
    ack = re.search(
        r"\b(?:e-?filing\s*)?acknowledg?ement\s*(?:number|no\.?)\b[\s:]*([0-9]{12,20})",
        text,
        re.I,
    ) or re.search(r"\b(1[0-9]{14})\b", text)
    filing = re.search(
        r"date\s*\(?\s*[DdMmYy/\s-]*\)?[\s:]*(\d{2}[-/]\d{2}[-/]\d{4})", text, re.I
    )
    ay = re.search(
        r"assessment\s*year\b[\s:]*\S*\s*(20\d{2}[-\s]?\d{2,4})", text, re.I
    ) or AY_RE.search(text)
    form = re.search(r"\b(ITR[-\s]?[1-7](?:A|S)?|SAHAJ|SUGAM)\b", text, re.I)
    name = _labeled_text(text, re.compile(r"\bname\b", re.I))

    gross = _itrv_box(
        text,
        re.compile(r"^\s*1\s+gross\s*total\s*income\b", re.I | re.M),
        re.compile(r"\bgross\s*total\s*income\b", re.I),
    )
    ded_via = _itrv_box(
        text,
        re.compile(r"^\s*2\s+deductions?\s*under\s*chapter[-\s]*VI[-\s]*A\b", re.I | re.M),
        re.compile(r"deductions?\s*under\s*chapter[-\s]*VI[-\s]*A\b", re.I),
    )
    total_income = _itrv_box(
        text,
        re.compile(r"^\s*3\s+total\s*income\b", re.I | re.M),
        re.compile(r"\b(?<!gross\s)(?<!total\s)total\s*income\b", re.I),
    )
    net_tax = _itrv_box(
        text,
        re.compile(r"^\s*4\s+net\s*tax\s*payable\b", re.I | re.M),
        re.compile(r"\bnet\s*tax\s*payable\b", re.I),
    )
    tds = _itrv_box(
        text,
        re.compile(r"^\s*7b\s+TDS\b", re.I | re.M),
        re.compile(r"^\s*b?\s*\bTDS\b", re.I | re.M),
        re.compile(r"\bTDS\b", re.I),
    )
    taxes_paid = _itrv_box(
        text,
        re.compile(r"^\s*7e\s+total\s*taxes?\s*paid\b", re.I | re.M),
        re.compile(r"\btotal\s*taxes?\s*paid\b", re.I),
    )
    refund = _itrv_box(
        text, re.compile(r"^\s*9\s+refund\b", re.I | re.M), re.compile(r"\brefund\b", re.I)
    )

    arithmetic = "incomplete"
    if gross is not None and ded_via is not None and total_income is not None:
        arithmetic = "ok" if abs(gross - ded_via - total_income) <= 100 else "mismatch"
        if arithmetic == "mismatch":
            warnings.append("grossTotal − chapterVI-A ≠ totalIncome")
    if ack is None:
        warnings.append("no e-filing acknowledgement number found")
    if PAN_RE.search(text) is None:
        warnings.append("no PAN found")

    return {
        "kind": "itrv",
        "pan": PAN_RE.search(text).group(1) if PAN_RE.search(text) else None,
        "name": name,
        "assessmentYear": ay.group(1) if ay else None,
        "itrForm": form.group(1).upper() if form else None,
        "ackNo": ack.group(1) if ack else None,
        "filingDate": filing.group(1) if filing else None,
        "grossTotalIncomePaise": gross,
        "deductionsChapterViaPaise": ded_via,
        "totalIncomePaise": total_income,
        "netTaxPayablePaise": net_tax,
        "tdsPaise": tds,
        "totalTaxesPaidPaise": taxes_paid,
        "refundPaise": refund,
        "arithmeticCheck": arithmetic,
        "warnings": warnings,
    }


# ── Form 26AS ────────────────────────────────────────────────────────────

def extract_form26as(text: str) -> dict:
    warnings: list = []
    entries: list = []
    for line in text.splitlines():
        tan = TAN_RE.search(line)
        if tan is None:
            continue
        amounts = [_paise(m.group(1)) for m in _AMOUNT_RE.finditer(line)
                   if "." in m.group(1)]
        sec = re.search(r"\b(19[24][A-Z]?|194[A-Z]{0,2})\b", line)
        date = re.search(r"\b(\d{2}[-/][A-Za-z]{3}[-/]\d{4}|\d{2}[-/]\d{2}[-/]\d{4})\b", line)
        before_tan = re.sub(r"[\d\s\-/.,]+$", "", line[: tan.start()]).strip()
        entries.append(
            {
                "deductor": before_tan or None,
                "tan": tan.group(1),
                "section": sec.group(1) if sec else None,
                "date": date.group(1) if date else None,
                "paidPaise": amounts[0] if len(amounts) > 0 else None,
                "taxDeductedPaise": amounts[1] if len(amounts) > 1 else None,
                "depositedPaise": amounts[2] if len(amounts) > 2 else (amounts[1] if len(amounts) > 1 else None),
            }
        )
    if not entries:
        warnings.append("no TAN-keyed TDS entries recognized")
    paid = [e["paidPaise"] for e in entries if e["paidPaise"] is not None]
    deducted = [e["taxDeductedPaise"] for e in entries if e["taxDeductedPaise"] is not None]
    ay = re.search(
        r"assessment\s*year\b[\s:]*\S*\s*(20\d{2}[-\s]?\d{2,4})", text, re.I
    ) or AY_RE.search(text)
    return {
        "kind": "form26as",
        "pan": PAN_RE.search(text).group(1) if PAN_RE.search(text) else None,
        "name": _labeled_text(
            text,
            re.compile(r"\bname\s*of\s*(?:the\s*)?(?:assessee|deductee|taxpayer)\b", re.I),
        ),
        "assessmentYear": ay.group(1) if ay else None,
        "entries": entries,
        "totalPaidPaise": sum(paid) if paid else None,
        "totalTaxDeductedPaise": sum(deducted) if deducted else None,
        "warnings": warnings,
    }


def extract_document(text: str) -> Optional[dict]:
    kind = detect_document_type(text)
    if kind == "payslip":
        return extract_payslip(text)
    if kind == "itrv":
        return extract_itrv(text)
    if kind == "form26as":
        return extract_form26as(text)
    return None
