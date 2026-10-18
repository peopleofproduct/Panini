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
 * In-memory .xlsx builder — emits a valid single-sheet workbook so the
 * native reader is exercised end-to-end against real ZIP/XLSX structure.
 */

import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipPart {
  name: string;
  data: Buffer;
}

export function buildZip(parts: ZipPart[]): Buffer {
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
    cent.writeUInt32LE(0, 8); // flags
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

export interface XlsxOptions {
  /** Use sharedStrings for all string cells (default true). */
  sharedStrings?: boolean;
  /** Emit a date-formatted numeric cell style (styles.xml). */
  dateStyle?: boolean;
}

function colRef(i: number): string {
  return String.fromCharCode(65 + i);
}

/**
 * rows: cells are either strings or numbers — numbers are written as
 * numeric cells, with a date style applied when `dateStyle` is set.
 */
export function buildXlsx(rows: (string | number)[][], opts: XlsxOptions = {}): Buffer {
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

export const HDFC_HEADER = [
  'Date',
  'Narration',
  'Chq Ref No',
  'Withdrawal Amt',
  'Deposit Amt',
  'Closing Balance',
];

export const HDFC_ROWS: (string | number)[][] = [
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
