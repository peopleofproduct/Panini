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

import { counterpartyFlows, detectConductMetrics } from '../src';
import type { InsightTransaction } from '../src';

const R = 100;
const txn = (p: Partial<InsightTransaction>): InsightTransaction => ({
  date: '2024-01-15',
  direction: 'CREDIT',
  amountPaise: 1000 * R,
  ...p,
});

describe('counterpartyFlows', () => {
  it('aggregates in/out/net per counterparty, largest volume first', () => {
    const report = counterpartyFlows([
      txn({ counterparty: 'ACME CORP', amountPaise: 80_000 * R }),
      txn({ counterparty: 'Swiggy', direction: 'DEBIT', amountPaise: 500 * R }),
      txn({ counterparty: 'ACME CORP', amountPaise: 80_000 * R, date: '2024-02-01' }),
      txn({ counterparty: 'swiggy', direction: 'DEBIT', amountPaise: 300 * R }),
    ]);
    expect(report.flows[0]!.counterparty).toBe('ACME CORP');
    expect(report.flows[0]!.inflowPaise).toBe(160_000 * R);
    expect(report.flows[1]!.counterparty).toBe('SWIGGY');
    expect(report.flows[1]!.outflowPaise).toBe(800 * R);
    expect(report.flows[1]!.netPaise).toBe(-800 * R);
    expect(report.flows[1]!.txnIndices).toEqual([1, 3]);
  });

  it('counts unattributed rows honestly', () => {
    const report = counterpartyFlows([
      txn({ counterparty: 'KNOWN', amountPaise: 5000 * R }),
      txn({ narration: '1234 5678 9012', amountPaise: 100 * R }),
    ]);
    expect(report.unattributedCount).toBe(1);
    expect(report.flows).toHaveLength(1);
  });

  it('respects the top limit', () => {
    const txns = Array.from({ length: 30 }, (_, i) =>
      txn({ counterparty: `CP-${i}`, amountPaise: (i + 1) * 1000 * R }),
    );
    expect(counterpartyFlows(txns, { top: 5 }).flows).toHaveLength(5);
  });

  it('tracks first/last seen per counterparty', () => {
    const report = counterpartyFlows([
      txn({ counterparty: 'X', date: '2024-03-10' }),
      txn({ counterparty: 'X', date: '2024-01-05' }),
      txn({ counterparty: 'X', date: '2024-02-20' }),
    ]);
    const f = report.flows[0]!;
    expect(f.firstSeen).toBe('2024-01-05');
    expect(f.lastSeen).toBe('2024-03-10');
  });
});

describe('detectConductMetrics', () => {
  it('counts overdrawn EOD days and worst overdraft', () => {
    const { metrics } = detectConductMetrics([
      txn({ date: '2024-01-05', balancePaise: 5000 * R }),
      txn({
        date: '2024-01-05',
        direction: 'DEBIT',
        amountPaise: 8000 * R,
        balancePaise: -3000 * R,
      }),
      txn({
        date: '2024-01-06',
        direction: 'DEBIT',
        amountPaise: 500 * R,
        balancePaise: -3500 * R,
      }),
      txn({ date: '2024-01-07', amountPaise: 10_000 * R, balancePaise: 6500 * R }),
    ]);
    expect(metrics.overdrawnDays).toBe(2); // Jan 5 EOD −3000, Jan 6 −3500; Jan 7 positive
    expect(metrics.worstOverdraftPaise).toBe(-3500 * R);
  });

  it('computes bounce rate against debits', () => {
    const { metrics } = detectConductMetrics([
      txn({ date: '2024-01-05', amountPaise: 50_000 * R }),
      txn({
        date: '2024-01-06',
        direction: 'DEBIT',
        amountPaise: 5000 * R,
        narration: 'NACH RTN CHG',
      }),
      txn({
        date: '2024-01-07',
        direction: 'DEBIT',
        amountPaise: 1000 * R,
        narration: 'UPI-SWIGGY',
      }),
      txn({
        date: '2024-01-08',
        direction: 'DEBIT',
        amountPaise: 500 * R,
        narration: 'ECS RETURN',
      }),
      txn({ date: '2024-01-09', direction: 'DEBIT', amountPaise: 200 * R, narration: 'UPI-UBER' }),
    ]);
    expect(metrics.bounceCount).toBe(2);
    expect(metrics.bounceRatePct).toBe(50); // 2 of 4 debits
  });

  it('emits a conduct signal when overdrawn days accumulate', () => {
    const txns: InsightTransaction[] = [];
    for (let d = 1; d <= 10; d++) {
      txns.push(
        txn({
          date: `2024-01-${String(d).padStart(2, '0')}`,
          direction: 'DEBIT',
          amountPaise: 100 * R,
          balancePaise: -500 * R,
        }),
      );
    }
    const { signals } = detectConductMetrics(txns);
    expect(signals[0]!.note).toContain('overdrawn');
  });

  it('clean account → no signals, null-safe metrics', () => {
    const { metrics, signals } = detectConductMetrics([
      txn({ date: '2024-01-05', amountPaise: 45_231 * R, balancePaise: 60_000 * R }),
      txn({
        date: '2024-01-06',
        direction: 'DEBIT',
        amountPaise: 1_234 * R,
        balancePaise: 58_766 * R,
      }),
    ]);
    expect(metrics.overdrawnDays).toBe(0);
    expect(metrics.bounceCount).toBe(0);
    expect(metrics.averageEodBalancePaise).not.toBeNull();
    expect(signals).toHaveLength(0);
  });
});
