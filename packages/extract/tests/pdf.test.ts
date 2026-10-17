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

import { extractPdfFragments, extractPdfLines } from '../src/pdf/pdfText';
import { extractPdfStatement } from '../src/pdf/pdfStatement';
import { loadCsvLayouts } from '../src/formatsLoader';
import { makePdf, makeStatementPdf } from './pdfFixture';

describe('extractPdfFragments', () => {
  it('extracts positioned fragments from a FlateDecode stream', () => {
    const pdf = makePdf([
      { x: 50, y: 700, text: 'Hello' },
      { x: 120, y: 700, text: 'World' },
      { x: 50, y: 680, text: 'Second line' },
    ]);
    const frags = extractPdfFragments(pdf);
    expect(frags.length).toBe(3);
    expect(frags.map((f) => f.text).sort()).toEqual(['Hello', 'Second line', 'World'].sort());
    const hello = frags.find((f) => f.text === 'Hello');
    expect(hello?.y).toBeCloseTo(700);
  });

  it('extracts uncompressed streams too', () => {
    const pdf = makePdf([{ x: 10, y: 100, text: 'plain' }], { compress: false });
    expect(extractPdfFragments(pdf)[0]?.text).toBe('plain');
  });

  it('returns empty for image-only (scanned) PDFs', () => {
    const pdf = new Uint8Array(
      Buffer.from(
        '%PDF-1.4\n1 0 obj << >> stream\nBINARY\x89PNG\nendstream\nendobj\n%%EOF',
        'latin1',
      ),
    );
    expect(extractPdfFragments(pdf)).toEqual([]);
  });
});

describe('extractPdfLines', () => {
  it('groups fragments on the same baseline', () => {
    const pdf = makePdf([
      { x: 200, y: 700, text: 'second' },
      { x: 50, y: 700, text: 'first' },
      { x: 50, y: 680, text: 'below' },
    ]);
    const lines = extractPdfLines(pdf);
    expect(lines.length).toBe(2);
    expect(lines[0]?.text).toBe('first second');
    expect(lines[1]?.text).toBe('below');
  });
});

describe('extractPdfStatement', () => {
  const layouts = loadCsvLayouts();
  const rows = [
    [
      '15/10/26',
      'UPI/402345678912/DR/SWIGGY@okaxis/RENT/',
      '402345678912',
      '1250.00',
      '',
      '45230.50',
    ],
    ['16/10/26', 'NEFT-N3452618902-SALARY-TCS LTD', 'N3452618902', '', '85000.00', '130230.50'],
  ];

  it('reconstructs a statement table from positioned text', () => {
    const pdf = makeStatementPdf(rows);
    const result = extractPdfStatement(pdf, layouts, { bankHint: 'HDFC' });
    expect(result.format).toBe('pdf');
    expect(result.accountMask).toBe('1234');
    expect(result.transactions.length).toBe(2);
    const first = result.transactions[0];
    expect(first?.date).toBe('2026-10-15');
    expect(first?.direction).toBe('DEBIT');
    expect(first?.amountPaise).toBe(125000);
    expect(first?.balancePaise).toBe(4523050);
    const second = result.transactions[1];
    expect(second?.direction).toBe('CREDIT');
    expect(second?.amountPaise).toBe(8500000);
    expect(second?.narration).toContain('TCS LTD');
  });

  it('warns on scanned PDFs instead of fabricating rows', () => {
    const pdf = new Uint8Array(Buffer.from('%PDF-1.4\n%%EOF', 'latin1'));
    const result = extractPdfStatement(pdf, layouts);
    expect(result.transactions).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/OCR/);
  });

  it('handles multi-page statements with a table per page', () => {
    const cols = [50, 140, 300, 380, 460];
    const streamFor = (rows: string[][]) => {
      const frags = [
        ...['Date', 'Narration', 'Debit', 'Credit', 'Balance'].map((h, i) => ({
          x: cols[i] ?? 0,
          y: 700,
          text: h,
        })),
        ...rows.flatMap((row, r) =>
          row
            .map((cell, i) => ({ x: cols[i] ?? 0, y: 680 - r * 20, text: cell }))
            .filter((f) => f.text !== ''),
        ),
      ];
      return makePdf(frags);
    };
    // two stream objects inside one document → two pages
    const pageA = streamFor([['15/10/26', 'UPI-A', '10.00', '', '90.00']]);
    const pageB = streamFor([
      ['16/10/26', 'NEFT-B', '', '50.00', '140.00'],
      ['17/10/26', 'ATM-WDL', '20.00', '', '120.00'],
    ]);
    const merged = new Uint8Array(
      Buffer.concat([
        Buffer.from(pageA).subarray(0, Buffer.from(pageA).indexOf('%%EOF')),
        Buffer.from(pageB).subarray(Buffer.from(pageB).indexOf('%PDF') + 8),
      ]),
    );
    const result = extractPdfStatement(merged, layouts);
    expect(result.transactions.length).toBe(3);
    expect(result.transactions.map((t) => t.direction)).toEqual(['DEBIT', 'CREDIT', 'DEBIT']);
    expect(result.metadata['pages']).toBe('2');
  });
});
