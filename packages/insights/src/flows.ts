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

import { counterpartyKey, epochDay } from './analyze';
import type { Evidence, InsightTransaction, RiskSignal } from './types';

export const FLOW_RULE_IDS = {
  COUNTERPARTY: 'PANINI-FLOW-CP-001',
  CONDUCT: 'PANINI-CONDUCT-001',
} as const;

/** One counterparty's aggregate flow — the money-trail row an analyst reads. */
export interface CounterpartyFlow {
  readonly counterparty: string;
  readonly inflowPaise: number;
  readonly outflowPaise: number;
  /** inflow − outflow: positive means the counterparty pays this account. */
  readonly netPaise: number;
  readonly txnCount: number;
  /** Evidence indices back into the input array. */
  readonly txnIndices: readonly number[];
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
}

export interface CounterpartyFlowReport {
  /** Sorted by total volume (inflow+outflow), largest first. */
  readonly flows: readonly CounterpartyFlow[];
  /** Rows with no resolvable counterparty — they're excluded from `flows`
   *  but still counted here so coverage is honest. */
  readonly unattributedCount: number;
  readonly warnings: readonly string[];
}

/**
 * Aggregates transactions into per-counterparty in/out/net totals —
 * deterministic money-flow data (the kernel behind "money trail"
 * products). Grouping key is the same normalization the insights engine
 * uses: merchant → counterparty → narration tail.
 */
export function counterpartyFlows(
  transactions: readonly InsightTransaction[],
  options?: { readonly top?: number },
): CounterpartyFlowReport {
  const warnings: string[] = [];
  const groups = new Map<
    string,
    { inflow: number; outflow: number; idx: number[]; first: string | null; last: string | null }
  >();
  let unattributed = 0;
  for (const [index, txn] of transactions.entries()) {
    if (txn === null || txn === undefined) continue;
    if (
      txn.direction === null ||
      txn.direction === undefined ||
      txn.amountPaise === null ||
      txn.amountPaise === undefined ||
      !Number.isFinite(txn.amountPaise)
    )
      continue;
    const key = counterpartyKey(txn);
    if (key === null) {
      unattributed++;
      continue;
    }
    const g = groups.get(key) ?? { inflow: 0, outflow: 0, idx: [], first: null, last: null };
    if (txn.direction === 'CREDIT') g.inflow += txn.amountPaise;
    else g.outflow += txn.amountPaise;
    g.idx.push(index);
    const day = epochDay(txn.date);
    if (day !== null) {
      const iso = txn.date!.slice(0, 10);
      if (g.first === null || iso < g.first) g.first = iso;
      if (g.last === null || iso > g.last) g.last = iso;
    }
    groups.set(key, g);
  }
  const flows: CounterpartyFlow[] = [...groups.entries()].map(([counterparty, g]) => ({
    counterparty,
    inflowPaise: g.inflow,
    outflowPaise: g.outflow,
    netPaise: g.inflow - g.outflow,
    txnCount: g.idx.length,
    txnIndices: g.idx,
    firstSeen: g.first,
    lastSeen: g.last,
  }));
  flows.sort((a, b) => b.inflowPaise + b.outflowPaise - (a.inflowPaise + a.outflowPaise));
  const top = options?.top;
  return {
    flows: top !== undefined ? flows.slice(0, top) : flows,
    unattributedCount: unattributed,
    warnings,
  };
}

/** Account-conduct metrics — the behavioural numbers underwriters pull
 *  from OD/CC accounts and bounce history. */
export interface ConductMetrics {
  /** Transaction rows carrying a negative running balance. */
  readonly overdrawnDays: number;
  /** Deepest negative balance observed, paise. */
  readonly worstOverdraftPaise: number | null;
  /** Mean of end-of-day balances (last balance seen per day), paise. */
  readonly averageEodBalancePaise: number | null;
  /** Coefficient of variation of EOD balances, percent. */
  readonly eodVolatilityPct: number | null;
  /** Bounce/return narrations as a share of all debits, percent. */
  readonly bounceRatePct: number | null;
  readonly bounceCount: number;
  /** Days covered by dated transactions. */
  readonly daysCovered: number;
  /** Cheque/ECS/NACH return charges detected (fee rows, not the bounce itself). */
  readonly returnChargeCount: number;
  readonly evidence: readonly Evidence[];
}

const BOUNCE_NARR_RE =
  /\b(bounce[ds]?|dishonou?r(?:ed)?|insufficient\s*funds?|unpaid|return\s*(?:chg|charge)|nach\s*(?:rtn|return)|ecs\s*(?:rtn|return)|chq\s*ret|cheque\s*ret|auto\s*debit\s*(?:fail|rej)|mandate\s*(?:fail|rej))\b/i;

/**
 * Deterministic account-conduct metrics — overdrawn days, EOD balance
 * stats, bounce rate. Complements the fraud-indicator suite: fraud flags
 * anomalies, conduct measures discipline.
 */
export function detectConductMetrics(transactions: readonly InsightTransaction[]): {
  metrics: ConductMetrics;
  signals: readonly RiskSignal[];
} {
  const usable = transactions.filter(
    (t): t is InsightTransaction =>
      t !== null &&
      t !== undefined &&
      t.amountPaise !== null &&
      t.amountPaise !== undefined &&
      Number.isFinite(t.amountPaise) &&
      t.direction !== null &&
      t.direction !== undefined,
  );

  // EOD balance = last balance-bearing row per calendar day.
  const eodByDay = new Map<number, number>();
  let odCount = 0;
  let worstOd: number | null = null;
  const odIdx: number[] = [];
  let minDay: number | null = null;
  let maxDay: number | null = null;
  usable.forEach((t, index) => {
    const day = epochDay(t.date);
    if (day !== null) {
      minDay = minDay === null ? day : Math.min(minDay, day);
      maxDay = maxDay === null ? day : Math.max(maxDay, day);
    }
    if (t.balancePaise === null || t.balancePaise === undefined || !Number.isFinite(t.balancePaise))
      return;
    if (day !== null) eodByDay.set(day, t.balancePaise);
    if (t.balancePaise < 0) {
      odCount++;
      odIdx.push(index);
      worstOd = worstOd === null ? t.balancePaise : Math.min(worstOd, t.balancePaise);
    }
  });

  const eodValues = [...eodByDay.values()];
  const avgEod =
    eodValues.length > 0
      ? Math.round(eodValues.reduce((a, b) => a + b, 0) / eodValues.length)
      : null;
  let eodVolatility: number | null = null;
  if (eodValues.length >= 2 && avgEod !== null && avgEod !== 0) {
    const variance = eodValues.reduce((s, v) => s + (v - avgEod) ** 2, 0) / eodValues.length;
    eodVolatility = Math.round((Math.sqrt(variance) / Math.abs(avgEod)) * 10000) / 100;
  }

  const debits = usable.filter((t) => t.direction === 'DEBIT');
  const bounceIdx: number[] = [];
  let returnCharges = 0;
  usable.forEach((t, index) => {
    if (t.direction !== 'DEBIT') return;
    if (BOUNCE_NARR_RE.test(t.narration ?? '')) {
      bounceIdx.push(index);
      if (/return\s*(?:chg|charge)/i.test(t.narration ?? '')) returnCharges++;
    }
  });
  const bounceRatePct =
    debits.length > 0 ? Math.round((bounceIdx.length / debits.length) * 10000) / 100 : null;

  const metrics: ConductMetrics = {
    overdrawnDays: eodByDay.size > 0 ? [...eodByDay.values()].filter((b) => b < 0).length : odCount,
    worstOverdraftPaise: worstOd,
    averageEodBalancePaise: avgEod,
    eodVolatilityPct: eodVolatility,
    bounceRatePct,
    bounceCount: bounceIdx.length,
    daysCovered: minDay !== null && maxDay !== null ? maxDay - minDay + 1 : 0,
    returnChargeCount: returnCharges,
    evidence:
      odIdx.length > 0
        ? [
            {
              ruleId: FLOW_RULE_IDS.CONDUCT,
              note: `${odIdx.length} row(s) with negative balance`,
              txnIndices: odIdx,
            },
          ]
        : [],
  };

  const signals: RiskSignal[] = [];
  if (metrics.overdrawnDays >= 5) {
    signals.push({
      ruleId: FLOW_RULE_IDS.CONDUCT,
      severity: metrics.overdrawnDays >= 15 ? 'high' : 'medium',
      note: `${metrics.overdrawnDays} day(s) closed overdrawn`,
      evidence: metrics.evidence,
    });
  }
  if (bounceRatePct !== null && bounceRatePct >= 5 && bounceIdx.length >= 3) {
    signals.push({
      ruleId: FLOW_RULE_IDS.CONDUCT,
      severity: bounceRatePct >= 15 ? 'high' : 'medium',
      note: `bounce rate ${bounceRatePct}% of debits (${bounceIdx.length}/${debits.length})`,
      evidence: [
        { ruleId: FLOW_RULE_IDS.CONDUCT, note: 'bounce/return narrations', txnIndices: bounceIdx },
      ],
    });
  }
  if (eodVolatility !== null && eodVolatility >= 80) {
    signals.push({
      ruleId: FLOW_RULE_IDS.CONDUCT,
      severity: 'low',
      note: `EOD balance volatility ${eodVolatility}% — unstable daily balances`,
      evidence: [],
    });
  }
  return { metrics, signals };
}
