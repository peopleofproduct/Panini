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

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATEMENT_SPECS, generateCsvStatement } from '@paniniapi/simulator';
import {
  analyzeCsvStatement,
  analyzeTransactions,
  extractCsv,
  extractSmsText,
  initPaniniBrowser,
  parseNarration,
} from '../src';

const DIST = join(__dirname, '..', 'dist');

describe('browser entry (bundled data path)', () => {
  it('parses narrations with full grammar + dictionary enrichment', () => {
    initPaniniBrowser();
    const r = parseNarration('UPI/20261015/DR/826384910234/SWIGGY BUNDL/okaxis/');
    expect(r.channel).toBe('UPI');
    expect(r.is_salary).toBe(false);
    // Dictionary enrichment must resolve the canonical merchant — proves the
    // bundled merchant table loaded (not just grammars).
    expect(r.merchant ?? r.counterparty).toBeTruthy();
  });

  it('detects salary narrations via bundled rules', () => {
    const r = parseNarration('NEFT-N3452618902-SALARY-OCT 2025-ACME PVT LTD');
    expect(r.is_salary).toBe(true);
  });

  it('extracts a generated CSV statement with bundled layouts', () => {
    const spec = STATEMENT_SPECS.find((s) => s.layoutId === 'hdfc_statement')!;
    const gen = generateCsvStatement(spec, { seed: 7, transactions: 25 });
    const st = extractCsv(gen.text);
    expect(st.transactions.length).toBe(25);
    expect(st.layoutId).toBe('hdfc_statement');
  });

  it('extractSmsText parses a bank alert body', () => {
    const st = extractSmsText(
      'A/c XX1234 debited by Rs.1,250.00 on 15-Oct-26 UPI-SWIGGY@okaxis Avl Bal Rs.44,020.50',
    );
    expect(st.transactions.length).toBe(1);
    expect(st.transactions[0]?.amountPaise).toBe(125000);
    expect(st.accountMask).toBe('1234');
  });

  it('analyzeCsvStatement runs extract → enrich → insights', () => {
    const spec = STATEMENT_SPECS.find((s) => s.layoutId === 'icici_statement')!;
    const gen = generateCsvStatement(spec, { seed: 11, transactions: 30 });
    const r = analyzeCsvStatement(gen.text);
    expect(r.insights.analyzedTransactions).toBe(30);
    expect(r.insights.cashflow).toBeDefined();
    expect(r.insights.trends.monthly.length).toBeGreaterThan(0);
  });

  it('re-exported analyzeTransactions works standalone', () => {
    const r = analyzeTransactions([{ date: '2025-01-05', direction: 'CREDIT', amountPaise: 100 }]);
    expect(r.analyzedTransactions).toBe(1);
  });
});

describe('emitted bundle integrity', () => {
  for (const file of ['panini.browser.mjs', 'panini.browser.cjs', 'panini.browser.global.js']) {
    it(`${file} exists and contains zero node: imports`, () => {
      const path = join(DIST, file);
      expect(existsSync(path)).toBe(true);
      const code = readFileSync(path, 'utf8');
      expect(code).not.toMatch(/from ['"]node:/);
      expect(code).not.toMatch(/require\(['"]node:/);
      expect(code.length).toBeGreaterThan(50_000); // grammar data is inlined
    });
  }

  it('ESM bundle executes standalone — parses without the package barrels', () => {
    // Real node subprocess — proves the bundle runs outside the test runtime
    // and resolves no workspace imports.
    const script = `import('${join(DIST, 'panini.browser.mjs')}').then(m => { const r = m.parseNarration('NEFT-N3452618902-SALARY-OCT 2025-ACME PVT LTD'); if (r.is_salary !== true) process.exit(1); })`;
    execFileSync(process.execPath, ['--input-type=module', '-e', script]);
  });

  it('CJS bundle parses identically to the source entry', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../dist/panini.browser.cjs') as {
      parseNarration: (text: string) => ReturnType<typeof parseNarration>;
    };
    const a = mod.parseNarration('UPI/20261015/DR/826384910234/SWIGGY BUNDL/okaxis/');
    const b = parseNarration('UPI/20261015/DR/826384910234/SWIGGY BUNDL/okaxis/');
    expect(a).toEqual(b);
  });
});
