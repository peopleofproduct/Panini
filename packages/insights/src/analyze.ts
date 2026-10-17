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

import type {
  CashflowSummary,
  Evidence,
  FoirSummary,
  IncomeEvent,
  IncomeSummary,
  InsightsOptions,
  InsightsReport,
  InsightTransaction,
  MonthlyFlow,
  ObligationsSummary,
  RecurringObligation,
  RiskSignal,
  TrendSummary,
} from './types';

export const RULE_IDS = {
  SALARY_FLAG: 'PANINI-INC-001',
  SALARY_KEYWORD: 'PANINI-INC-002',
  REGULAR_CREDIT: 'PANINI-INC-003',
  RECURRING_DEBIT: 'PANINI-OBL-001',
  EMI: 'PANINI-EMI-001',
  FOIR: 'PANINI-FOIR-001',
  CASHFLOW: 'PANINI-CF-001',
  BOUNCE: 'PANINI-RSK-BOUNCE-001',
  ROUND_TRIP: 'PANINI-RSK-RT-001',
  SELF_TRANSFER: 'PANINI-RSK-SELF-001',
} as const;

const SALARY_KEYWORD_RE = /\b(salary|payroll|sal\s*cr|wages?|stipend)\b/i;
const EMI_KEYWORD_RE =
  /\b(emi|loan\s*(?:repay|emi|pmt)|nach[\s-]|ecs[\s-]|bajaj\s*fin|finserv|home\s*credit|tata\s*capital|capital\s*first|cholamandalam|aditya\s*birla\s*fin|fullerton|muthoot|shriram\s*(?:fin|transport)|mahindra\s*fin|tvs\s*credit|credila|l&t\s*fin|piramal|idfc\s*loan|poonawalla|hdb\s*fin|kissht|zestmoney|axio|simpl|lazypay)\b/i;
const BOUNCE_RE =
  /\b(bounce[ds]?|dishonou?r(?:ed)?|insufficient\s*funds?|unpaid|return\s*(?:chg|charge)|nach\s*(?:rtn|return)|ecs\s*(?:rtn|return)|chq\s*ret|cheque\s*ret|auto\s*debit\s*(?:fail|rej)|mandate\s*(?:fail|rej))\b/i;
const SELF_RE =
  /\b(self|own\s*a\/?c|own\s*(?:acct|account|transfer|trf)|trf\s*to\s*self|self\s*trf|by\s*self|to\s*self)\b/i;

const DAY_MS = 86_400_000;

function monthKey(date: string | null): string | null {
  return date !== null && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null;
}

function epochDay(date: string | null): number | null {
  if (date === null) return null;
  // Accept ISO date-time inputs ('2024-01-15T10:30:00Z', the AA
  // transactionTimestamp shape) by reducing to their date component.
  const day = /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : date;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms / DAY_MS;
}

/** Uppercase alnum counterparty key for grouping 'SWIGGY BUNDL' ~ 'Swiggy'. */
function counterpartyKey(txn: InsightTransaction): string | null {
  const raw = txn.merchant ?? txn.counterparty;
  if (raw !== null && raw !== undefined && raw.trim() !== '') {
    const k = raw
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return k.length > 0 ? k : null;
  }
  const narration = txn.narration ?? '';
  const m = /(?:to|cr|dr|from)\s+([A-Za-z][A-Za-z0-9 &]{2,30})/.exec(narration);
  if (m !== null) return m[1]!.toUpperCase().replace(/\s+/g, ' ').trim();
  // Last '-'/'/'-separated segment — 'NEFT-N111-SALARY-TCS LTD' → 'TCS LTD'.
  const tail = narration.split(/[-/]/).pop()?.trim() ?? '';
  const cleaned = tail
    .replace(/[^A-Za-z0-9 &]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^[A-Za-z][A-Za-z0-9 &]{2,30}$/.test(cleaned) ? cleaned.toUpperCase() : null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function withinTolerance(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= Math.max(a, b) * tolerance;
}

interface WorkTxn {
  readonly txn: InsightTransaction;
  readonly index: number;
}

function detectIncome(
  txns: readonly WorkTxn[],
  warnings: string[],
): { summary: IncomeSummary; evidence: readonly Evidence[] } {
  const credits = txns.filter((w) => w.txn.direction === 'CREDIT' && w.txn.amountPaise !== null);
  const events: IncomeEvent[] = [];
  const evidence: Evidence[] = [];

  for (const w of credits) {
    const t = w.txn;
    const narration = t.narration ?? '';
    if (t.is_salary === true) {
      events.push({
        index: w.index,
        date: t.date,
        amountPaise: t.amountPaise!,
        employer: counterpartyKey(t),
        basis: 'is_salary_flag',
      });
    } else if (SALARY_KEYWORD_RE.test(narration)) {
      events.push({
        index: w.index,
        date: t.date,
        amountPaise: t.amountPaise!,
        employer: counterpartyKey(t),
        basis: 'salary_keyword',
      });
    }
  }

  // Regular-credit fallback: same source paying a similar amount across
  // multiple months counts as income even without a salary marker.
  const bySource = new Map<string, WorkTxn[]>();
  for (const w of credits) {
    const key = counterpartyKey(w.txn);
    if (key === null) continue;
    const list = bySource.get(key) ?? [];
    list.push(w);
    bySource.set(key, list);
  }
  const claimed = new Set(events.map((e) => e.index));
  for (const [source, list] of bySource) {
    const months = new Set(list.map((w) => monthKey(w.txn.date)).filter(Boolean));
    if (months.size < 2) continue;
    const amounts = list.map((w) => w.txn.amountPaise!);
    const med = median(amounts);
    const consistent = amounts.every((a) => withinTolerance(a, med, 0.2));
    if (!consistent) continue;
    for (const w of list) {
      if (claimed.has(w.index)) continue;
      claimed.add(w.index);
      events.push({
        index: w.index,
        date: w.txn.date,
        amountPaise: w.txn.amountPaise!,
        employer: source,
        basis: 'regular_credit',
      });
    }
  }

  if (events.length > 0) {
    evidence.push({
      ruleId: RULE_IDS.SALARY_FLAG,
      note: `${events.length} income credit(s) detected`,
      txnIndices: events.map((e) => e.index),
    });
  }

  const months = new Set(events.map((e) => monthKey(e.date)).filter(Boolean));
  const sources = [
    ...new Set(events.map((e) => e.employer).filter((s): s is string => s !== null)),
  ];
  const byMonth = new Map<string, number>();
  for (const e of events) {
    const mk = monthKey(e.date);
    if (mk !== null) byMonth.set(mk, (byMonth.get(mk) ?? 0) + e.amountPaise);
  }
  const monthlyAveragePaise =
    byMonth.size > 0
      ? Math.round([...byMonth.values()].reduce((a, b) => a + b, 0) / byMonth.size)
      : null;

  let consistency: IncomeSummary['consistency'] = 'insufficient_data';
  if (events.length >= 2 && months.size >= 2) {
    const primary = sources.length > 0 ? bySource.get(sources[0]!) : undefined;
    const amounts =
      primary !== undefined && primary.length >= 2
        ? primary.map((w) => w.txn.amountPaise!)
        : events.map((e) => e.amountPaise);
    consistency =
      amounts.length >= 2 && amounts.every((a) => withinTolerance(a, median(amounts), 0.2))
        ? 'regular'
        : 'irregular';
  } else if (events.length === 1) {
    consistency = 'insufficient_data';
  }
  if (events.length === 0 && credits.length > 0) {
    warnings.push('credits present but none identified as income — check enrichment/labels');
  }

  return {
    summary: {
      credits: events.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
      sources,
      monthlyAveragePaise,
      consistency,
      monthsObserved: months.size,
    },
    evidence,
  };
}

function detectObligations(
  txns: readonly WorkTxn[],
  minOccurrences: number,
): { summary: ObligationsSummary; evidence: readonly Evidence[] } {
  const debits = txns.filter((w) => w.txn.direction === 'DEBIT' && w.txn.amountPaise !== null);
  const byKey = new Map<string, WorkTxn[]>();
  for (const w of debits) {
    const key = counterpartyKey(w.txn);
    if (key === null) continue;
    const list = byKey.get(key) ?? [];
    list.push(w);
    byKey.set(key, list);
  }

  const recurring: RecurringObligation[] = [];
  const evidence: Evidence[] = [];
  for (const [key, list] of byKey) {
    // Sum per calendar month first: a counterparty paid twice in one month
    // is a 2× monthly obligation, not two half-obligations.
    const perMonth = new Map<string, number>();
    for (const w of list) {
      const mk = monthKey(w.txn.date);
      if (mk === null) continue;
      perMonth.set(mk, (perMonth.get(mk) ?? 0) + w.txn.amountPaise!);
    }
    if (perMonth.size < minOccurrences) continue;
    const monthSums = [...perMonth.values()];
    const typical = median(monthSums);
    if (!monthSums.every((s) => withinTolerance(s, typical, 0.1))) continue;
    const isEmi = list.some(
      (w) =>
        EMI_KEYWORD_RE.test(w.txn.narration ?? '') ||
        EMI_KEYWORD_RE.test(key) ||
        w.txn.category === 'Loan & EMI',
    );
    recurring.push({
      counterparty: key,
      occurrences: list.map((w) => w.index),
      typicalAmountPaise: Math.round(typical),
      monthsHit: [...perMonth.keys()].sort(),
      isEmi,
    });
  }

  if (recurring.length > 0) {
    evidence.push({
      ruleId: RULE_IDS.RECURRING_DEBIT,
      note: `${recurring.length} recurring obligation(s) detected`,
      txnIndices: recurring.flatMap((r) => r.occurrences),
    });
  }

  const emis = recurring.filter((r) => r.isEmi);
  if (emis.length > 0) {
    evidence.push({
      ruleId: RULE_IDS.EMI,
      note: `${emis.length} EMI pattern(s) detected`,
      txnIndices: emis.flatMap((r) => r.occurrences),
    });
  }

  return {
    summary: {
      recurring,
      emis,
      monthlyObligationPaise:
        recurring.length > 0 ? recurring.reduce((sum, r) => sum + r.typicalAmountPaise, 0) : null,
    },
    evidence,
  };
}

function computeFoir(income: IncomeSummary, obligations: ObligationsSummary): FoirSummary {
  if (income.monthlyAveragePaise === null || income.monthlyAveragePaise <= 0) {
    return {
      ratio: null,
      monthlyIncomePaise: income.monthlyAveragePaise,
      monthlyObligationPaise: obligations.monthlyObligationPaise,
      note: 'income undetected — FOIR not computable',
    };
  }
  const obligation = obligations.monthlyObligationPaise ?? 0;
  return {
    ratio: Math.round((obligation / income.monthlyAveragePaise) * 1000) / 1000,
    monthlyIncomePaise: income.monthlyAveragePaise,
    monthlyObligationPaise: obligations.monthlyObligationPaise,
    note:
      obligations.monthlyObligationPaise === null
        ? 'no recurring obligations detected — FOIR floor is 0'
        : `obligations ${obligation} / income ${income.monthlyAveragePaise}`,
  };
}

function summarizeCashflow(txns: readonly WorkTxn[]): CashflowSummary {
  let totalCredits = 0;
  let totalDebits = 0;
  let minBal: number | null = null;
  let maxBal: number | null = null;
  let closing: number | null = null;
  let closingDay: number | null = null;
  const months = new Set<string>();
  for (const w of txns) {
    const t = w.txn;
    if (t.direction === 'CREDIT' && t.amountPaise !== null) totalCredits += t.amountPaise;
    if (t.direction === 'DEBIT' && t.amountPaise !== null) totalDebits += t.amountPaise;
    const mk = monthKey(t.date);
    if (mk !== null) months.add(mk);
    if (
      t.balancePaise !== null &&
      t.balancePaise !== undefined &&
      Number.isFinite(t.balancePaise)
    ) {
      minBal = minBal === null ? t.balancePaise : Math.min(minBal, t.balancePaise);
      maxBal = maxBal === null ? t.balancePaise : Math.max(maxBal, t.balancePaise);
      // Closing = balance of the latest dated row (input order breaks
      // same-day ties); rows without a parseable date fall back to
      // last-seen so undated statements still report a closing figure.
      const day = epochDay(t.date);
      if (day !== null) {
        if (closingDay === null || day >= closingDay) {
          closing = t.balancePaise;
          closingDay = day;
        }
      } else if (closingDay === null) {
        closing = t.balancePaise;
      }
    }
  }
  return {
    totalCreditsPaise: totalCredits,
    totalDebitsPaise: totalDebits,
    netPaise: totalCredits - totalDebits,
    monthsObserved: months.size,
    averageMonthlyNetPaise:
      months.size > 0 ? Math.round((totalCredits - totalDebits) / months.size) : null,
    minBalancePaise: minBal,
    maxBalancePaise: maxBal,
    closingBalancePaise: closing,
  };
}

function computeTrends(txns: readonly WorkTxn[]): TrendSummary {
  const byMonth = new Map<string, MonthlyFlow>();
  for (const w of txns) {
    const mk = monthKey(w.txn.date);
    if (mk === null || w.txn.amountPaise === null) continue;
    const cur = byMonth.get(mk) ?? { month: mk, creditsPaise: 0, debitsPaise: 0, netPaise: 0 };
    const credits = cur.creditsPaise + (w.txn.direction === 'CREDIT' ? w.txn.amountPaise : 0);
    const debits = cur.debitsPaise + (w.txn.direction === 'DEBIT' ? w.txn.amountPaise : 0);
    byMonth.set(mk, {
      month: mk,
      creditsPaise: credits,
      debitsPaise: debits,
      netPaise: credits - debits,
    });
  }
  const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  let netFlowDirection: TrendSummary['netFlowDirection'] = 'insufficient_data';
  if (monthly.length >= 3) {
    const half = Math.floor(monthly.length / 2);
    const first = monthly.slice(0, half);
    const second = monthly.slice(monthly.length - half);
    const avg = (rows: readonly MonthlyFlow[]) =>
      rows.reduce((s, r) => s + r.netPaise, 0) / rows.length;
    const f = avg(first);
    const s = avg(second);
    const band = Math.max(Math.abs(f), 1) * 0.1;
    netFlowDirection = s - f > band ? 'improving' : f - s > band ? 'declining' : 'stable';
  }

  // Median per-day balance change across consecutive dated balances,
  // sorted by date so input order cannot fabricate velocity sign/magnitude.
  const dated: { day: number; balancePaise: number }[] = [];
  for (const w of txns) {
    const t = w.txn;
    const day = epochDay(t.date);
    if (day === null) continue;
    if (t.balancePaise === null || t.balancePaise === undefined) continue;
    if (!Number.isFinite(t.balancePaise)) continue;
    dated.push({ day, balancePaise: t.balancePaise });
  }
  dated.sort((a, b) => a.day - b.day);
  const velocities: number[] = [];
  for (let i = 1; i < dated.length; i++) {
    const dayDiff = dated[i]!.day - dated[i - 1]!.day;
    if (dayDiff === 0) continue;
    velocities.push((dated[i]!.balancePaise - dated[i - 1]!.balancePaise) / dayDiff);
  }

  const volatility = (key: 'creditsPaise' | 'debitsPaise'): number | null => {
    if (monthly.length < 2) return null;
    const values = monthly.map((m) => m[key]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) return null;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.round((Math.sqrt(variance) / mean) * 10000) / 100;
  };

  return {
    monthly,
    netFlowDirection,
    balanceVelocityPaisePerDay: velocities.length > 0 ? Math.round(median(velocities)) : null,
    creditVolatilityPct: volatility('creditsPaise'),
    debitVolatilityPct: volatility('debitsPaise'),
  };
}

function detectSignals(
  txns: readonly WorkTxn[],
  roundTripWindowDays: number,
  roundTripTolerance: number,
): readonly RiskSignal[] {
  const signals: RiskSignal[] = [];

  // Bounce / return / dishonour narrations.
  const bounceIdx = txns.filter((w) => BOUNCE_RE.test(w.txn.narration ?? '')).map((w) => w.index);
  if (bounceIdx.length > 0) {
    signals.push({
      ruleId: RULE_IDS.BOUNCE,
      severity: bounceIdx.length >= 3 ? 'high' : 'medium',
      note: `${bounceIdx.length} bounced/returned payment narration(s)`,
      evidence: [
        {
          ruleId: RULE_IDS.BOUNCE,
          note: 'narration carries bounce/return/dishonour keywords',
          txnIndices: bounceIdx,
        },
      ],
    });
  }

  // Round-trips: a credit mirrored by a similar debit to the same
  // counterparty inside the window.
  const credits = txns.filter(
    (w) => w.txn.direction === 'CREDIT' && w.txn.amountPaise !== null && w.txn.date !== null,
  );
  const debits = txns.filter(
    (w) => w.txn.direction === 'DEBIT' && w.txn.amountPaise !== null && w.txn.date !== null,
  );
  const roundTripEvidence: Evidence[] = [];
  const used = new Set<number>();
  for (const c of credits) {
    const key = counterpartyKey(c.txn);
    const day = epochDay(c.txn.date);
    if (key === null || day === null) continue;
    for (const d of debits) {
      if (used.has(d.index) || d.index === c.index) continue;
      if (counterpartyKey(d.txn) !== key) continue;
      const dDay = epochDay(d.txn.date);
      if (dDay === null || dDay < day || dDay - day > roundTripWindowDays) continue;
      if (!withinTolerance(c.txn.amountPaise!, d.txn.amountPaise!, roundTripTolerance)) continue;
      used.add(d.index);
      roundTripEvidence.push({
        ruleId: RULE_IDS.ROUND_TRIP,
        note: `credit ₹${(c.txn.amountPaise! / 100).toFixed(2)} mirrored by debit of ₹${(d.txn.amountPaise! / 100).toFixed(2)} to ${key} within ${dDay - day} day(s)`,
        txnIndices: [c.index, d.index],
      });
      break;
    }
  }
  if (roundTripEvidence.length > 0) {
    signals.push({
      ruleId: RULE_IDS.ROUND_TRIP,
      severity: roundTripEvidence.length >= 3 ? 'high' : 'medium',
      note: `${roundTripEvidence.length} round-trip pattern(s) — credit mirrored by matching debit`,
      evidence: roundTripEvidence,
    });
  }

  // Self-transfers: explicit self/own keywords in the narration.
  const selfIdx = txns.filter((w) => SELF_RE.test(w.txn.narration ?? '')).map((w) => w.index);
  if (selfIdx.length > 0) {
    signals.push({
      ruleId: RULE_IDS.SELF_TRANSFER,
      severity: 'low',
      note: `${selfIdx.length} self/own-account transfer narration(s)`,
      evidence: [
        {
          ruleId: RULE_IDS.SELF_TRANSFER,
          note: 'narration carries self/own-account keywords',
          txnIndices: selfIdx,
        },
      ],
    });
  }

  return signals;
}

/**
 * Runs every deterministic insight rule over normalized transactions.
 * Never throws — malformed rows are dropped with a warning and every claim
 * carries evidence pointing back into the input array.
 */
export function analyzeTransactions(
  transactions: readonly InsightTransaction[],
  options?: InsightsOptions,
): InsightsReport {
  const warnings: string[] = [];
  const usable: WorkTxn[] = [];
  let dropped = 0;
  for (const [index, txn] of transactions.entries()) {
    if (txn === null || txn === undefined) {
      dropped++;
      continue;
    }
    if (
      txn.direction === null ||
      txn.direction === undefined ||
      txn.amountPaise === null ||
      txn.amountPaise === undefined ||
      !Number.isFinite(txn.amountPaise)
    ) {
      dropped++;
      continue;
    }
    usable.push({ txn, index });
  }
  if (dropped > 0) {
    warnings.push(`${dropped} transaction(s) dropped: missing direction or amount`);
  }
  if (usable.length === 0) {
    warnings.push('no usable transactions — report reflects an empty input');
  }

  const income = detectIncome(usable, warnings);
  const obligations = detectObligations(usable, options?.minRecurringOccurrences ?? 3);
  const foir = computeFoir(income.summary, obligations.summary);
  const cashflow = summarizeCashflow(usable);
  const trends = computeTrends(usable);
  const signals = detectSignals(
    usable,
    options?.roundTripWindowDays ?? 5,
    options?.amountTolerance ?? 0.02,
  );

  return {
    income: income.summary,
    obligations: obligations.summary,
    foir,
    cashflow,
    trends,
    signals,
    warnings,
    analyzedTransactions: usable.length,
  };
}
