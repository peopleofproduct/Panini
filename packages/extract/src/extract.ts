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

import { extractCsvStatement, statementFromRows } from './csv/csvStatement';
import { loadCsvLayouts, loadSmsPatterns } from './formatsLoader';
import { extractPdfStatement } from './pdf/pdfStatement';
import { extractSms } from './sms';
import { sniffFormat } from './sniff';
import type { ExtractOptions, ExtractedStatement } from './types';

function empty(format: ExtractedStatement['format'], warnings: string[]): ExtractedStatement {
  return {
    format,
    bank: null,
    layoutId: null,
    accountMask: null,
    transactions: [],
    warnings,
    metadata: {},
  };
}

/** Splits OCR text into pseudo-cell rows (2+ spaces or tabs = column break). */
function linesToRows(text: string): string[][] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.split(/\t| {2,}/).map((c) => c.trim()));
}

/**
 * One entry point for every statement input:
 *
 *   string / UTF-8 text  → csv (multi-line delimited) or sms (alert body)
 *   %PDF bytes           → pdf text-layer extraction
 *   PK zip bytes         → xlsx via the caller's SpreadsheetProvider
 *   PNG/JPEG bytes       → image via the caller's OcrProvider → rows
 *
 * Never throws for malformed input — warnings carry the details.
 */
export async function extractStatement(
  input: string | Uint8Array,
  options: ExtractOptions = {},
): Promise<ExtractedStatement> {
  const format = sniffFormat(input);
  const hint = { ...(options.bankHint !== undefined ? { bankHint: options.bankHint } : {}) };
  const withLayout = {
    ...hint,
    ...(options.layoutId !== undefined ? { layoutId: options.layoutId } : {}),
  };
  const layouts = loadCsvLayouts(options.formatsDir);

  switch (format) {
    case 'csv':
      return extractCsvStatement(input as string, layouts, withLayout);
    case 'sms':
      return extractSms(input as string, loadSmsPatterns(options.formatsDir), hint);
    case 'pdf': {
      const result = extractPdfStatement(input as Uint8Array, layouts, hint);
      if (
        result.transactions.length === 0 &&
        result.warnings.some((w) => w.includes('OCR')) &&
        options.ocr
      ) {
        let ocr;
        try {
          ocr = await options.ocr.recognize(input as Uint8Array);
        } catch (err) {
          return {
            ...result,
            warnings: [
              ...result.warnings,
              `ocr provider '${options.ocr.name}' failed: ${err instanceof Error ? err.message : String(err)}`,
            ],
          };
        }
        const rows = linesToRows(ocr.text);
        const mined = statementFromRows(rows, layouts, 'image', withLayout);
        return {
          ...mined,
          format: 'pdf',
          metadata: { ...mined.metadata, ocrProvider: options.ocr.name },
        };
      }
      return result;
    }
    case 'xlsx': {
      if (!options.spreadsheet) {
        return empty('xlsx', [
          'spreadsheet input requires options.spreadsheet — plug in SheetJS/exceljs via the SpreadsheetProvider seam',
        ]);
      }
      let rows: string[][];
      try {
        rows = options.spreadsheet.readSheet(input as Uint8Array).map((r) => [...r]);
      } catch (err) {
        return empty('xlsx', [
          `spreadsheet provider '${options.spreadsheet.name}' failed: ${err instanceof Error ? err.message : String(err)}`,
        ]);
      }
      const mined = statementFromRows(rows, layouts, 'xlsx', withLayout);
      return {
        ...mined,
        metadata: { ...mined.metadata, spreadsheetProvider: options.spreadsheet.name },
      };
    }
    case 'image': {
      if (!options.ocr) {
        return empty('image', [
          'image input requires options.ocr — plug in Tesseract/cloud OCR via the OcrProvider seam',
        ]);
      }
      let ocr;
      try {
        ocr = await options.ocr.recognize(input as Uint8Array);
      } catch (err) {
        return empty('image', [
          `ocr provider '${options.ocr.name}' failed: ${err instanceof Error ? err.message : String(err)}`,
        ]);
      }
      const rows = linesToRows(ocr.text);
      const mined = statementFromRows(rows, layouts, 'image', withLayout);
      return {
        ...mined,
        metadata: { ...mined.metadata, ocrProvider: options.ocr.name },
      };
    }
    default:
      return empty('unknown', ['input format could not be identified']);
  }
}
