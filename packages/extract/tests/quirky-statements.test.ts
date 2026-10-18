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

import {
  ALL_QUIRKS,
  generateQuirkyCsvStatement,
  STATEMENT_SPECS,
  type QuirkyStatement,
  type StatementQuirk,
} from '@paniniapi/simulator';
import { extractCsvStatement } from '../src/csv/csvStatement';
import { decodeBytes } from '../src/sniff';
import { loadCsvLayouts } from '../src/formatsLoader';
import type { ExtractedStatement } from '../src/types';

const layouts = loadCsvLayouts();

function extract(gen: QuirkyStatement): ExtractedStatement {
  const text = gen.content instanceof Uint8Array ? decodeBytes(gen.content) : gen.content;
  return extractCsvStatement(text, layouts);
}

function expectRowsRecovered(gen: QuirkyStatement, result: ExtractedStatement): void {
  expect(result.transactions.length).toBe(gen.rows.length);
  gen.rows.forEach((want, i) => {
    const got = result.transactions[i];
    if (!got) throw new Error(`missing row ${i}`);
    expect(got.date).toBe(want.date);
    expect(got.direction).toBe(want.direction);
    expect(got.amountPaise).toBe(want.amountPaise);
    if (gen.spec.balance !== undefined) expect(got.balancePaise).toBe(want.balancePaise);
    if (gen.spec.refNo !== undefined) expect(got.refNo).toBe(want.refNo);
    expect(got.narration).toBe(want.narration);
  });
}

describe('quirky generated statements', () => {
  describe('each quirk in isolation, across every layout', () => {
    for (const spec of STATEMENT_SPECS) {
      for (const quirk of ALL_QUIRKS) {
        it(`${spec.layoutId} + ${quirk}`, () => {
          const gen = generateQuirkyCsvStatement(spec, {
            seed: 7,
            transactions: 6,
            quirks: [quirk],
          });
          const result = extract(gen);
          expectRowsRecovered(gen, result);
        });
      }
    }
  });

  describe('seeded quirk combinations, across every layout', () => {
    for (const spec of STATEMENT_SPECS) {
      for (const seed of [1, 2, 3, 4, 5]) {
        it(`${spec.layoutId} seed=${seed}`, () => {
          const gen = generateQuirkyCsvStatement(spec, { seed, transactions: 10 });
          expect(gen.quirks.length).toBeGreaterThan(0);
          const result = extract(gen);
          expectRowsRecovered(gen, result);
        });
      }
    }
  });

  describe('quirk-specific expectations', () => {
    const withBalance = STATEMENT_SPECS.find((s) => s.balance !== undefined);
    if (!withBalance) throw new Error('no balance spec registered');

    it('opening_closing_rows → metadata, not transactions', () => {
      const gen = generateQuirkyCsvStatement(withBalance, {
        seed: 11,
        transactions: 5,
        quirks: ['opening_closing_rows'],
        openingBalancePaise: 10_000_00,
      });
      const result = extract(gen);
      expect(result.metadata['openingBalancePaise']).toBe('1000000');
      const last = gen.rows[gen.rows.length - 1]!;
      expect(result.metadata['closingBalancePaise']).toBe(String(last.balancePaise));
      // The marker rows must not inflate the transaction count.
      expectRowsRecovered(gen, result);
    });

    it('wrapped_narration → joined with a warning, still one row', () => {
      const gen = generateQuirkyCsvStatement(withBalance, {
        seed: 12,
        transactions: 5,
        quirks: ['wrapped_narration'],
      });
      const result = extract(gen);
      expectRowsRecovered(gen, result);
      const allWarnings = result.transactions.map((t) => t.warnings.join(' ')).join(' ');
      expect(allWarnings).toContain('narration continued');
    });

    it('footer_noise → boilerplate never becomes a transaction', () => {
      const gen = generateQuirkyCsvStatement(withBalance, {
        seed: 13,
        transactions: 5,
        quirks: ['footer_noise'],
      });
      const result = extract(gen);
      expectRowsRecovered(gen, result);
      const narrations = result.transactions.map((t) => t.narration).join(' ');
      expect(narrations).not.toContain('END OF STATEMENT');
      expect(narrations).not.toContain('computer generated');
    });

    it('utf16le bytes decode to identical rows', () => {
      const plain = generateQuirkyCsvStatement(withBalance, { seed: 14, transactions: 5 });
      const utf16 = generateQuirkyCsvStatement(withBalance, {
        seed: 14,
        transactions: 5,
        quirks: ['utf16le'],
      });
      expect(utf16.content).toBeInstanceOf(Uint8Array);
      const a = extract(plain);
      const b = extract(utf16);
      expect(b.transactions.map((t) => t.date + t.amountPaise)).toEqual(
        a.transactions.map((t) => t.date + t.amountPaise),
      );
    });
  });
});

// Type-level coverage: every quirk name round-trips through the union.
const _all: readonly StatementQuirk[] = ALL_QUIRKS;
void _all;
