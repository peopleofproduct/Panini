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

import type { StatementFormat } from './types';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 (xlsx/docx)
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(data: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((b, i) => data[i] === b);
}

/**
 * Decodes statement bytes to text, honouring byte-order marks — Excel's
 * "CSV UTF-8" adds an EF BB BF prefix and "Unicode text" saves UTF-16.
 * Without a BOM the bytes are read as UTF-8.
 */
export function decodeBytes(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  }
  if (data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(data.subarray(2));
  }
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(data.subarray(3));
  }
  return new TextDecoder('utf-8').decode(data);
}

const HEAD_BYTES = 512;

function hasBom(data: Uint8Array): boolean {
  return (
    (data[0] === 0xff && data[1] === 0xfe) ||
    (data[0] === 0xfe && data[1] === 0xff) ||
    (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf)
  );
}

/** True when the leading bytes look like UTF-8 text (no control bytes, valid sequences). */
function looksLikeText(data: Uint8Array): boolean {
  const head = data.subarray(0, HEAD_BYTES);
  for (const b of head) {
    if (b === 0x7f || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)) return false;
  }
  // Drop the final char: the slice may cut a multi-byte sequence in half.
  return !new TextDecoder('utf-8').decode(head).slice(0, -1).includes('\uFFFD');
}

/**
 * Sniffs the input format from magic bytes (binary) or text shape
 * (multi-line with delimiters → csv; single-line alert → sms).
 */
export function sniffFormat(input: string | Uint8Array): StatementFormat {
  if (input instanceof Uint8Array) {
    if (startsWith(input, PDF_MAGIC)) return 'pdf';
    if (startsWith(input, ZIP_MAGIC)) return 'xlsx';
    if (startsWith(input, PNG_MAGIC) || startsWith(input, JPEG_MAGIC)) return 'image';
    if (hasBom(input) || looksLikeText(input)) {
      input = decodeBytes(input);
    } else {
      return 'unknown';
    }
  }
  const text = input.trim();
  if (text === '') return 'unknown';
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  const hasDelimiters = lines.some((l) => (l.match(/[,;\t|]/g) ?? []).length >= 2);
  if (lines.length >= 2 && hasDelimiters) return 'csv';
  if (/\b(debited|credited|avl\s*bal|a\/c|spent)\b/i.test(text)) return 'sms';
  if (hasDelimiters) return 'csv';
  // Weak CSV shape: multiple lines, at least two of which carry a
  // delimiter — covers two-column exports (a single comma per line)
  // that the ≥2-delimiter heuristic above would misroute to SMS.
  const delimLines = lines.filter((l) => /[,;\t|]/.test(l)).length;
  if (lines.length >= 2 && delimLines >= 2) return 'csv';
  return 'sms';
}
