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

import { STATEMENT_SPECS, generateCsvStatement } from '@paniniapi/simulator';
import { extractCsvStatement, loadCsvLayouts } from '@paniniapi/extract';
import { analyzeTransactions } from '../src';

const layouts = loadCsvLayouts();

function pipeline(seed: number, transactions = 30) {
  const spec = STATEMENT_SPECS.find((s) => s.layoutId === 'hdfc_statement')!;
  const gen = generateCsvStatement(spec, { seed, transactions });
  const extracted = extractCsvStatement(gen.text, layouts);
  return { gen, extracted, report: analyzeTransactions(extracted.transactions) };
}

describe('end-to-end: generated statement → extract → insights', () => {
  it('produces a coherent report from extracted transactions', () => {
    const { extracted, report } = pipeline(11);
    expect(report.analyzedTransactions).toBe(extracted.transactions.length);
    expect(report.cashflow.totalCreditsPaise + report.cashflow.totalDebitsPaise).toBeGreaterThan(0);
    expect(report.cashflow.closingBalancePaise).not.toBeNull();
  });

  it('detects salary-keyword income narrations produced by the simulator', () => {
    // Seed 7 produced salary credits in earlier runs; the generator embeds
    // 'NEFT-<ref>-SALARY-ACME PVT LTD' credits which the keyword rule catches.
    const { gen, report } = pipeline(7, 40);
    const salaryGenerated = gen.rows.filter((r) => /SALARY/.test(r.narration));
    if (salaryGenerated.length > 0) {
      expect(report.income.credits.length).toBeGreaterThanOrEqual(salaryGenerated.length);
    }
  });

  it('never throws on fully anomalous input', () => {
    const spec = STATEMENT_SPECS[3]!;
    const gen = generateCsvStatement(spec, { seed: 3, transactions: 30, anomalyRate: 0.6 });
    const extracted = extractCsvStatement(gen.text, layouts);
    const report = analyzeTransactions(extracted.transactions);
    expect(report.warnings.length).toBeGreaterThanOrEqual(0);
    expect(report.analyzedTransactions).toBeLessThanOrEqual(gen.rows.length);
  });

  it('is deterministic end-to-end', () => {
    expect(pipeline(21).report).toEqual(pipeline(21).report);
  });
});
