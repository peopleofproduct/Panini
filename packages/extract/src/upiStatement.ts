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

import { findAccountMask } from './rowMapper';
import { parseStatementAmount } from './statementAmount';
import type { ExtractedStatement, ExtractedTransaction, StatementFormat } from './types';

/**
 * PhonePe's emailed transaction statement is not a table — every record is
 * a ~7-line vertical block:
 *
 *   Aug 07, 2024
 *   03:38 PM
 *   Paid to MERCHANT NAME
 *   Transaction ID : T2408071538001
 *   UTR : 422019876543
 *   Paid by HDFC Bank -XXXX1234
 *   Debit ₹ 500.00
 *
 * Detected by its field markers rather than a header row, and parsed with a
 * line state machine: a month-first date line opens a record, `Paid to` /
 * `Bill paid` carries the narration, `Transaction ID` / `UTR` carry refs,
 * and the Debit/Credit amount line closes it.
 */

const DATE_RE = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/;
const TIME_RE = /^\d{1,2}:\d{2}\s*(?::\d{2})?\s*[AP]M/i;
const AMOUNT_LINE_RE = /^(debit(?:ed)?|credit(?:ed)?)\b[^\d]*([\d,]+(?:\.\d{1,2})?)/i;
const TXN_ID_RE = /^transaction\s*id\s*:\s*(\S+)/i;
const UTR_RE = /^utr\s*(?:no\.?|number)?\s*:\s*(\S+)/i;
const NARRATION_RE = /^(paid to|received from|bill paid|refund(?:\s+from)?)\s*[-–:]?\s*(.+)/i;
const PAID_BY_RE = /^paid by\s+(.+)/i;
/** "… -XXXX1234" / "… ***5678" tail in a Paid-by line. */
const PAID_BY_MASK_RE = /[-–*xX]{2,}\s*(\d{3,6})\b/;

const MONTHS: Readonly<Record<string, string>> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

/** True when text carries PhonePe's vertical field markers. */
export function looksLikeUpiAppStatement(text: string): boolean {
  return /transaction\s*id\s*:/i.test(text) && /^paid to\b/im.test(text);
}

function parseUpiDate(monthName: string, day: string, year: string): string | null {
  const mm = MONTHS[monthName.toLowerCase()];
  if (mm === undefined) return null;
  return `${year}-${mm}-${day.padStart(2, '0')}`;
}

export function parseUpiAppStatement(text: string, format: StatementFormat): ExtractedStatement {
  const warnings: string[] = [];
  const metadata: Record<string, string> = {
    statementIssuer: 'phonepe',
    accountKind: 'upi_app',
  };
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim());
  const transactions: ExtractedTransaction[] = [];

  let date: string | null = null;
  let narration = '';
  let rawParts: string[] = [];
  let txnId: string | null = null;
  let utr: string | null = null;
  let paidBy = '';

  const flushRaw = () => {
    rawParts = [];
    txnId = null;
    utr = null;
  };

  for (const line of lines) {
    if (line === '') continue;
    const dm = DATE_RE.exec(line);
    if (dm) {
      // A new date line closes any dangling record without an amount.
      date = parseUpiDate(dm[1]!, dm[2]!, dm[3]!);
      narration = '';
      flushRaw();
      rawParts.push(line);
      continue;
    }
    if (date === null) continue; // preamble / letterhead
    rawParts.push(line);

    if (TIME_RE.test(line)) continue;
    const txn = TXN_ID_RE.exec(line);
    if (txn) {
      txnId = txn[1]!;
      continue;
    }
    const utrM = UTR_RE.exec(line);
    if (utrM) {
      utr = utrM[1]!;
      continue;
    }
    const payer = PAID_BY_RE.exec(line);
    if (payer) {
      // Statement identity comes from the first funding account seen —
      // later records may use a different linked bank account.
      if (paidBy === '') paidBy = payer[1]!;
      continue;
    }
    const amountLine = AMOUNT_LINE_RE.exec(line);
    if (amountLine) {
      const amount = parseStatementAmount(amountLine[2]!);
      if (amount !== null) {
        transactions.push({
          date,
          narration: narration || 'PhonePe transaction',
          amountPaise: amount.paise,
          direction: amountLine[1]!.toLowerCase().startsWith('deb') ? 'DEBIT' : 'CREDIT',
          refNo: utr ?? txnId,
          balancePaise: null,
          raw: rawParts.join(' '),
          warnings: [],
        });
      } else {
        warnings.push(`unparseable amount line: '${line.slice(0, 60)}'`);
      }
      date = null;
      narration = '';
      flushRaw();
      continue;
    }
    const narr = NARRATION_RE.exec(line);
    if (narr) {
      narration = `${narr[1]} ${narr[2]}`.trim();
    }
  }
  if (date !== null) {
    warnings.push('final record had no amount line — dropped');
  }

  if (transactions.length === 0) {
    warnings.push('UPI-app statement markers found but no records parsed');
  }

  const accountMask =
    findAccountMask(paidBy) ??
    PAID_BY_MASK_RE.exec(paidBy)?.[1] ??
    findAccountMask(text.split('\n').slice(0, 10).join(' ')) ??
    null;

  return {
    format,
    bank: 'PHONEPE',
    layoutId: 'phonepe_statement',
    accountMask,
    transactions,
    warnings,
    metadata,
  };
}
