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
 * Minimal PDF text-layer extractor. Covers the digitally-generated
 * statement subset: uncompressed and /FlateDecode content streams, Tj /
 * TJ / ' / " show operators, Td / TD / Tm / T* positioning, literal and
 * hex strings (UTF-16BE or WinAnsi-ish single-byte encodings).
 *
 * Deliberately not implemented: CID font ToUnicode CMap resolution,
 * Type3 fonts, cross-reference stream object chains beyond plain `obj`.
 * Scanned PDFs produce no text — they are for the OCR seam, not this.
 */

import { inflateSync } from 'node:zlib';

/** A positioned text fragment on a page. */
export interface PdfFragment {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/** A reconstructed line of text (fragments merged at equal y). */
export interface PdfLine {
  readonly page: number;
  readonly y: number;
  readonly text: string;
  readonly fragments: readonly PdfFragment[];
}

const LATIN1 = 'latin1';

// ── stream extraction ──────────────────────────────────────────────────────

const STREAM_RE = /stream(\r\n|\r|\n)/g;
const ENDSTREAM = 'endstream';

interface RawStream {
  readonly dictionary: string;
  readonly data: Uint8Array;
}

const LENGTH_RE = /\/Length\s+(\d+)/;

function findStreams(pdf: Uint8Array): RawStream[] {
  const latin = Buffer.from(pdf).toString(LATIN1);
  const out: RawStream[] = [];
  STREAM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STREAM_RE.exec(latin)) !== null) {
    // `endstream` contains "stream" — skip matches that are its tail.
    if (latin.slice(m.index - 3, m.index) === 'end') continue;
    const dataStart = m.index + m[0].length;
    // The object's dictionary is the text between the preceding `<<` and `stream`.
    const dictStart = latin.lastIndexOf('<<', m.index);
    const dictionary = dictStart >= 0 ? latin.slice(dictStart, m.index) : '';

    // Prefer /Length — compressed data can legitimately contain the
    // bytes "endstream" mid-stream, which a naive scan would truncate on.
    let end = -1;
    const lenMatch = LENGTH_RE.exec(dictionary);
    if (lenMatch) {
      const lengthEnd = dataStart + Number(lenMatch[1]);
      const probe = latin.slice(lengthEnd, lengthEnd + 32);
      if (/^\s*endstream/.test(probe)) end = lengthEnd;
    }
    if (end < 0) {
      end = latin.indexOf(ENDSTREAM, dataStart);
    }
    if (end < 0) break;
    out.push({ dictionary, data: pdf.subarray(dataStart, end) });
    STREAM_RE.lastIndex = end + ENDSTREAM.length;
  }
  return out;
}

function decodeStream(stream: RawStream): Uint8Array | null {
  const flate = /\/FlateDecode|\/Fl\b/.test(stream.dictionary);
  try {
    if (flate) return inflateSync(Buffer.from(stream.data));
    return stream.data;
  } catch {
    return null;
  }
}

// ── content-stream tokenizer ───────────────────────────────────────────────

type Tok =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'arrOpen' }
  | { kind: 'arrClose' }
  | { kind: 'op'; value: string };

function isWhite(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0c || b === 0x00;
}

function isDelim(b: number): boolean {
  return (
    b === 0x28 ||
    b === 0x29 ||
    b === 0x3c ||
    b === 0x3e ||
    b === 0x5b ||
    b === 0x5d ||
    b === 0x2f ||
    b === 0x25
  );
}

const WINANSI_HIGH: Readonly<Record<number, string>> = {
  0x91: '\u2018',
  0x92: '\u2019',
  0x93: '\u201c',
  0x94: '\u201d',
  0x96: '\u2013',
  0x97: '\u2014',
  0xa0: ' ',
  0xb9: '\u00b9',
};

function decodeBytes(bytes: number[]): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      if (b0 === undefined || b1 === undefined) break;
      s += String.fromCharCode((b0 << 8) | b1);
    }
    return s;
  }
  let s = '';
  for (const b of bytes) {
    s += WINANSI_HIGH[b] ?? String.fromCharCode(b);
  }
  return s;
}

function tokenize(data: Uint8Array): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = data.length;
  while (i < n) {
    const b = data[i];
    if (b === undefined) break;
    if (isWhite(b)) {
      i += 1;
      continue;
    }
    if (b === 0x25) {
      // '%' comment to end of line
      while (i < n && data[i] !== 0x0a && data[i] !== 0x0d) i += 1;
      continue;
    }
    if (b === 0x28) {
      // literal string with balanced parens and escapes
      i += 1;
      const bytes: number[] = [];
      let depth = 1;
      while (i < n && depth > 0) {
        const c = data[i];
        if (c === undefined) break;
        if (c === 0x5c) {
          const e = data[i + 1];
          i += 1;
          if (e === undefined) break;
          if (e === 0x6e) bytes.push(0x0a);
          else if (e === 0x72) bytes.push(0x0d);
          else if (e === 0x74) bytes.push(0x09);
          else if (e === 0x62) bytes.push(0x08);
          else if (e === 0x66) bytes.push(0x0c);
          else if (e >= 0x30 && e <= 0x37) {
            let oct = e - 0x30;
            let k = 0;
            while (k < 2) {
              const o = data[i + 1];
              if (o !== undefined && o >= 0x30 && o <= 0x37) {
                oct = oct * 8 + (o - 0x30);
                i += 1;
                k += 1;
              } else break;
            }
            bytes.push(oct & 0xff);
          } else if (e === 0x0a || e === 0x0d) {
            // line continuation
          } else bytes.push(e);
          i += 1;
          continue;
        }
        if (c === 0x28) depth += 1;
        if (c === 0x29) {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
        }
        bytes.push(c);
        i += 1;
      }
      toks.push({ kind: 'str', value: decodeBytes(bytes) });
      continue;
    }
    if (b === 0x3c) {
      if (data[i + 1] === 0x3c) {
        toks.push({ kind: 'op', value: '<<' });
        i += 2;
        continue;
      }
      // hex string
      i += 1;
      let hex = '';
      while (i < n) {
        const c = data[i];
        if (c === undefined || c === 0x3e) break;
        if (!isWhite(c)) hex += String.fromCharCode(c);
        i += 1;
      }
      i += 1;
      if (hex.length % 2 === 1) hex += '0';
      const bytes: number[] = [];
      for (let k = 0; k + 1 < hex.length; k += 2) {
        bytes.push(parseInt(hex.slice(k, k + 2), 16));
      }
      toks.push({ kind: 'str', value: decodeBytes(bytes) });
      continue;
    }
    if (b === 0x5b) {
      toks.push({ kind: 'arrOpen' });
      i += 1;
      continue;
    }
    if (b === 0x5d) {
      toks.push({ kind: 'arrClose' });
      i += 1;
      continue;
    }
    if (b === 0x2f) {
      // name
      let j = i + 1;
      let name = '';
      while (j < n) {
        const c = data[j];
        if (c === undefined || isWhite(c) || isDelim(c)) break;
        name += String.fromCharCode(c);
        j += 1;
      }
      toks.push({ kind: 'name', value: name });
      i = j;
      continue;
    }
    if (b === 0x3e) {
      i += data[i + 1] === 0x3e ? 2 : 1;
      continue;
    }
    // number or operator word
    let j = i;
    let word = '';
    while (j < n) {
      const c = data[j];
      if (c === undefined || isWhite(c) || isDelim(c)) break;
      word += String.fromCharCode(c);
      j += 1;
    }
    i = j;
    const num = Number(word);
    if (word !== '' && !Number.isNaN(num)) {
      toks.push({ kind: 'num', value: num });
    } else if (word !== '') {
      toks.push({ kind: 'op', value: word });
    }
  }
  return toks;
}

// ── text reconstruction ────────────────────────────────────────────────────

const LINE_Y_TOLERANCE = 3;

function fragmentsFromTokens(toks: readonly Tok[], page: number): PdfFragment[] {
  const fragments: PdfFragment[] = [];
  const stack: (number | string)[] = [];
  let inText = false;
  let x = 0;
  let y = 0;
  let lineStartX = 0;
  let leading = 0;

  const popNumbers = (count: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < count; k += 1) {
      const v = stack.pop();
      out.unshift(typeof v === 'number' ? v : 0);
    }
    return out;
  };

  const showText = (s: string) => {
    if (s === '' || !inText) return;
    fragments.push({ page, x, y, text: s });
    x += s.length; // glyph advance approximation — ordering only, not layout truth
  };

  let inArray = false;
  let arrayText = '';
  let arrayGap = false;

  for (const tok of toks) {
    if (tok.kind === 'num') {
      if (inArray) {
        if (tok.value < -120) arrayGap = true; // big kerning backspace = word gap
      } else {
        stack.push(tok.value);
      }
      continue;
    }
    if (tok.kind === 'str') {
      if (inArray) {
        if (arrayGap) {
          arrayText += ' ';
          arrayGap = false;
        }
        arrayText += tok.value;
      } else {
        stack.push(tok.value);
      }
      continue;
    }
    if (tok.kind === 'name') {
      stack.length = 0;
      continue;
    }
    if (tok.kind === 'arrOpen') {
      inArray = true;
      arrayText = '';
      arrayGap = false;
      stack.length = 0;
      continue;
    }
    if (tok.kind === 'arrClose') {
      inArray = false;
      stack.push(arrayText);
      continue;
    }
    if (tok.kind !== 'op') continue;

    switch (tok.value) {
      case 'BT':
        inText = true;
        x = 0;
        y = 0;
        lineStartX = 0;
        break;
      case 'ET':
        inText = false;
        break;
      case 'TL': {
        const v = popNumbers(1);
        leading = v[0] ?? 0;
        break;
      }
      case 'Td':
      case 'TD': {
        const v = popNumbers(2);
        const tx = v[0] ?? 0;
        const ty = v[1] ?? 0;
        x = lineStartX + tx;
        y += ty;
        lineStartX = x;
        if (tok.value === 'TD') leading = -ty;
        break;
      }
      case 'Tm': {
        const v = popNumbers(6);
        x = v[4] ?? 0;
        y = v[5] ?? 0;
        lineStartX = x;
        break;
      }
      case 'T*': {
        y -= leading;
        x = lineStartX;
        break;
      }
      case 'Tj': {
        const s = stack.pop();
        if (typeof s === 'string') showText(s);
        break;
      }
      case 'TJ': {
        const s = stack.pop();
        if (typeof s === 'string') showText(s);
        break;
      }
      case "'": {
        y -= leading;
        x = lineStartX;
        const s = stack.pop();
        if (typeof s === 'string') showText(s);
        break;
      }
      case '"': {
        const s = stack.pop();
        stack.pop();
        stack.pop();
        y -= leading;
        x = lineStartX;
        if (typeof s === 'string') showText(s);
        break;
      }
      default:
        break;
    }
    stack.length = 0;
  }
  return fragments;
}

/** Groups fragments into visual lines: same page, y within tolerance, sorted x. */
export function linesFromFragments(fragments: readonly PdfFragment[]): PdfLine[] {
  const sorted = [...fragments].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const groups: { page: number; y: number; frags: PdfFragment[] }[] = [];
  for (const f of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.page === f.page && Math.abs(last.y - f.y) <= LINE_Y_TOLERANCE) {
      last.frags.push(f);
    } else {
      groups.push({ page: f.page, y: f.y, frags: [f] });
    }
  }
  return groups.map((g) => {
    const frags = g.frags.sort((a, b) => a.x - b.x);
    let text = '';
    let prev: PdfFragment | null = null;
    for (const f of frags) {
      if (prev && f.x - (prev.x + prev.text.length) > 0.5) text += ' ';
      text += f.text;
      prev = f;
    }
    return { page: g.page, y: g.y, text, fragments: frags };
  });
}

/**
 * Extracts positioned text fragments from PDF bytes. Returns fragments in
 * content-stream order; scanned (image-only) PDFs return an empty list.
 */
export function extractPdfFragments(pdf: Uint8Array): PdfFragment[] {
  const fragments: PdfFragment[] = [];
  let page = 0;
  for (const stream of findStreams(pdf)) {
    const decoded = decodeStream(stream);
    if (!decoded) continue;
    const toks = tokenize(decoded);
    if (!toks.some((t) => t.kind === 'op' && (t.value === 'Tj' || t.value === 'TJ'))) continue;
    page += 1;
    fragments.push(...fragmentsFromTokens(toks, page));
  }
  return fragments;
}

/** Convenience: positioned lines extracted from a PDF buffer. */
export function extractPdfLines(pdf: Uint8Array): PdfLine[] {
  return linesFromFragments(extractPdfFragments(pdf));
}
