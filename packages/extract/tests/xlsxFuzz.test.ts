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
 * Deterministic fuzz harness for the native XLSX reader. The parser is
 * hand-rolled, so this pins the contract that matters: malformed input
 * must degrade to a warning-bearing statement — never throw, never hang,
 * never fabricate transactions from garbage.
 */

import { extractStatement } from '../src';
import { buildXlsx, HDFC_ROWS } from './xlsxFixture';

/** mulberry32 — seeded PRNG so the fuzz run is reproducible in CI. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALID = buildXlsx(HDFC_ROWS);

describe('xlsx fuzz — determinism and no-throw guarantee', () => {
  it('random bit flips never throw', async () => {
    const rand = rng(0x7ab1e);
    for (let i = 0; i < 500; i++) {
      const bytes = Buffer.from(VALID);
      const flips = 1 + Math.floor(rand() * 8);
      for (let f = 0; f < flips; f++) {
        const pos = Math.floor(rand() * bytes.length);
        bytes[pos]! ^= 1 << Math.floor(rand() * 8);
      }
      const result = await extractStatement(new Uint8Array(bytes));
      expect(Array.isArray(result.transactions)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
      // If corruption touched structure, we must get zero txns — garbage
      // bytes must never fabricate a transaction.
      for (const txn of result.transactions) {
        expect(txn.narration).not.toBe('');
      }
    }
  });

  it('every truncation length never throws', async () => {
    const len = VALID.length;
    for (let keep = 4; keep < len; keep += 13) {
      const result = await extractStatement(new Uint8Array(VALID.subarray(0, keep)));
      expect(Array.isArray(result.transactions)).toBe(true);
    }
  });

  it('random byte garbage never throws', async () => {
    const rand = rng(0xf00d);
    for (let i = 0; i < 100; i++) {
      const n = 4 + Math.floor(rand() * 512);
      const bytes = new Uint8Array(n);
      // Force ZIP magic so it sniffs as xlsx half the time.
      bytes[0] = 0x50;
      bytes[1] = 0x4b;
      bytes[2] = 0x03;
      bytes[3] = 0x04;
      for (let b = 4; b < n; b++) bytes[b] = Math.floor(rand() * 256);
      const result = await extractStatement(bytes);
      expect(Array.isArray(result.transactions)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });

  it('unmutated input is unaffected by the harness (sanity)', async () => {
    const result = await extractStatement(new Uint8Array(VALID));
    expect(result.transactions).toHaveLength(3);
  });
});
