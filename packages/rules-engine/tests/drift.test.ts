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

import { analyzeNarrationBatch, corpusBaseline, skeletonOf } from '../src/drift';
import { suggestGrammarRule } from '../src/suggest';
import { loadCorpus } from '../src/coverage';
import { parseBankNarration } from '../src/bankRules';

const KNOWN = [
  'UPI/402345678912/DR/SWIGGY@okaxis/RENT/',
  'NEFT-N3452618902-SALARY-TCS LTD',
  'POS 415982XXXXXX0342 ZOMATO',
];

describe('analyzeNarrationBatch', () => {
  it('corpus narrations match at baseline → no drift', () => {
    const corpus = loadCorpus();
    const hdfc = corpus.find((f) => f.bank === 'KOTAK')!;
    const report = analyzeNarrationBatch(
      hdfc.samples.map((s) =>
        s.bankHint !== undefined ? { text: s.input, bankHint: s.bankHint } : s.input,
      ),
      { bankHint: 'KOTAK' },
    );
    expect(report.drift).toBe(false);
    expect(report.baselineMatchRate).toBeGreaterThan(0.8);
    expect(report.matchRate).toBeGreaterThanOrEqual(report.baselineMatchRate! - 0.05);
  });

  it('a format the grammar has never seen triggers drift', () => {
    const alien = Array.from(
      { length: 20 },
      (_, i) => `XNACH|TXN|${String(100000000 + i)}|MERCHANT ${i}|ONLINE`,
    );
    const report = analyzeNarrationBatch([...KNOWN, ...alien], { bankHint: 'KOTAK' });
    expect(report.drift).toBe(true);
    expect(report.warnings[0]).toContain('below');
    const cluster = report.unmatchedClusters[0];
    expect(cluster).toBeDefined();
    expect(cluster!.count).toBe(20);
  });

  it('custom threshold widens/narrows sensitivity', () => {
    const half = [...KNOWN, ...KNOWN.map((n) => `XYZZY-${n}`)];
    const report = analyzeNarrationBatch(half, { bankHint: 'KOTAK', dropThreshold: 0.9 });
    expect(report.drift).toBe(false); // 90pp drop allowed → half-matched is fine
  });

  it('empty batch → no drift, zero rate', () => {
    const report = analyzeNarrationBatch([]);
    expect(report.total).toBe(0);
    expect(report.drift).toBe(false);
  });
});

describe('skeletonOf', () => {
  it('stabilises literals, normalises digits', () => {
    expect(skeletonOf('UPI/402345678912/DR/SWIGGY@okaxis/RENT/')).toBe('UPI-N-DR-A-RENT');
  });
});

describe('suggestGrammarRule', () => {
  it('drafts a working pattern from same-skeleton samples', () => {
    const samples = [
      'XNACH|TXN|100000001|MERCHANT A|ONLINE',
      'XNACH|TXN|100000002|MERCHANT B|ONLINE',
      'XNACH|TXN|100000003|MERCHANT C|ONLINE',
    ];
    const s = suggestGrammarRule(samples);
    expect(s).not.toBeNull();
    expect(s!.safe).toBe(true);
    // the draft actually matches the sample shape through the real engine
    const parsed = parseBankNarration(samples[0]!, {
      bare: true,
      ruleSets: [
        {
          id: 'test-overlay',
          bank: 'GENERIC',
          version: '0',
          patterns: [s!.pattern],
        },
      ],
    });
    expect(parsed.matched_rule).toBe('test-overlay:' + s!.pattern.name);
  });

  it('heterogeneous samples → no safe draft', () => {
    const s = suggestGrammarRule(['ALPHA-BETA-GAMMA', '1-2-3-4-5-6', 'TOTALLY DIFFERENT TEXT']);
    expect(s === null || s.safe === false).toBe(true);
  });
});

describe('corpusBaseline', () => {
  it('returns the corpus match-rate for a known bank', () => {
    expect(corpusBaseline('KOTAK')).toBeGreaterThan(0.8);
  });
});
