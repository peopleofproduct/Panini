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

import type { BankNamesFile, CsvLayoutsFile } from '../formatsLoader';
import { detectBankId } from '../bankNames';
import { looksLikeUpiAppStatement, parseUpiAppStatement } from '../upiStatement';
import { parseStatementDate } from '../statementDate';
import { findAccountMask, mapRow } from '../rowMapper';
import { mineStatementMetadata } from '../statementMetadata';
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

const MAX_CONTINUATION_ROWS = 3;
const MAX_CONTINUATION_LENGTH = 120;
/** Footer / boilerplate lines that must never be glued onto a narration. */
const FOOTER_RE =
  /^(?:page\s+\d|statement\s+(?:summary|of)|total\b|closing\s+balance|opening\s+balance|this\s+is\s+a\s+computer|registered\s+office|\*|disclaimer|note\b|end\s+of\s+statement)/i;
/** A row that only states a balance carried into / out of the period. */
const BALANCE_MARKER_RE =
  /^(?:(opening)\s+bal(?:ance)?|(b\/f)|(brought\s+forward)|(closing)\s+bal(?:ance)?|(c\/f)|(carried\s+forward))[\s:.-]*$/i;
const NUMERIC_DATE_RE = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/;

function cellText(cells: readonly string[], idx: number | undefined): string {
  return idx === undefined ? '' : (cells[idx] ?? '').trim();
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
  options?: { bankHint?: string; layoutId?: string; bankNames?: BankNamesFile },
): ExtractedStatement {
  const warnings: string[] = [];
  const metadata: Record<string, string> = {};

  const preambleText = rows
    .slice(0, file.maxHeaderScanRows)
    .map((r) => r.join(' '))
    .join(' ');
  const detectedBank =
    options?.bankNames !== undefined ? detectBankId(preambleText, options.bankNames) : null;
  const accountMask = findAccountMask(preambleText);
  const footerText = rows
    .slice(-file.maxHeaderScanRows)
    .map((r) => r.join(' '))
    .join(' ');
  Object.assign(metadata, mineStatementMetadata(`${preambleText} ${footerText}`));

  const table = detectTable(rows, file, options);
  if (!table) {
    return {
      format,
      bank: detectedBank ?? options?.bankHint ?? null,
      layoutId: null,
      accountMask,
      transactions: [],
      warnings: ['no statement table detected in input'],
      metadata,
    };
  }

  const headerWidth = (rows[table.headerRowIndex] ?? []).length;
  const cols = table.columns;
  const transactions: ExtractedTransaction[] = [];
  let lastBaseWarnings: readonly string[] = [];
  let continuationRows = 0;
  let canContinue = false;
  let firstGt12 = false;
  let secondGt12 = false;

  for (let i = table.headerRowIndex + 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (!cells || cells.every((c) => c.trim() === '')) {
      canContinue = false;
      continue;
    }

    const dateText = cellText(cells, cols.date);
    const dm = NUMERIC_DATE_RE.exec(dateText);
    if (dm) {
      if (Number(dm[1]) > 12) firstGt12 = true;
      if (Number(dm[2]) > 12) secondGt12 = true;
    }

    const narrationText = cellText(cells, cols.narration);
    const noAmounts =
      cellText(cells, cols.debit) === '' &&
      cellText(cells, cols.credit) === '' &&
      cellText(cells, cols.amount) === '';
    const noBalance = cellText(cells, cols.balance) === '';

    // Opening / closing balance marker rows are statement metadata, not
    // transactions.
    const marker = BALANCE_MARKER_RE.exec(narrationText);
    if (marker !== null && noAmounts && !noBalance) {
      const mapped = mapRow(cells, cols);
      if (mapped.balancePaise !== null) {
        const isOpening =
          marker[1] !== undefined || marker[2] !== undefined || marker[3] !== undefined;
        const key = isOpening ? 'openingBalancePaise' : 'closingBalancePaise';
        metadata[key] ??= String(mapped.balancePaise);
        canContinue = false;
        continue;
      }
    }

    if (!rowPlausible(cells, cols, headerWidth)) {
      const isContinuation =
        canContinue &&
        continuationRows < MAX_CONTINUATION_ROWS &&
        dateText === '' &&
        noAmounts &&
        noBalance &&
        narrationText !== '' &&
        narrationText.length <= MAX_CONTINUATION_LENGTH &&
        !FOOTER_RE.test(narrationText);
      if (isContinuation) {
        const prev = transactions[transactions.length - 1]!;
        continuationRows += 1;
        transactions[transactions.length - 1] = {
          ...prev,
          narration: `${prev.narration} ${narrationText}`.trim(),
          raw: `${prev.raw} ${cells.join(' ').trim()}`.trim(),
          warnings: [...lastBaseWarnings, `narration continued across ${continuationRows} row(s)`],
        };
        continue;
      }
      canContinue = false;
      const preview = cells.join(' ').trim();
      if (preview) warnings.push(`skipped non-transaction row ${i + 1}: '${preview.slice(0, 60)}'`);
      continue;
    }

    const mapped = mapRow(cells, cols);
    transactions.push(mapped);
    lastBaseWarnings = mapped.warnings;
    continuationRows = 0;
    canContinue = true;
  }

  if (secondGt12 && !firstGt12) {
    warnings.push(
      'date column looks month-first (MM/DD/YYYY) — values were read day-first (DD/MM/YYYY); rows with an impossible day-first date were skipped, not guessed',
    );
  }

  if (transactions.length === 0) {
    warnings.push('header detected but no transaction rows parsed');
  } else if (metadata['closingBalancePaise'] === undefined) {
    // Fallback: last transaction's running balance is the de-facto close.
    const lastBalance = [...transactions].reverse().find((t) => t.balancePaise !== null);
    if (lastBalance?.balancePaise !== null && lastBalance?.balancePaise !== undefined) {
      metadata['closingBalancePaise'] = String(lastBalance.balancePaise);
    }
  }

  const layout = table.layout;
  if (layout?.kind !== undefined) metadata['accountKind'] = layout.kind;
  const bank = layout ? layout.bank : (detectedBank ?? options?.bankHint ?? null);
  const bankSource =
    layout !== null
      ? 'layout'
      : detectedBank !== null
        ? 'preamble'
        : options?.bankHint !== undefined
          ? 'hint'
          : null;
  if (bankSource !== null) metadata['bankSource'] = bankSource;
  if (layout === null || layout.id === 'generic_statement') {
    warnings.push(
      `no bank-specific layout matched — parsed via generic fallback${detectedBank !== null ? ` (detected bank: ${detectedBank}; a dedicated layout would improve accuracy)` : ''}`,
    );
  }

  return {
    format,
    bank,
    layoutId: layout ? layout.id : 'generic_heuristic',
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
  options?: { bankHint?: string; layoutId?: string; bankNames?: BankNamesFile },
): ExtractedStatement {
  // UPI-app statements (PhonePe et al.) are vertical field records, not
  // tables — route them before the delimited-column machinery sees them.
  if (looksLikeUpiAppStatement(text)) {
    return parseUpiAppStatement(text, 'csv');
  }
  const { rows, delimiter } = parseCsv(text);
  const result = statementFromRows(rows, file, 'csv', options);
  return {
    ...result,
    metadata: { ...result.metadata, delimiter: delimiter === '\t' ? 'tab' : delimiter },
  };
}
