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

import { detectMonitoringEvents, runMonitorCycle, statementDiff } from '../src/monitor';
import type { AlertSink, MonitorSnapshot, SnapshotStore, StatementSource } from '../src/monitor';
import { analyzeTransactions } from '../src/analyze';
import type { InsightTransaction } from '../src/types';

function txn(
  date: string,
  direction: 'DEBIT' | 'CREDIT',
  amountPaise: number,
  narration = 'X',
  balancePaise: number | null = null,
): InsightTransaction {
  return { date, direction, amountPaise, narration, balancePaise };
}

// Three months of salary + an EMI — a healthy baseline.
const BASELINE = (): InsightTransaction[] => [
  txn('2026-07-01', 'CREDIT', 6400000, 'SALARY ACME', 700000),
  txn('2026-07-05', 'DEBIT', 1800000, 'EMI HOMECREDIT', 520000),
  txn('2026-08-01', 'CREDIT', 6400000, 'SALARY ACME', 700000),
  txn('2026-08-05', 'DEBIT', 1800000, 'EMI HOMECREDIT', 520000),
  txn('2026-09-01', 'CREDIT', 6400000, 'SALARY ACME', 700000),
  txn('2026-09-05', 'DEBIT', 1800000, 'EMI HOMECREDIT', 520000),
];

const snap = (txns: InsightTransaction[], at = '2026-10-01T00:00:00Z'): MonitorSnapshot => ({
  capturedAt: at,
  transactions: txns,
  report: analyzeTransactions(txns),
});

describe('statementDiff', () => {
  it('identifies added, removed, and matched rows', () => {
    const prev = [txn('2026-10-01', 'DEBIT', 10000), txn('2026-10-02', 'DEBIT', 20000)];
    const curr = [txn('2026-10-01', 'DEBIT', 10000), txn('2026-10-03', 'CREDIT', 50000)];
    const d = statementDiff(prev, curr);
    expect(d.addedRows).toEqual([1]);
    expect(d.removedRows).toEqual([1]);
    expect(d.addedCreditsPaise).toBe(50000);
    expect(d.addedDebitsPaise).toBe(0);
  });

  it('handles duplicates as a multiset', () => {
    const prev = [txn('2026-10-01', 'DEBIT', 10000)];
    const curr = [txn('2026-10-01', 'DEBIT', 10000), txn('2026-10-01', 'DEBIT', 10000)];
    const d = statementDiff(prev, curr);
    expect(d.addedRows).toEqual([1]); // one matched, one added
  });
});

describe('detectMonitoringEvents', () => {
  it('emits only a baseline event on first capture', () => {
    const events = detectMonitoringEvents(null, snap(BASELINE()));
    expect(events).toEqual([
      expect.objectContaining({ ruleId: 'monitor.baseline', severity: 'info' }),
    ]);
  });

  it('fires income_source_lost when salary disappears', () => {
    const curr = BASELINE().filter((t) => !t.narration!.includes('SALARY'));
    const events = detectMonitoringEvents(snap(BASELINE()), snap(curr));
    expect(events.some((e) => e.ruleId === 'monitor.income_source_lost')).toBe(true);
  });

  it('fires balance_drop on a >30% closing-balance cliff', () => {
    const prev = [txn('2026-09-30', 'DEBIT', 10000, 'X', 1000000)];
    const curr = [txn('2026-10-30', 'DEBIT', 10000, 'X', 500000)];
    const events = detectMonitoringEvents(snap(prev), snap(curr));
    expect(events.some((e) => e.ruleId === 'monitor.balance_drop')).toBe(true);
  });

  it('fires new_obligation when a fresh EMI pattern appears', () => {
    const curr = [
      ...BASELINE(),
      txn('2026-07-10', 'DEBIT', 900000, 'EMI NEWLOAN', 400000),
      txn('2026-08-10', 'DEBIT', 900000, 'EMI NEWLOAN', 400000),
      txn('2026-09-10', 'DEBIT', 900000, 'EMI NEWLOAN', 400000),
    ];
    const events = detectMonitoringEvents(snap(BASELINE()), snap(curr));
    expect(events.some((e) => e.ruleId === 'monitor.new_obligation')).toBe(true);
  });

  it('is deterministic — same snapshots, same events', () => {
    const p = snap(BASELINE());
    const c = snap([...BASELINE(), txn('2026-10-01', 'DEBIT', 999000, 'BIG OUT')]);
    expect(detectMonitoringEvents(p, c)).toEqual(detectMonitoringEvents(p, c));
  });
});

describe('runMonitorCycle', () => {
  const makeStore = (): SnapshotStore & { data: Map<string, MonitorSnapshot> } => {
    const data = new Map<string, MonitorSnapshot>();
    return {
      data,
      async load(key) {
        return data.get(key) ?? null;
      },
      async save(key, snapshot) {
        data.set(key, snapshot);
      },
    };
  };

  it('captures a baseline on first cycle', async () => {
    const store = makeStore();
    const source: StatementSource = {
      name: 'fake',
      async fetch() {
        return BASELINE();
      },
    };
    const r = await runMonitorCycle({ key: 'acct-1', source, store });
    expect(r.events[0]!.ruleId).toBe('monitor.baseline');
    expect(r.diff).toBeNull();
    expect(store.data.has('acct-1')).toBe(true);
  });

  it('diffs against the stored snapshot and emits to the sink', async () => {
    const store = makeStore();
    await store.save('acct-1', snap(BASELINE()));
    const emitted: string[] = [];
    const sink: AlertSink = {
      name: 'test-sink',
      async emit(events) {
        emitted.push(...events.map((e) => e.ruleId));
      },
    };
    const source: StatementSource = {
      name: 'fake',
      async fetch() {
        return [...BASELINE(), txn('2026-10-02', 'DEBIT', 12000000, 'GIANT DEBIT')];
      },
    };
    const r = await runMonitorCycle({
      key: 'acct-1',
      source,
      store,
      sink,
      now: () => new Date('2026-10-03T00:00:00Z'),
    });
    expect(r.diff!.addedRows).toEqual([6]);
    expect(r.events.some((e) => e.ruleId === 'monitor.large_debit')).toBe(true);
    expect(emitted.length).toBeGreaterThan(0);
    expect(r.emittedTo).toBe('test-sink');
  });

  it('works without a sink — events are returned for the caller', async () => {
    const store = makeStore();
    const source: StatementSource = {
      name: 'fake',
      async fetch() {
        return BASELINE();
      },
    };
    const r = await runMonitorCycle({ key: 'a', source, store });
    expect(r.emittedTo).toBeNull();
    expect(r.events.length).toBeGreaterThan(0);
  });
});
