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

import { extractStatement } from '../src/extract';
import { sniffFormat } from '../src/sniff';
import type { OcrProvider, SpreadsheetProvider } from '../src/index';
import { makeStatementPdf } from './pdfFixture';

const HDFC_CSV =
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n' +
  '15/10/26,UPI/123/DR/SWIGGY@okaxis/,123,15/10/26,100.00,,900.00';

const SMS = 'A/c XX1234 debited by Rs.500.00 on 15-Oct-26 UPI-AMAZON Avl Bal Rs.9,000.00';

describe('sniffFormat', () => {
  it('detects pdf, xlsx, image, csv, sms', () => {
    expect(sniffFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x20]))).toBe('pdf');
    expect(sniffFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('xlsx');
    expect(sniffFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image');
    expect(sniffFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image');
    expect(sniffFormat(HDFC_CSV)).toBe('csv');
    expect(sniffFormat(SMS)).toBe('sms');
    expect(sniffFormat('')).toBe('unknown');
    expect(sniffFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe('unknown');
  });

  it('sniffs two-column CSVs (one delimiter per line) as csv', () => {
    expect(sniffFormat('Date,Amount\n2024-01-01,100\n2024-01-02,200')).toBe('csv');
  });

  it('keeps single-line delimited text on the sms path', () => {
    expect(sniffFormat('a,b')).toBe('sms');
  });

  it('keeps SMS-keyword text on the sms path even with delimiters', () => {
    expect(sniffFormat('a/c debited 100, avl bal 500, ref 9')).toBe('sms');
  });
});

describe('extractStatement', () => {
  it('routes CSV text through layout detection', async () => {
    const result = await extractStatement(HDFC_CSV);
    expect(result.format).toBe('csv');
    expect(result.bank).toBe('HDFC');
    expect(result.transactions.length).toBe(1);
    expect(result.transactions[0]?.amountPaise).toBe(10000);
  });

  it('routes single-line alerts through the SMS patterns', async () => {
    const result = await extractStatement(SMS);
    expect(result.format).toBe('sms');
    expect(result.transactions[0]?.amountPaise).toBe(50000);
    expect(result.transactions[0]?.direction).toBe('DEBIT');
    expect(result.accountMask).toBe('1234');
  });

  it('extracts PDF text-layer statements', async () => {
    const pdf = makeStatementPdf([
      ['15/10/26', 'POS 415982XXXXXX0342 ZOMATO', 'P123', '320.50', '', '44100.00'],
    ]);
    const result = await extractStatement(pdf);
    expect(result.format).toBe('pdf');
    expect(result.transactions[0]?.amountPaise).toBe(32050);
  });

  it('xlsx without a provider returns a documented warning, not a throw', async () => {
    const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const result = await extractStatement(fakeZip);
    expect(result.format).toBe('xlsx');
    expect(result.transactions).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/SpreadsheetProvider/);
  });

  it('xlsx rows flow through the SpreadsheetProvider seam', async () => {
    const spreadsheet: SpreadsheetProvider = {
      name: 'fake-sheet',
      readSheet: () => [
        [
          'Date',
          'Narration',
          'Chq./Ref.No.',
          'Value Dt',
          'Withdrawal Amt.',
          'Deposit Amt.',
          'Closing Balance',
        ],
        ['15/10/26', 'UPI/999/DR/ZOMATO@icici/', '999', '15/10/26', '320.50', '', '44100.00'],
      ],
    };
    const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const result = await extractStatement(fakeZip, { spreadsheet });
    expect(result.format).toBe('xlsx');
    expect(result.bank).toBe('HDFC');
    expect(result.transactions[0]?.amountPaise).toBe(32050);
    expect(result.metadata['spreadsheetProvider']).toBe('fake-sheet');
  });

  it('image input uses the OcrProvider seam then reuses table detection', async () => {
    const ocr: OcrProvider = {
      name: 'fake-ocr',
      recognize: async () => ({
        text:
          'Date  Narration  Debit  Credit  Balance\n' +
          '15/10/26  UPI/555/DR/DMART@okhdfc/  200.00    43000.00',
      }),
    };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]);
    const result = await extractStatement(png, { ocr });
    expect(result.format).toBe('image');
    expect(result.transactions[0]?.amountPaise).toBe(20000);
    expect(result.metadata['ocrProvider']).toBe('fake-ocr');
  });

  it('scanned PDF falls back to OCR when a provider is wired', async () => {
    const ocr: OcrProvider = {
      name: 'fake-ocr',
      recognize: async () => ({
        text:
          'Date  Description  Debit  Credit  Balance\n' +
          '15/10/26  NEFT-ACME CORP  1500.00    40000.00',
      }),
    };
    const scannedPdf = new Uint8Array(Buffer.from('%PDF-1.4\n%%EOF', 'latin1'));
    const result = await extractStatement(scannedPdf, { ocr });
    expect(result.format).toBe('pdf');
    expect(result.transactions[0]?.amountPaise).toBe(150000);
  });

  it('never throws on garbage', async () => {
    for (const input of [
      '',
      '   ',
      new Uint8Array(0),
      new Uint8Array([0xff, 0x00, 0xab]),
      '\x00\x01\x02 not a statement',
      ','.repeat(500),
    ]) {
      const result = await extractStatement(input);
      expect(result.format).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });
});
