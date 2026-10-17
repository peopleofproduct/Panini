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

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractCsvStatement } from '../src/csv/csvStatement';
import { extractSms } from '../src/sms';
import { loadCsvLayouts, loadSmsPatterns, resolveFormatsDir } from '../src/formatsLoader';

const CORPUS = join(resolveFormatsDir(), 'corpus');

interface CsvExpectRow {
  readonly date?: string;
  readonly direction?: string;
  readonly amountPaise?: number;
  readonly balancePaise?: number;
  readonly refNo?: string;
}

interface Fixture {
  readonly id: string;
  readonly format: string;
  readonly input?: string;
  readonly expect?: {
    readonly bank?: string | null;
    readonly layoutId?: string;
    readonly accountMask?: string;
    readonly count?: number;
    readonly rows?: readonly CsvExpectRow[];
  };
  readonly samples?: readonly {
    readonly input: string;
    readonly expect: Record<string, unknown>;
  }[];
}

const files = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('formats corpus', () => {
  const layouts = loadCsvLayouts();
  const smsFile = loadSmsPatterns();

  for (const name of files) {
    const fixture = JSON.parse(readFileSync(join(CORPUS, name), 'utf8')) as Fixture;

    if (fixture.format === 'csv' && fixture.input && fixture.expect) {
      it(`${name}: detects ${fixture.expect.layoutId} and extracts ${fixture.expect.count} rows`, () => {
        const result = extractCsvStatement(fixture.input as string, layouts);
        const expect_ = fixture.expect as NonNullable<Fixture['expect']>;
        expect(result.bank).toBe(expect_.bank);
        expect(result.layoutId).toBe(expect_.layoutId);
        if (expect_.accountMask !== undefined) expect(result.accountMask).toBe(expect_.accountMask);
        expect(result.transactions.length).toBe(expect_.count);
        (expect_.rows ?? []).forEach((want, i) => {
          const got = result.transactions[i];
          if (!got) throw new Error(`missing row ${i}`);
          if (want.date !== undefined) expect(got.date).toBe(want.date);
          if (want.direction !== undefined) expect(got.direction).toBe(want.direction);
          if (want.amountPaise !== undefined) expect(got.amountPaise).toBe(want.amountPaise);
          if (want.balancePaise !== undefined) expect(got.balancePaise).toBe(want.balancePaise);
          if (want.refNo !== undefined) expect(got.refNo).toBe(want.refNo);
        });
      });
    }

    if (fixture.format === 'sms' && fixture.samples) {
      for (const [i, sample] of fixture.samples.entries()) {
        it(`${name}[${i}]`, () => {
          const result = extractSms(sample.input, smsFile);
          expect(result.transactions.length).toBe(1);
          const txn = result.transactions[0];
          if (!txn) throw new Error('no transaction');
          const got: Record<string, unknown> = {
            direction: txn.direction,
            amountPaise: txn.amountPaise,
            balancePaise: txn.balancePaise,
            date: txn.date,
            accountMask: result.accountMask,
          };
          for (const [key, want] of Object.entries(sample.expect)) {
            expect(got[key]).toBe(want);
          }
        });
      }
    }
  }

  it('covers every corpus file', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });
});
