/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCategories, loadTaxonomy, lookupMerchant, parseBankNarration } from '../src';
import type { MerchantEntry } from '../src/dictionary';

interface GoldCase {
  readonly input: string;
  readonly expect: Record<string, unknown>;
}
interface GoldFile {
  readonly version: number;
  readonly description: string;
  readonly cases: readonly GoldCase[];
}
interface SetMetrics {
  total: number;
  passed: number;
  passRate: number;
  avgConfidence: number;
  ruleMatchRate: number;
}
interface Baseline {
  readonly version: number;
  readonly sets: Record<string, SetMetrics>;
}

const EVAL_DIR = join(__dirname, '..', 'eval');
const BASELINE_PATH = join(EVAL_DIR, 'baseline.json');

function loadGold(name: string): GoldFile {
  return JSON.parse(readFileSync(join(EVAL_DIR, `${name}.gold.json`), 'utf8')) as GoldFile;
}

function fieldFailures(expect: Record<string, unknown>, actual: Record<string, unknown>): string[] {
  return Object.entries(expect)
    .filter(([field, want]) => actual[field] !== want)
    .map(
      ([field, want]) =>
        `${field}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual[field])}`,
    );
}

/** Runs a gold set; returns per-case failures plus aggregate metrics. */
function runGoldSet(
  name: string,
  evaluate: (input: string) => Record<string, unknown>,
): { failures: { input: string; problems: string[] }[]; metrics: SetMetrics } {
  const gold = loadGold(name);
  const failures: { input: string; problems: string[] }[] = [];
  let confidence = 0;
  let ruleMatched = 0;
  for (const c of gold.cases) {
    const actual = evaluate(c.input);
    const problems = fieldFailures(c.expect, actual);
    if (problems.length > 0) failures.push({ input: c.input, problems });
    if (typeof actual['confidence'] === 'number') confidence += actual['confidence'];
    if (typeof actual['matched_rule'] === 'string' && actual['matched_rule'] !== null)
      ruleMatched++;
  }
  const total = gold.cases.length;
  return {
    failures,
    metrics: {
      total,
      passed: total - failures.length,
      passRate: total > 0 ? (total - failures.length) / total : 0,
      avgConfidence: total > 0 ? confidence / total : 0,
      ruleMatchRate: total > 0 ? ruleMatched / total : 0,
    },
  };
}

const narrationSet = runGoldSet('narration', (input) => {
  const r = parseBankNarration(input);
  return {
    channel: r.channel,
    type: r.type,
    counterparty: r.counterparty,
    merchant: r.merchant,
    category: r.category,
    ref_no: r.ref_no,
    vpa: r.vpa,
    confidence: r.confidence,
    matched_rule: r.matched_rule,
    schema_version: r.schema_version,
    category_id: r.category_id,
    category_group: r.category_group,
    category_source: r.category_source,
    counterparty_kind: r.counterparty_kind,
    ref_kind: r.ref_kind,
    mcc: r.mcc,
  };
});

const categorySet = runGoldSet('category', (input) => ({
  category: parseBankNarration(input).category,
}));

const merchantSet = runGoldSet('merchant', (input) => {
  const entry: MerchantEntry | null = lookupMerchant(input);
  return {
    canonical: entry?.canonical ?? null,
    category: entry?.category ?? null,
    mcc: entry?.mcc ?? null,
  };
});

const mccSet = runGoldSet('mcc', (input) => {
  const r = parseBankNarration(input);
  return { mcc: r.mcc, mcc_description: r.mcc_description, category: r.category };
});

const ALL_SETS: Record<
  string,
  { failures: { input: string; problems: string[] }[]; metrics: SetMetrics }
> = {
  narration: narrationSet,
  category: categorySet,
  merchant: merchantSet,
  mcc: mccSet,
};

describe('eval — gold sets', () => {
  for (const [name, result] of Object.entries(ALL_SETS)) {
    describe(`${name}.gold.json (${result.metrics.total} cases)`, () => {
      it('every case passes its asserted fields', () => {
        const report = result.failures
          .map((f) => `  ${f.input}\n    ${f.problems.join('\n    ')}`)
          .join('\n');
        expect(report === '' ? [] : report).toEqual([]);
      });
    });
  }

  it('metrics do not regress below baseline (set PANINI_EVAL_UPDATE=1 to re-baseline)', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
    const current = Object.fromEntries(
      Object.entries(ALL_SETS).map(([name, r]) => [name, r.metrics]),
    );
    if (process.env['PANINI_EVAL_UPDATE'] === '1') {
      writeFileSync(BASELINE_PATH, JSON.stringify({ version: 1, sets: current }, null, 2) + '\n');
      return;
    }
    const regressions: string[] = [];
    for (const [name, metrics] of Object.entries(current)) {
      const base = baseline.sets[name];
      if (base === undefined) {
        regressions.push(`${name}: missing from baseline — run PANINI_EVAL_UPDATE=1`);
        continue;
      }
      if (metrics.total < base.total)
        regressions.push(`${name}: case count shrank ${base.total} → ${metrics.total}`);
      if (metrics.passed < base.passed)
        regressions.push(`${name}: passed ${base.passed} → ${metrics.passed}`);
      if (metrics.avgConfidence < base.avgConfidence - 1e-9)
        regressions.push(
          `${name}: avgConfidence ${base.avgConfidence.toFixed(3)} → ${metrics.avgConfidence.toFixed(3)}`,
        );
      if (metrics.ruleMatchRate < base.ruleMatchRate - 1e-9)
        regressions.push(
          `${name}: ruleMatchRate ${base.ruleMatchRate.toFixed(3)} → ${metrics.ruleMatchRate.toFixed(3)}`,
        );
    }
    expect(regressions).toEqual([]);
  });
});

describe('taxonomy governance', () => {
  it('categories.json labels and taxonomy.json entries stay in lockstep', () => {
    const labels = new Set(Object.values(loadCategories()));
    const taxonomy = loadTaxonomy();
    const known = new Set(Object.keys(taxonomy.categories));
    expect([...labels].filter((l) => !known.has(l))).toEqual([]);
    expect([...known].filter((l) => !labels.has(l))).toEqual([]);
    for (const [label, entry] of Object.entries(taxonomy.categories)) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.group.length).toBeGreaterThan(0);
      expect(label).not.toBe('Uncategorized');
    }
  });
});
