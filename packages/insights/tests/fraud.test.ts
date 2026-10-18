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

import {
  consolidateAccounts,
  detectFraudIndicators,
  detectPortfolioIndicators,
  FRAUD_RULE_IDS,
} from '../src';
import type { InsightTransaction } from '../src';

const R = 100; // ₹1 in paise

function txn(partial: Partial<InsightTransaction>): InsightTransaction {
  return { date: '2024-01-15', direction: 'CREDIT', amountPaise: 1000 * R, ...partial };
}

function ids(report: { indicators: readonly { ruleId: string }[] }): string[] {
  return report.indicators.map((i) => i.ruleId);
}

describe('detectFraudIndicators', () => {
  it('flags same-amount credit→debit pairs via different counterparties', () => {
    const report = detectFraudIndicators([
      txn({ date: '2024-01-10', amountPaise: 50_000 * R, narration: 'NEFT FROM ALPHA TRADERS' }),
      txn({
        date: '2024-01-11',
        direction: 'DEBIT',
        amountPaise: 50_000 * R,
        narration: 'NEFT TO BETA HOLDINGS',
      }),
    ]);
    expect(ids(report)).toContain(FRAUD_RULE_IDS.CIRCULAR_PAIR);
  });

  it('does not double-flag same-counterparty mirrors (round-trip rule owns those)', () => {
    const report = detectFraudIndicators([
      txn({ date: '2024-01-10', amountPaise: 50_000 * R, narration: 'NEFT FROM ALPHA TRADERS' }),
      txn({
        date: '2024-01-11',
        direction: 'DEBIT',
        amountPaise: 50_000 * R,
        narration: 'NEFT TO ALPHA TRADERS',
      }),
    ]);
    expect(ids(report)).not.toContain(FRAUD_RULE_IDS.CIRCULAR_PAIR);
  });

  it('flags cash deposits dated on weekends', () => {
    // 2024-01-13 is a Saturday.
    const report = detectFraudIndicators([
      txn({ date: '2024-01-13', narration: 'CASH DEP SELF' }),
      txn({ date: '2024-01-14', narration: 'CASH DEPOSIT AT BRANCH' }),
      txn({ date: '2024-01-15', narration: 'CASH DEP' }),
    ]);
    const ind = report.indicators.find((i) => i.ruleId === FRAUD_RULE_IDS.HOLIDAY_CASH);
    expect(ind).toBeDefined();
    expect(ind!.evidence[0]!.txnIndices).toHaveLength(2); // Sat + Sun, not Monday
  });

  it('honours a supplied holiday list', () => {
    const report = detectFraudIndicators(
      [txn({ date: '2024-01-26', narration: 'CASH DEP' })], // Friday — Republic Day
      { holidays: ['2024-01-26'] },
    );
    expect(ids(report)).toContain(FRAUD_RULE_IDS.HOLIDAY_CASH);
  });

  it('flags RTGS narrations below the ₹2L floor', () => {
    const report = detectFraudIndicators([
      txn({ amountPaise: 150_000 * R, narration: 'RTGS-UTR123-VENDOR PAYMENT' }),
      txn({ amountPaise: 250_000 * R, narration: 'RTGS-UTR456-GENUINE LARGE' }),
    ]);
    const ind = report.indicators.find((i) => i.ruleId === FRAUD_RULE_IDS.RTGS_BELOW_FLOOR);
    expect(ind!.evidence[0]!.txnIndices).toEqual([0]);
  });

  it('flags round-figure clustering among large transactions', () => {
    const txns: InsightTransaction[] = [];
    for (let i = 0; i < 8; i++) {
      txns.push(txn({ date: `2024-01-${10 + i}`, amountPaise: 20_000 * R }));
    }
    txns.push(txn({ date: '2024-02-01', amountPaise: 12_345 * R }));
    txns.push(txn({ date: '2024-02-02', amountPaise: 9_876 * R }));
    const report = detectFraudIndicators(txns);
    expect(ids(report)).toContain(FRAUD_RULE_IDS.ROUND_FIGURES);
  });

  it('flags zero-transaction months inside the covered span', () => {
    const report = detectFraudIndicators([
      txn({ date: '2024-01-10' }),
      txn({ date: '2024-01-20', direction: 'DEBIT' }),
      txn({ date: '2024-04-05' }),
      txn({ date: '2024-04-06', direction: 'DEBIT' }),
    ]);
    const gaps = report.indicators.filter((i) => i.ruleId === FRAUD_RULE_IDS.GAP_MONTH);
    expect(gaps.map((g) => g.note)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('2024-02'),
        expect.stringContaining('2024-03'),
      ]),
    );
  });

  it('flags wash months with near-equal inflow and outflow', () => {
    const report = detectFraudIndicators([
      txn({ date: '2024-01-05', amountPaise: 400_000 * R, narration: 'NEFT IN' }),
      txn({ date: '2024-01-10', amountPaise: 300_000 * R, narration: 'UPI IN' }),
      txn({ date: '2024-01-20', direction: 'DEBIT', amountPaise: 699_000 * R }),
      txn({ date: '2024-02-05', amountPaise: 100_000 * R }),
      txn({ date: '2024-02-10', direction: 'DEBIT', amountPaise: 10_000 * R }),
    ]);
    const wash = report.indicators.find((i) => i.ruleId === FRAUD_RULE_IDS.WASH_MONTH);
    expect(wash!.evidence[0]!.note).toContain('2024-01');
  });

  it('flags salary credits that stop before the statement ends', () => {
    const txns: InsightTransaction[] = [
      txn({ date: '2024-01-01', amountPaise: 75_000 * R, is_salary: true }),
      txn({ date: '2024-02-01', amountPaise: 75_000 * R, is_salary: true }),
      txn({ date: '2024-03-01', amountPaise: 75_000 * R, is_salary: true }),
      txn({ date: '2024-05-15', direction: 'DEBIT', amountPaise: 5_000 * R }),
    ];
    const report = detectFraudIndicators(txns);
    const stop = report.indicators.find((i) => i.ruleId === FRAUD_RULE_IDS.SALARY_STOP);
    expect(stop!.note).toContain('absent after 2024-03');
  });

  it('flags large debits stripping each salary credit', () => {
    const txns: InsightTransaction[] = [];
    for (const m of ['01', '02', '03']) {
      txns.push(txn({ date: `2024-${m}-01`, amountPaise: 80_000 * R, is_salary: true }));
      txns.push(
        txn({
          date: `2024-${m}-02`,
          direction: 'DEBIT',
          amountPaise: 78_000 * R,
          narration: 'NEFT TO X',
        }),
      );
    }
    const report = detectFraudIndicators(txns);
    expect(ids(report)).toContain(FRAUD_RULE_IDS.SALARY_STRIP);
  });

  it('flags dormant-period → large-credit spikes', () => {
    const report = detectFraudIndicators([
      txn({ date: '2024-01-05', amountPaise: 10_000 * R }),
      txn({ date: '2024-01-10', amountPaise: 12_000 * R }),
      txn({ date: '2024-03-20', amountPaise: 500_000 * R }),
    ]);
    expect(ids(report)).toContain(FRAUD_RULE_IDS.DORMANT_SPIKE);
  });

  it('flags overdrawn balance rows', () => {
    const report = detectFraudIndicators([
      txn({ date: '2024-01-05', balancePaise: 10_000 * R }),
      txn({
        date: '2024-01-06',
        direction: 'DEBIT',
        amountPaise: 20_000 * R,
        balancePaise: -10_000 * R,
      }),
      txn({
        date: '2024-01-07',
        direction: 'DEBIT',
        amountPaise: 1_000 * R,
        balancePaise: -11_000 * R,
      }),
    ]);
    const od = report.indicators.find((i) => i.ruleId === FRAUD_RULE_IDS.OVERDRAWN_DAYS);
    expect(od!.evidence[0]!.txnIndices).toEqual([1, 2]);
  });

  it('flags repeated minimum-balance penalties', () => {
    const report = detectFraudIndicators([
      txn({
        date: '2024-01-31',
        direction: 'DEBIT',
        amountPaise: 590 * R,
        narration: 'MIN BAL CHG',
      }),
      txn({
        date: '2024-02-29',
        direction: 'DEBIT',
        amountPaise: 590 * R,
        narration: 'NON MAINTENANCE CHARGE',
      }),
    ]);
    expect(ids(report)).toContain(FRAUD_RULE_IDS.PENALTY_CHARGES);
  });

  it('clean statements produce no indicators', () => {
    const report = detectFraudIndicators([
      txn({ date: '2024-01-02', amountPaise: 45_231 * R, narration: 'NEFT SALARY ACME CORP' }),
      txn({
        date: '2024-01-03',
        direction: 'DEBIT',
        amountPaise: 12_345 * R,
        narration: 'UPI-SWIGGY',
      }),
      txn({
        date: '2024-01-05',
        direction: 'DEBIT',
        amountPaise: 3_210 * R,
        narration: 'UPI-UBER',
      }),
    ]);
    expect(report.indicators).toHaveLength(0);
  });

  it('skips malformed rows with a warning instead of throwing', () => {
    const report = detectFraudIndicators([
      txn({}),
      { date: '2024-01-01', direction: null, amountPaise: 100 } as InsightTransaction,
    ]);
    expect(report.warnings[0]).toContain('skipped');
  });
});

describe('consolidateAccounts', () => {
  const acct = (key: string, txns: InsightTransaction[]) => ({
    accountKey: key,
    transactions: txns,
  });

  it('detects inter-account transfers and nets them out', () => {
    const report = consolidateAccounts([
      acct('A', [txn({ date: '2024-01-10', direction: 'DEBIT', amountPaise: 60_000 * R })]),
      acct('B', [txn({ date: '2024-01-11', amountPaise: 60_000 * R })]),
    ]);
    expect(report.internalTransfers).toHaveLength(1);
    expect(report.internalTransfers[0]).toMatchObject({
      fromAccount: 'A',
      toAccount: 'B',
      amountPaise: 60_000 * R,
    });
    expect(report.consolidated.externalCreditsPaise).toBe(0);
    expect(report.consolidated.externalDebitsPaise).toBe(0);
    expect(report.consolidated.internalVolumePaise).toBe(60_000 * R);
  });

  it('does not match transfers within the same account', () => {
    const report = consolidateAccounts([
      acct('A', [
        txn({ date: '2024-01-10', direction: 'DEBIT', amountPaise: 60_000 * R }),
        txn({ date: '2024-01-11', amountPaise: 60_000 * R }),
      ]),
    ]);
    expect(report.internalTransfers).toHaveLength(0);
  });

  it('flags duplicate refNo rows across overlapping statements', () => {
    const report = consolidateAccounts([
      acct('A-jan', [txn({ date: '2024-01-10', refNo: 'UTR12345678' })]),
      acct('A-feb', [txn({ date: '2024-01-10', refNo: 'UTR12345678' })]),
    ]);
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]!.refNo).toBe('UTR12345678');
  });

  it('computes per-account rollups with period bounds', () => {
    const report = consolidateAccounts([
      {
        accountMask: 'XX1234',
        bank: 'HDFC',
        transactions: [
          txn({ date: '2024-01-05' }),
          txn({ date: '2024-03-15', direction: 'DEBIT' }),
        ],
      },
    ]);
    const a = report.accounts[0]!;
    expect(a.accountKey).toBe('HDFC-XX1234');
    expect(a.periodStart).toBe('2024-01-05');
    expect(a.periodEnd).toBe('2024-03-15');
  });
});

describe('detectPortfolioIndicators', () => {
  const acct = (key: string, txns: InsightTransaction[]) => ({
    accountKey: key,
    transactions: txns,
  });

  it('flags money rotating A→B→A', () => {
    const report = detectPortfolioIndicators([
      acct('A', [
        txn({ date: '2024-01-10', direction: 'DEBIT', amountPaise: 50_000 * R }),
        txn({ date: '2024-01-12', amountPaise: 50_000 * R }),
      ]),
      acct('B', [
        txn({ date: '2024-01-10', amountPaise: 50_000 * R }),
        txn({ date: '2024-01-12', direction: 'DEBIT', amountPaise: 50_000 * R }),
      ]),
    ]);
    expect(ids(report)).toContain(FRAUD_RULE_IDS.CROSS_ACCOUNT_CYCLE);
  });

  it('flags turnover inflated by own-account transfers', () => {
    const report = detectPortfolioIndicators([
      acct('A', [
        txn({ date: '2024-01-05', direction: 'DEBIT', amountPaise: 40_000 * R }),
        txn({ date: '2024-01-10', direction: 'DEBIT', amountPaise: 40_000 * R }),
        txn({ date: '2024-01-15', direction: 'DEBIT', amountPaise: 40_000 * R }),
        txn({ date: '2024-01-20', amountPaise: 10_000 * R }), // external
      ]),
      acct('B', [
        txn({ date: '2024-01-05', amountPaise: 40_000 * R }),
        txn({ date: '2024-01-10', amountPaise: 40_000 * R }),
        txn({ date: '2024-01-15', amountPaise: 40_000 * R }),
      ]),
    ]);
    const ind = report.indicators.find((i) => i.ruleId === FRAUD_RULE_IDS.INFLATED_TURNOVER);
    expect(ind).toBeDefined();
    expect(ind!.note).toContain('92%'); // 120k internal of 130k raw credits
  });
});
