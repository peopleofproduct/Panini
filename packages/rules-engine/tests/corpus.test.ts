/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { checkSample, coverageReport, loadCorpus, type CorpusSample } from '../src';

describe('corpus — coverage gate', () => {
  const corpus = loadCorpus();

  it('has corpus fixtures for every bundled bank plus shared sets', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(10);
    for (const file of corpus) {
      expect(file.samples.length).toBeGreaterThan(0);
    }
  });

  it('reports the coverage summary table', () => {
    const report = coverageReport();
    console.log(
      [
        '',
        '  bank       samples  matched  passed  avgConf',
        '  ' + '-'.repeat(50),
        ...report.map(
          (r) =>
            `  ${r.bank.padEnd(10)} ${String(r.total).padStart(7)} ${String(r.ruleMatched).padStart(8)} ${String(
              r.passed,
            ).padStart(7)} ${r.avgConfidence.toFixed(2).padStart(8)}`,
        ),
        '',
      ].join('\n'),
    );
    expect(report.every((r) => r.ruleMatched > 0)).toBe(true);
  });

  // One generated test per corpus sample — the real coverage gate.
  for (const file of corpus) {
    describe(`${file.bank} (${file.samples.length} samples)`, () => {
      for (const sample of file.samples) {
        it(sample.input, () => {
          const failures = checkSample(sample as CorpusSample);
          expect(failures).toEqual([]);
        });
      }
    });
  }
});
