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
 * Grammar-drift detection: compare a live batch of narrations against the
 * corpus-derived baseline for a bank. When a bank changes its narration
 * format, the match rate collapses — this surfaces it as a signal with
 * the exact unmatched samples, instead of silently mis-parsing.
 */

import { parseBankNarration, type ParseBankNarrationOptions } from './bankRules';
import { coverageReport } from './coverage';

export interface DriftCluster {
  /** Token skeleton shared by the cluster's samples (e.g. 'UPI-*-VAR-*'). */
  readonly skeleton: string;
  readonly count: number;
  readonly samples: readonly string[];
}

export interface DriftReport {
  readonly total: number;
  readonly matched: number;
  readonly matchRate: number;
  readonly avgConfidence: number;
  /** Corpus-derived expected match rate for the bank (null = no corpus). */
  readonly baselineMatchRate: number | null;
  /** Absolute match-rate drop below baseline that counts as drift. Default 0.2. */
  readonly drift: boolean;
  /** Unmatched narrations grouped by shared token skeleton. */
  readonly unmatchedClusters: readonly DriftCluster[];
  readonly warnings: readonly string[];
}

export interface DriftOptions extends ParseBankNarrationOptions {
  /** Bank whose corpus baseline the batch is compared against. */
  readonly bankHint?: string;
  /** Fraction of baseline drop that counts as drift. Default 0.2 (20%). */
  readonly dropThreshold?: number;
  /** Cap samples kept per unmatched cluster. Default 5. */
  readonly maxClusterSamples?: number;
}

const SEPARATORS = /[-/:| ]+/;

/** Rough skeleton: literal alpha tokens stay, digit runs become 'N'. */
export function skeletonOf(narration: string): string {
  return narration
    .split(SEPARATORS)
    .filter((tok) => tok !== '')
    .map((tok) => {
      if (/^\d+$/.test(tok)) return 'N';
      if (/^[A-Z]{4}\d{6,7}$/.test(tok)) return 'IFSC';
      if (/^\d{2}[-/.]?\d{2}[-/.]?\d{2,4}$/.test(tok)) return 'DATE';
      if (/^[A-Z]{2,4}$/.test(tok)) return tok; // channel markers: UPI, DR, NEFT…
      return /^[A-Za-z@._]+$/.test(tok) ? 'A' : '*';
    })
    .join('-');
}

/** Baseline match rate for a bank from its corpus file; null if absent. */
export function corpusBaseline(bankHint?: string): number | null {
  const reports = coverageReport();
  const want = (bankHint ?? 'GENERIC').toUpperCase();
  const hit = reports.find((r) => r.bank.toUpperCase() === want || r.bank === 'LEGACY');
  const exact = reports.find((r) => r.bank.toUpperCase() === want) ?? hit;
  if (exact === undefined || exact.total === 0) return null;
  return exact.ruleMatched / exact.total;
}

/**
 * Parse a batch of narrations and report drift vs the corpus baseline.
 * Deterministic, never throws on garbage narrations.
 */
export function analyzeNarrationBatch(
  narrations: readonly (string | { text: string; bankHint?: string })[],
  opts: DriftOptions = {},
): DriftReport {
  const warnings: string[] = [];
  let matched = 0;
  let confidenceSum = 0;
  const unmatched = new Map<string, string[]>();

  for (const item of narrations) {
    const text = typeof item === 'string' ? item : item.text;
    const hint =
      typeof item === 'object' && item.bankHint !== undefined ? item.bankHint : opts.bankHint;
    const parsed = parseBankNarration(hint !== undefined ? { text, bankHint: hint } : text, opts);
    confidenceSum += parsed.confidence;
    if (parsed.matched_rule !== null) {
      matched++;
    } else {
      const key = skeletonOf(text);
      const list = unmatched.get(key) ?? [];
      list.push(text);
      unmatched.set(key, list);
    }
  }

  const total = narrations.length;
  const matchRate = total === 0 ? 0 : matched / total;
  const avgConfidence = total === 0 ? 0 : confidenceSum / total;
  const baseline = corpusBaseline(opts.bankHint);
  const threshold = opts.dropThreshold ?? 0.2;
  const drift = baseline !== null && total > 0 && matchRate < baseline - threshold;

  if (drift) {
    warnings.push(
      `match rate ${(matchRate * 100).toFixed(1)}% is ${((baseline - matchRate) * 100).toFixed(
        0,
      )}pp below the ${opts.bankHint ?? 'GENERIC'} corpus baseline ` +
        `(${(baseline * 100).toFixed(1)}%) — the bank likely changed its narration format`,
    );
  }

  const maxSamples = opts.maxClusterSamples ?? 5;
  const unmatchedClusters = [...unmatched.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([skeleton, samples]) => ({
      skeleton,
      count: samples.length,
      samples: samples.slice(0, maxSamples),
    }));

  return {
    total,
    matched,
    matchRate,
    avgConfidence,
    baselineMatchRate: baseline,
    drift,
    unmatchedClusters,
    warnings,
  };
}
