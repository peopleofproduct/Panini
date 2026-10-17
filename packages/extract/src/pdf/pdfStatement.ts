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

import type { CsvLayoutsFile } from '../formatsLoader';
import { findAccountMask, mapRow } from '../rowMapper';
import { mineStatementMetadata } from '../statementMetadata';
import type { ExtractedStatement, ExtractedTransaction } from '../types';
import { normalizeHeaderCell, type ColumnField } from '../csv/layouts';
import { extractPdfFragments, type PdfFragment } from './pdfText';
import { decryptPdf, type PdfCredentials, type PasswordPatternsFile } from './encryption';

export interface ExtractPdfOptions {
  readonly bankHint?: string;
  /** Details used to unlock a password-protected statement. */
  readonly credentials?: PdfCredentials;
  /** Password template file; defaults to bundled formats/pdf-passwords.json. */
  readonly passwordPatterns?: PasswordPatternsFile;
}

const LINE_Y_TOLERANCE = 3;

interface AnchoredColumn {
  readonly field: ColumnField;
  readonly x: number;
}

const HEADER_KEYWORDS: readonly [ColumnField, readonly string[]][] = [
  ['date', ['date', 'txn date', 'tran date', 'transaction date', 'value date', 'posting date']],
  [
    'narration',
    ['narration', 'description', 'particulars', 'details', 'remarks', 'transaction remarks'],
  ],
  ['refNo', ['ref no', 'chq ref no', 'ref no cheque no', 'cheque no', 'utr', 'utr no']],
  ['debit', ['debit', 'withdrawal', 'withdrawal amt', 'withdrawals', 'dr', 'debit amount']],
  ['credit', ['credit', 'deposit', 'deposit amt', 'deposits', 'cr', 'credit amount']],
  ['amount', ['amount', 'txn amount']],
  ['direction', ['dr cr', 'type', 'txn type']],
  ['balance', ['balance', 'closing balance', 'bal']],
];

/**
 * Locates the statement-table header line on a page: the line containing
 * a date-ish column plus at least one money column keyword.
 */
interface HeaderHit {
  readonly columns: AnchoredColumn[];
  readonly y: number;
}

function findHeader(fragments: readonly PdfFragment[]): HeaderHit | null {
  const byLine: { y: number; frags: PdfFragment[] }[] = [];
  for (const f of [...fragments].sort((a, b) => b.y - a.y)) {
    const hit = byLine.find((l) => Math.abs(l.y - f.y) <= LINE_Y_TOLERANCE);
    if (hit) hit.frags.push(f);
    else byLine.push({ y: f.y, frags: [f] });
  }

  for (const line of byLine) {
    const columns: AnchoredColumn[] = [];
    for (const f of line.frags) {
      const norm = normalizeHeaderCell(f.text);
      for (const [field, keywords] of HEADER_KEYWORDS) {
        if (
          keywords.some((k) => norm === k || norm.startsWith(`${k} `) || norm.endsWith(` ${k}`))
        ) {
          columns.push({ field, x: f.x });
          break;
        }
      }
    }
    const fields = new Set(columns.map((c) => c.field));
    if (
      fields.has('date') &&
      (fields.has('debit') || fields.has('credit') || fields.has('amount')) &&
      columns.length >= 3
    ) {
      return { columns: columns.sort((a, b) => a.x - b.x), y: line.y };
    }
  }
  return null;
}

/** Assigns each row fragment to the nearest column anchor at or before its x. */
function fragmentsToCells(
  anchors: readonly AnchoredColumn[],
  rowFrags: readonly PdfFragment[],
  width: number,
): string[] {
  const cells: string[] = Array.from({ length: width }, () => '');
  for (const f of rowFrags) {
    let best = -1;
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i];
      if (anchor && anchor.x <= f.x + 1) best = i;
    }
    if (best < 0) best = 0;
    const idx = best;
    cells[idx] = cells[idx] === '' ? f.text : `${cells[idx]} ${f.text}`;
  }
  return cells;
}

/**
 * Rebuilds statement rows from positioned text fragments — from a PDF
 * text layer or from an OCR provider that returns word boxes. The table
 * header is located per page, column anchors come from header x-positions,
 * and rows are assembled by grouping fragments on the same baseline.
 *
 * Continuation lines (a narration that wraps to a second visual line)
 * produce no date/amount of their own — they are stitched onto the
 * previous transaction's narration instead of becoming phantom rows.
 */
export function statementFromFragments(
  fragments: readonly PdfFragment[],
  options?: { bankHint?: string },
): ExtractedStatement {
  const warnings: string[] = [];
  const metadata: Record<string, string> = {};

  const allText = fragments
    .slice(0, 60)
    .map((f) => f.text)
    .join(' ');
  const accountMask = findAccountMask(allText);
  Object.assign(metadata, mineStatementMetadata(allText));

  const byPage = new Map<number, PdfFragment[]>();
  for (const f of fragments) {
    const arr = byPage.get(f.page) ?? [];
    arr.push(f);
    byPage.set(f.page, arr);
  }
  metadata.pages = String(byPage.size);

  const transactions: ExtractedTransaction[] = [];
  const sortedPages = [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([, frags]) => frags);
  for (const pageFrags of sortedPages) {
    const header = findHeader(pageFrags);
    if (!header) continue;
    const anchors = header.columns;

    // data rows = fragments below the header baseline, grouped by y
    const dataFrags = pageFrags.filter((f) => f.y < header.y - LINE_Y_TOLERANCE);
    const rowLines = new Map<number, PdfFragment[]>();
    for (const f of dataFrags) {
      let bucket: PdfFragment[] | undefined;
      for (const [key, arr] of rowLines) {
        if (Math.abs(key - f.y) <= LINE_Y_TOLERANCE) {
          bucket = arr;
          break;
        }
      }
      if (!bucket) {
        bucket = [];
        rowLines.set(f.y, bucket);
      }
      bucket.push(f);
    }

    const fieldOrder = anchors.map((a) => a.field);
    const columns: Partial<Record<ColumnField, number>> = {};
    fieldOrder.forEach((field, idx) => {
      if (columns[field] === undefined) columns[field] = idx;
    });
    const narrationIdx = columns['narration'];

    for (const rowFrags of [...rowLines.values()].sort((a, b) => b[0]!.y - a[0]!.y)) {
      const cells = fragmentsToCells(
        anchors,
        rowFrags.sort((a, b) => a.x - b.x),
        fieldOrder.length,
      );
      if (cells.every((c) => c.trim() === '')) continue;
      const txn = mapRow(cells, columns);
      if (txn.date === null && txn.amountPaise === null) {
        // Continuation of a wrapped narration — or a footer/summary line.
        const extra = narrationIdx !== undefined ? (cells[narrationIdx] ?? '').trim() : '';
        const last = transactions[transactions.length - 1];
        if (extra !== '' && last) {
          transactions[transactions.length - 1] = {
            ...last,
            narration: `${last.narration} ${extra}`,
            raw: `${last.raw} ${txn.raw}`.trim(),
          };
        }
        continue;
      }
      transactions.push(txn);
    }
  }

  if (transactions.length === 0) {
    warnings.push('text layer found but no transaction table detected');
  }

  return {
    format: 'pdf',
    bank: options?.bankHint ?? null,
    layoutId: 'pdf_table_anchors',
    accountMask,
    transactions,
    warnings,
    metadata,
  };
}

/**
 * Extracts transactions from a digitally-generated statement PDF. When
 * `credentials` are supplied, Standard-handler encrypted documents are
 * unlocked first (per-bank password patterns live in
 * `formats/pdf-passwords.json`); without credentials an encrypted PDF
 * yields a warning, never a throw.
 */
export function extractPdfStatement(
  pdf: Uint8Array,
  _file: CsvLayoutsFile,
  options?: ExtractPdfOptions,
): ExtractedStatement {
  const warnings: string[] = [];

  const unlock = decryptPdf(pdf, options?.credentials, options?.passwordPatterns);
  if (unlock.status === 'encrypted') {
    return {
      format: 'pdf',
      bank: options?.bankHint ?? null,
      layoutId: null,
      accountMask: null,
      transactions: [],
      warnings: [...unlock.warnings],
      metadata: { encrypted: 'true' },
    };
  }
  warnings.push(...unlock.warnings);

  const fragments = extractPdfFragments(pdf, unlock.decryptStream);
  if (fragments.length === 0) {
    return {
      format: 'pdf',
      bank: options?.bankHint ?? null,
      layoutId: null,
      accountMask: null,
      transactions: [],
      warnings: [...warnings, 'no text layer found — scanned PDFs need the OCR provider seam'],
      metadata: unlock.status === 'unlocked' ? { unlocked: 'true' } : {},
    };
  }

  const result = statementFromFragments(fragments, options);
  return { ...result, warnings: [...warnings, ...result.warnings] };
}
