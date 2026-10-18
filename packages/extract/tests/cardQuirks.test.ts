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

import { statementFromFragments } from '../src/pdf/pdfStatement';

/** Header fragments: DATE | TRANSACTION DETAILS | AMOUNT (+ optional CREDIT flag col). */
const header = (withCredit = false) =>
  [
    { page: 0, x: 0, y: 500, text: 'Date' },
    { page: 0, x: 100, y: 500, text: 'Transaction Details' },
    ...(withCredit ? [{ page: 0, x: 380, y: 500, text: 'Credit' }] : []),
    { page: 0, x: 420, y: 500, text: 'Amount' },
  ] as const;

describe('card-statement column-collapse quirks', () => {
  it("axis-style cashback column: '500.00 DR 5.00' keeps the leading amount", () => {
    const frags = [
      ...header(),
      { page: 0, x: 0, y: 480, text: '15/09/2026' },
      { page: 0, x: 100, y: 480, text: 'AMAZON PAY INDIA' },
      { page: 0, x: 420, y: 480, text: '500.00' },
      { page: 0, x: 470, y: 480, text: 'DR' },
      { page: 0, x: 540, y: 480, text: '5.00' }, // cashback col collapses in
    ];
    const result = statementFromFragments(frags);
    const txn = result.transactions[0];
    expect(txn?.amountPaise).toBe(50000);
    expect(txn?.direction).toBe('DEBIT');
    expect(txn?.warnings.join(' ')).toContain('trailing fragments');
  });

  it("indusind-style trailing statement date: '508.06 DR 15/09/2026'", () => {
    const frags = [
      ...header(),
      { page: 0, x: 0, y: 480, text: '05/09/2026' },
      { page: 0, x: 100, y: 480, text: 'BOOKMYSHOW CINEMA' },
      { page: 0, x: 420, y: 480, text: '508.06' },
      { page: 0, x: 470, y: 480, text: 'DR' },
      { page: 0, x: 540, y: 480, text: '15/09/2026' },
    ];
    const result = statementFromFragments(frags);
    const txn = result.transactions[0];
    expect(txn?.amountPaise).toBe(50806);
    expect(txn?.direction).toBe('DEBIT');
    expect(txn?.date).toBe('2026-09-05');
  });

  it("hdfc-cc style '+' credit flag marks the row a credit", () => {
    const frags = [
      ...header(true),
      { page: 0, x: 0, y: 480, text: '25/10/2026' },
      { page: 0, x: 100, y: 480, text: 'PAYMENT RECEIVED' },
      { page: 0, x: 380, y: 480, text: '+' },
      { page: 0, x: 420, y: 480, text: '1,234.00' },
      { page: 0, x: 500, y: 480, text: 'l' }, // stray currency marker
    ];
    const result = statementFromFragments(frags);
    const txn = result.transactions[0];
    expect(txn?.amountPaise).toBe(123400);
    expect(txn?.direction).toBe('CREDIT');
  });

  it('single-letter C/D amount suffixes (sbi-card style) map direction', () => {
    const frags = [
      ...header(),
      { page: 0, x: 0, y: 480, text: '15 Oct 26' },
      { page: 0, x: 100, y: 480, text: 'AMAZON PAY INDIA' },
      { page: 0, x: 420, y: 480, text: '1,299.00 D' },
      { page: 0, x: 0, y: 470, text: '16 Oct 26' },
      { page: 0, x: 100, y: 470, text: 'PAYMENT RECEIVED' },
      { page: 0, x: 420, y: 470, text: '5,000.00 C' },
    ];
    const result = statementFromFragments(frags);
    expect(result.transactions[0]?.direction).toBe('DEBIT');
    expect(result.transactions[1]?.direction).toBe('CREDIT');
    expect(result.transactions[1]?.amountPaise).toBe(500000);
  });
});
