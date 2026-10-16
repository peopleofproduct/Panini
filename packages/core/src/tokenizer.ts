/**
 * Copyright 2026 Project Panini Contributors
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

import { isPlausibleDate } from './dates';
import type { TransactionChannel, TransactionType } from './types';

/** Token categories produced by the lexical pass over a narration string. */
export type TokenKind =
  | 'KEYWORD' // known banking vocabulary (UPI, DEBIT, REV, ...)
  | 'VPA' // contains '@' — UPI virtual payment address fragment
  | 'DATE' // plausibly a calendar date
  | 'AMOUNT' // numeric with decimal/Indian thousands separators
  | 'NUMERIC' // plain digits (reference ids, masks)
  | 'ALPHA' // letters only
  | 'ALNUM' // mixed letters/digits
  | 'SYMBOL'; // anything else

export interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  /** Index of this token in the token stream. */
  readonly position: number;
}

/** Maps narration keywords to transaction channels. */
export const CHANNEL_KEYWORDS: Readonly<Record<string, TransactionChannel>> = {
  UPI: 'UPI',
  IMPS: 'IMPS',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  ACH: 'ACH',
  ECS: 'ACH',
  NACH: 'NACH',
  'E-NACH': 'NACH',
  ATM: 'ATM',
  CASH: 'ATM',
  WDL: 'ATM',
  POS: 'POS',
  CHQ: 'CHEQUE',
  CHEQUE: 'CHEQUE',
  CLG: 'CHEQUE',
  NETBANKING: 'NETBANKING',
  INET: 'NETBANKING',
  IB: 'NETBANKING',
};

/** Maps narration keywords to transaction direction. */
export const DIRECTION_KEYWORDS: Readonly<Record<string, TransactionType>> = {
  DR: 'DEBIT',
  DEBIT: 'DEBIT',
  DEBITED: 'DEBIT',
  WITHDRAWAL: 'DEBIT',
  WDL: 'DEBIT',
  CR: 'CREDIT',
  CREDIT: 'CREDIT',
  CREDITED: 'CREDIT',
  DEP: 'CREDIT',
  DEPOSIT: 'CREDIT',
  REV: 'REVERSAL',
  REVERSAL: 'REVERSAL',
  RTN: 'REVERSAL',
  REFUND: 'REFUND',
  RFD: 'REFUND',
};

const KEYWORD_SET: ReadonlySet<string> = new Set([
  ...Object.keys(CHANNEL_KEYWORDS),
  ...Object.keys(DIRECTION_KEYWORDS),
  'TRANSFER',
  'TRF',
  'TXN',
  'SALARY',
  'EMI',
  'AT',
  'TO',
  'BY',
  'FROM',
  'A/C',
  'AC',
  'NO',
]);

// Commas are NOT delimiters — they appear inside Indian-formatted amounts
// such as 1,50,000.50 and must keep the token intact.
const TOKEN_SPLIT = /[\s\-\/|:;]+/;
const AMOUNT_RE = /^(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?$/;
const DATE_CANDIDATE_RE = /^(?:\d{6}|\d{8}|\d{2}[-/.]\d{2}[-/.]\d{2,4}|\d{4}[-/.]\d{2}[-/.]\d{2})$/;
const CURRENCY_PREFIX = /^(?:rs\.?|inr|₹)/i;

function classifyToken(raw: string): TokenKind {
  if (raw.includes('@')) return 'VPA';
  // Classification ignores a leading currency marker (Rs./INR/₹).
  const value = raw.replace(CURRENCY_PREFIX, '') || raw;
  const upper = value.toUpperCase();
  if (KEYWORD_SET.has(upper)) return 'KEYWORD';
  if (AMOUNT_RE.test(value) && (value.includes('.') || value.includes(','))) return 'AMOUNT';
  if (DATE_CANDIDATE_RE.test(value) && isPlausibleDate(value)) return 'DATE';
  if (/^\d+$/.test(value)) return 'NUMERIC';
  if (/^[A-Za-z]+$/.test(value)) return 'ALPHA';
  if (/^[A-Za-z0-9]+$/.test(value)) return 'ALNUM';
  return 'SYMBOL';
}

/**
 * Splits a narration/SMS string into classified tokens. Whitespace is the
 * outer delimiter; each resulting piece that is itself a plausible date
 * (e.g. `15-10-26`) is kept whole. All other pieces are then split on
 * `-/|:;` — `@` is preserved inside tokens so VPAs like `826384@okaxis`
 * survive intact.
 */
export function tokenize(input: string): readonly Token[] {
  const tokens: Token[] = [];
  for (const piece of input.trim().split(/\s+/)) {
    if (piece.length === 0) continue;
    if (DATE_CANDIDATE_RE.test(piece) && isPlausibleDate(piece)) {
      tokens.push({ kind: 'DATE', value: piece, position: tokens.length });
      continue;
    }
    for (const part of piece.split(TOKEN_SPLIT)) {
      if (part.length === 0) continue;
      tokens.push({ kind: classifyToken(part), value: part, position: tokens.length });
    }
  }
  return tokens;
}
