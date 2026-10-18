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
import {
  generateCsvStatement,
  type GeneratedStatementRow,
  type StatementColumnSpec,
} from './statementFactory';

/**
 * Deterministic corruption kinds — real quirks observed in Indian bank CSV
 * exports. Each kind preserves the transaction semantics, so ground truth
 * survives: the extractor is expected to recover every generated row.
 */
export type StatementQuirk =
  /** Long narration split onto a continuation line (joined by extractor). */
  | 'wrapped_narration'
  /** The unused debit/credit column carries '0.00' instead of staying empty. */
  | 'zero_opposite_column'
  /** Direction column uses bare 'D'/'C' instead of 'Dr'/'Cr'. */
  | 'dc_letters'
  /** Date cells drop leading zeroes: '5/1/2026'. */
  | 'single_digit_dates'
  /** Date cells carry a time suffix: '05/01/2026 10:30:45'. */
  | 'datetime_cells'
  /** Statement boilerplate after the last row (must not become a transaction). */
  | 'footer_noise'
  /** OPENING BALANCE / CLOSING BALANCE marker rows (surface as metadata). */
  | 'opening_closing_rows'
  /** Debit amounts rendered signed: '-1,234.00' or '(1,234.00)'. */
  | 'signed_debits'
  /** Blank lines sprinkled between rows. */
  | 'blank_lines'
  /** CRLF line endings. */
  | 'crlf'
  /** UTF-8 BOM prefix. */
  | 'utf8_bom'
  /** UTF-16LE with BOM. */
  | 'utf16le'
  /** UTF-16BE with BOM. */
  | 'utf16be';

export const ALL_QUIRKS: readonly StatementQuirk[] = [
  'wrapped_narration',
  'zero_opposite_column',
  'dc_letters',
  'single_digit_dates',
  'datetime_cells',
  'footer_noise',
  'opening_closing_rows',
  'signed_debits',
  'blank_lines',
  'crlf',
  'utf8_bom',
  'utf16le',
  'utf16be',
];

const ENCODING_QUIRKS: ReadonlySet<StatementQuirk> = new Set(['utf16le', 'utf16be']);

export interface QuirkyStatement {
  readonly spec: StatementColumnSpec;
  /** Statement text, or encoded bytes when an encoding quirk was applied. */
  readonly content: string | Uint8Array;
  /** Ground truth for every generated transaction, in order. */
  readonly rows: readonly GeneratedStatementRow[];
  /** Quirks actually applied (inapplicable ones are skipped). */
  readonly quirks: readonly StatementQuirk[];
}

export interface QuirkOptions {
  readonly seed?: number;
  readonly transactions?: number;
  /** Quirks to apply; defaults to a seeded pick of three. */
  readonly quirks?: readonly StatementQuirk[];
  /** Opening balance in paise; forwarded to the base generator. */
  readonly openingBalancePaise?: number;
}

type Rng = () => number;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = littleEndian ? 0xff : 0xfe;
  out[1] = littleEndian ? 0xfe : 0xff;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const offset = 2 + i * 2;
    out[offset] = littleEndian ? code & 0xff : code >> 8;
    out[offset + 1] = littleEndian ? code >> 8 : code & 0xff;
  }
  return out;
}

/** RFC-4180 field escaping — mirrors statementFactory's csvCell. */
function csvCell(value: string, delimiter: string): string {
  return value.includes(delimiter) || value.includes('"') || value.includes('\n')
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

const FOOTER_LINES = [
  'This is a computer generated statement and does not require signature.',
  'Page 1 of 1',
  '*** END OF STATEMENT ***',
  'Registered Office: Mumbai',
] as const;

/**
 * Generates a synthetic CSV statement then applies deterministic
 * corruption quirks. `content` is the corrupted text (or bytes for the
 * encoding quirks); `rows` remains the ground truth the extractor should
 * recover. Quirks that don't apply to a spec (e.g. `signed_debits` on a
 * debit/credit-column layout) are skipped and omitted from `quirks`.
 */
export function generateQuirkyCsvStatement(
  spec: StatementColumnSpec,
  options?: QuirkOptions,
): QuirkyStatement {
  const rng = mulberry32((options?.seed ?? 42) * 7919 + 13);
  const quirks = [...(options?.quirks ?? [])];
  if (quirks.length === 0) {
    const pool = ALL_QUIRKS.filter((q) => !ENCODING_QUIRKS.has(q));
    while (quirks.length < 3 && pool.length > 0) {
      const q = pool.splice(Math.floor(rng() * pool.length), 1)[0]!;
      quirks.push(q);
    }
  }

  const gen = generateCsvStatement(spec, {
    ...(options?.seed !== undefined ? { seed: options.seed } : {}),
    ...(options?.transactions !== undefined ? { transactions: options.transactions } : {}),
    ...(options?.openingBalancePaise !== undefined
      ? { openingBalancePaise: options.openingBalancePaise }
      : {}),
  });
  const delimiter = spec.delimiter ?? ',';
  // Generated narrations never contain the delimiter or quotes, so a
  // naive split is safe here (this is a generator, not a parser).
  const lines = gen.text.split('\n');
  const headerIdx = lines.findIndex((l) => l.trim().startsWith(spec.headers[0]!.trim()));
  const dataStart = headerIdx + 1;
  const applied = new Set<StatementQuirk>();
  const hasQuirk = (q: StatementQuirk) => quirks.includes(q);
  const rows = gen.rows.map((r) => ({ ...r }));

  const splitRow = (line: string) => line.split(delimiter);

  // ── row-content quirks ────────────────────────────────────────────────

  if (hasQuirk('zero_opposite_column') && spec.debit !== undefined && spec.credit !== undefined) {
    let touched = false;
    for (let i = dataStart; i < lines.length; i++) {
      const cells = splitRow(lines[i]!);
      if (cells.length < spec.headers.length) continue;
      if (cells[spec.debit] === '' && cells[spec.credit] !== '') {
        cells[spec.debit] = '0.00';
        touched = true;
      } else if (cells[spec.credit] === '' && cells[spec.debit] !== '') {
        cells[spec.credit] = '0.00';
        touched = true;
      }
      lines[i] = cells.join(delimiter);
    }
    if (touched) applied.add('zero_opposite_column');
  }

  if (hasQuirk('dc_letters') && spec.direction !== undefined) {
    for (let i = dataStart; i < lines.length; i++) {
      const cells = splitRow(lines[i]!);
      const v = cells[spec.direction];
      if (v === 'Dr') cells[spec.direction] = 'D';
      else if (v === 'Cr') cells[spec.direction] = 'C';
      lines[i] = cells.join(delimiter);
    }
    applied.add('dc_letters');
  }

  if (hasQuirk('single_digit_dates')) {
    let touched = false;
    for (let i = dataStart; i < lines.length; i++) {
      const cells = splitRow(lines[i]!);
      const cell = cells[spec.date] ?? '';
      const mangled = cell.replace(/\b0(\d)\b/g, '$1');
      if (mangled !== cell) {
        cells[spec.date] = mangled;
        lines[i] = cells.join(delimiter);
        touched = true;
      }
    }
    if (touched) applied.add('single_digit_dates');
  }

  if (hasQuirk('datetime_cells')) {
    let touched = false;
    for (let i = dataStart; i < lines.length; i++) {
      const cells = splitRow(lines[i]!);
      const cell = cells[spec.date] ?? '';
      if (cell.trim() !== '') {
        cells[spec.date] =
          `${cell} ${String(Math.floor(rng() * 24)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}`;
        lines[i] = cells.join(delimiter);
        touched = true;
      }
    }
    if (touched) applied.add('datetime_cells');
  }

  if (hasQuirk('signed_debits') && spec.amount !== undefined) {
    for (let i = dataStart; i < lines.length; i++) {
      const cells = splitRow(lines[i]!);
      const isDebit = spec.direction !== undefined && cells[spec.direction] === 'Dr';
      const v = cells[spec.amount] ?? '';
      if (isDebit && v !== '') {
        cells[spec.amount] = rng() < 0.5 ? `-${v}` : `(${v})`;
        lines[i] = cells.join(delimiter);
      }
    }
    applied.add('signed_debits');
  }

  let continuationLineIdx = -1;
  if (hasQuirk('wrapped_narration') && dataStart < lines.length) {
    // Wrap one row's narration across a continuation line. The extractor
    // must join it back, so ground truth narration changes accordingly.
    const rowIdx = dataStart + Math.floor(rng() * (lines.length - dataStart));
    const cells = splitRow(lines[rowIdx]!);
    const narr = cells[spec.narration] ?? '';
    if (narr.length > 8) {
      const cut = narr.indexOf('-', Math.floor(narr.length / 2));
      const at = cut > 0 ? cut + 1 : Math.floor(narr.length / 2);
      const head = narr.slice(0, at);
      const tail = narr.slice(at);
      const cont = spec.headers.map(() => '');
      cont[spec.narration] = tail;
      lines.splice(rowIdx + 1, 0, cont.join(delimiter));
      continuationLineIdx = rowIdx + 1;
      cells[spec.narration] = head;
      lines[rowIdx] = cells.join(delimiter);
      const genRow = rows[rowIdx - dataStart];
      if (genRow) (genRow as { narration: string }).narration = `${head} ${tail}`.trim();
      applied.add('wrapped_narration');
    }
  }

  if (hasQuirk('blank_lines')) {
    let inserted = false;
    for (let i = dataStart + 1; i < lines.length; i += 2) {
      // A blank before a continuation row would break the narration join.
      if (i !== continuationLineIdx && rng() < 0.4) {
        lines.splice(i, 0, '');
        if (i < continuationLineIdx) continuationLineIdx += 1;
        inserted = true;
      }
    }
    if (inserted) applied.add('blank_lines');
  }

  if (hasQuirk('opening_closing_rows') && spec.balance !== undefined) {
    const open = spec.headers.map(() => '');
    open[spec.narration] = 'OPENING BALANCE';
    open[spec.balance] = formatOpeningBalance(gen.rows, options?.openingBalancePaise);
    const close = spec.headers.map(() => '');
    close[spec.narration] = 'CLOSING BALANCE';
    close[spec.balance] =
      gen.rows.length > 0 ? formatPaise(gen.rows[gen.rows.length - 1]!.balancePaise) : '';
    const quote = (cells: string[]) => cells.map((c) => csvCell(c, delimiter)).join(delimiter);
    lines.splice(dataStart, 0, quote(open));
    lines.push(quote(close));
    applied.add('opening_closing_rows');
  }

  if (hasQuirk('footer_noise')) {
    lines.push(...pick(rng, [FOOTER_LINES.slice(0, 2), FOOTER_LINES]));
    applied.add('footer_noise');
  }

  // ── encoding / framing quirks ─────────────────────────────────────────

  const joiner = hasQuirk('crlf') ? '\r\n' : '\n';
  if (hasQuirk('crlf')) applied.add('crlf');
  let text = lines.join(joiner);
  if (hasQuirk('utf8_bom')) {
    text = '\uFEFF' + text;
    applied.add('utf8_bom');
  }

  let content: string | Uint8Array = text;
  if (hasQuirk('utf16le')) {
    content = encodeUtf16(text, true);
    applied.add('utf16le');
  } else if (hasQuirk('utf16be')) {
    content = encodeUtf16(text, false);
    applied.add('utf16be');
  }

  return { spec, content, rows, quirks: [...applied] };
}

function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  const tail = rupees.slice(-3);
  const head = rupees.slice(0, -3);
  const grouped = head.length > 0 ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail;
  return `${sign}${grouped}.${frac}`;
}

function formatOpeningBalance(
  rows: readonly GeneratedStatementRow[],
  openingPaise: number | undefined,
): string {
  const first = rows[0];
  if (openingPaise !== undefined) return formatPaise(openingPaise);
  if (first === undefined) return '0.00';
  const opening =
    first.direction === 'CREDIT'
      ? first.balancePaise - first.amountPaise
      : first.balancePaise + first.amountPaise;
  return formatPaise(opening);
}
