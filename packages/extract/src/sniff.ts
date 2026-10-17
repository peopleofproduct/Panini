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
 * Sniffs the input format from magic bytes (binary) or text shape
 * (multi-line with delimiters → csv; single-line alert → sms).
 */
export function sniffFormat(input: string | Uint8Array): StatementFormat {
  if (input instanceof Uint8Array) {
    if (startsWith(input, PDF_MAGIC)) return 'pdf';
    if (startsWith(input, ZIP_MAGIC)) return 'xlsx';
    if (startsWith(input, PNG_MAGIC) || startsWith(input, JPEG_MAGIC)) return 'image';
    const head = input.slice(0, 64);
    if (head.every((b) => b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f))) {
      input = new TextDecoder().decode(input);
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
  return 'sms';
}
