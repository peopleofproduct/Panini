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

import { parsePaise } from '@paniniapi/core';
import { parseStatementDate } from './statementDate';
import type { ColumnField } from './csv/layouts';
import type { ExtractedTransaction, RowDirection } from './types';

/** Digits of an account number buried in preamble/footer text. */
const ACCOUNT_RE =
  /(?:a\/c|account)\s*(?:no\.?|number|#)?\s*[:-]?\s*(?:x{2,}|\*{2,}|\d{2,}[x*]{2,})?(\d{3,6})\b/i;

/** "1,234.56 Dr" / "INR 500.00 CR" — amount with an embedded direction suffix. */
const DR_CR_SUFFIX = /\b(dr|cr|debit|credit)\b\.?\s*$/i;

export function findAccountMask(text: string): string | null {
  const m = ACCOUNT_RE.exec(text);
  return m?.[1] ?? null;
}

function cellOf(
  cells: readonly string[],
  columns: Partial<Record<ColumnField, number>>,
  field: ColumnField,
): string | null {
  const idx = columns[field];
  if (idx === undefined) return null;
  const value = cells[idx];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

function directionFromText(value: string): RowDirection {
  const upper = value.toUpperCase();
  if (/\b(DR|DEBIT|WITHDRAWAL|WDL)\b/.test(upper)) return 'DEBIT';
  if (/\b(CR|CREDIT|DEPOSIT|DEP)\b/.test(upper)) return 'CREDIT';
  return null;
}

/**
 * Maps one table row to an ExtractedTransaction. Never throws: rows that
 * fail to produce a date or an amount are still returned with warnings
 * so callers can audit every skipped cent.
 */
export function mapRow(
  cells: readonly string[],
  columns: Partial<Record<ColumnField, number>>,
): ExtractedTransaction {
  const warnings: string[] = [];
  const raw = cells.join(' ').trim();

  const date = (() => {
    const rawDate = cellOf(cells, columns, 'date');
    if (!rawDate) return null;
    const parsed = parseStatementDate(rawDate);
    if (!parsed) warnings.push(`unparseable date '${rawDate}'`);
    return parsed;
  })();

  const narration = cellOf(cells, columns, 'narration') ?? '';
  const refNo = cellOf(cells, columns, 'refNo');

  let amountPaise: number | null = null;
  let direction: RowDirection = null;

  const debitRaw = cellOf(cells, columns, 'debit');
  const creditRaw = cellOf(cells, columns, 'credit');
  const amountRaw = cellOf(cells, columns, 'amount');
  const directionRaw = cellOf(cells, columns, 'direction');

  if (debitRaw !== null) {
    amountPaise = parsePaise(debitRaw);
    direction = 'DEBIT';
    if (amountPaise === null) warnings.push(`unparseable debit '${debitRaw}'`);
  }
  if (creditRaw !== null) {
    const credit = parsePaise(creditRaw);
    if (credit === null) {
      warnings.push(`unparseable credit '${creditRaw}'`);
    } else if (amountPaise === null) {
      amountPaise = credit;
      direction = 'CREDIT';
    } else {
      warnings.push('row carries both debit and credit; debit kept');
    }
  }
  if (amountPaise === null && amountRaw !== null) {
    const suffix = DR_CR_SUFFIX.exec(amountRaw);
    const bare = suffix ? amountRaw.replace(DR_CR_SUFFIX, '').trim() : amountRaw;
    const parsed = parsePaise(bare);
    if (parsed === null) {
      warnings.push(`unparseable amount '${amountRaw}'`);
    } else {
      amountPaise = parsed;
      direction = suffix ? directionFromText(suffix[1] ?? '') : direction;
    }
  }
  if (direction === null && directionRaw !== null) {
    direction = directionFromText(directionRaw);
  }
  if (
    direction === null &&
    amountPaise !== null &&
    amountRaw !== null &&
    !DR_CR_SUFFIX.test(amountRaw)
  ) {
    direction = amountRaw.trim().startsWith('-') ? 'DEBIT' : null;
  }

  const balanceRaw = cellOf(cells, columns, 'balance');
  let balancePaise: number | null = null;
  if (balanceRaw !== null) {
    const suffix = DR_CR_SUFFIX.exec(balanceRaw);
    const stripped = balanceRaw.replace(DR_CR_SUFFIX, '').trim();
    balancePaise = parsePaise(stripped);
    // Indian statements mark an overdrawn balance as '1,234.00 Dr' — the
    // magnitude parses positive, so re-apply the sign.
    if (balancePaise !== null && suffix !== null && directionFromText(suffix[1] ?? '') === 'DEBIT')
      balancePaise = -balancePaise;
    if (balancePaise === null) warnings.push(`unparseable balance '${balanceRaw}'`);
  }

  if (!narration && !refNo && amountPaise === null) {
    warnings.push('row produced no usable fields');
  }

  return {
    date,
    narration,
    refNo,
    direction,
    amountPaise,
    balancePaise,
    raw,
    warnings,
  };
}
