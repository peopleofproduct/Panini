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

import { mulberry32 } from './mockFactory';

/**
 * Render spec for one bank's CSV statement: the concrete header row and the
 * column positions each semantic field occupies. These specs are generation
 * inputs only — the authoritative detection contract stays in the extract
 * package's `formats/csv-layouts.json`, and generated statements are fed
 * back through the extractor as a drift gate: if a spec drifts from the
 * real layout, extraction (not the generator) fails the test.
 */
export interface StatementColumnSpec {
  /** Matches `layout.id` in csv-layouts.json. */
  readonly layoutId: string;
  readonly bank: string;
  /** Header cells in physical column order. */
  readonly headers: readonly string[];
  /** Column indices into `headers`. */
  readonly date: number;
  readonly narration: number;
  readonly refNo?: number;
  readonly debit?: number;
  readonly credit?: number;
  /** Single-amount column (used with `direction`) — the Kotak-style shape. */
  readonly amount?: number;
  /** 'Dr'/'Cr' marker column paired with `amount`. */
  readonly direction?: number;
  readonly balance?: number;
  readonly dateFormat: 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'DD/MM/YY' | 'DD Mon YYYY';
  readonly delimiter?: string;
  /** Lines emitted before the header row (bank name, account mask, ...). */
  readonly preamble?: readonly string[];
}

/** One generated transaction row with its ground-truth interpretation. */
export interface GeneratedStatementRow {
  readonly date: string;
  readonly narration: string;
  readonly refNo: string | null;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountPaise: number;
  readonly balancePaise: number;
  /** Set when the row was deliberately corrupted; extractors must not
   *  fabricate a transaction from it. */
  readonly anomaly?: 'bad_date' | 'missing_amount' | 'short_row';
}

export interface GeneratedStatement {
  readonly spec: StatementColumnSpec;
  /** The rendered statement text, ready to feed `extractCsvStatement`. */
  readonly text: string;
  /** Ground truth for every row emitted, in order. */
  readonly rows: readonly GeneratedStatementRow[];
}

export interface GenerateStatementOptions {
  readonly seed?: number;
  readonly transactions?: number;
  /** Opening balance in paise; defaults to a seeded value. */
  readonly openingBalancePaise?: number;
  /** Fraction of rows corrupted with anomalies (0–1). Defaults to 0. */
  readonly anomalyRate?: number;
}

type Rng = () => number;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function digits(rng: Rng, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randInt(rng, 0, 9));
  return out;
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function alnum(rng: Rng, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALNUM[Math.floor(rng() * ALNUM.length)];
  return out;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const NARRATION_DEBIT = [
  'UPI/{ref}/DR/SWIGGY@okaxis/',
  'UPI/{ref}/DR/DMART@okhdfc/',
  'POS {ref} PURCHASE MCC-5411',
  'ATM WDL-SELF-{bank}',
  'NACH-EMI-BAJAJ FINSERV-{ref}',
  'NEFT-{ref}-RENT-LANDLORD',
] as const;

const NARRATION_CREDIT = [
  'NEFT-{ref}-SALARY-ACME PVT LTD',
  'UPI/{ref}/CR/REFUND-FLIPKART/',
  'IMPS-{ref}-REMITTER-{bank}-INWARD',
  'ACH-CR-{ref}-DIVIDEND',
  'UPI/{ref}/CR/JOHN DOE@ybl/',
] as const;

function formatDate(format: StatementColumnSpec['dateFormat'], iso: string): string {
  const [y, m, d] = iso.split('-');
  switch (format) {
    case 'DD/MM/YYYY':
      return `${d}/${m}/${y}`;
    case 'DD-MM-YYYY':
      return `${d}-${m}-${y}`;
    case 'DD/MM/YY':
      return `${d}/${m}/${y?.slice(2)}`;
    case 'DD Mon YYYY':
      return `${d} ${MONTH_NAMES[Number(m) - 1]} ${y}`;
  }
}

function randomIsoDate(rng: Rng): string {
  const y = pick(rng, [2025, 2026]);
  const m = randInt(rng, 1, 12);
  const d = randInt(rng, 1, 28);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** RFC-4180 field escaping — only when the cell needs it. */
function csvCell(value: string, delimiter: string): string {
  return value.includes(delimiter) || value.includes('"') || value.includes('\n')
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function formatAmount(paise: number): string {
  const rupees = String(Math.floor(paise / 100));
  const frac = String(paise % 100).padStart(2, '0');
  // Indian digit grouping: last 3 digits, then pairs — 1,23,456 not 123,456.
  const tail = rupees.slice(-3);
  const head = rupees.slice(0, -3);
  const grouped = head.length > 0 ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail;
  return `${grouped}.${frac}`;
}

/**
 * Generates a synthetic CSV statement rendered through one bank's layout
 * spec. Deterministic for a given seed — same seed, same bytes. The
 * returned `rows` are ground truth: feed `text` to the extractor and
 * compare row-for-row.
 */
export function generateCsvStatement(
  spec: StatementColumnSpec,
  options?: GenerateStatementOptions,
): GeneratedStatement {
  const rng = mulberry32(options?.seed ?? 42);
  const count = options?.transactions ?? randInt(rng, 5, 15);
  const anomalyRate = options?.anomalyRate ?? 0;
  let balance = options?.openingBalancePaise ?? randInt(rng, 10_000, 500_000) * 100;
  const delimiter = spec.delimiter ?? ',';

  const rows: GeneratedStatementRow[] = [];
  const lines: string[] = [...(spec.preamble ?? []), spec.headers.join(delimiter)];

  for (let i = 0; i < count; i++) {
    const direction = pick(rng, ['DEBIT', 'CREDIT'] as const);
    const amountPaise = randInt(rng, 50, 250_000) * 100 + randInt(rng, 0, 99);
    const refNo = spec.refNo !== undefined ? `${alnum(rng, 4)}${digits(rng, 6)}` : null;
    const narrationTemplate =
      direction === 'DEBIT' ? pick(rng, NARRATION_DEBIT) : pick(rng, NARRATION_CREDIT);
    const narration = narrationTemplate
      .replace('{ref}', digits(rng, 12))
      .replace('{bank}', spec.bank);
    const iso = randomIsoDate(rng);
    balance += direction === 'CREDIT' ? amountPaise : -amountPaise;

    const anomaly =
      rng() < anomalyRate
        ? pick(rng, ['bad_date', 'missing_amount', 'short_row'] as const)
        : undefined;

    const cells = spec.headers.map(() => '');
    cells[spec.date] =
      anomaly === 'bad_date'
        ? pick(rng, ['99/99/9999', 'N/A', ''])
        : formatDate(spec.dateFormat, iso);
    cells[spec.narration] = narration;
    if (spec.refNo !== undefined && refNo !== null) cells[spec.refNo] = refNo;
    if (anomaly !== 'missing_amount') {
      if (spec.debit !== undefined && direction === 'DEBIT')
        cells[spec.debit] = formatAmount(amountPaise);
      if (spec.credit !== undefined && direction === 'CREDIT')
        cells[spec.credit] = formatAmount(amountPaise);
      if (spec.amount !== undefined) cells[spec.amount] = formatAmount(amountPaise);
    }
    if (spec.direction !== undefined) cells[spec.direction] = direction === 'DEBIT' ? 'Dr' : 'Cr';
    if (spec.balance !== undefined)
      // Indian exports mark an overdrawn balance '1,234.00 Dr' rather than '-1,234.00'.
      cells[spec.balance] = balance < 0 ? `${formatAmount(-balance)} Dr` : formatAmount(balance);
    if (anomaly === 'short_row') cells.length = Math.max(1, spec.date);

    rows.push({
      date: iso,
      narration,
      refNo,
      direction,
      amountPaise,
      balancePaise: balance,
      ...(anomaly !== undefined ? { anomaly } : {}),
    });

    lines.push(cells.map((c) => csvCell(c, delimiter)).join(delimiter));
  }

  return { spec, text: lines.join('\n'), rows };
}

/**
 * Render specs for every supported bank layout — header orders mirror
 * real exports; column indices feed {@link generateCsvStatement}.
 */
export const STATEMENT_SPECS: readonly StatementColumnSpec[] = [
  {
    layoutId: 'hdfc_statement',
    bank: 'HDFC',
    headers: [
      'Date',
      'Narration',
      'Chq Ref No',
      'Withdrawal Amt',
      'Deposit Amt',
      'Closing Balance',
    ],
    date: 0,
    narration: 1,
    refNo: 2,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD/MM/YY',
    preamble: ['HDFC BANK LTD', 'Account No : XXXXXX4321'],
  },
  {
    layoutId: 'icici_statement',
    bank: 'ICICI',
    headers: [
      'Transaction Date',
      'Value Date',
      'Transaction Remarks',
      'Cheque Number',
      'Withdrawal Amount (INR)',
      'Deposit Amount (INR)',
      'Balance (INR)',
    ],
    date: 0,
    narration: 2,
    refNo: 3,
    debit: 4,
    credit: 5,
    balance: 6,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['ICICI BANK', 'Account No : XXXXXX1234'],
  },
  {
    layoutId: 'sbi_statement',
    bank: 'SBI',
    headers: ['Txn Date', 'Description', 'Ref No/Cheque No', 'Debit', 'Credit', 'Balance'],
    date: 0,
    narration: 1,
    refNo: 2,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD Mon YYYY',
    preamble: ['STATE BANK OF INDIA', 'Account No : XXXXXX9876'],
  },
  {
    layoutId: 'axis_statement',
    bank: 'AXIS',
    headers: ['Tran Date', 'Chq No', 'Particulars', 'Dr', 'Cr', 'Bal'],
    date: 0,
    narration: 2,
    refNo: 1,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD-MM-YYYY',
    preamble: ['AXIS BANK', 'Account No : XXXXXX5566'],
  },
  {
    layoutId: 'kotak_statement',
    bank: 'KOTAK',
    headers: ['Date', 'Description', 'Chq Ref No', 'Amount', 'Dr/Cr', 'Balance'],
    date: 0,
    narration: 1,
    refNo: 2,
    amount: 3,
    direction: 4,
    balance: 5,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['KOTAK MAHINDRA BANK', 'Account No : XXXXXX7788'],
  },
  {
    layoutId: 'pnb_statement',
    bank: 'PNB',
    headers: ['Txn Date', 'Value Date', 'Transaction Details', 'Withdrawal', 'Deposit', 'Balance'],
    date: 0,
    narration: 2,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['PUNJAB NATIONAL BANK', 'Account No : XXXXXX2233'],
  },
  {
    layoutId: 'bob_statement',
    bank: 'BOB',
    headers: ['Date', 'Narration', 'Chq Ref No', 'Withdrawal', 'Deposit', 'Balance'],
    date: 0,
    narration: 1,
    refNo: 2,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['BANK OF BARODA', 'Account No : XXXXXX3344'],
  },
  {
    layoutId: 'yes_statement',
    bank: 'YES',
    headers: ['Transaction Date', 'Description', 'Reference Number', 'Debit', 'Credit', 'Balance'],
    date: 0,
    narration: 1,
    refNo: 2,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['YES BANK', 'Account No : XXXXXX6677'],
  },
  {
    layoutId: 'indusind_statement',
    bank: 'INDUSIND',
    headers: ['Date', 'Particulars', 'Cheque No', 'Debit', 'Credit', 'Balance'],
    date: 0,
    narration: 1,
    refNo: 2,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['INDUSIND BANK', 'Account No : XXXXXX8899'],
  },
  {
    layoutId: 'union_statement',
    bank: 'UNION',
    headers: [
      'Transaction Date',
      'Transaction Details',
      'Reference No',
      'Debit',
      'Credit',
      'Balance',
    ],
    date: 0,
    narration: 1,
    refNo: 2,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['UNION BANK OF INDIA', 'Account No : XXXXXX6789'],
  },
  {
    layoutId: 'idfc_statement',
    bank: 'IDFC',
    headers: [
      'Transaction Date',
      'Value Date',
      'Particulars',
      'Cheque No',
      'Debit',
      'Credit',
      'Balance',
    ],
    date: 0,
    narration: 2,
    refNo: 3,
    debit: 4,
    credit: 5,
    balance: 6,
    dateFormat: 'DD-MM-YYYY',
    preamble: ['IDFC FIRST BANK', 'Account No : XXXXXX3456'],
  },
  {
    layoutId: 'canara_statement',
    bank: 'CANARA',
    headers: [
      'Txn Date',
      'Value Date',
      'Cheque No',
      'Description',
      'Branch Code',
      'Debit',
      'Credit',
      'Balance',
    ],
    date: 0,
    narration: 3,
    refNo: 2,
    debit: 5,
    credit: 6,
    balance: 7,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['CANARA BANK', 'Account No : XXXXXX7890'],
  },
  {
    layoutId: 'federal_statement',
    bank: 'FEDERAL',
    headers: ['Tran Date', 'Chq No', 'Particulars', 'Debit', 'Credit', 'Balance'],
    date: 0,
    narration: 2,
    refNo: 1,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD/MM/YY',
    preamble: ['FEDERAL BANK', 'Account No : XXXXXX1122'],
  },
  {
    layoutId: 'rbl_statement',
    bank: 'RBL',
    headers: [
      'Transaction Date',
      'Value Date',
      'Description',
      'Cheque No',
      'Withdrawal',
      'Deposit',
      'Balance',
    ],
    date: 0,
    narration: 2,
    refNo: 3,
    debit: 4,
    credit: 5,
    balance: 6,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['RBL BANK', 'Account No : XXXXXX5544'],
  },
  {
    layoutId: 'au_statement',
    bank: 'AU_SFB',
    headers: [
      'Transaction Date',
      'Narration',
      'Reference No',
      'Withdrawal',
      'Deposit',
      'Closing Balance',
    ],
    date: 0,
    narration: 1,
    refNo: 2,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: 'DD/MM/YYYY',
    preamble: ['AU SMALL FINANCE BANK', 'Account No : XXXXXX9900'],
  },
];
