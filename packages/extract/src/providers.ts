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

import type { OcrFragment, OcrProvider } from './ocr';
import type { SpreadsheetProvider } from './spreadsheet';

/**
 * Ready-made provider adapters. The heavy libraries stay caller-owned —
 * these factories only require a duck-typed handle on the library the
 * consumer already installed, so this package remains zero-dependency.
 *
 *   import * as XLSX from 'xlsx';
 *   extractStatement(bytes, { spreadsheet: createSheetJsProvider(XLSX) });
 *
 *   import { createWorker } from 'tesseract.js';
 *   const worker = await createWorker('eng');
 *   extractStatement(png, { ocr: createTesseractProvider(worker) });
 */

/** Minimal structural shape of a SheetJS-compatible module. */
export interface SheetJsLike {
  readonly SheetNames?: readonly string[];
  read(
    data: Uint8Array | ArrayBuffer,
    options?: { type?: string },
  ): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json(worksheet: unknown, options?: { header?: number; raw?: boolean }): unknown;
  };
}

/** Adapts SheetJS (or any compatible spreadsheet reader) to the seam. */
export function createSheetJsProvider(xlsx: SheetJsLike, sheetIndex = 0): SpreadsheetProvider {
  return {
    name: 'sheetjs',
    readSheet(data) {
      const workbook = xlsx.read(data, { type: 'array' });
      const name = workbook.SheetNames[sheetIndex] ?? workbook.SheetNames[0];
      if (name === undefined) return [];
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
        raw: false,
      });
      if (!Array.isArray(rows)) return [];
      return (rows as unknown[]).map((row) =>
        Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [],
      );
    },
  };
}

/** Minimal structural shape of a tesseract.js worker. */
export interface TesseractLike {
  recognize(image: Uint8Array | Buffer | string): Promise<{
    data: {
      text: string;
      confidence?: number;
      words?: readonly {
        text: string;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }[];
    };
  }>;
}

/**
 * Adapts a tesseract.js worker (or compatible engine) to the OCR seam.
 * Word boxes become OcrFragments so column anchoring survives OCR —
 * far more accurate than whitespace-splitting flat text on bank tables.
 */
export function createTesseractProvider(worker: TesseractLike): OcrProvider {
  return {
    name: 'tesseract',
    async recognize(image) {
      const { data } = await worker.recognize(image);
      const fragments: OcrFragment[] = (data.words ?? [])
        .filter((w) => w.text.trim() !== '')
        .map((w) => ({ text: w.text, x: w.bbox.x0, y: w.bbox.y0 }));
      const out: { text: string; fragments?: OcrFragment[]; confidence?: number } = {
        text: data.text,
      };
      if (fragments.length > 0) out.fragments = fragments;
      if (data.confidence !== undefined) out.confidence = data.confidence / 100;
      return out;
    },
  };
}
