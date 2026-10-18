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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectBankId } from '../src/bankNames';
import { loadBankNames, loadCsvLayouts } from '../src/formatsLoader';

interface IfscEntry {
  readonly name: string;
  readonly code: string;
}

const IFSC_FILE = join(
  __dirname,
  '..',
  '..',
  'rules-engine',
  'rules',
  'entities',
  'ifsc-codes.json',
);

/**
 * IFSC dictionary `code` ↔ bank-names `id` divergences, reviewed and
 * pinned here. A mismatch without an entry fails the gate — that is the
 * point: silent identity drift between the IFSC map and preamble
 * detection is exactly what this test exists to catch.
 */
const CODE_ALIASES: Readonly<Record<string, string>> = {
  CBI: 'CENTRAL_BANK',
  INDIAN: 'INDIAN_BANK',
  KARB: 'KARNATAKA',
  JKB: 'JAKB',
  PAYTM: 'PAYTM_PB',
  AIRTEL: 'AIRTEL_PB',
  FINO: 'FINO_PB',
  JIO: 'JIO_PB',
  AU: 'AU_SFB',
  NESFB: 'NESF',
  KVGB: 'KA_GRAMIN',
};

describe('bank identity consistency (IFSC ↔ bank-names)', () => {
  const bankNames = loadBankNames();
  const layouts = loadCsvLayouts();
  const ifsc = JSON.parse(readFileSync(IFSC_FILE, 'utf8')) as {
    banks: Record<string, IfscEntry>;
  };

  it('every IFSC bank name resolves to a bank-names id', () => {
    const misses: string[] = [];
    for (const [prefix, entry] of Object.entries(ifsc.banks)) {
      const detected = detectBankId(`${entry.name}\nstatement`, bankNames);
      if (detected === null) misses.push(`${prefix} ${entry.name}`);
    }
    expect(misses).toEqual([]);
  });

  it('detected id equals the IFSC code or a pinned alias', () => {
    const drift: string[] = [];
    for (const [prefix, entry] of Object.entries(ifsc.banks)) {
      const detected = detectBankId(`${entry.name}\nstatement`, bankNames);
      const expected = CODE_ALIASES[entry.code] ?? entry.code;
      if (detected !== null && detected !== expected) {
        drift.push(`${prefix} ${entry.name}: IFSC=${entry.code} detected=${detected}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('every csv-layout bank is a known bank-names id or GENERIC', () => {
    const ids = new Set(bankNames.banks.map((b) => b.id));
    const unknown = layouts.layouts
      .map((l) => l.bank)
      .filter((b) => b !== 'GENERIC' && !ids.has(b));
    expect(unknown).toEqual([]);
  });

  it('names with & / punctuation still detect after normalization', () => {
    expect(detectBankId('Jammu & Kashmir Bank Ltd\nSavings Account', bankNames)).toBe('JAKB');
    expect(detectBankId('Punjab & Sind Bank\nAccount Statement', bankNames)).toBe('PSB');
  });
});
