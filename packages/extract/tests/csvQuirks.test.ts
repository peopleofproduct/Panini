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

import { extractCsvStatement } from '../src/csv/csvStatement';
import { extractStatement } from '../src/extract';
import { loadCsvLayouts } from '../src/formatsLoader';
import { parseStatementAmount } from '../src/statementAmount';
import { parseStatementDate } from '../src/statementDate';

const layouts = loadCsvLayouts();
const run = (csv: string) => extractCsvStatement(csv, layouts);

describe('D1 — zero-valued opposite column', () => {
  const header = 'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance';

  it('reads a credit when the debit column carries 0.00', () => {
    const r = run(`${header}\n05/01/26,UPI-SALARY,0.00,50000.00,60000.00`);
    expect(r.transactions[0]).toMatchObject({ direction: 'CREDIT', amountPaise: 5_000_000 });
  });

  it('reads a debit when the credit column carries 0.00', () => {
    const r = run(`${header}\n06/01/26,UPI-SWIGGY,500.00,0.00,59500.00`);
    expect(r.transactions[0]).toMatchObject({ direction: 'DEBIT', amountPaise: 50_000 });
  });

  it('blank opposite column still works', () => {
    const r = run(`${header}\n05/01/26,UPI-SALARY,,50000.00,60000.00`);
    expect(r.transactions[0]).toMatchObject({ direction: 'CREDIT', amountPaise: 5_000_000 });
  });

  it('both columns zero yields amount 0, unknown direction and a warning', () => {
    const r = run(`${header}\n05/01/26,UPI-NOOP,0.00,0.00,60000.00`);
    const t = r.transactions[0]!;
    expect(t.amountPaise).toBe(0);
    expect(t.direction).toBeNull();
    expect(t.warnings.join(' ')).toMatch(/zero/i);
  });

  it('both columns non-zero keeps the debit and warns (unchanged contract)', () => {
    const r = run(`${header}\n05/01/26,UPI-ODD,100.00,200.00,60000.00`);
    expect(r.transactions[0]).toMatchObject({ direction: 'DEBIT', amountPaise: 10_000 });
    expect(r.transactions[0]!.warnings.join(' ')).toMatch(/both debit and credit/);
  });
});

describe('D2 — single-digit day/month dates', () => {
  it('parses D/M/YYYY as day-first', () => {
    expect(parseStatementDate('5/1/2026')).toBe('2026-01-05');
    expect(parseStatementDate('5-1-26')).toBe('2026-01-05');
    expect(parseStatementDate('05/1/2026')).toBe('2026-01-05');
    expect(parseStatementDate('5.1.2026')).toBe('2026-01-05');
  });

  it('still rejects impossible dates', () => {
    expect(parseStatementDate('31/2/2026')).toBeNull();
    expect(parseStatementDate('0/1/2026')).toBeNull();
    expect(parseStatementDate('5/13/2026')).toBeNull();
  });

  it('extracts rows that use single-digit dates', () => {
    const r = run(
      'Date,Narration,Debit,Credit,Balance\n5/1/2026,UPI-A,100,,900\n6/1/2026,UPI-B,,50,950',
    );
    expect(r.transactions.map((t) => t.date)).toEqual(['2026-01-05', '2026-01-06']);
  });

  it('warns (without reinterpreting) when the column looks month-first', () => {
    const r = run(
      'Date,Narration,Debit,Credit,Balance\n1/5/2026,UPI-A,100,,900\n1/25/2026,UPI-B,,50,950',
    );
    expect(r.warnings.join(' ')).toMatch(/month-first/i);
    // 1/25/2026 is not a valid day-first date, so that row is skipped — never guessed.
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]!.date).toBe('2026-05-01');
  });
});

describe('D3 — trailing time components', () => {
  it.each([
    ['2026-01-05 10:30:00', '2026-01-05'],
    ['2026-01-05T10:30:00Z', '2026-01-05'],
    ['2026-01-05 10:30', '2026-01-05'],
    ['05-01-2026 10:30:45', '2026-01-05'],
    ['05/01/2026 10:30:45 AM', '2026-01-05'],
    ['05/01/2026 1:05 PM', '2026-01-05'],
    ['2026-01-05T10:30:00.123+05:30', '2026-01-05'],
  ])('strips the time from %s', (input, expected) => {
    expect(parseStatementDate(input)).toBe(expected);
  });

  it('does not accept an impossible time-bearing date', () => {
    expect(parseStatementDate('2026-13-05 10:30:00')).toBeNull();
  });

  it('extracts rows whose date cell carries a timestamp', () => {
    const r = run(
      'Date,Narration,Debit,Credit,Balance\n2026-01-05 10:30:00,UPI-A,100,,900\n2026-01-06 09:00:00,UPI-B,,50,950',
    );
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0]!.date).toBe('2026-01-05');
  });
});

describe('D4 — single-letter direction column', () => {
  it('reads D / C from the type column', () => {
    const r = run(
      'Date,Narration,Amount,Type,Balance\n05-01-2026,UPI-A,100,D,900\n06-01-2026,UPI-B,50,C,950',
    );
    expect(r.transactions.map((t) => t.direction)).toEqual(['DEBIT', 'CREDIT']);
    expect(r.transactions.map((t) => t.amountPaise)).toEqual([10_000, 5_000]);
  });

  it('reads DR. / CR. from the type column', () => {
    const r = run(
      'Date,Narration,Amount,Type,Balance\n05-01-2026,UPI-A,100,DR.,900\n06-01-2026,UPI-B,50,CR.,950',
    );
    expect(r.transactions.map((t) => t.direction)).toEqual(['DEBIT', 'CREDIT']);
  });
});

describe('D5 — statement amount shapes', () => {
  it.each([
    ['100', { paise: 10_000, sign: null }],
    ['1,00,000.50', { paise: 10_000_050, sign: null }],
    ['-100', { paise: 10_000, sign: 'neg' }],
    ['+50', { paise: 5_000, sign: 'pos' }],
    ['(100.00)', { paise: 10_000, sign: 'neg' }],
    ['100.00-', { paise: 10_000, sign: 'neg' }],
    ['Rs. 1,000/-', { paise: 100_000, sign: null }],
    ['₹1,000.00', { paise: 100_000, sign: null }],
    ['INR 250', { paise: 25_000, sign: null }],
    ['.50', { paise: 50, sign: null }],
    ['-Rs.10', { paise: 1_000, sign: 'neg' }],
    ['0.00', { paise: 0, sign: null }],
  ])('parses %s', (input, expected) => {
    expect(parseStatementAmount(input)).toEqual(expected);
  });

  it.each(['', 'abc', '1.234', '12,34,', '--5', '(5', '5)', '1 000', 'Rs.', '1e5'])(
    'rejects %p',
    (input) => {
      expect(parseStatementAmount(input)).toBeNull();
    },
  );

  const header = 'Date,Narration,Amount,Balance';

  it('normalises a signed debit to magnitude plus direction', () => {
    const r = run(`${header}\n05-01-2026,UPI-A,-100,900`);
    expect(r.transactions[0]).toMatchObject({ direction: 'DEBIT', amountPaise: 10_000 });
  });

  it('treats an explicit + as a credit and leaves unsigned amounts ambiguous', () => {
    const r = run(`${header}\n05-01-2026,UPI-A,+50,950\n06-01-2026,UPI-B,50,1000`);
    expect(r.transactions[0]).toMatchObject({ direction: 'CREDIT', amountPaise: 5_000 });
    expect(r.transactions[1]).toMatchObject({ direction: null, amountPaise: 5_000 });
  });

  it('parses parenthesis and trailing-minus amounts as debits', () => {
    const r = run(`${header}\n05-01-2026,UPI-A,(100.00),900\n06-01-2026,UPI-B,25.00-,875`);
    expect(r.transactions.map((t) => [t.direction, t.amountPaise])).toEqual([
      ['DEBIT', 10_000],
      ['DEBIT', 2_500],
    ]);
  });

  it('parses Rs./- shaped debit and credit cells', () => {
    const r = run(
      'Date,Narration,Debit,Credit,Balance\n05-01-2026,UPI-A,"Rs. 1,000/-",,"9,000.00"',
    );
    expect(r.transactions[0]).toMatchObject({
      direction: 'DEBIT',
      amountPaise: 100_000,
      balancePaise: 900_000,
    });
  });

  it('keeps negative running balances (overdraft) in every notation', () => {
    const r = run(
      `${header}\n05-01-2026,UPI-A,+50,-950\n06-01-2026,UPI-B,+50,(900.00)\n07-01-2026,UPI-C,+50,850.00 Dr\n08-01-2026,UPI-D,+50,800.00 Cr`,
    );
    expect(r.transactions.map((t) => t.balancePaise)).toEqual([-95_000, -90_000, -85_000, 80_000]);
  });
});

describe('D6 — wrapped narration continuation rows', () => {
  const header = 'Date,Narration,Debit,Credit,Balance';

  it('appends a continuation row to the previous transaction', () => {
    const r = run(
      `${header}\n05-01-2026,UPI-AMAZON PAY INDIA PRIVATE,100,,900\n,LIMITED/REF123,,,\n06-01-2026,UPI-B,,50,950`,
    );
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0]!.narration).toBe('UPI-AMAZON PAY INDIA PRIVATE LIMITED/REF123');
    expect(r.transactions[1]!.narration).toBe('UPI-B');
  });

  it('joins up to three consecutive continuation rows', () => {
    const r = run(`${header}\n05-01-2026,A,100,,900\n,B,,,\n,C,,,\n,D,,,\n,E,,,`);
    expect(r.transactions[0]!.narration).toBe('A B C D');
    expect(r.warnings.join(' ')).toMatch(/skipped non-transaction row/);
  });

  it('does not absorb footer text', () => {
    const r = run(`${header}\n05-01-2026,A,100,,900\n,Page 1 of 2,,,\n,B,,,`);
    expect(r.transactions[0]!.narration).toBe('A');
  });

  it('does not treat a row carrying an amount as a continuation', () => {
    const r = run(`${header}\n05-01-2026,A,100,,900\n,B,5,,`);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]!.narration).toBe('A');
  });

  it('records that the narration was continued', () => {
    const r = run(`${header}\n05-01-2026,A,100,,900\n,B,,,`);
    expect(r.transactions[0]!.warnings.join(' ')).toMatch(/continued across 1 row/);
  });
});

describe('D7 — opening / closing balance rows', () => {
  const header = 'Date,Narration,Debit,Credit,Balance';

  it('turns an opening-balance row into metadata, not a transaction', () => {
    const r = run(`${header}\n01-01-2026,Opening Balance,,,1000\n05-01-2026,UPI-A,100,,900`);
    expect(r.transactions).toHaveLength(1);
    expect(r.metadata['openingBalancePaise']).toBe('100000');
  });

  it('turns closing / carried-forward rows into metadata', () => {
    const r = run(`${header}\n05-01-2026,UPI-A,100,,900\n31-01-2026,Closing Balance,,,900`);
    expect(r.transactions).toHaveLength(1);
    expect(r.metadata['closingBalancePaise']).toBe('90000');
  });

  it('handles B/F and C/F markers', () => {
    const r = run(
      `${header}\n01-01-2026,B/F,,,1000\n05-01-2026,UPI-A,100,,900\n31-01-2026,C/F,,,900`,
    );
    expect(r.transactions).toHaveLength(1);
    expect(r.metadata['openingBalancePaise']).toBe('100000');
    expect(r.metadata['closingBalancePaise']).toBe('90000');
  });

  it('keeps a real transaction whose narration merely mentions the words', () => {
    const r = run(`${header}\n05-01-2026,Opening Balance Transfer fee,10,,990`);
    expect(r.transactions).toHaveLength(1);
  });
});

describe('UTF-16 encoded CSV bytes', () => {
  const csv =
    'Date,Narration,Debit,Credit,Balance\n05-01-2026,UPI-A,100,,900\n06-01-2026,UPI-B,,50,950';

  it('decodes UTF-16LE with BOM', async () => {
    const bytes = new Uint8Array(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')]),
    );
    const r = await extractStatement(bytes);
    expect(r.format).toBe('csv');
    expect(r.transactions).toHaveLength(2);
  });

  it('decodes UTF-16BE with BOM', async () => {
    const le = Buffer.from(csv, 'utf16le');
    const be = Buffer.from(le);
    be.swap16();
    const bytes = new Uint8Array(Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
    const r = await extractStatement(bytes);
    expect(r.format).toBe('csv');
    expect(r.transactions).toHaveLength(2);
  });

  it('decodes UTF-8 with BOM', async () => {
    const bytes = new Uint8Array(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv)]),
    );
    const r = await extractStatement(bytes);
    expect(r.format).toBe('csv');
    expect(r.transactions).toHaveLength(2);
  });
});
