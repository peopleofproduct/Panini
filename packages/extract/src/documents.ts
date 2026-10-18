/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { parseStatementAmount } from './statementAmount';

/** Document classes the deterministic parsers cover beyond bank statements. */
export type DocumentKind = 'statement' | 'payslip' | 'itrv' | 'form26as' | 'unknown';

export type ParsedDocument = ParsedPayslip | ParsedItrV | ParsedForm26as;

/** Component row of a payslip — original label preserved (employers rename
 *  heads freely; canonicalizing loses YoY comparability). */
export interface PayslipComponent {
  readonly label: string;
  readonly side: 'earning' | 'deduction';
  readonly amountPaise: number;
}

export interface ParsedPayslip {
  readonly kind: 'payslip';
  readonly employeeName: string | null;
  readonly employer: string | null;
  /** Pay period, 'YYYY-MM' when resolvable. */
  readonly period: string | null;
  readonly payDate: string | null;
  readonly components: readonly PayslipComponent[];
  readonly grossPaise: number | null;
  readonly deductionsPaise: number | null;
  readonly netPayPaise: number | null;
  readonly ids: {
    readonly pan: string | null;
    readonly uan: string | null;
    readonly pfNo: string | null;
    readonly esiNo: string | null;
    readonly bankAccountMask: string | null;
  };
  /** gross − deductions = netPay when all three are present. */
  readonly arithmeticCheck: 'ok' | 'mismatch' | 'incomplete';
  readonly warnings: readonly string[];
}

/** Numbered-box fields of the ITR-V / acknowledgement form. */
export interface ParsedItrV {
  readonly kind: 'itrv';
  readonly pan: string | null;
  readonly name: string | null;
  readonly assessmentYear: string | null;
  readonly itrForm: string | null;
  readonly ackNo: string | null;
  readonly filingDate: string | null;
  readonly grossTotalIncomePaise: number | null;
  readonly deductionsChapterViaPaise: number | null;
  readonly totalIncomePaise: number | null;
  readonly netTaxPayablePaise: number | null;
  readonly tdsPaise: number | null;
  readonly totalTaxesPaidPaise: number | null;
  readonly refundPaise: number | null;
  /** grossTotal − deductions ≈ totalIncome when all present (±₹1). */
  readonly arithmeticCheck: 'ok' | 'mismatch' | 'incomplete';
  readonly warnings: readonly string[];
}

export interface Form26asEntry {
  readonly deductor: string | null;
  readonly tan: string | null;
  readonly section: string | null;
  readonly date: string | null;
  readonly paidPaise: number | null;
  readonly taxDeductedPaise: number | null;
  readonly depositedPaise: number | null;
}

export interface ParsedForm26as {
  readonly kind: 'form26as';
  readonly pan: string | null;
  readonly name: string | null;
  readonly assessmentYear: string | null;
  readonly entries: readonly Form26asEntry[];
  readonly totalPaidPaise: number | null;
  readonly totalTaxDeductedPaise: number | null;
  readonly warnings: readonly string[];
}

// ── shared helpers ──────────────────────────────────────────────────────

const PAN_RE = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/;
const TAN_RE = /\b([A-Z]{4}[0-9]{5}[A-Z])\b/;
const AY_RE = /\b(20\d{2}[-\s]?\d{2,4})\b/;
const AMOUNT_RE = /(-?\d[\d,]*\.\d{2}|-?\d[\d,]*)/;

function paise(raw: string): number | null {
  const v = parseStatementAmount(raw);
  if (v === null) return null;
  return v.sign === 'neg' ? -v.paise : v.paise;
}

/** Find `label … number` on one line, or the first bare number on the
 *  following `lookahead` lines (label rows and value cells split in the
 *  text layer). */
function labeledAmount(text: string, labelRe: RegExp, lookahead = 2): number | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!labelRe.test(line)) continue;
    // Strip a leading box/field number left after removing the label
    // ('1 Gross Total Income 850000' → '1  850000' → '850000').
    const afterLabel = line
      .replace(labelRe, '')
      .replace(/\([^)]*\)/g, '') // '(7a+7b+7c+7d)' cross-references aren't amounts
      .replace(/^\s*\d{1,2}[a-z]?\s+/, '');
    const m = AMOUNT_RE.exec(afterLabel);
    if (m !== null) {
      const v = paise(m[1]!);
      if (v !== null) return v;
    }
    for (let j = i + 1; j <= Math.min(i + lookahead, lines.length - 1); j++) {
      const lm = /^\s*(-?\d[\d,]*(?:\.\d{2})?)\s*$/.exec(lines[j]!);
      if (lm !== null) {
        const v = paise(lm[1]!);
        if (v !== null) return v;
      }
      const nm = AMOUNT_RE.exec(lines[j]!);
      if (nm !== null && !/[A-Za-z]{3,}/.test(lines[j]!.replace(labelRe, ''))) {
        const v = paise(nm[1]!);
        if (v !== null) return v;
      }
    }
  }
  return null;
}

function labeledText(text: string, labelRe: RegExp): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (!labelRe.test(line)) continue;
    const rest = line
      .replace(labelRe, '')
      .replace(/^[\s:–—-]+/, '')
      .trim();
    if (rest !== '') return rest;
  }
  return null;
}

// ── detection ───────────────────────────────────────────────────────────

const ITRV_HINT =
  /income\s*tax\s*return\s*[\s-]*verification|\bITR-V\b|e-?filing\s*acknowledgement/i;
const F26AS_HINT =
  /form\s*(?:no\.?\s*)?26as|annual\s*(?:tax|information)\s*statement|\bTDS\b.*deductor/i;
const PAYSLIP_HINT = /\b(pay\s*slip|payslip|salary\s*slip|salary\s*statement|pay\s*advice)\b/i;
const PAYSLIP_STRUCT =
  /\b(net\s*pay|take\s*home|earnings|deductions|basic\s*(?:salary|pay)|\bhra\b)\b/i;

/** Cheap text sniff — which deterministic document parser applies. */
export function detectDocumentType(text: string): DocumentKind {
  if (ITRV_HINT.test(text)) return 'itrv';
  if (F26AS_HINT.test(text)) return 'form26as';
  if (PAYSLIP_HINT.test(text) && PAYSLIP_STRUCT.test(text)) return 'payslip';
  if (/date.*narration|statement\s*(?:of\s*account|period)|opening\s*balance/i.test(text))
    return 'statement';
  return 'unknown';
}

// ── payslip ─────────────────────────────────────────────────────────────

const DEDUCTION_LABEL_RE =
  /\b(p\.?\s?f\.?|provident\s*fund|e\.?s\.?i\.?|professional\s*tax|prof\.?\s*tax|p\.?\s?tax|t\.?d\.?s\.?|income\s*tax|labour\s*welfare|l\.?w\.?f\.?|loan|advance|recovery|vpf|gratuity|canteen|insurance|society|fine)\b/i;
const EARNING_LABEL_RE =
  /\b(basic|h\.?r\.?a\.?|house\s*rent|special\s*allowance|conveyance|transport|l\.?t\.?a\.?|medical|bonus|incentive|arrears?|overtime|ot\b|variable\s*pay|performance|retention|other\s*allowance|dearness|da\b|city\s*compensatory|cca|shift|washing|uniform|leave\s*encash|stipend|attendance)\b/i;
const SKIP_LABEL_RE =
  /\b(total|gross|net|earnings|deductions|pay\s*slip|payslip|name|pan|uan|designation|department|bank|a\/?c|account|date|period|month|days?|lop|loss\s*of\s*pay|signature|address|do[jb]|join)\b/i;

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function parsePeriod(text: string): string | null {
  const m =
    /(?:month\s*of|pay\s*period|period|for\s*the\s*month\s*of|payslip\s*for)\s*[:#-]?\s*([A-Za-z]{3,9})\s*[-,']?\s*(20\d{2})/i.exec(
      text,
    ) ?? /\b([A-Za-z]{3,9})\s*[-,]\s*(20\d{2})\b/.exec(text);
  if (m === null) return null;
  const mon = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
  return mon !== undefined ? `${m[2]}-${mon}` : null;
}

/**
 * Parses the text layer of an Indian payslip into structured components.
 * Component labels are preserved verbatim — earnings vs deductions is the
 * only classification applied. Deterministic: label+amount line pairs,
 * statutory-ID regexes, and a gross−deductions=net arithmetic check.
 */
export function extractPayslip(text: string): ParsedPayslip {
  const warnings: string[] = [];
  const components: PayslipComponent[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    // "Label    12,345.00" — label then terminal amount.
    const m = /^([A-Za-z][A-Za-z ./&()'-]{1,40}?)[\s:]+(-?\d[\d,]*(?:\.\d{1,2})?)\s*$/.exec(line);
    if (m === null) continue;
    const label = m[1]!.replace(/\s+/g, ' ').trim();
    const amount = paise(m[2]!);
    if (amount === null) continue;
    if (SKIP_LABEL_RE.test(label)) continue;
    const side = DEDUCTION_LABEL_RE.test(label)
      ? 'deduction'
      : EARNING_LABEL_RE.test(label)
        ? 'earning'
        : null;
    if (side === null) continue;
    const key = `${side}:${label.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push({ label, side, amountPaise: amount });
  }

  const gross =
    labeledAmount(text, /\b(gross\s*(?:earnings?|pay|salary|total)|total\s*earnings?)\b/i) ??
    (components.some((c) => c.side === 'earning')
      ? components.filter((c) => c.side === 'earning').reduce((s, c) => s + c.amountPaise, 0)
      : null);
  const deductionsTotal =
    labeledAmount(text, /\b(total\s*deductions?|deductions?\s*total)\b/i) ??
    (components.some((c) => c.side === 'deduction')
      ? components.filter((c) => c.side === 'deduction').reduce((s, c) => s + c.amountPaise, 0)
      : null);
  const netPay = labeledAmount(
    text,
    /\b(net\s*(?:pay|salary|amount|payable)|take\s*home|net\s*payable)\b/i,
  );

  let arithmeticCheck: ParsedPayslip['arithmeticCheck'] = 'incomplete';
  if (gross !== null && deductionsTotal !== null && netPay !== null) {
    arithmeticCheck = Math.abs(gross - deductionsTotal - netPay) <= 100 ? 'ok' : 'mismatch';
    if (arithmeticCheck === 'mismatch') {
      warnings.push(`gross(${gross}) − deductions(${deductionsTotal}) ≠ netPay(${netPay})`);
    }
  }
  if (components.length === 0) {
    warnings.push('no earnings/deduction components recognized');
  }

  const pan = PAN_RE.exec(text)?.[1] ?? null;
  const uan = /\bUAN\b[\s:]*(\d{12})\b/i.exec(text)?.[1] ?? null;
  const pfNo =
    /\bP\.?\s?F\.?\s*(?:No|Number|A\/?c|Account)\b\.?[\s:]*([A-Z0-9/-]{6,25})/i.exec(text)?.[1] ??
    null;
  const esiNo = /\bE\.?S\.?I\.?\s*(?:No|Number)\b\.?[\s:]*(\d{10,17})/i.exec(text)?.[1] ?? null;
  const bankMask =
    /(?:a\/?c|account)\s*(?:no\.?|number)?[\s:]*[xX*]*(\d{4})\b/.exec(text)?.[1] ?? null;

  const employeeName =
    labeledText(
      text,
      /\b(?:employee\s*name|emp(?:loyee)?\s*name|name\s*of\s*(?:the\s*)?employee)\b/i,
    ) ?? labeledText(text, /^\s*name\b/i);
  const employer =
    labeledText(text, /\b(?:employer|company|organization|organisation)\b/i) ??
    (() => {
      for (const line of text.split(/\r?\n/).slice(0, 5)) {
        const t = line.trim();
        if (
          /\b(ltd|limited|llp|pvt|private|inc|corp|technologies|solutions|industries|enterprises)\b/i.test(
            t,
          ) &&
          t.length < 80
        )
          return t;
      }
      return null;
    })();

  return {
    kind: 'payslip',
    employeeName,
    employer,
    period: parsePeriod(text),
    payDate:
      /(?:pay\s*date|date\s*of\s*payment)\s*[:#-]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i.exec(
        text,
      )?.[1] ?? null,
    components,
    grossPaise: gross,
    deductionsPaise: deductionsTotal,
    netPayPaise: netPay,
    ids: { pan, uan, pfNo, esiNo, bankAccountMask: bankMask },
    arithmeticCheck,
    warnings,
  };
}

// ── ITR-V ───────────────────────────────────────────────────────────────

function itrvBox(text: string, ...labelRes: RegExp[]): number | null {
  for (const re of labelRes) {
    const v = labeledAmount(text, re, 3);
    if (v !== null) return v;
  }
  return null;
}

/** Parses the ITR-V / e-filing acknowledgement text layer — the numbered
 *  boxes (1 gross total income … 9 refund) are stable across ITR forms. */
export function extractItrV(text: string): ParsedItrV {
  const warnings: string[] = [];

  const ackNo =
    /\b(?:e-?filing\s*)?acknowledg?ement\s*(?:number|no\.?)\b[\s:]*([0-9]{12,20})/i.exec(
      text,
    )?.[1] ??
    /\b(1[0-9]{14})\b/.exec(text)?.[1] ??
    null;
  const filingDate =
    /date\s*\(?\s*[DdMmYy/\s-]*\)?[\s:]*(\d{2}[-/]\d{2}[-/]\d{4})/i.exec(text)?.[1] ?? null;
  const assessmentYear =
    /assessment\s*year\b[\s:]*\S*\s*(20\d{2}[-\s]?\d{2,4})/i.exec(text)?.[1] ??
    AY_RE.exec(text)?.[1] ??
    null;
  const itrForm =
    /\b(ITR[-\s]?[1-7](?:A|S)?|SAHAJ|SUGAM)\b/i.exec(text)?.[1]?.toUpperCase() ?? null;
  const name = labeledText(text, /\bname\b/i);
  const status = labeledText(text, /\bstatus\b/i);
  void status;

  // Box-number-anchored labels first (stable ITR-V structure), plain labels
  // as fallback for text layers that drop the box digits.
  const gross = itrvBox(text, /^\s*1\s+gross\s*total\s*income\b/im, /\bgross\s*total\s*income\b/i);
  const dedVIA = itrvBox(
    text,
    /^\s*2\s+deductions?\s*under\s*chapter[-\s]*VI[-\s]*A\b/im,
    /deductions?\s*under\s*chapter[-\s]*VI[-\s]*A\b/i,
  );
  const totalIncome = itrvBox(
    text,
    /^\s*3\s+total\s*income\b/im,
    /\b(?<!gross\s)(?<!total\s)total\s*income\b/i,
  );
  const netTaxPayable = itrvBox(
    text,
    /^\s*4\s+net\s*tax\s*payable\b/im,
    /\bnet\s*tax\s*payable\b/i,
  );
  const tds = itrvBox(text, /^\s*7b\s+TDS\b/im, /^\s*b?\s*\bTDS\b/im, /\bTDS\b/i);
  const taxesPaid = itrvBox(
    text,
    /^\s*7e\s+total\s*taxes?\s*paid\b/im,
    /\btotal\s*taxes?\s*paid\b/i,
  );
  const refund = itrvBox(text, /^\s*9\s+refund\b/im, /\brefund\b/i);

  let arithmeticCheck: ParsedItrV['arithmeticCheck'] = 'incomplete';
  if (gross !== null && dedVIA !== null && totalIncome !== null) {
    arithmeticCheck = Math.abs(gross - dedVIA - totalIncome) <= 100 ? 'ok' : 'mismatch';
    if (arithmeticCheck === 'mismatch') {
      warnings.push('grossTotal − chapterVI-A ≠ totalIncome');
    }
  }
  if (ackNo === null) warnings.push('no e-filing acknowledgement number found');
  if (PAN_RE.exec(text) === null) warnings.push('no PAN found');

  return {
    kind: 'itrv',
    pan: PAN_RE.exec(text)?.[1] ?? null,
    name,
    assessmentYear,
    itrForm,
    ackNo,
    filingDate,
    grossTotalIncomePaise: gross,
    deductionsChapterViaPaise: dedVIA,
    totalIncomePaise: totalIncome,
    netTaxPayablePaise: netTaxPayable,
    tdsPaise: tds,
    totalTaxesPaidPaise: taxesPaid,
    refundPaise: refund,
    arithmeticCheck,
    warnings,
  };
}

// ── Form 26AS ───────────────────────────────────────────────────────────

/** Parses the Form 26AS / annual tax statement text layer: TDS entries by
 *  deductor (TAN + section + date + paid/deducted/deposited) and the
 *  document's own totals when printed. */
export function extractForm26as(text: string): ParsedForm26as {
  const warnings: string[] = [];
  const entries: Form26asEntry[] = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const tan = TAN_RE.exec(line);
    if (tan === null) continue;
    const amounts = [...line.matchAll(/(-?\d[\d,]*\.\d{2})/g)].map((m) => paise(m[1]!));
    const sec = /\b(19[24][A-Z]?|194[A-Z]{0,2})\b/.exec(line)?.[1] ?? null;
    const date =
      /\b(\d{2}[-/][A-Za-z]{3}[-/]\d{4}|\d{2}[-/]\d{2}[-/]\d{4})\b/.exec(line)?.[1] ?? null;
    const beforeTan = line
      .slice(0, tan.index)
      .replace(/[\d\s\-/.,]+$/, '')
      .trim();
    entries.push({
      deductor: beforeTan !== '' ? beforeTan : null,
      tan: tan[1]!,
      section: sec,
      date,
      paidPaise: amounts[0] ?? null,
      taxDeductedPaise: amounts[1] ?? null,
      depositedPaise: amounts[2] ?? amounts[1] ?? null,
    });
  }

  if (entries.length === 0) {
    warnings.push('no TAN-keyed TDS entries recognized');
  }
  const paid = entries.map((e) => e.paidPaise).filter((v): v is number => v !== null);
  const deducted = entries.map((e) => e.taxDeductedPaise).filter((v): v is number => v !== null);

  return {
    kind: 'form26as',
    pan: PAN_RE.exec(text)?.[1] ?? null,
    name: labeledText(text, /\bname\s*of\s*(?:the\s*)?(?:assessee|deductee|taxpayer)\b/i),
    assessmentYear:
      /assessment\s*year\b[\s:]*\S*\s*(20\d{2}[-\s]?\d{2,4})/i.exec(text)?.[1] ??
      AY_RE.exec(text)?.[1] ??
      null,
    entries,
    totalPaidPaise: paid.length > 0 ? paid.reduce((a, b) => a + b, 0) : null,
    totalTaxDeductedPaise: deducted.length > 0 ? deducted.reduce((a, b) => a + b, 0) : null,
    warnings,
  };
}

/** Convenience dispatcher: detect then parse. Returns the parsed document
 *  or null with a detectable 'unknown'/'statement' kind. */
export function extractDocument(text: string): ParsedDocument | null {
  switch (detectDocumentType(text)) {
    case 'payslip':
      return extractPayslip(text);
    case 'itrv':
      return extractItrV(text);
    case 'form26as':
      return extractForm26as(text);
    default:
      return null;
  }
}
