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
 * Deterministic scorecard evaluation.
 *
 * Panini deliberately does NOT ship a calibrated credit score — that
 * requires default-history data we do not have, and under RBI's
 * accountable-lender rules the risk model must belong to the regulated
 * entity anyway. What this module provides is the honest middle ground:
 * a JSON-declared, weighted rule set evaluated over the evidence-backed
 * {@link InsightsReport}, producing a score with a full derivation trace
 * so every point can be audited down to transaction indices.
 */

import type { InsightsReport } from './types';

export type ScorecardOp = 'lt' | 'lte' | 'eq' | 'neq' | 'gte' | 'gt' | 'in';

export interface ScorecardCondition {
  /** Metric key from the {@link METRICS} registry. */
  readonly metric: string;
  readonly op: ScorecardOp;
  readonly value: number | string | readonly (number | string)[];
  readonly all?: undefined;
  readonly any?: undefined;
}

export interface ScorecardComposite {
  readonly all?: readonly ScorecardCondition[];
  readonly any?: readonly ScorecardCondition[];
  readonly metric?: undefined;
  readonly op?: undefined;
  readonly value?: undefined;
}

export type ScorecardWhen = ScorecardCondition | ScorecardComposite;

export interface ScorecardRule {
  readonly id: string;
  /** Points contributed when `when` matches. */
  readonly points: number;
  readonly when: ScorecardWhen;
  readonly description?: string;
}

export interface ScorecardBand {
  /** Applied when scorePct >= minScorePct (bands sorted desc at eval). */
  readonly minScorePct: number;
  readonly label: string;
}

export interface ScorecardSpec {
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  readonly rules: readonly ScorecardRule[];
  readonly bands?: readonly ScorecardBand[];
}

export interface ScorecardContribution {
  readonly ruleId: string;
  readonly points: number;
  readonly matched: boolean;
  /** Observed metric values per leaf condition (for the audit trace). */
  readonly observed: readonly { metric: string; value: unknown }[];
  readonly description?: string;
}

export interface ScorecardResult {
  readonly specId: string;
  readonly specVersion: string;
  /** Sum of points from matched rules. */
  readonly score: number;
  /** Sum of points across all rules. */
  readonly maxScore: number;
  /** score / maxScore * 100. */
  readonly scorePct: number;
  /**
   * Fraction of maxScore whose conditions could be evaluated against
   * real data (not missing metrics). A high scorePct on low coveragePct
   * is a thin-file artefact — surface it, don't hide it.
   */
  readonly coveragePct: number;
  readonly band: string | null;
  readonly contributions: readonly ScorecardContribution[];
  readonly warnings: readonly string[];
}

/** Maps a metric key to a value extractor over the insights report. */
const METRICS: Record<string, (r: InsightsReport, arg?: string) => unknown> = {
  'foir.ratio': (r) => r.foir.ratio,
  'income.monthlyAveragePaise': (r) => r.income.monthlyAveragePaise,
  'income.consistency': (r) => r.income.consistency,
  'income.monthsObserved': (r) => r.income.monthsObserved,
  'income.sources': (r) => r.income.sources.length,
  'obligations.monthlyObligationPaise': (r) => r.obligations.monthlyObligationPaise,
  'obligations.emiCount': (r) => r.obligations.emis.length,
  'cashflow.averageMonthlyNetPaise': (r) => r.cashflow.averageMonthlyNetPaise,
  'cashflow.minBalancePaise': (r) => r.cashflow.minBalancePaise,
  'cashflow.netPaise': (r) => r.cashflow.netPaise,
  'trends.netFlowDirection': (r) => r.trends.netFlowDirection,
  'trends.creditVolatilityPct': (r) => r.trends.creditVolatilityPct,
  'trends.debitVolatilityPct': (r) => r.trends.debitVolatilityPct,
  'signals.count': (r) => r.signals.length,
  'signals.count.high': (r) => r.signals.filter((s) => s.severity === 'high').length,
  'signals.count.medium': (r) => r.signals.filter((s) => s.severity === 'medium').length,
  'signals.count.low': (r) => r.signals.filter((s) => s.severity === 'low').length,
  'signals.rule': (r, arg) => r.signals.filter((s) => s.ruleId === (arg ?? '')).length,
  analyzedTransactions: (r) => r.analyzedTransactions,
};

const OPS: readonly string[] = ['lt', 'lte', 'eq', 'neq', 'gte', 'gt', 'in'];
const COMPARATOR: Record<ScorecardOp, (a: unknown, b: unknown) => boolean> = {
  lt: (a, b) => typeof a === 'number' && typeof b === 'number' && a < b,
  lte: (a, b) => typeof a === 'number' && typeof b === 'number' && a <= b,
  gt: (a, b) => typeof a === 'number' && typeof b === 'number' && a > b,
  gte: (a, b) => typeof a === 'number' && typeof b === 'number' && a >= b,
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  in: (a, b) => Array.isArray(b) && b.includes(a as never),
};

/** A metric key may carry a `:arg` suffix (e.g. `signals.rule:risk.bounce`). */
function resolveMetric(raw: string): { key: string; arg?: string } {
  const idx = raw.indexOf(':');
  return idx === -1 ? { key: raw } : { key: raw.slice(0, idx), arg: raw.slice(idx + 1) };
}

export class ScorecardSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScorecardSpecError';
  }
}

/** Validate a spec; throws ScorecardSpecError on the first defect. */
export function validateScorecardSpec(spec: unknown): asserts spec is ScorecardSpec {
  const s = spec as ScorecardSpec;
  if (!s || typeof s !== 'object') throw new ScorecardSpecError('spec must be an object');
  if (typeof s.id !== 'string' || s.id === '') throw new ScorecardSpecError('spec.id required');
  if (typeof s.version !== 'string' || s.version === '')
    throw new ScorecardSpecError('spec.version required');
  if (!Array.isArray(s.rules) || s.rules.length === 0)
    throw new ScorecardSpecError('spec.rules must be a non-empty array');
  const seen = new Set<string>();
  for (const rule of s.rules) {
    if (typeof rule.id !== 'string' || rule.id === '')
      throw new ScorecardSpecError('rule.id required');
    if (seen.has(rule.id)) throw new ScorecardSpecError(`duplicate rule id '${rule.id}'`);
    seen.add(rule.id);
    if (typeof rule.points !== 'number' || !Number.isFinite(rule.points))
      throw new ScorecardSpecError(`rule '${rule.id}' needs numeric points`);
    validateWhen(rule.when, `rule '${rule.id}'`);
  }
  for (const band of s.bands ?? []) {
    if (typeof band.label !== 'string' || typeof band.minScorePct !== 'number')
      throw new ScorecardSpecError('each band needs label + numeric minScorePct');
  }
}

function validateWhen(when: ScorecardWhen, where: string): void {
  if (!when || typeof when !== 'object') throw new ScorecardSpecError(`${where}: missing 'when'`);
  const c = when as ScorecardCondition;
  if (c.metric !== undefined) {
    const { key } = resolveMetric(c.metric);
    if (METRICS[key] === undefined)
      throw new ScorecardSpecError(`${where}: unknown metric '${c.metric}'`);
    if (!OPS.includes(c.op)) throw new ScorecardSpecError(`${where}: bad op '${c.op}'`);
    if (c.value === undefined) throw new ScorecardSpecError(`${where}: missing value`);
    return;
  }
  const composite = when as ScorecardComposite;
  const list = composite.all ?? composite.any;
  if (!Array.isArray(list) || list.length === 0)
    throw new ScorecardSpecError(`${where}: 'when' needs metric/op/value or non-empty all/any`);
  for (const inner of list) {
    // composites nest one level only — keep evaluation readable
    if (inner.all !== undefined || inner.any !== undefined)
      throw new ScorecardSpecError(`${where}: nested all/any not supported`);
    validateWhen(inner, where);
  }
}

type Verdict = 'matched' | 'missed' | 'unknown'; // unknown = missing data

function evalCondition(
  cond: ScorecardCondition,
  report: InsightsReport,
): {
  verdict: Verdict;
  observed: { metric: string; value: unknown };
} {
  const { key, arg } = resolveMetric(cond.metric);
  const extract = METRICS[key]!;
  const observed = extract(report, arg);
  if (observed === null || observed === undefined)
    return { verdict: 'unknown', observed: { metric: cond.metric, value: observed } };
  return {
    verdict: COMPARATOR[cond.op](observed, cond.value) ? 'matched' : 'missed',
    observed: { metric: cond.metric, value: observed },
  };
}

function evalWhen(
  when: ScorecardWhen,
  report: InsightsReport,
): { verdict: Verdict; observed: { metric: string; value: unknown }[] } {
  if ((when as ScorecardCondition).metric !== undefined) {
    const r = evalCondition(when as ScorecardCondition, report);
    return { verdict: r.verdict, observed: [r.observed] };
  }
  const comp = when as ScorecardComposite;
  const observed: { metric: string; value: unknown }[] = [];
  const verdicts: Verdict[] = [];
  for (const c of comp.all ?? comp.any ?? []) {
    const r = evalCondition(c, report);
    verdicts.push(r.verdict);
    observed.push(r.observed);
  }
  const verdict =
    comp.all !== undefined
      ? verdicts.every((v) => v === 'matched')
        ? 'matched'
        : verdicts.some((v) => v === 'missed')
          ? 'missed'
          : 'unknown'
      : verdicts.some((v) => v === 'matched')
        ? 'matched'
        : verdicts.some((v) => v === 'missed')
          ? 'missed'
          : 'unknown';
  return { verdict, observed };
}

/**
 * Evaluate a scorecard spec against an insights report. Pure and
 * deterministic — same report + same spec → byte-identical result.
 */
export function evaluateScorecard(report: InsightsReport, spec: ScorecardSpec): ScorecardResult {
  validateScorecardSpec(spec);

  const contributions: ScorecardContribution[] = [];
  const warnings: string[] = [];
  let score = 0;
  let maxScore = 0;
  let evaluableMax = 0;

  for (const rule of spec.rules) {
    maxScore += rule.points;
    const { verdict, observed } = evalWhen(rule.when, report);
    if (verdict !== 'unknown') evaluableMax += rule.points;
    if (verdict === 'matched') score += rule.points;
    if (verdict === 'unknown')
      warnings.push(
        `rule '${rule.id}' skipped — metric data missing (${observed
          .map((o) => o.metric)
          .join(', ')})`,
      );
    contributions.push({
      ruleId: rule.id,
      points: rule.points,
      matched: verdict === 'matched',
      observed,
      ...(rule.description !== undefined ? { description: rule.description } : {}),
    });
  }

  const scorePct = maxScore === 0 ? 0 : (score / maxScore) * 100;
  const coveragePct = maxScore === 0 ? 0 : (evaluableMax / maxScore) * 100;
  if (coveragePct < 60)
    warnings.push(
      `thin file — only ${coveragePct.toFixed(0)}% of scoreable rules had data; ` +
        `treat the score as low-confidence`,
    );

  const band =
    spec.bands
      ?.filter((b) => scorePct >= b.minScorePct)
      .sort((a, b) => b.minScorePct - a.minScorePct)[0]?.label ?? null;

  return {
    specId: spec.id,
    specVersion: spec.version,
    score,
    maxScore,
    scorePct,
    coveragePct,
    band,
    contributions,
    warnings,
  };
}
