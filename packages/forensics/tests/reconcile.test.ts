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

import { reconcileWithAa, transactionsFromAaData } from '../src/reconcile';
import type { AaTransaction } from '../src/reconcile';
import type { ExtractedStatement, ExtractedTransaction } from '@paniniapi/extract';

function docTxn(
  date: string,
  narration: string,
  direction: 'DEBIT' | 'CREDIT',
  amountPaise: number,
  balancePaise: number,
): ExtractedTransaction {
  return {
    date,
    narration,
    refNumber: null,
    direction,
    amountPaise,
    balancePaise,
    raw: '',
    warnings: [],
  };
}

function statement(transactions: readonly ExtractedTransaction[]): ExtractedStatement {
  return {
    format: 'pdf',
    bank: null,
    layoutId: null,
    accountMask: null,
    transactions,
    warnings: [],
    metadata: {},
  };
}

function aaTxn(
  valueDate: string,
  type: 'DEBIT' | 'CREDIT',
  amount: string,
  narration: string,
  balance?: string,
): AaTransaction {
  return {
    txnId: `T${valueDate}${amount}`,
    amount,
    type,
    valueDate,
    narration,
    ...(balance !== undefined ? { currentBalance: balance } : {}),
  };
}

const DOC = () =>
  statement([
    docTxn('2026-10-15', 'UPI/SWIGGY', 'DEBIT', 10000, 90000),
    docTxn('2026-10-16', 'UPI/REFUND', 'CREDIT', 20000, 110000),
    docTxn('2026-10-17', 'UPI/AMAZON', 'DEBIT', 30000, 80000),
  ]);

const AA_TRUTH = (): AaTransaction[] => [
  aaTxn('2026-10-15', 'DEBIT', '100.00', 'UPI SWIGGY', '900.00'),
  aaTxn('2026-10-16', 'CREDIT', '200.00', 'UPI REFUND', '1100.00'),
  aaTxn('2026-10-17', 'DEBIT', '300.00', 'UPI AMAZON', '800.00'),
];

describe('reconcileWithAa', () => {
  it('reports consistent when document matches AA truth', () => {
    const r = reconcileWithAa(DOC(), AA_TRUTH());
    expect(r.verdict).toBe('consistent');
    expect(r.matchedRows).toBe(3);
    expect(r.documentOnlyRows).toEqual([]);
    expect(r.aaOnlyRows).toEqual([]);
  });

  it('flags fabricated rows the bank feed does not know', () => {
    const doc = DOC();
    doc.transactions.push(docTxn('2026-10-18', 'SALARY CREDIT', 'CREDIT', 5000000, 5080000));
    const r = reconcileWithAa(doc, AA_TRUTH());
    expect(r.verdict).toBe('fabrication_evidence');
    expect(r.documentOnlyRows).toEqual([3]);
    expect(r.summary).toContain('unknown to the bank feed');
  });

  it('flags bank transactions the document omits (hidden debits)', () => {
    const doc = statement([
      docTxn('2026-10-15', 'UPI/SWIGGY', 'DEBIT', 10000, 90000),
      docTxn('2026-10-16', 'UPI/REFUND', 'CREDIT', 20000, 110000),
    ]);
    const r = reconcileWithAa(doc, AA_TRUTH());
    expect(r.verdict).toBe('fabrication_evidence');
    expect(r.aaOnlyRows).toEqual([2]);
    expect(r.summary).toContain('omitted');
  });

  it('treats amount-altered rows as doc-only + aa-only', () => {
    const doc = DOC();
    // Fraudster inflates the refund: doc says 500.00, bank says 200.00.
    doc.transactions[1] = docTxn('2026-10-16', 'UPI/REFUND', 'CREDIT', 50000, 140000);
    const r = reconcileWithAa(doc, AA_TRUTH());
    expect(r.verdict).toBe('fabrication_evidence');
    expect(r.documentOnlyRows).toEqual([1]);
    expect(r.aaOnlyRows).toEqual([1]);
  });

  it('tolerates a one-day value/posting date difference', () => {
    const aa = AA_TRUTH();
    aa[0] = aaTxn('2026-10-16', 'DEBIT', '100.00', 'UPI SWIGGY', '900.00');
    const r = reconcileWithAa(DOC(), aa);
    expect(r.verdict).not.toBe('fabrication_evidence');
    expect(r.matchedRows).toBe(3);
  });

  it('soft-flags narration drift without raising fabrication evidence', () => {
    const aa = AA_TRUTH();
    aa[0] = aaTxn('2026-10-15', 'DEBIT', '100.00', 'UPI-SWIGGY BUNDY TECHNOLOGIES', '900.00');
    const r = reconcileWithAa(DOC(), aa);
    expect(r.verdict).toBe('partial');
    expect(r.mismatches.some((m) => m.field === 'narration' && m.severity === 'soft')).toBe(true);
  });

  it('soft-flags balance disagreement on a matched pair', () => {
    const aa = AA_TRUTH();
    aa[2] = aaTxn('2026-10-17', 'DEBIT', '300.00', 'UPI AMAZON', '799.99');
    const r = reconcileWithAa(DOC(), aa);
    expect(r.verdict).toBe('partial');
    expect(r.mismatches.some((m) => m.field === 'balance')).toBe(true);
  });

  it('marks document rows outside AA coverage as unverifiable, not suspect', () => {
    const doc = DOC();
    doc.transactions.push(docTxn('2026-11-20', 'LATER TXN', 'DEBIT', 5000, 75000));
    const r = reconcileWithAa(doc, AA_TRUTH());
    expect(r.verdict).toBe('consistent');
    expect(r.unverifiableRows).toEqual([3]);
    expect(r.documentOnlyRows).toEqual([]);
  });

  it('returns incomparable when either side is empty', () => {
    expect(reconcileWithAa(statement([]), AA_TRUTH()).verdict).toBe('incomparable');
    expect(reconcileWithAa(DOC(), []).verdict).toBe('incomparable');
  });

  it('is deterministic — same inputs, same report', () => {
    const doc = DOC();
    doc.transactions.push(docTxn('2026-10-18', 'FAKE', 'CREDIT', 100, 80100));
    expect(reconcileWithAa(doc, AA_TRUTH())).toEqual(reconcileWithAa(doc, AA_TRUTH()));
  });
});

describe('transactionsFromAaData', () => {
  it('extracts the ReBIT Account.Transactions.Transaction shape', () => {
    const fi = {
      Account: {
        maskedAccNumber: 'XXXX1234',
        Transactions: {
          startDate: '2026-10-01',
          endDate: '2026-10-31',
          Transaction: [
            { txnId: '1', amount: '100.00', type: 'DEBIT', valueDate: '2026-10-15' },
            { txnId: '2', amount: '200.00', type: 'CREDIT', valueDate: '2026-10-16' },
          ],
        },
      },
    };
    const txns = transactionsFromAaData(fi);
    expect(txns).toHaveLength(2);
    expect(txns[0]!.type).toBe('DEBIT');
  });

  it('accepts a bare transaction array', () => {
    const txns = transactionsFromAaData([
      { amount: '10.00', type: 'DEBIT', valueDate: '2026-10-15' },
    ]);
    expect(txns).toHaveLength(1);
  });

  it('returns [] for shapes without transactions', () => {
    expect(transactionsFromAaData({ Profile: { name: 'x' } })).toEqual([]);
    expect(transactionsFromAaData(null)).toEqual([]);
    expect(transactionsFromAaData('string')).toEqual([]);
  });
});
