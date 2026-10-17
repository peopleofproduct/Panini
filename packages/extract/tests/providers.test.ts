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

import { createSheetJsProvider, createTesseractProvider } from '../src/providers';
import { extractStatement } from '../src/extract';
import { mineStatementMetadata } from '../src/statementMetadata';
import { extractCsvStatement } from '../src/csv/csvStatement';
import { loadCsvLayouts } from '../src/formatsLoader';
import type { SheetJsLike, TesseractLike } from '../src/providers';

describe('createSheetJsProvider', () => {
  const sheetJs: SheetJsLike = {
    read: () => ({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    }),
    utils: {
      sheet_to_json: () => [
        ['Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
        ['15/10/26', 'UPI/111/DR/SWIGGY@okaxis/', '100.00', '', '900.00'],
        [16, 'number cells coerce', '200.00', '', '700.00'],
      ],
    },
  };

  it('returns first-sheet rows via the caller-owned library', async () => {
    const provider = createSheetJsProvider(sheetJs);
    const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const result = await extractStatement(fakeZip, { spreadsheet: provider });
    expect(result.format).toBe('xlsx');
    expect(result.transactions.length).toBeGreaterThanOrEqual(1);
    expect(result.transactions[0]?.amountPaise).toBe(10000);
    expect(result.metadata['spreadsheetProvider']).toBe('sheetjs');
  });
});

describe('createTesseractProvider', () => {
  const worker: TesseractLike = {
    recognize: async () => ({
      data: {
        text: 'Date Narration Debit Credit Balance\n15/10/26 UPI-X 100.00 900.00',
        confidence: 92.5,
        words: [
          { text: 'Date', bbox: { x0: 50, y0: 100, x1: 90, y1: 115 } },
          { text: 'Narration', bbox: { x0: 140, y0: 100, x1: 220, y1: 115 } },
          { text: 'Debit', bbox: { x0: 300, y0: 100, x1: 340, y1: 115 } },
          { text: 'Credit', bbox: { x0: 380, y0: 100, x1: 430, y1: 115 } },
          { text: 'Balance', bbox: { x0: 460, y0: 100, x1: 520, y1: 115 } },
          { text: '15/10/26', bbox: { x0: 50, y0: 120, x1: 110, y1: 135 } },
          { text: 'UPI/777/DR/DMART@okhdfc/', bbox: { x0: 140, y0: 120, x1: 290, y1: 135 } },
          { text: '200.00', bbox: { x0: 300, y0: 120, x1: 350, y1: 135 } },
          { text: '8800.00', bbox: { x0: 460, y0: 120, x1: 520, y1: 135 } },
        ],
      },
    }),
  };

  it('maps word boxes to fragments so the anchored pipeline keeps columns', async () => {
    const provider = createTesseractProvider(worker);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]);
    const result = await extractStatement(png, { ocr: provider });
    expect(result.format).toBe('image');
    expect(result.transactions.length).toBe(1);
    expect(result.transactions[0]?.direction).toBe('DEBIT');
    expect(result.transactions[0]?.amountPaise).toBe(20000);
    expect(result.transactions[0]?.balancePaise).toBe(880000);
    expect(result.metadata['ocrConfidence']).toBe('0.925');
  });
});

describe('mineStatementMetadata', () => {
  it('mines period, IFSC, holder, and balances from preamble text', () => {
    const meta = mineStatementMetadata(
      'HDFC BANK LTD. Customer Name : Kapil Sharma IFSC : HDFC0001234 ' +
        'Statement From 01/10/26 To 31/10/26 Opening Balance : 10,000.00 ' +
        'Closing Balance : 45,230.50',
    );
    expect(meta['statementFrom']).toBe('2026-10-01');
    expect(meta['statementTo']).toBe('2026-10-31');
    expect(meta['ifsc']).toBe('HDFC0001234');
    expect(meta['accountHolder']).toBe('Kapil Sharma');
    expect(meta['openingBalancePaise']).toBe('1000000');
    expect(meta['closingBalancePaise']).toBe('4523050');
  });

  it('derives closing balance from the last transaction when unlabeled', () => {
    const csv =
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n' +
      '15/10/26,UPI/1/DR/X@ok/,1,15/10/26,100.00,,900.00\n' +
      '16/10/26,UPI/2/CR/Y@ok/,2,16/10/26,,300.00,1200.00';
    const result = extractCsvStatement(csv, loadCsvLayouts());
    expect(result.metadata['closingBalancePaise']).toBe('120000');
  });
});
