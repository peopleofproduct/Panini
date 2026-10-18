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

import { counterpartyKey, epochDay, median, monthKey, withinTolerance } from './analyze';
import type { AccountSlice } from './consolidate';
import { consolidateAccounts } from './consolidate';
import type { Evidence, InsightTransaction, RiskSignal, RuleId } from './types';

export const FRAUD_RULE_IDS = {
  /** Same-amount credit then debit within days via different counterparties. */
  CIRCULAR_PAIR: 'PANINI-FRD-CIRC-001',
  /** Cash deposit narration on a weekend or supplied holiday. */
  HOLIDAY_CASH: 'PANINI-FRD-HOL-001',
  /** Narration claims RTGS but amount is below the ₹2L RTGS floor. */
  RTGS_BELOW_FLOOR: 'PANINI-FRD-RTGS-001',
  /** Suspicious share of round-figure amounts. */
  ROUND_FIGURES: 'PANINI-FRD-ROUND-001',
  /** Calendar month inside the covered span with zero transactions. */
  GAP_MONTH: 'PANINI-FRD-GAP-001',
  /** Month where debits ≈ credits at meaningful volume — turnover wash. */
  WASH_MONTH: 'PANINI-FRD-EQDC-001',
  /** Regular salary credits stop before the statement ends. */
  SALARY_STOP: 'PANINI-FRD-SALSTOP-001',
  /** Large outflow immediately following each salary credit. */
  SALARY_STRIP: 'PANINI-FRD-LSAL-001',
  /** Long quiet stretch followed by a large credit spike. */
  DORMANT_SPIKE: 'PANINI-FRD-DORM-001',
  /** Balance column dipped negative — overdrawn/OD days. */
  OVERDRAWN_DAYS: 'PANINI-FRD-OD-001',
  /** Minimum-balance / penalty fee narrations. */
  PENALTY_CHARGES: 'PANINI-FRD-MINB-001',
  /** Money rotates borrower account → account → back (portfolio level). */
  CROSS_ACCOUNT_CYCLE: 'PANINI-FRD-ACIRC-001',
  /** Internal transfers make up a large share of raw credit volume. */
  INFLATED_TURNOVER: 'PANINI-FRD-SELFINFL-001',
} as const;

export interface FraudOptions {
  /** ISO 'YYYY-MM-DD' dates treated as non-banking days (weekends are always
   *  counted). Bank holidays differ by state — supply the relevant list. */
  readonly holidays?: readonly string[];
  /** Max days between credit and its mirroring debit. Default 2. */
  readonly circularWindowDays?: number;
  /** Amount tolerance for pairing. Default 0.02. */
  readonly amountTolerance?: number;
  /** Round-figure check: only txns ≥ this count. Default ₹10,000. */
  readonly roundAmountMinPaise?: number;
  /** Share of round figures (among ≥min txns, need ≥5) that flags. Default 0.4. */
  readonly roundShareThreshold?: number;
  /** Quiet stretch in days that counts as dormant. Default 45. */
  readonly dormantGapDays?: number;
  /** Fraction of the salary credit that counts as a stripping debit. Default 0.8. */
  readonly salaryStripFraction?: number;
  /** Wash month tolerance: |debits−credits| within this share. Default 0.05. */
  readonly washTolerance?: number;
}

export interface FraudReport {
  readonly indicators: readonly RiskSignal[];
  readonly warnings: readonly string[];
}

const CASH_RE = /\b(cash\s*(?:dep|deposit|dpt)|self\s*cash|cdm\b|cash\s*by)\b/i;
const RTGS_RE = /\brtgs\b/i;
const PENALTY_RE =
  /\b(min(?:imum)?\s*bal(?:ance)?\s*(?:chg|charge|penalty)|non[-\s]?maintenance|penalty\s*chg|avg\s*bal\s*chg|qb\s*chg|amb\s*chg)\b/i;
const SALARY_RE = /\b(salary|payroll|sal\s*cr|wages?|stipend)\b/i;

const RTGS_FLOOR_PAISE = 200_000 * 100; // ₹2,00,000
const ROUND_UNIT_PAISE = 1_000 * 100; // multiples of ₹1,000

interface WorkTxn {
  readonly txn: InsightTransaction;
  readonly index: number;
  readonly day: number | null;
}

/** Counterparty key for rotation matching — strips channel/direction tokens
 *  ('NEFT TO ALPHA' vs 'NEFT FROM ALPHA' → 'ALPHA') so direction-word noise
 *  in raw narrations can't defeat the same-counterparty check. */
function rotationKey(txn: InsightTransaction): string | null {
  let key = counterpartyKey(txn);
  if (key === null) return null;
  let prev = '';
  while (key !== prev) {
    prev = key;
    key = key
      .replace(/^(NEFT|RTGS|IMPS|UPI|NACH|ECS|TRF|TPT|FT|BY|TO|FROM|DR|CR|SELF)\s+/g, '')
      .trim();
  }
  return key.length > 0 ? key : null;
}

function work(txns: readonly InsightTransaction[]): { usable: WorkTxn[]; dropped: number } {
  const usable: WorkTxn[] = [];
  let dropped = 0;
  txns.forEach((txn, index) => {
    if (
      txn === null ||
      txn === undefined ||
      txn.direction === null ||
      txn.direction === undefined ||
      txn.amountPaise === null ||
      txn.amountPaise === undefined ||
      !Number.isFinite(txn.amountPaise)
    ) {
      dropped++;
      return;
    }
    usable.push({ txn, index, day: epochDay(txn.date) });
  });
  return { usable, dropped };
}

function isNonBankingDay(isoDate: string, holidays: ReadonlySet<string>): boolean {
  const day = epochDay(isoDate);
  if (day === null) return false;
  const dow = new Date(day * 86_400_000).getUTCDay();
  return dow === 0 || dow === 6 || holidays.has(isoDate.slice(0, 10));
}

function circularPairs(
  usable: readonly WorkTxn[],
  windowDays: number,
  tolerance: number,
): Evidence[] {
  const credits = usable.filter((w) => w.txn.direction === 'CREDIT' && w.day !== null);
  const debits = usable.filter((w) => w.txn.direction === 'DEBIT' && w.day !== null);
  const evidence: Evidence[] = [];
  const used = new Set<number>();
  for (const c of credits) {
    const cKey = rotationKey(c.txn);
    for (const d of debits) {
      if (used.has(d.index) || d.index === c.index) continue;
      const gap = d.day! - c.day!;
      if (gap < 0 || gap > windowDays) continue;
      if (!withinTolerance(c.txn.amountPaise!, d.txn.amountPaise!, tolerance)) continue;
      // Same-counterparty mirror is already PANINI-RSK-RT-001 — this rule
      // covers rotation: money in from one party, out to another.
      const dKey = rotationKey(d.txn);
      if (cKey !== null && dKey !== null && cKey === dKey) continue;
      used.add(d.index);
      evidence.push({
        ruleId: FRAUD_RULE_IDS.CIRCULAR_PAIR,
        note: `₹${(c.txn.amountPaise! / 100).toFixed(2)} in then ~same out within ${gap} day(s), different counterparty`,
        txnIndices: [c.index, d.index],
      });
      break;
    }
  }
  return evidence;
}

function gapMonths(usable: readonly WorkTxn[]): Evidence[] {
  const seen = new Set<string>();
  let minDay: number | null = null;
  let maxDay: number | null = null;
  for (const w of usable) {
    const mk = monthKey(w.txn.date);
    if (mk !== null) seen.add(mk);
    if (w.day !== null) {
      minDay = minDay === null ? w.day : Math.min(minDay, w.day);
      maxDay = maxDay === null ? w.day : Math.max(maxDay, w.day);
    }
  }
  if (minDay === null || maxDay === null || maxDay - minDay < 45) return [];
  const missing: string[] = [];
  const cursor = new Date(minDay * 86_400_000);
  const end = new Date(maxDay * 86_400_000);
  cursor.setUTCDate(1);
  while (cursor <= end) {
    const mk = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!seen.has(mk)) missing.push(mk);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return missing.map((mk) => ({
    ruleId: FRAUD_RULE_IDS.GAP_MONTH as RuleId,
    note: `no transactions in ${mk} — dormant month or missing statement pages`,
    txnIndices: [],
  }));
}

function salarySignals(
  usable: readonly WorkTxn[],
  stripFraction: number,
): { stop: Evidence | null; strip: Evidence | null } {
  const salary = usable.filter(
    (w) =>
      w.txn.direction === 'CREDIT' &&
      (w.txn.is_salary === true || SALARY_RE.test(w.txn.narration ?? '')) &&
      w.day !== null,
  );
  if (salary.length < 2) return { stop: null, strip: null };
  const months = [...new Set(salary.map((w) => monthKey(w.txn.date)).filter(Boolean))].sort();
  const lastSalaryMonth = months[months.length - 1]!;
  const allMonths = [...new Set(usable.map((w) => monthKey(w.txn.date)).filter(Boolean))].sort();
  const lastMonth = allMonths[allMonths.length - 1]!;

  let stop: Evidence | null = null;
  if (months.length >= 3 && lastMonth > lastSalaryMonth) {
    stop = {
      ruleId: FRAUD_RULE_IDS.SALARY_STOP,
      note: `salary credits present in ${months.length} month(s) but absent after ${lastSalaryMonth}; statement runs to ${lastMonth}`,
      txnIndices: salary.map((w) => w.index),
    };
  }

  const stripPairs: number[] = [];
  const debits = usable.filter((w) => w.txn.direction === 'DEBIT' && w.day !== null);
  for (const s of salary) {
    for (const d of debits) {
      const gap = d.day! - s.day!;
      if (gap < 0 || gap > 3) continue;
      if (d.txn.amountPaise! < s.txn.amountPaise! * stripFraction) continue;
      stripPairs.push(s.index, d.index);
      break;
    }
  }
  const strip: Evidence | null =
    stripPairs.length >= 4
      ? {
          ruleId: FRAUD_RULE_IDS.SALARY_STRIP,
          note: `${stripPairs.length / 2} salary credit(s) followed within 3 days by debit(s) ≥ ${Math.round(stripFraction * 100)}% of salary`,
          txnIndices: stripPairs,
        }
      : null;
  return { stop, strip };
}

/**
 * The named fraud-indicator suite — deterministic checks mirroring the
 * industry-standard list (circular flows, holiday cash, threshold gaming,
 * round figures, gap months, wash months, salary anomalies, dormant spikes,
 * overdrawn days, penalty charges). Every flag carries evidence rows.
 */
export function detectFraudIndicators(
  transactions: readonly InsightTransaction[],
  options?: FraudOptions,
): FraudReport {
  const warnings: string[] = [];
  const { usable, dropped } = work(transactions);
  if (dropped > 0) warnings.push(`${dropped} transaction(s) skipped: missing direction/amount`);
  const indicators: RiskSignal[] = [];
  const push = (
    ruleId: RuleId,
    severity: RiskSignal['severity'],
    note: string,
    evidence: Evidence[],
  ) => indicators.push({ ruleId, severity, note, evidence });

  const windowDays = options?.circularWindowDays ?? 2;
  const tolerance = options?.amountTolerance ?? 0.02;
  const holidays = new Set(options?.holidays ?? []);

  const circ = circularPairs(usable, windowDays, tolerance);
  if (circ.length > 0) {
    push(
      FRAUD_RULE_IDS.CIRCULAR_PAIR,
      circ.length >= 3 ? 'high' : 'medium',
      `${circ.length} same-amount in/out pair(s) across different counterparties — possible rotation`,
      circ,
    );
  }

  const holIdx = usable
    .filter(
      (w) =>
        CASH_RE.test(w.txn.narration ?? '') &&
        w.txn.direction === 'CREDIT' &&
        w.txn.date !== null &&
        isNonBankingDay(w.txn.date, holidays),
    )
    .map((w) => w.index);
  if (holIdx.length > 0) {
    push(
      FRAUD_RULE_IDS.HOLIDAY_CASH,
      holIdx.length >= 3 ? 'high' : 'low',
      `${holIdx.length} cash deposit(s) dated on weekend/holiday — CDM/branch deposits don't settle on non-banking days`,
      [
        {
          ruleId: FRAUD_RULE_IDS.HOLIDAY_CASH,
          note: 'cash-deposit narration on a non-banking day',
          txnIndices: holIdx,
        },
      ],
    );
  }

  const rtgsIdx = usable
    .filter((w) => RTGS_RE.test(w.txn.narration ?? '') && w.txn.amountPaise! < RTGS_FLOOR_PAISE)
    .map((w) => w.index);
  if (rtgsIdx.length > 0) {
    push(
      FRAUD_RULE_IDS.RTGS_BELOW_FLOOR,
      'medium',
      `${rtgsIdx.length} narration(s) claim RTGS below the ₹2,00,000 RBI floor`,
      [
        {
          ruleId: FRAUD_RULE_IDS.RTGS_BELOW_FLOOR,
          note: 'RTGS minimum is ₹2L — sub-floor RTGS is mislabeled or threshold-gaming',
          txnIndices: rtgsIdx,
        },
      ],
    );
  }

  const roundMin = options?.roundAmountMinPaise ?? 1_000_000;
  const big = usable.filter((w) => w.txn.amountPaise! >= roundMin);
  const roundIdx = big
    .filter((w) => w.txn.amountPaise! % ROUND_UNIT_PAISE === 0)
    .map((w) => w.index);
  const share = big.length > 0 ? roundIdx.length / big.length : 0;
  if (roundIdx.length >= 5 && share >= (options?.roundShareThreshold ?? 0.4)) {
    push(
      FRAUD_RULE_IDS.ROUND_FIGURES,
      share >= 0.7 ? 'high' : 'medium',
      `${roundIdx.length}/${big.length} transactions ≥ ₹10,000 are exact ₹1,000 multiples (${Math.round(share * 100)}%)`,
      [
        {
          ruleId: FRAUD_RULE_IDS.ROUND_FIGURES,
          note: 'round-figure clustering is an anomaly pattern, not proof',
          txnIndices: roundIdx,
        },
      ],
    );
  }

  const gaps = gapMonths(usable);
  for (const g of gaps) {
    push(FRAUD_RULE_IDS.GAP_MONTH, 'medium', g.note, [g]);
  }

  const byMonth = new Map<string, { cr: number; dr: number; idx: number[] }>();
  for (const w of usable) {
    const mk = monthKey(w.txn.date);
    if (mk === null) continue;
    const cur = byMonth.get(mk) ?? { cr: 0, dr: 0, idx: [] };
    if (w.txn.direction === 'CREDIT') cur.cr += w.txn.amountPaise!;
    else cur.dr += w.txn.amountPaise!;
    cur.idx.push(w.index);
    byMonth.set(mk, cur);
  }
  const washTol = options?.washTolerance ?? 0.05;
  const wash: Evidence[] = [];
  for (const [mk, v] of byMonth) {
    if (v.cr < 500_000 || v.dr < 500_000) continue; // ignore trivial months (<₹5k)
    if (Math.abs(v.cr - v.dr) <= Math.max(v.cr, v.dr) * washTol) {
      wash.push({
        ruleId: FRAUD_RULE_IDS.WASH_MONTH,
        note: `${mk}: credits ≈ debits (₹${(v.cr / 100).toFixed(0)} / ₹${(v.dr / 100).toFixed(0)}) — turnover wash`,
        txnIndices: v.idx,
      });
    }
  }
  if (wash.length > 0) {
    push(
      FRAUD_RULE_IDS.WASH_MONTH,
      wash.length >= 2 ? 'high' : 'medium',
      `${wash.length} month(s) with near-equal inflow/outflow`,
      wash,
    );
  }

  const sal = salarySignals(usable, options?.salaryStripFraction ?? 0.8);
  if (sal.stop !== null) {
    push(FRAUD_RULE_IDS.SALARY_STOP, 'medium', sal.stop.note, [sal.stop]);
  }
  if (sal.strip !== null) {
    push(FRAUD_RULE_IDS.SALARY_STRIP, 'high', sal.strip.note, [sal.strip]);
  }

  // Dormant → spike: a ≥gap-day lull followed by a credit ≥3× median credit.
  const dated = usable.filter((w) => w.day !== null).sort((a, b) => a.day! - b.day!);
  const creditMedian = median(
    dated.filter((w) => w.txn.direction === 'CREDIT').map((w) => w.txn.amountPaise!),
  );
  const dormantGap = options?.dormantGapDays ?? 45;
  const dorm: Evidence[] = [];
  for (let i = 1; i < dated.length; i++) {
    const gap = dated[i]!.day! - dated[i - 1]!.day!;
    if (gap < dormantGap) continue;
    const after = dated[i]!;
    if (
      after.txn.direction === 'CREDIT' &&
      Number.isFinite(creditMedian) &&
      creditMedian > 0 &&
      after.txn.amountPaise! >= creditMedian * 3
    ) {
      dorm.push({
        ruleId: FRAUD_RULE_IDS.DORMANT_SPIKE,
        note: `${gap}-day lull then credit ₹${(after.txn.amountPaise! / 100).toFixed(2)} (>3× median credit)`,
        txnIndices: [after.index],
      });
    }
  }
  if (dorm.length > 0) {
    push(
      FRAUD_RULE_IDS.DORMANT_SPIKE,
      'medium',
      `${dorm.length} dormant-period→large-credit pattern(s)`,
      dorm,
    );
  }

  const odIdx = usable
    .filter(
      (w) =>
        w.txn.balancePaise !== null && w.txn.balancePaise !== undefined && w.txn.balancePaise < 0,
    )
    .map((w) => w.index);
  if (odIdx.length > 0) {
    push(
      FRAUD_RULE_IDS.OVERDRAWN_DAYS,
      odIdx.length >= 10 ? 'high' : 'low',
      `${odIdx.length} transaction row(s) show a negative balance — overdrawn days`,
      [
        {
          ruleId: FRAUD_RULE_IDS.OVERDRAWN_DAYS,
          note: 'negative running balance observed',
          txnIndices: odIdx,
        },
      ],
    );
  }

  const penIdx = usable
    .filter((w) => PENALTY_RE.test(w.txn.narration ?? '') && w.txn.direction === 'DEBIT')
    .map((w) => w.index);
  if (penIdx.length >= 2) {
    push(
      FRAUD_RULE_IDS.PENALTY_CHARGES,
      'low',
      `${penIdx.length} minimum-balance/penalty charge(s) — conduct signal`,
      [
        {
          ruleId: FRAUD_RULE_IDS.PENALTY_CHARGES,
          note: 'balance-maintenance penalty narrations',
          txnIndices: penIdx,
        },
      ],
    );
  }

  return { indicators, warnings };
}

/**
 * Portfolio-level indicators: the checks that only make sense across a
 * borrower's full account set — cross-account rotation cycles and
 * internal-transfer-inflated turnover.
 */
export function detectPortfolioIndicators(
  accounts: readonly AccountSlice[],
  options?: FraudOptions,
): FraudReport {
  const warnings: string[] = [];
  const portfolio = consolidateAccounts(accounts, options);
  warnings.push(...portfolio.warnings);
  const indicators: RiskSignal[] = [];

  // Cycles: A→B then B→A within the combined window — money rotated and
  // returned, the classic turnover inflation shape.
  const windowDays = options?.circularWindowDays ?? 2;
  const tolerance = options?.amountTolerance ?? 0.02;
  const cycles: Evidence[] = [];
  for (const t1 of portfolio.internalTransfers) {
    for (const t2 of portfolio.internalTransfers) {
      if (t2 === t1) continue;
      if (t2.fromAccount !== t1.toAccount || t2.toAccount !== t1.fromAccount) continue;
      if (!withinTolerance(t1.amountPaise, t2.amountPaise, tolerance)) continue;
      if (Math.abs(t1.daysApart + t2.daysApart) > windowDays * 2) continue;
      cycles.push({
        ruleId: FRAUD_RULE_IDS.CROSS_ACCOUNT_CYCLE,
        note: `₹${(t1.amountPaise / 100).toFixed(2)} rotated ${t1.fromAccount}→${t1.toAccount}→${t1.fromAccount}`,
        txnIndices: [],
      });
      break;
    }
  }
  if (cycles.length > 0) {
    indicators.push({
      ruleId: FRAUD_RULE_IDS.CROSS_ACCOUNT_CYCLE,
      severity: 'high',
      note: `${cycles.length} cross-account rotation cycle(s) — money returned to its origin account`,
      evidence: cycles,
    });
  }

  const share =
    portfolio.consolidated.totalCreditsPaise > 0
      ? portfolio.consolidated.internalVolumePaise / portfolio.consolidated.totalCreditsPaise
      : 0;
  if (share >= 0.3 && portfolio.internalTransfers.length >= 3) {
    indicators.push({
      ruleId: FRAUD_RULE_IDS.INFLATED_TURNOVER,
      severity: share >= 0.6 ? 'high' : 'medium',
      note: `${Math.round(share * 100)}% of raw credits are transfers between the borrower's own accounts — turnover inflated`,
      evidence: portfolio.internalTransfers.map((t) => ({
        ruleId: FRAUD_RULE_IDS.INFLATED_TURNOVER,
        note: `${t.fromAccount} → ${t.toAccount}: ₹${(t.amountPaise / 100).toFixed(2)}`,
        txnIndices: [],
      })),
    });
  }

  return { indicators, warnings };
}
