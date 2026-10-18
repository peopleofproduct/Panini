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

/**
 * Recurring-monitoring kernel — the open-ended answer to hosted
 * "smart collections" products.
 *
 * Monitoring is three separable concerns, and only one of them is
 * deterministic logic: (a) *getting* fresh data — the lender's own AA
 * contracts via `@paniniapi/fiu-client`, a TSP SDK, or file drops;
 * (b) *detecting what changed* — a pure function Panini owns; (c)
 * *delivering the alert* — webhooks, queues, LOS tickets, all caller
 * infrastructure. This module ships (b) plus thin seams for (a) and (c),
 * so a lender composes a complete monitor instead of inheriting a
 * half-built one:
 *
 *   source.fetch(key)  → store.load(key) → diff + analyze + rules →
 *   events → sink.emit(events) → store.save(snapshot)
 *
 * Everything deterministic lives in-library (snapshot diff, event
 * rules, insight comparison); everything operational stays a plug.
 */

import { analyzeTransactions } from './analyze';
import type { InsightsOptions, InsightsReport, InsightTransaction, RiskSignal } from './types';

/** A persisted monitoring snapshot — JSON-serializable by construction. */
export interface MonitorSnapshot {
  /** ISO timestamp of when this snapshot was captured (injected clock). */
  readonly capturedAt: string;
  readonly transactions: readonly InsightTransaction[];
  readonly report: InsightsReport;
}

/** Deterministic row diff between two snapshots. */
export interface StatementDiff {
  /** Indices into the current transactions present now but not before. */
  readonly addedRows: readonly number[];
  /** Indices into the previous transactions no longer present. */
  readonly removedRows: readonly number[];
  readonly addedDebitsPaise: number;
  readonly addedCreditsPaise: number;
}

/**
 * Multiset match on (date, direction, amountPaise) — deterministic,
 * O(n·m). Narration is deliberately excluded: the same transaction can
 * render differently across feeds, but identical date+amount+direction
 * is a strong identity for monitoring purposes.
 */
export function statementDiff(
  previous: readonly InsightTransaction[],
  current: readonly InsightTransaction[],
): StatementDiff {
  const pool = [...previous];
  const used = new Array<boolean>(pool.length).fill(false);
  const added: number[] = [];
  let addedDebits = 0;
  let addedCredits = 0;

  for (const [i, row] of current.entries()) {
    const hit = pool.findIndex(
      (p, j) =>
        !used[j] &&
        p.date === row.date &&
        p.direction === row.direction &&
        p.amountPaise === row.amountPaise,
    );
    if (hit === -1) {
      added.push(i);
      if (row.direction === 'DEBIT' && row.amountPaise !== null) addedDebits += row.amountPaise;
      if (row.direction === 'CREDIT' && row.amountPaise !== null) addedCredits += row.amountPaise;
    } else {
      used[hit] = true;
    }
  }
  const removed: number[] = [];
  used.forEach((u, j) => {
    if (!u) removed.push(j);
  });
  return {
    addedRows: added,
    removedRows: removed,
    addedDebitsPaise: addedDebits,
    addedCreditsPaise: addedCredits,
  };
}

export type MonitorEventSeverity = 'info' | 'medium' | 'high';

export interface MonitoringEvent {
  readonly ruleId: string;
  readonly severity: MonitorEventSeverity;
  readonly note: string;
  /** Indices into the current snapshot's transactions, where applicable. */
  readonly txnIndices: readonly number[];
}

/** Tunable thresholds — every number a lender's risk team may disagree with. */
export interface MonitorRules {
  /** Closing-balance drop fraction that fires monitor.balance_drop. Default 0.3 (30%). */
  readonly balanceDropFraction?: number;
  /** Single added debit above this multiple of the previous median debit
   *  fires monitor.large_debit. Default 5. */
  readonly largeDebitMultiple?: number;
  /** Absolute floor for large_debit, paise. Default 5,00,000 paise (₹5,000). */
  readonly largeDebitFloorPaise?: number;
  /** Insights options forwarded to each snapshot's analysis. */
  readonly insights?: InsightsOptions;
}

/**
 * Compare two snapshots and emit rule-Id'd monitoring events.
 * Pure function — same inputs, same events. prev=null is a baseline
 * capture: no comparison events, just the anchor.
 */
export function detectMonitoringEvents(
  previous: MonitorSnapshot | null,
  current: MonitorSnapshot,
  rules: MonitorRules = {},
): readonly MonitoringEvent[] {
  const events: MonitoringEvent[] = [];
  if (previous === null) {
    events.push({
      ruleId: 'monitor.baseline',
      severity: 'info',
      note: `baseline captured — ${current.transactions.length} rows, no comparison history`,
      txnIndices: [],
    });
    return events;
  }

  const diff = statementDiff(previous.transactions, current.transactions);
  if (diff.addedRows.length > 0) {
    events.push({
      ruleId: 'monitor.new_activity',
      severity: 'info',
      note:
        `${diff.addedRows.length} new rows since ${previous.capturedAt} ` +
        `(+₹${(diff.addedCreditsPaise / 100).toFixed(2)} / −₹${(diff.addedDebitsPaise / 100).toFixed(2)})`,
      txnIndices: diff.addedRows,
    });
  }

  // Income sources that existed and are now gone.
  const prevSources = new Set(previous.report.income.sources);
  const currSources = new Set(current.report.income.sources);
  const lost = [...prevSources].filter((s) => !currSources.has(s));
  if (lost.length > 0) {
    events.push({
      ruleId: 'monitor.income_source_lost',
      severity: 'high',
      note: `income sources absent in current snapshot: ${lost.join(', ')}`,
      txnIndices: [],
    });
  }

  // Closing-balance cliff.
  const dropFrac = rules.balanceDropFraction ?? 0.3;
  const prevClose = previous.report.cashflow.closingBalancePaise;
  const currClose = current.report.cashflow.closingBalancePaise;
  if (
    prevClose !== null &&
    currClose !== null &&
    prevClose > 0 &&
    currClose < prevClose * (1 - dropFrac)
  ) {
    events.push({
      ruleId: 'monitor.balance_drop',
      severity: 'high',
      note:
        `closing balance fell from ₹${(prevClose / 100).toFixed(2)} to ` +
        `₹${(currClose / 100).toFixed(2)} (>${Math.round(dropFrac * 100)}% drop)`,
      txnIndices: [],
    });
  }

  // Obligations appearing / disappearing.
  const prevEmis = new Set(previous.report.obligations.emis.map((e) => e.counterparty));
  const currEmis = new Set(current.report.obligations.emis.map((e) => e.counterparty));
  const newEmis = [...currEmis].filter((e) => !prevEmis.has(e));
  const stoppedEmis = [...prevEmis].filter((e) => !currEmis.has(e));
  if (newEmis.length > 0) {
    events.push({
      ruleId: 'monitor.new_obligation',
      severity: 'medium',
      note: `new recurring obligation(s) detected: ${newEmis.join(', ')}`,
      txnIndices: [],
    });
  }
  if (stoppedEmis.length > 0) {
    events.push({
      ruleId: 'monitor.obligation_stopped',
      severity: 'medium',
      note:
        `obligation(s) no longer recurring: ${stoppedEmis.join(', ')} ` +
        `(closed early — or bounced)`,
      txnIndices: [],
    });
  }

  // Newly-fired risk signals (bounce/round-trip/self-transfer classes).
  const prevRules = new Set(previous.report.signals.map((s) => s.ruleId));
  const newSignals = current.report.signals.filter((s) => !prevRules.has(s.ruleId));
  for (const s of newSignals) {
    events.push({
      ruleId: `monitor.signal:${s.ruleId}`,
      severity: signalSeverity(s),
      note: `new risk signal ${s.ruleId}: ${s.note}`,
      txnIndices: s.evidence.flatMap((e) => [...e.txnIndices]),
    });
  }

  // Outlier single debits among the added rows.
  const mult = rules.largeDebitMultiple ?? 5;
  const floor = rules.largeDebitFloorPaise ?? 500_000;
  const prevDebits = previous.transactions
    .filter((t) => t.direction === 'DEBIT' && t.amountPaise !== null)
    .map((t) => t.amountPaise as number)
    .sort((a, b) => a - b);
  const median = prevDebits.length > 0 ? prevDebits[Math.floor(prevDebits.length / 2)]! : 0;
  const threshold = Math.max(floor, median * mult);
  const outliers = diff.addedRows.filter((i) => {
    const t = current.transactions[i]!;
    return t.direction === 'DEBIT' && t.amountPaise !== null && t.amountPaise > threshold;
  });
  if (outliers.length > 0) {
    events.push({
      ruleId: 'monitor.large_debit',
      severity: 'medium',
      note:
        `${outliers.length} added debit(s) above ₹${(threshold / 100).toFixed(2)} ` +
        `(median-debit×${mult} or floor)`,
      txnIndices: outliers,
    });
  }
  return events;
}

function signalSeverity(s: RiskSignal): MonitorEventSeverity {
  return s.severity === 'high' ? 'high' : s.severity === 'medium' ? 'medium' : 'info';
}

/* ------------------------------------------------------------------ */
/* Caller-owned seams — the complete product is a composition           */
/* ------------------------------------------------------------------ */

/**
 * How fresh data arrives. Implementations are caller-owned:
 * wrap `fiu-client` for direct-AA pulls, a TSP SDK for contracted
 * orchestration, or a file-drop reader for manual batches.
 */
export interface StatementSource {
  readonly name: string;
  fetch(key: string): Promise<readonly InsightTransaction[]>;
}

/**
 * Where snapshots persist between cycles — the lender's database,
 * an S3 bucket, Redis, anything. Two methods is the whole contract.
 */
export interface SnapshotStore {
  load(key: string): Promise<MonitorSnapshot | null>;
  save(key: string, snapshot: MonitorSnapshot): Promise<void>;
}

/** Where events go — webhook, queue, LOS ticket, pager. Optional:
 *  omit it and collect the returned events yourself. */
export interface AlertSink {
  readonly name: string;
  emit(events: readonly MonitoringEvent[]): Promise<void>;
}

export interface MonitorCycleOptions {
  /** Identity of the monitored account in the store/source. */
  readonly key: string;
  readonly source: StatementSource;
  readonly store: SnapshotStore;
  readonly sink?: AlertSink;
  readonly rules?: MonitorRules;
  /** Injected clock for deterministic tests/replay. Default Date.now. */
  readonly now?: () => Date;
}

export interface MonitorCycleResult {
  readonly snapshot: MonitorSnapshot;
  readonly diff: StatementDiff | null;
  readonly events: readonly MonitoringEvent[];
  readonly emittedTo: string | null;
}

/**
 * One monitoring cycle: fetch → diff vs stored snapshot → detect →
 * emit → persist. Never throws for empty sources (empty diff = no
 * events beyond baseline); seam failures propagate to the caller —
 * monitoring infrastructure failures should be loud, not swallowed.
 */
export async function runMonitorCycle(opts: MonitorCycleOptions): Promise<MonitorCycleResult> {
  const now = opts.now ?? (() => new Date());
  const transactions = await opts.source.fetch(opts.key);
  const previous = await opts.store.load(opts.key);
  const report = analyzeTransactions([...transactions], opts.rules?.insights);
  const snapshot: MonitorSnapshot = {
    capturedAt: now().toISOString(),
    transactions,
    report,
  };
  const diff = previous === null ? null : statementDiff(previous.transactions, transactions);
  const events = detectMonitoringEvents(previous, snapshot, opts.rules ?? {});
  let emittedTo: string | null = null;
  if (opts.sink !== undefined && events.length > 0) {
    await opts.sink.emit(events);
    emittedTo = opts.sink.name;
  }
  await opts.store.save(opts.key, snapshot);
  return { snapshot, diff, events, emittedTo };
}
