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
import { parseStatementDate } from '../statementDate';
import { findAccountMask, mapRow } from '../rowMapper';
import type { ExtractedStatement, ExtractedTransaction, StatementFormat } from '../types';
import { parseCsv } from './csvParser';
import { detectTable } from './layouts';

/**
 * True when a data row still looks tabular relative to the detected
 * columns — used to stop at footers/notes instead of emitting garbage.
 */
function rowPlausible(
  cells: readonly string[],
  columns: { date?: number },
  headerWidth: number,
): boolean {
  const dateIdx = columns.date;
  if (dateIdx === undefined) return false;
  const dateCell = cells[dateIdx];
  if (dateCell === undefined || parseStatementDate(dateCell.trim()) === null) return false;
  if (cells.length > headerWidth + 2) return false;
  return true;
}

/**
 * Turns cell rows (from CSV text, a spreadsheet provider, or OCR output)
 * into a statement. Shared by every tabular tier — layout detection is
 * data-driven (`formats/csv-layouts.json`); unparsable rows are skipped
 * with warnings rather than throwing.
 */
export function statementFromRows(
  rows: readonly string[][],
  file: CsvLayoutsFile,
  format: StatementFormat,
  options?: { bankHint?: string; layoutId?: string },
): ExtractedStatement {
  const warnings: string[] = [];
  const metadata: Record<string, string> = {};

  const preambleText = rows
    .slice(0, file.maxHeaderScanRows)
    .map((r) => r.join(' '))
    .join(' ');
  const accountMask = findAccountMask(preambleText);

  const table = detectTable(rows, file, options);
  if (!table) {
    return {
      format,
      bank: options?.bankHint ?? null,
      layoutId: null,
      accountMask,
      transactions: [],
      warnings: ['no statement table detected in input'],
      metadata,
    };
  }

  const headerWidth = (rows[table.headerRowIndex] ?? []).length;
  const transactions: ExtractedTransaction[] = [];
  for (let i = table.headerRowIndex + 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (!cells || cells.every((c) => c.trim() === '')) continue;
    if (!rowPlausible(cells, table.columns, headerWidth)) {
      const preview = cells.join(' ').trim();
      if (preview) warnings.push(`skipped non-transaction row ${i + 1}: '${preview.slice(0, 60)}'`);
      continue;
    }
    transactions.push(mapRow(cells, table.columns));
  }

  if (transactions.length === 0) {
    warnings.push('header detected but no transaction rows parsed');
  }

  return {
    format,
    bank: table.layout ? table.layout.bank : null,
    layoutId: table.layout ? table.layout.id : 'generic_heuristic',
    accountMask,
    transactions,
    warnings,
    metadata,
  };
}

/** Extracts transactions from CSV/TSV statement text. */
export function extractCsvStatement(
  text: string,
  file: CsvLayoutsFile,
  options?: { bankHint?: string; layoutId?: string },
): ExtractedStatement {
  const { rows, delimiter } = parseCsv(text);
  const result = statementFromRows(rows, file, 'csv', options);
  return {
    ...result,
    metadata: { ...result.metadata, delimiter: delimiter === '\t' ? 'tab' : delimiter },
  };
}
