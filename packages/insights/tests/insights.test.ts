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

import { analyzeTransactions, RULE_IDS, type InsightTransaction } from '../src';

function txn(
  partial: Partial<InsightTransaction> & Pick<InsightTransaction, 'direction' | 'amountPaise'>,
): InsightTransaction {
  return { date: '2026-01-05', ...partial };
}

/** Three months of salary + rent + SIP + groceries — a clean profile. */
const SALARIED: readonly InsightTransaction[] = [
  txn({
    date: '2026-01-01',
    direction: 'CREDIT',
    amountPaise: 85_000_00,
    narration: 'NEFT-N111-SALARY-TCS LTD',
    is_salary: true,
  }),
  txn({
    date: '2026-02-01',
    direction: 'CREDIT',
    amountPaise: 85_000_00,
    narration: 'NEFT-N222-SALARY-TCS LTD',
    is_salary: true,
  }),
  txn({
    date: '2026-03-01',
    direction: 'CREDIT',
    amountPaise: 85_000_00,
    narration: 'NEFT-N333-SALARY-TCS LTD',
    is_salary: true,
  }),
  txn({
    date: '2026-01-05',
    direction: 'DEBIT',
    amountPaise: 22_000_00,
    narration: 'NACH-EMI-HDFC BANK-LOAN',
    counterparty: 'HDFC BANK',
  }),
  txn({
    date: '2026-02-05',
    direction: 'DEBIT',
    amountPaise: 22_000_00,
    narration: 'NACH-EMI-HDFC BANK-LOAN',
    counterparty: 'HDFC BANK',
  }),
  txn({
    date: '2026-03-05',
    direction: 'DEBIT',
    amountPaise: 22_000_00,
    narration: 'NACH-EMI-HDFC BANK-LOAN',
    counterparty: 'HDFC BANK',
  }),
  txn({
    date: '2026-01-10',
    direction: 'DEBIT',
    amountPaise: 5_000_00,
    narration: 'UPI-DR-LANDLORD RENT',
    counterparty: 'LANDLORD',
  }),
  txn({
    date: '2026-02-10',
    direction: 'DEBIT',
    amountPaise: 5_000_00,
    narration: 'UPI-DR-LANDLORD RENT',
    counterparty: 'LANDLORD',
  }),
  txn({
    date: '2026-03-10',
    direction: 'DEBIT',
    amountPaise: 5_000_00,
    narration: 'UPI-DR-LANDLORD RENT',
    counterparty: 'LANDLORD',
  }),
];

describe('income detection', () => {
  it('detects flagged salary credits with regular consistency', () => {
    const r = analyzeTransactions(SALARIED);
    expect(r.income.credits.length).toBe(3);
    expect(r.income.consistency).toBe('regular');
    expect(r.income.monthlyAveragePaise).toBe(85_000_00);
    expect(r.income.sources).toContain('TCS LTD');
    expect(r.income.monthsObserved).toBe(3);
  });

  it('detects salary by narration keyword without the flag', () => {
    const r = analyzeTransactions([
      txn({ direction: 'CREDIT', amountPaise: 60_000_00, narration: 'NEFT-SALARY CREDIT-ACME' }),
      txn({
        date: '2026-02-01',
        direction: 'CREDIT',
        amountPaise: 60_000_00,
        narration: 'NEFT-SALARY CREDIT-ACME',
      }),
    ]);
    expect(r.income.credits.length).toBe(2);
    expect(r.income.credits[0]!.basis).toBe('salary_keyword');
  });

  it('detects regular same-source credits as probable income', () => {
    const r = analyzeTransactions([
      txn({ direction: 'CREDIT', amountPaise: 45_000_00, counterparty: 'ACME PVT LTD' }),
      txn({
        date: '2026-02-01',
        direction: 'CREDIT',
        amountPaise: 45_100_00,
        counterparty: 'ACME PVT LTD',
      }),
      txn({
        date: '2026-03-01',
        direction: 'CREDIT',
        amountPaise: 44_900_00,
        counterparty: 'ACME PVT LTD',
      }),
    ]);
    expect(r.income.credits.length).toBe(3);
    expect(r.income.credits[0]!.basis).toBe('regular_credit');
    expect(r.income.consistency).toBe('regular');
  });

  it('reports insufficient_data when no income exists', () => {
    const r = analyzeTransactions([
      txn({ direction: 'DEBIT', amountPaise: 1_000_00, narration: 'UPI-DR-SWIGGY' }),
    ]);
    expect(r.income.credits.length).toBe(0);
    expect(r.income.consistency).toBe('insufficient_data');
    expect(r.income.monthlyAveragePaise).toBeNull();
  });
});

describe('recurring obligations and EMI', () => {
  it('detects recurring debits across months and flags EMI narrations', () => {
    const r = analyzeTransactions(SALARIED);
    expect(r.obligations.recurring.length).toBe(2);
    const emi = r.obligations.emis;
    expect(emi.length).toBe(1);
    expect(emi[0]!.counterparty).toBe('HDFC BANK');
    expect(emi[0]!.typicalAmountPaise).toBe(22_000_00);
    expect(r.obligations.monthlyObligationPaise).toBe(27_000_00);
  });

  it('ignores one-off debits and jittery amounts', () => {
    const r = analyzeTransactions([
      txn({ direction: 'DEBIT', amountPaise: 1_000_00, counterparty: 'X' }),
      txn({ direction: 'DEBIT', amountPaise: 2_000_00, counterparty: 'X' }),
      txn({ direction: 'DEBIT', amountPaise: 9_999_00, counterparty: 'X' }),
    ]);
    expect(r.obligations.recurring.length).toBe(0);
  });

  it('honours minRecurringOccurrences=2 for short statements', () => {
    const r = analyzeTransactions(
      [
        txn({ direction: 'DEBIT', amountPaise: 999_00, counterparty: 'NETFLIX' }),
        txn({
          date: '2026-02-05',
          direction: 'DEBIT',
          amountPaise: 999_00,
          counterparty: 'NETFLIX',
        }),
      ],
      { minRecurringOccurrences: 2 },
    );
    expect(r.obligations.recurring.length).toBe(1);
  });
});

describe('FOIR', () => {
  it('computes obligations ÷ income', () => {
    const r = analyzeTransactions(SALARIED);
    // 27,000 / 85,000 ≈ 0.318
    expect(r.foir.ratio).toBeCloseTo(0.318, 2);
  });

  it('returns null with a note when income is unknown', () => {
    const r = analyzeTransactions([
      txn({ direction: 'DEBIT', amountPaise: 1_000_00, narration: 'UPI-DR-X' }),
    ]);
    expect(r.foir.ratio).toBeNull();
    expect(r.foir.note).toContain('not computable');
  });
});

describe('cash-flow', () => {
  it('summarizes totals, net, and balance range', () => {
    const r = analyzeTransactions(
      SALARIED.map((t, i) => ({ ...t, balancePaise: (i + 1) * 1_000_00 })),
    );
    expect(r.cashflow.totalCreditsPaise).toBe(255_000_00);
    expect(r.cashflow.totalDebitsPaise).toBe(81_000_00);
    expect(r.cashflow.netPaise).toBe(174_000_00);
    expect(r.cashflow.minBalancePaise).toBe(1_000_00);
    expect(r.cashflow.maxBalancePaise).toBe(9_000_00);
    expect(r.cashflow.closingBalancePaise).toBe(9_000_00);
  });
});

describe('risk signals', () => {
  it('flags bounce/return narrations with evidence', () => {
    const r = analyzeTransactions([
      txn({
        direction: 'DEBIT',
        amountPaise: 5_000_00,
        narration: 'NACH RTN-EMI BOUNCE-INSUFFICIENT FUNDS',
      }),
      txn({ direction: 'DEBIT', amountPaise: 100_00, narration: 'RETURN CHG-NACH' }),
    ]);
    const sig = r.signals.find((s) => s.ruleId === RULE_IDS.BOUNCE);
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe('medium');
    expect(sig!.evidence[0]!.txnIndices).toEqual([0, 1]);
  });

  it('flags round-trip credit→debit pairs to the same counterparty', () => {
    const r = analyzeTransactions([
      txn({
        date: '2026-01-10',
        direction: 'CREDIT',
        amountPaise: 50_000_00,
        counterparty: 'RAHUL K',
      }),
      txn({
        date: '2026-01-12',
        direction: 'DEBIT',
        amountPaise: 50_000_00,
        counterparty: 'RAHUL K',
      }),
    ]);
    const sig = r.signals.find((s) => s.ruleId === RULE_IDS.ROUND_TRIP);
    expect(sig).toBeDefined();
    expect(sig!.evidence[0]!.txnIndices).toEqual([0, 1]);
  });

  it('does not flag far-apart or mismatched-amount pairs', () => {
    const r = analyzeTransactions([
      txn({
        date: '2026-01-10',
        direction: 'CREDIT',
        amountPaise: 50_000_00,
        counterparty: 'RAHUL K',
      }),
      txn({
        date: '2026-02-20',
        direction: 'DEBIT',
        amountPaise: 48_000_00,
        counterparty: 'RAHUL K',
      }),
    ]);
    expect(r.signals.find((s) => s.ruleId === RULE_IDS.ROUND_TRIP)).toBeUndefined();
  });

  it('flags self-transfer narrations', () => {
    const r = analyzeTransactions([
      txn({ direction: 'DEBIT', amountPaise: 10_000_00, narration: 'TRF TO SELF A/C' }),
      txn({ direction: 'CREDIT', amountPaise: 2_000_00, narration: 'UPI-CR-OWN ACCOUNT' }),
    ]);
    const sig = r.signals.find((s) => s.ruleId === RULE_IDS.SELF_TRANSFER);
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe('low');
  });
});

describe('robustness', () => {
  it('drops malformed rows with a warning, never throws', () => {
    const r = analyzeTransactions([
      txn({ direction: null, amountPaise: 1_000_00 }),
      txn({ direction: 'DEBIT', amountPaise: null }),
      txn({ direction: 'DEBIT', amountPaise: 500_00 }),
    ]);
    expect(r.analyzedTransactions).toBe(1);
    expect(r.warnings[0]).toContain('dropped');
  });

  it('handles an empty input array', () => {
    const r = analyzeTransactions([]);
    expect(r.analyzedTransactions).toBe(0);
    expect(r.income.credits.length).toBe(0);
    expect(r.foir.ratio).toBeNull();
    expect(r.signals.length).toBe(0);
  });

  it('is deterministic — same input, identical report', () => {
    const a = analyzeTransactions(SALARIED);
    const b = analyzeTransactions(SALARIED);
    expect(a).toEqual(b);
  });
});
