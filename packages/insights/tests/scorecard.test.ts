/**
 * Copyright 2026 Kapil — Project Panini Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeTransactions } from '../src/analyze';
import {
  evaluateScorecard,
  validateScorecardSpec,
  ScorecardSpecError,
  type ScorecardSpec,
} from '../src/scorecard';
import type { InsightsReport } from '../src/types';

const REFERENCE_SPEC = JSON.parse(
  readFileSync(join(__dirname, '..', 'scorecards', 'reference.json'), 'utf8'),
) as ScorecardSpec;

/** A minimal synthetic report: shape-matches InsightsReport, no noise. */
function stubReport(over: Partial<InsightsReport> = {}): InsightsReport {
  return {
    income: {
      credits: [],
      sources: [],
      monthlyAveragePaise: null,
      consistency: 'insufficient_data',
      monthsObserved: 0,
    },
    obligations: { recurring: [], emis: [], monthlyObligationPaise: null },
    foir: { ratio: null, monthlyIncomePaise: null, monthlyObligationPaise: null, note: '' },
    cashflow: {
      totalCreditsPaise: 0,
      totalDebitsPaise: 0,
      netPaise: 0,
      monthsObserved: 0,
      averageMonthlyNetPaise: null,
      minBalancePaise: null,
      maxBalancePaise: null,
      closingBalancePaise: null,
    },
    trends: {
      monthly: [],
      netFlowDirection: 'insufficient_data',
      balanceVelocityPaisePerDay: null,
      creditVolatilityPct: null,
      debitVolatilityPct: null,
    },
    signals: [],
    warnings: [],
    analyzedTransactions: 0,
    ...over,
  };
}

const HEALTHY = stubReport({
  income: {
    credits: [],
    sources: ['ACME Corp'],
    monthlyAveragePaise: 50_000_00,
    consistency: 'regular',
    monthsObserved: 6,
  },
  foir: { ratio: 0.4, monthlyIncomePaise: 50_000_00, monthlyObligationPaise: 20_000_00, note: '' },
  cashflow: {
    totalCreditsPaise: 300_000_00,
    totalDebitsPaise: 200_000_00,
    netPaise: 100_000_00,
    monthsObserved: 6,
    averageMonthlyNetPaise: 16_666_00,
    minBalancePaise: 5_000_00,
    maxBalancePaise: 120_000_00,
    closingBalancePaise: 100_000_00,
  },
  trends: {
    monthly: [],
    netFlowDirection: 'improving',
    balanceVelocityPaisePerDay: 500,
    creditVolatilityPct: 2,
    debitVolatilityPct: 5,
  },
  analyzedTransactions: 120,
});

describe('validateScorecardSpec', () => {
  it('accepts the shipped reference spec', () => {
    expect(() => validateScorecardSpec(REFERENCE_SPEC)).not.toThrow();
  });

  it('rejects unknown metrics', () => {
    expect(() =>
      validateScorecardSpec({
        id: 'x',
        version: '1',
        rules: [{ id: 'r', points: 1, when: { metric: 'bogus.metric', op: 'gt', value: 0 } }],
      }),
    ).toThrow(ScorecardSpecError);
  });

  it('rejects duplicate rule ids and nested composites', () => {
    const base = { id: 'x', version: '1' };
    expect(() =>
      validateScorecardSpec({
        ...base,
        rules: [
          { id: 'a', points: 1, when: { metric: 'foir.ratio', op: 'lt', value: 1 } },
          { id: 'a', points: 1, when: { metric: 'foir.ratio', op: 'lt', value: 1 } },
        ],
      }),
    ).toThrow("duplicate rule id 'a'");
    expect(() =>
      validateScorecardSpec({
        ...base,
        rules: [
          {
            id: 'a',
            points: 1,
            when: { all: [{ all: [{ metric: 'foir.ratio', op: 'lt', value: 1 }] }] },
          },
        ],
      }),
    ).toThrow('nested all/any');
  });
});

describe('evaluateScorecard', () => {
  it('healthy report scores at the top band with full trace', () => {
    const r = evaluateScorecard(HEALTHY, REFERENCE_SPEC);
    expect(r.score).toBe(95); // every rule fires except 'foir.stretched' (FOIR 0.4 ≤ 0.5)
    expect(r.maxScore).toBe(100);
    expect(r.band).toBe('strong_facts');
    expect(r.coveragePct).toBe(100);
    const trace = r.contributions.find((c) => c.ruleId === 'foir.comfortable')!;
    expect(trace.matched).toBe(true);
    expect(trace.observed[0]).toEqual({ metric: 'foir.ratio', value: 0.4 });
  });

  it('missing metrics drop coverage and warn — never fake a score', () => {
    const empty = stubReport();
    const r = evaluateScorecard(empty, REFERENCE_SPEC);
    expect(r.score).toBe(0);
    // half the card is still evaluable on empty data (counts/enums are
    // never null) — that's the point of coveragePct
    expect(r.coveragePct).toBe(50);
    expect(r.warnings.some((w) => w.includes('thin file'))).toBe(true);
  });

  it('composites: all requires every condition, any needs one', () => {
    const spec: ScorecardSpec = {
      id: 't',
      version: '1',
      rules: [
        {
          id: 'all',
          points: 10,
          when: {
            all: [
              { metric: 'foir.ratio', op: 'lt', value: 1 },
              { metric: 'income.consistency', op: 'eq', value: 'regular' },
            ],
          },
        },
        {
          id: 'any',
          points: 5,
          when: {
            any: [
              { metric: 'income.consistency', op: 'eq', value: 'irregular' },
              { metric: 'income.consistency', op: 'eq', value: 'regular' },
            ],
          },
        },
      ],
    };
    const r = evaluateScorecard(HEALTHY, spec);
    expect(r.contributions.find((c) => c.ruleId === 'all')!.matched).toBe(true);
    expect(r.contributions.find((c) => c.ruleId === 'any')!.matched).toBe(true);
    expect(r.score).toBe(15);
  });

  it('signals.rule:arg counts a specific rule id', () => {
    const spec: ScorecardSpec = {
      id: 't',
      version: '1',
      rules: [
        {
          id: 'bounced',
          points: 10,
          when: { metric: 'signals.rule:risk.bounce', op: 'eq', value: 0 },
        },
      ],
    };
    const withBounce = stubReport({
      signals: [{ ruleId: 'risk.bounce', severity: 'high', note: '', evidence: [] }],
    });
    expect(evaluateScorecard(withBounce, spec).score).toBe(0);
    expect(evaluateScorecard(HEALTHY, spec).score).toBe(10);
  });

  it('is deterministic — same input, identical output', () => {
    expect(evaluateScorecard(HEALTHY, REFERENCE_SPEC)).toEqual(
      evaluateScorecard(HEALTHY, REFERENCE_SPEC),
    );
  });

  it('end-to-end: analyzeTransactions → evaluateScorecard', () => {
    const txns = [
      {
        date: '2026-01-01',
        amountPaise: 80_000_00,
        direction: 'CREDIT' as const,
        narration: 'SALARY ACME CORP',
        category: 'Income',
      },
      {
        date: '2026-02-01',
        amountPaise: 80_000_00,
        direction: 'CREDIT' as const,
        narration: 'SALARY ACME CORP',
        category: 'Income',
      },
      {
        date: '2026-03-01',
        amountPaise: 80_000_00,
        direction: 'CREDIT' as const,
        narration: 'SALARY ACME CORP',
        category: 'Income',
      },
      {
        date: '2026-01-05',
        amountPaise: 20_000_00,
        direction: 'DEBIT' as const,
        narration: 'EMI HDFC BANK',
        category: 'Loan & EMI',
      },
    ];
    const report = analyzeTransactions(txns);
    const r = evaluateScorecard(report, REFERENCE_SPEC);
    expect(r.scorePct).toBeGreaterThan(0);
    expect(r.coveragePct).toBeGreaterThan(0);
  });
});
