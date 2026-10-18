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

import { extractStatement } from '../src';
import { createNativeXlsxProvider } from '../src/providers';
import { buildXlsx, buildZip, HDFC_HEADER, HDFC_ROWS } from './xlsxFixture';

describe('native xlsx reader', () => {
  it('parses a shared-strings workbook into statement rows', async () => {
    const bytes = new Uint8Array(buildXlsx(HDFC_ROWS));
    const result = await extractStatement(bytes);
    expect(result.format).toBe('xlsx');
    expect(result.metadata['spreadsheetProvider']).toBe('panini-native-xlsx');
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0]).toMatchObject({
      date: '2026-10-15',
      narration: 'UPI-DR-402512345678-SWIGGY-okaxis',
      direction: 'DEBIT',
      amountPaise: 25000,
    });
    expect(result.transactions[1]).toMatchObject({ direction: 'CREDIT', amountPaise: 7500000 });
  });

  it('parses inline-string cells (no sharedStrings part)', async () => {
    const bytes = new Uint8Array(buildXlsx(HDFC_ROWS, { sharedStrings: false }));
    const result = await extractStatement(bytes);
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0]?.narration).toContain('SWIGGY');
  });

  it('renders date-formatted serials as ISO dates', async () => {
    const excelSerial = Math.floor(new Date('2026-10-15T00:00:00Z').getTime() / 86400000) + 25569;
    const rows: (string | number)[][] = [
      HDFC_HEADER,
      [excelSerial, 'UPI-DR-1-TEST-ybl', '1', '100.00', '', '900.00'],
    ];
    const bytes = new Uint8Array(buildXlsx(rows, { dateStyle: true }));
    const result = await extractStatement(bytes);
    expect(result.transactions[0]?.date).toBe('2026-10-15');
  });

  it('preserves sparse cells via column letters', async () => {
    // A1 header, C1 header; A2 val, C2 val — B empty everywhere.
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="C1" t="inlineStr"><is><t>Narration</t></is></c><c r="E1" t="inlineStr"><is><t>Withdrawal Amt</t></is></c><c r="F1" t="inlineStr"><is><t>Closing Balance</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>15/10/2026</t></is></c><c r="C2" t="inlineStr"><is><t>UPI-DR-1-X-ybl</t></is></c><c r="E2"><v>10</v></c><c r="F2"><v>90</v></c></row>
      </sheetData></worksheet>`;
    const workbook = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
    const bytes = new Uint8Array(
      buildZip([
        { name: 'xl/workbook.xml', data: Buffer.from(workbook) },
        { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(rels) },
        { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
      ]),
    );
    const result = await extractStatement(bytes);
    // Sparse: narration landed in column C — still extracted.
    expect(result.transactions[0]?.narration).toBe('UPI-DR-1-X-ybl');
  });

  it('a caller-supplied provider still wins', async () => {
    const bytes = new Uint8Array(buildXlsx(HDFC_ROWS));
    const calls: string[] = [];
    const result = await extractStatement(bytes, {
      spreadsheet: {
        name: 'spy',
        readSheet: () => {
          calls.push('called');
          return HDFC_ROWS.map((r) => r.map(String));
        },
      },
    });
    expect(calls).toHaveLength(1);
    expect(result.metadata['spreadsheetProvider']).toBe('spy');
    expect(result.transactions).toHaveLength(3);
  });
});

describe('xlsx seam hardening', () => {
  it('non-workbook zip (docx-shaped) warns instead of throwing', async () => {
    const docx = new Uint8Array(
      buildZip([{ name: 'word/document.xml', data: Buffer.from('<w:doc/>') }]),
    );
    const result = await extractStatement(docx);
    expect(result.format).toBe('xlsx');
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('workbook');
  });

  it('truncated zip warns instead of throwing', async () => {
    const bytes = buildXlsx(HDFC_ROWS);
    const truncated = new Uint8Array(bytes.subarray(0, bytes.length - 60));
    const result = await extractStatement(truncated);
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('corrupt payload fails CRC32 → warning, not throw', async () => {
    const bytes = Buffer.from(buildXlsx(HDFC_ROWS));
    // Corrupt a byte inside the worksheet entry's compressed payload —
    // locate it via the local header (name is at header+30).
    const name = Buffer.from('xl/worksheets/sheet1.xml');
    const idx = bytes.indexOf(name);
    expect(idx).toBeGreaterThan(0);
    const payloadStart = idx - 30 + 30 + name.length;
    bytes[payloadStart]! ^= 0xff;
    const result = await extractStatement(new Uint8Array(bytes));
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/failed|CRC|corrupt|error/i);
  });

  it('explicit native provider works through the seam', async () => {
    const bytes = new Uint8Array(buildXlsx(HDFC_ROWS));
    const result = await extractStatement(bytes, { spreadsheet: createNativeXlsxProvider() });
    expect(result.metadata['spreadsheetProvider']).toBe('panini-native-xlsx');
    expect(result.transactions).toHaveLength(3);
  });

  it('empty zip warns instead of throwing', async () => {
    const result = await extractStatement(new Uint8Array(buildZip([])));
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
