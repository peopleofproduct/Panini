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

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectBankId } from '../src/bankNames';
import { extractStatement, statementFromFragments } from '../src/index';
import { loadBankNames, loadCsvLayouts } from '../src/formatsLoader';

const bankNames = loadBankNames();

describe('detectBankId', () => {
  it('identifies a bank from its letterhead line', () => {
    expect(detectBankId('BANDHAN BANK LTD\nAccount No : XXXX1\n', bankNames)).toBe('BANDHAN');
  });

  it('longest name on a line wins over the substring inside it', () => {
    expect(detectBankId('UNION BANK OF INDIA\n', bankNames)).toBe('UNION');
    expect(detectBankId('SOUTH INDIAN BANK\n', bankNames)).toBe('SIB');
    expect(detectBankId('CENTRAL BANK OF INDIA\n', bankNames)).toBe('CENTRAL_BANK');
  });

  it('is word-bounded — "citi" never hits inside "city union bank"', () => {
    expect(detectBankId('CITY UNION BANK LTD\n', bankNames)).toBe('CUB');
  });

  it('ignores bank names outside the preamble scan window', () => {
    const narration = 'NEFT CREDIT FROM HDFC BANK';
    const text = `${Array(25).fill('noise line').join('\n')}\n${narration}`;
    expect(detectBankId(text, bankNames)).toBeNull();
  });
});

const GENERIC_BANDHAN_CSV = `BANDHAN BANK LTD
Account No : XXXXXX7777
Posting Date,Details,Debit,Credit,Running Balance
2026-10-15,UPI-SALARY,,50000.00,95000.00
2026-10-16,CARD PURCHASE POS ZOMATO,450.00,,94550.00`;

describe('bank detection in extraction', () => {
  it('names an uncovered bank even when it parses generically', async () => {
    const result = await extractStatement(GENERIC_BANDHAN_CSV);
    expect(result.bank).toBe('BANDHAN');
    expect(result.metadata['bankSource']).toBe('preamble');
    expect(result.transactions).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('generic fallback');
    expect(result.warnings.join(' ')).toContain('BANDHAN');
  });

  it('dedicated-layout statements keep layout provenance and stay silent', async () => {
    const csv = `HDFC BANK LTD
Account No : XXXXXX1111
Date,Narration,Chq Ref No,Withdrawal Amt,Deposit Amt,Closing Balance
15/10/2026,UPI/123/CR/SALARY,R1,,50000.00,95000.00`;
    const result = await extractStatement(csv);
    expect(result.bank).toBe('HDFC');
    expect(result.metadata['bankSource']).toBe('layout');
    expect(result.warnings.join(' ')).not.toContain('generic fallback');
  });

  it('detects the bank on pdf letterhead fragments', () => {
    const frags = [
      { page: 0, x: 0, y: 700, text: 'INDIAN' },
      { page: 0, x: 50, y: 700, text: 'BANK' },
      { page: 0, x: 0, y: 680, text: 'Account' },
      { page: 0, x: 60, y: 680, text: 'XXXXX22' },
    ];
    const result = statementFromFragments(frags, { bankNames });
    expect(result.bank).toBe('INDIAN_BANK');
    expect(result.metadata['bankSource']).toBe('preamble');
  });
});

describe('extraFormatsDir', () => {
  it('lets a caller append a private bank layout without forking formats', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'panini-formats-'));
    writeFileSync(
      join(dir, 'csv-layouts.json'),
      JSON.stringify({
        layouts: [
          {
            id: 'private_bank_statement',
            bank: 'PRIVATEBANK',
            requiredHeaders: ['posting date', 'memo', 'dr amt', 'cr amt'],
            columns: {
              date: ['posting date'],
              narration: ['memo'],
              debit: ['dr amt'],
              credit: ['cr amt'],
              balance: ['running total'],
            },
          },
        ],
      }),
    );
    const csv = `PRIVATE CO-OP BANK
Posting Date,Memo,Dr Amt,Cr Amt,Running Total
15/10/2026,UPI-INWARD,,1000.00,11000.00`;
    const result = await extractStatement(csv, { extraFormatsDir: dir });
    expect(result.bank).toBe('PRIVATEBANK');
    expect(result.layoutId).toBe('private_bank_statement');
    expect(result.transactions).toHaveLength(1);
  });

  it('caller layouts shadow a bundled layout with the same id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'panini-formats-'));
    writeFileSync(
      join(dir, 'csv-layouts.json'),
      JSON.stringify({
        layouts: [
          {
            id: 'hdfc_statement',
            bank: 'SHADOWED',
            requiredHeaders: ['posting date', 'details'],
            columns: {
              date: ['posting date'],
              narration: ['details'],
              debit: ['debit'],
              credit: ['credit'],
              balance: ['running balance'],
            },
          },
        ],
      }),
    );
    const layouts = loadCsvLayouts();
    expect(layouts.layouts.find((l) => l.id === 'hdfc_statement')?.bank).toBe('HDFC');
    const csv = `Posting Date,Details,Debit,Credit,Running Balance
2026-10-15,X,1.00,,900.00`;
    const result = await extractStatement(csv, { extraFormatsDir: dir });
    expect(result.bank).toBe('SHADOWED');
  });
});
