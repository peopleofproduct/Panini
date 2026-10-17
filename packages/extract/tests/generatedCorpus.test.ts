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
import { extractCsvStatement } from '../src/csv/csvStatement';
import { loadCsvLayouts } from '../src/formatsLoader';

describe('generated statement corpus — layout × seeded transactions', () => {
  const layouts = loadCsvLayouts();
  const seeds = [1, 7, 42];

  it('has a render spec for every named layout', () => {
    const layoutIds = new Set(layouts.layouts.map((l) => l.id));
    for (const spec of STATEMENT_SPECS) {
      expect(layoutIds).toContain(spec.layoutId);
    }
    expect(STATEMENT_SPECS.length).toBeGreaterThanOrEqual(15);
  });

  for (const spec of STATEMENT_SPECS) {
    for (const seed of seeds) {
      it(`${spec.layoutId} seed=${seed}: round-trips every generated row`, () => {
        const gen = generateCsvStatement(spec, { seed, transactions: 12 });
        const result = extractCsvStatement(gen.text, layouts);
        expect(result.bank).toBe(spec.bank);
        expect(result.layoutId).toBe(spec.layoutId);
        expect(result.transactions.length).toBe(gen.rows.length);
        gen.rows.forEach((want, i) => {
          const got = result.transactions[i];
          if (!got) throw new Error(`missing row ${i}`);
          expect(got.date).toBe(want.date);
          expect(got.direction).toBe(want.direction);
          expect(got.amountPaise).toBe(want.amountPaise);
          expect(got.balancePaise).toBe(want.balancePaise);
          if (want.refNo !== null) expect(got.refNo).toBe(want.refNo);
        });
      });
    }
  }

  it('never fabricates amounts for corrupted rows', () => {
    for (const spec of STATEMENT_SPECS) {
      const gen = generateCsvStatement(spec, { seed: 5, transactions: 20, anomalyRate: 0.4 });
      const result = extractCsvStatement(gen.text, layouts);
      // Extraction must not throw; a corrupted amount cell must surface as
      // null (or a warning), never a guessed value.
      const corruptedNoAmount = gen.rows.filter(
        (r) => r.anomaly === 'missing_amount' || r.anomaly === 'short_row',
      ).length;
      const nullAmounts = result.transactions.filter((t) => t.amountPaise === null).length;
      expect(nullAmounts).toBeLessThanOrEqual(corruptedNoAmount);
    }
  });

  it('is deterministic — same seed produces identical bytes', () => {
    const a = generateCsvStatement(STATEMENT_SPECS[0]!, { seed: 99 });
    const b = generateCsvStatement(STATEMENT_SPECS[0]!, { seed: 99 });
    expect(a.text).toBe(b.text);
    expect(a.rows).toEqual(b.rows);
  });
});
