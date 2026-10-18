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

import { deflateRawSync } from 'node:zlib';
import { extractStatement } from '../src';
import { createNativeXlsxProvider } from '../src/providers';

/**
 * In-memory .xlsx builder — emits a valid single-sheet workbook so the
 * native reader is exercised end-to-end against real ZIP/XLSX structure.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipPart {
  name: string;
  data: Buffer;
}

function buildZip(parts: ZipPart[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name, 'utf8');
    const compressed = deflateRawSync(part.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc32(part.data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(part.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    chunks.push(local, name, compressed);

    const cent = Buffer.alloc(46);
    cent.writeUInt32LE(0x02014b50, 0);
    cent.writeUInt16LE(20, 4); // version made by
    cent.writeUInt16LE(20, 6); // version needed
    cent.writeUInt32LE(0, 8); // flags + method(8) stay 8 below
    cent.writeUInt16LE(8, 10); // method
    cent.writeUInt32LE(crc32(part.data), 16);
    cent.writeUInt32LE(compressed.length, 20);
    cent.writeUInt32LE(part.data.length, 24);
    cent.writeUInt16LE(name.length, 28);
    cent.writeUInt32LE(0, 30); // extra/comment lens + disk + int attr
    cent.writeUInt32LE(0, 38); // ext attr
    cent.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cent, name]));
    offset += 30 + name.length + compressed.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface XlsxOptions {
  /** Use sharedStrings for all string cells (default true). */
  sharedStrings?: boolean;
  /** Emit a date-formatted numeric cell style (styles.xml). */
  dateStyle?: boolean;
}

function colRef(i: number): string {
  return String.fromCharCode(65 + i);
}

/**
 * rows: cells are either strings or { serial } numeric-date cells written
 * with a date style when `dateStyle` is set.
 */
function buildXlsx(rows: (string | number)[][], opts: XlsxOptions = {}): Buffer {
  const sharedStrings: string[] = [];
  const ssIndex = new Map<string, number>();
  const cell = (v: string | number, ref: string): string => {
    if (typeof v === 'number') {
      const s = opts.dateStyle ? ' s="1"' : '';
      return `<c r="${ref}"${s}><v>${v}</v></c>`;
    }
    if (opts.sharedStrings === false) {
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    }
    let idx = ssIndex.get(v);
    if (idx === undefined) {
      idx = sharedStrings.length;
      sharedStrings.push(v);
      ssIndex.set(v, idx);
    }
    return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
  };

  const sheetRows = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r.map((v, ci) => cell(v, `${colRef(ci)}${ri + 1}`)).join('')}</row>`,
    )
    .join('');
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;

  const ss = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}">${sharedStrings
    .map((s) => `<si><t>${esc(s)}</t></si>`)
    .join('')}</sst>`;

  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;

  const styles = opts.dateStyle
    ? `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`
    : `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`;

  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(rels) },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(ss) },
    { name: 'xl/styles.xml', data: Buffer.from(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ]);
}

const HDFC_HEADER = [
  'Date',
  'Narration',
  'Chq Ref No',
  'Withdrawal Amt',
  'Deposit Amt',
  'Closing Balance',
];

const HDFC_ROWS: (string | number)[][] = [
  HDFC_HEADER,
  ['15/10/2026', 'UPI-DR-402512345678-SWIGGY-okaxis', '402512345678', '250.00', '', '5000.00'],
  [
    '16/10/2026',
    'NEFT-N3452618902-SALARY-OCTOBER 2026-TCS LTD',
    'N3452618902',
    '',
    '75000.00',
    '80000.00',
  ],
  ['17/10/2026', 'ATM WDL-SELF-0042', '0042', '2000.00', '', '78000.00'],
];

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
