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
import type { SmsPatternsFile } from './formatsLoader';
import { findAccountMask } from './rowMapper';
import type { ExtractedStatement, RowDirection } from './types';

const DATE_FALLBACK = /\b(\d{1,2}[-/ ](?:\d{1,2}|[A-Za-z]{3,9})[-/ ]\d{2,4})\b/;
const BALANCE_FALLBACK =
  /(?:avl|available|avail)\s*bal(?:ance)?\s*(?::|is)?\s*((?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d{1,2})?)/i;

/**
 * Extracts a single transaction from one bank SMS alert. Pattern matching
 * is data-driven (`formats/sms-patterns.json`); the SMS body is preserved
 * as `narration` so downstream normalization still classifies channel,
 * counterparty and category from the same grammar sets.
 */
export function extractSms(
  body: string,
  file: SmsPatternsFile,
  options?: { bankHint?: string },
): ExtractedStatement {
  const warnings: string[] = [];
  const text = body.trim();

  let direction: RowDirection = null;
  let amountPaise: number | null = null;
  let accountMask = findAccountMask(text);
  let matchedPattern: string | null = null;

  for (const pattern of file.patterns) {
    if (
      options?.bankHint &&
      pattern.bank !== 'GENERIC' &&
      pattern.bank !== options.bankHint.toUpperCase()
    ) {
      continue;
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern.regex, pattern.flags ?? 'i');
    } catch {
      continue;
    }
    const m = regex.exec(text);
    if (!m) continue;
    matchedPattern = pattern.id;
    if (pattern.direction === 'DEBIT' || pattern.direction === 'CREDIT') {
      direction = pattern.direction;
    }
    const amountGroup = m.groups?.['amount'];
    if (amountGroup) amountPaise = parsePaise(amountGroup);
    const maskGroup = m.groups?.['accountMask'];
    if (!accountMask && maskGroup) accountMask = maskGroup;
    break;
  }

  let balancePaise: number | null = null;
  const balMatch = file.balanceRegex
    ? new RegExp(file.balanceRegex, 'i').exec(text)
    : BALANCE_FALLBACK.exec(text);
  const balGroup = balMatch?.groups?.['balance'] ?? balMatch?.[1];
  if (balGroup) balancePaise = parsePaise(balGroup);

  let date: string | null = null;
  const dateMatch = file.dateRegex
    ? new RegExp(file.dateRegex, 'i').exec(text)
    : DATE_FALLBACK.exec(text);
  const dateGroup = dateMatch?.groups?.['date'] ?? dateMatch?.[1];
  if (dateGroup) {
    date = parseStatementDate(dateGroup);
    if (!date) warnings.push(`unparseable sms date '${dateGroup}'`);
  }

  if (!matchedPattern) {
    warnings.push('no sms pattern matched; narration passed through for grammar parsing');
  }

  const transactions =
    amountPaise === null && !matchedPattern
      ? []
      : [
          {
            date,
            narration: text,
            refNo: null,
            direction,
            amountPaise,
            balancePaise,
            raw: text,
            warnings: matchedPattern ? [] : ['unmatched sms pattern'],
          },
        ];

  return {
    format: 'sms',
    bank: options?.bankHint ?? null,
    layoutId: matchedPattern,
    accountMask,
    transactions,
    warnings,
    metadata: {},
  };
}
