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

import { listEntries, readMember } from './zip';

/**
 * Zero-dependency XLSX reader: a .xlsx is a ZIP of XML parts, so between
 * `zip.ts`, `zlib.inflateRawSync`, and targeted XML scans this covers the
 * workbook shapes bank portals actually emit (inline + shared strings,
 * numbers, booleans, date-formatted serials). Throws `xlsx: …` errors —
 * callers convert them to warnings.
 */

function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** All `<name ...>` / `<name ...>...</name>` occurrences (namespace-tolerant). */
function* tags(xml: string, local: string): Generator<string> {
  const re = new RegExp(`<(?:\\w+:)?${local}(?:\\s[^>]*)?/?>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) yield m[0];
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:\\w+:)?${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m?.[1] === undefined ? undefined : unescapeXml(m[1]);
}

/** Inner text of every `<t>` run inside a block (shared strings are runs of t elements). */
function collectText(block: string): string {
  let out = '';
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out += unescapeXml(m[1] ?? '');
  return out;
}

/** Column letters → zero-based index ('A' → 0, 'AA' → 26). */
function colIndex(ref: string): number {
  let idx = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return idx - 1;
}

/** Built-in numFmt ids that render as dates in the OOXML spec. */
const DATE_FMT_IDS: ReadonlySet<number> = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81,
]);

/** Custom formatCode → date when it carries y/d/m tokens outside literals. */
function customFmtIsDate(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');
  return /[dy]/.test(stripped) || /(^|[^a-z])m{1,5}([^a-z]|$)/i.test(stripped);
}

/** Excel serial → 'YYYY-MM-DD'. Serial 1 = 1900-01-01; epoch includes the 1900 leap bug offset. */
function serialToDate(serial: number, epoch1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const epoch = epoch1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.round(serial * 86_400_000));
  if (!Number.isFinite(d.getTime())) return null;
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

interface XlsxParts {
  readonly sharedStrings: readonly string[];
  /** cellXfs style index → renders a date. */
  readonly dateStyles: ReadonlySet<number>;
  readonly epoch1904: boolean;
  readonly sheetXml: string;
}

function loadParts(data: Uint8Array): XlsxParts {
  const entries = listEntries(data);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const workbookXml = readMember(data, 'xl/workbook.xml');
  if (workbookXml === null) {
    throw new Error('xlsx: not a workbook — xl/workbook.xml absent (docx/zip input?)');
  }
  const epoch1904 = /date1904\s*=\s*"(?:1|true)"/i.test(workbookXml);

  // First sheet → its rId → the target part via workbook rels.
  const firstSheet = [...tags(workbookXml, 'sheet')][0];
  if (firstSheet === undefined) throw new Error('xlsx: workbook declares no sheets');
  const rid = attr(firstSheet, 'id');
  const relsXml = readMember(data, 'xl/_rels/workbook.xml.rels') ?? '';
  let target: string | undefined;
  for (const rel of tags(relsXml, 'Relationship')) {
    if (rid !== undefined && attr(rel, 'Id') === rid) {
      target = attr(rel, 'Target');
      break;
    }
  }
  // Fallbacks: rel missing the id, or an odd producer naming.
  const relPath =
    target !== undefined
      ? `xl/${target.replace(/^\/xl\//, '')}`
      : entries.find((e) => /^xl\/worksheets\/sheet1\.xml$/i.test(e.name))?.name;
  if (relPath === undefined || !byName.has(relPath)) {
    throw new Error(`xlsx: worksheet part for rId '${rid ?? '?'}' not found`);
  }
  const sheetXml = readMember(data, relPath);
  if (sheetXml === null) throw new Error(`xlsx: '${relPath}' failed to extract`);

  const sharedStrings: string[] = [];
  const ssXml = readMember(data, 'xl/sharedStrings.xml');
  if (ssXml !== null) {
    const siRe = /<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g;
    let m: RegExpExecArray | null;
    while ((m = siRe.exec(ssXml)) !== null) sharedStrings.push(collectText(m[1] ?? ''));
  }

  const dateStyles = new Set<number>();
  const stylesXml = readMember(data, 'xl/styles.xml');
  if (stylesXml !== null) {
    const customFmt = new Map<number, string>();
    for (const fmt of tags(stylesXml, 'numFmt')) {
      const id = attr(fmt, 'numFmtId');
      const code = attr(fmt, 'formatCode') ?? '';
      if (id !== undefined) customFmt.set(parseInt(id, 10), code);
    }
    const cellXfs = /<(?:\w+:)?cellXfs[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stylesXml);
    if (cellXfs !== null) {
      let styleIdx = 0;
      for (const xf of tags(cellXfs[1] ?? '', 'xf')) {
        const numFmtId = parseInt(attr(xf, 'numFmtId') ?? '0', 10);
        const code = customFmt.get(numFmtId);
        if (DATE_FMT_IDS.has(numFmtId) || (code !== undefined && customFmtIsDate(code))) {
          dateStyles.add(styleIdx);
        }
        styleIdx++;
      }
    }
  }
  return { sharedStrings, dateStyles, epoch1904, sheetXml };
}

/** One `<c>` cell → display string. */
function cellText(cellXml: string, parts: XlsxParts): string {
  const type = attr(cellXml, 't') ?? 'n';
  const styleIdx = parseInt(attr(cellXml, 's') ?? '-1', 10);

  const vMatch = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cellXml);
  const raw = vMatch?.[1] !== undefined ? unescapeXml(vMatch[1]) : '';

  switch (type) {
    case 's': {
      const idx = parseInt(raw, 10);
      return parts.sharedStrings[idx] ?? '';
    }
    case 'inlineStr':
      return collectText(cellXml);
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE';
    case 'str':
    case 'e':
      return raw;
    default: {
      if (raw === '') return '';
      if (parts.dateStyles.has(styleIdx)) {
        const serial = parseFloat(raw);
        return serialToDate(serial, parts.epoch1904) ?? raw;
      }
      return raw;
    }
  }
}

/**
 * Reads the first worksheet as display-formatted string rows — the same
 * contract `SpreadsheetProvider.readSheet` exposes. Cells are aligned to
 * their column letters; gaps become empty strings.
 */
export function readXlsxSheet(data: Uint8Array): string[][] {
  const parts = loadParts(data);
  const rows: string[][] = [];

  const sheetData = /<(?:\w+:)?sheetData[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/.exec(
    parts.sheetXml,
  );
  if (sheetData === null) return rows;

  const rowRe = /<(?:\w+:)?row(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(sheetData[1] ?? '')) !== null) {
    const body = rowMatch[1] ?? '';
    const cells = new Map<number, string>();
    let maxCol = -1;
    const cellRe = /<(?:\w+:)?c(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    let cellMatch: RegExpExecArray | null;
    let implicitCol = 0;
    while ((cellMatch = cellRe.exec(body)) !== null) {
      const tag = cellMatch[0];
      const ref = attr(tag, 'r');
      const col = ref !== undefined ? colIndex(ref.toUpperCase()) : implicitCol;
      // For `<c .../>` there is no inner body; for `<c>...</c>` group 1 holds it.
      cells.set(col, cellText(tag, parts));
      if (col > maxCol) maxCol = col;
      implicitCol = col + 1;
    }
    const row: string[] = [];
    for (let i = 0; i <= maxCol; i++) row.push(cells.get(i) ?? '');
    rows.push(row);
  }
  return rows;
}
