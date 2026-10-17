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

import type { CsvLayout, CsvLayoutsFile } from '../formatsLoader';

/** Normalizes a header cell for matching: lowercase, alnum words only. */
export function normalizeHeaderCell(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type ColumnField =
  'date' | 'narration' | 'refNo' | 'debit' | 'credit' | 'amount' | 'direction' | 'balance';

export interface DetectedTable {
  /** Matched layout, or null when the heuristic fallback was used. */
  readonly layout: CsvLayout | null;
  /** Index into the rows array where the header sits. */
  readonly headerRowIndex: number;
  /** Semantic field → column index in the row's cells. */
  readonly columns: Readonly<Partial<Record<ColumnField, number>>>;
}

/** Finds the column index of the first cell matching any candidate. */
function columnIndex(cells: readonly string[], candidates: readonly string[]): number {
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (cell !== undefined && candidates.includes(cell)) return i;
  }
  return -1;
}

function headerCoverage(cells: readonly string[], required: readonly string[]): boolean {
  const set = new Set(cells);
  return required.every((h) => set.has(h));
}

function mapColumns(
  layout: CsvLayout,
  headerCells: readonly string[],
): Partial<Record<ColumnField, number>> {
  const columns: Partial<Record<ColumnField, number>> = {};
  for (const [field, candidates] of Object.entries(layout.columns) as [
    ColumnField,
    readonly string[],
  ][]) {
    const idx = columnIndex(headerCells, candidates);
    if (idx >= 0) columns[field] = idx;
  }
  return columns;
}

const KEYWORD_FIELDS: readonly [ColumnField, readonly string[]][] = [
  ['date', ['date', 'txn date', 'tran date', 'transaction date', 'value date', 'posting date']],
  [
    'narration',
    [
      'description',
      'narration',
      'particulars',
      'details',
      'remarks',
      'transaction remarks',
      'transaction details',
    ],
  ],
  [
    'refNo',
    ['ref no cheque no', 'chq ref no', 'ref no', 'cheque no', 'utr', 'utr no', 'transaction id'],
  ],
  [
    'debit',
    [
      'debit',
      'withdrawal',
      'withdrawal amt',
      'withdrawal amount',
      'dr',
      'debit amount',
      'withdrawal amount inr',
    ],
  ],
  [
    'credit',
    [
      'credit',
      'deposit',
      'deposit amt',
      'deposit amount',
      'cr',
      'credit amount',
      'deposit amount inr',
    ],
  ],
  ['amount', ['amount', 'amount inr', 'txn amount']],
  ['direction', ['dr cr', 'type', 'txn type', 'transaction type', 'dr cr indicator']],
  ['balance', ['balance', 'closing balance', 'bal', 'balance inr']],
];

/**
 * Locates the header row and resolves semantic columns.
 *
 * Pass 1: the first row (within `maxScanRows`) containing every
 * `requiredHeaders` cell of a layout wins — bankHint layouts are tried
 * first, GENERIC last.
 * Pass 2 (fallback): pick the row with the best keyword coverage across
 * canonical field names; needs at least a date column plus one of
 * narration/debit/credit/amount to qualify.
 */
export function detectTable(
  rows: readonly string[][],
  file: CsvLayoutsFile,
  options?: { bankHint?: string; layoutId?: string },
): DetectedTable | null {
  const maxScan = Math.min(file.maxHeaderScanRows, rows.length);
  const normRows = rows.map((r) => r.map(normalizeHeaderCell));

  let layouts = file.layouts;
  if (options?.layoutId) {
    layouts = layouts.filter((l) => l.id === options.layoutId);
  } else if (options?.bankHint) {
    const hint = options.bankHint.toUpperCase();
    layouts = [...layouts].sort((a, b) => {
      if (a.bank === hint && b.bank !== hint) return -1;
      if (b.bank === hint && a.bank !== hint) return 1;
      if (a.bank === 'GENERIC' && b.bank !== 'GENERIC') return 1;
      if (b.bank === 'GENERIC' && a.bank !== 'GENERIC') return -1;
      return 0;
    });
  }

  for (const layout of layouts) {
    for (let i = 0; i < maxScan; i += 1) {
      const cells = normRows[i];
      if (!cells) continue;
      if (headerCoverage(cells, layout.requiredHeaders)) {
        const columns = mapColumns(layout, cells);
        if (columns.date !== undefined) {
          return { layout, headerRowIndex: i, columns };
        }
      }
    }
  }
  if (options?.layoutId) return null;

  // Heuristic fallback: best keyword coverage, must include a date column.
  let best: DetectedTable | null = null;
  let bestScore = 0;
  for (let i = 0; i < maxScan; i += 1) {
    const cells = normRows[i];
    if (!cells) continue;
    const columns: Partial<Record<ColumnField, number>> = {};
    let score = 0;
    for (const [field, candidates] of KEYWORD_FIELDS) {
      const idx = columnIndex(cells, candidates);
      if (idx >= 0) {
        columns[field] = idx;
        score += 1;
      }
    }
    if (
      score > bestScore &&
      columns.date !== undefined &&
      (columns.narration !== undefined ||
        columns.debit !== undefined ||
        columns.amount !== undefined)
    ) {
      bestScore = score;
      best = { layout: null, headerRowIndex: i, columns };
    }
  }
  return best;
}
