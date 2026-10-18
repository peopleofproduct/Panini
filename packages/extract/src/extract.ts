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
import { loadCsvLayouts, loadPasswordPatterns, loadSmsPatterns } from './formatsLoader';
import type { OcrResult } from './ocr';
import { extractPdfStatement, statementFromFragments } from './pdf/pdfStatement';
import type { PdfFragment } from './pdf/pdfText';
import { extractSms } from './sms';
import { decodeBytes, sniffFormat } from './sniff';
import { readXlsxSheet } from './xlsx/xlsx';
import type { ExtractedStatement, ExtractOptions, StatementFormat } from './types';

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
export function linesToRows(text: string): string[][] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.split(/\t| {2,}/).map((c) => c.trim()));
}

/**
 * OCR output → statement. Word-level boxes take the x-anchored table
 * pipeline (pixel y grows downward, so it is negated to match PDF's
 * bottom-up origin); flat text falls back to whitespace-split rows.
 */
export function statementFromOcr(
  ocr: OcrResult,
  layouts: ReturnType<typeof loadCsvLayouts>,
  format: StatementFormat,
  providerName: string,
  options: { bankHint?: string; layoutId?: string },
): ExtractedStatement {
  const meta: Record<string, string> = { ocrProvider: providerName };
  if (ocr.confidence !== undefined) meta['ocrConfidence'] = ocr.confidence.toFixed(3);

  if (Array.isArray(ocr.fragments) && ocr.fragments.length > 0) {
    const frags: PdfFragment[] = ocr.fragments.map((f) => ({
      page: f.page ?? 1,
      x: f.x,
      y: -f.y,
      text: f.text,
    }));
    const mined = statementFromFragments(frags, options);
    return { ...mined, format, metadata: { ...mined.metadata, ...meta } };
  }
  const mined = statementFromRows(linesToRows(ocr.text ?? ''), layouts, format, options);
  return { ...mined, metadata: { ...mined.metadata, ...meta } };
}

/**
 * One entry point for every statement input:
 *
 *   string / UTF-8 text  → csv (multi-line delimited) or sms (alert body)
 *   %PDF bytes           → pdf text-layer extraction
 *   PK zip bytes         → xlsx via the built-in reader (or a caller's
 *                          SpreadsheetProvider when supplied)
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
  // sniffFormat decodes text-like byte input (UTF-8 / BOM-marked UTF-16) to
  // decide csv/sms — the text pipelines then need the decoded string, not
  // the raw bytes.
  const textInput = input instanceof Uint8Array ? decodeBytes(input) : input;

  switch (format) {
    case 'csv':
      return extractCsvStatement(textInput, layouts, withLayout);
    case 'sms':
      return extractSms(textInput, loadSmsPatterns(options.formatsDir), hint);
    case 'pdf': {
      const result = extractPdfStatement(input as Uint8Array, layouts, {
        ...hint,
        ...(options.credentials !== undefined ? { credentials: options.credentials } : {}),
        passwordPatterns: loadPasswordPatterns(options.formatsDir),
      });
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
        return statementFromOcr(ocr, layouts, 'pdf', options.ocr.name, withLayout);
      }
      return result;
    }
    case 'xlsx': {
      // A caller-supplied provider wins; the zero-dep native reader is the
      // built-in default so .xlsx works with no SheetJS install.
      const spreadsheet = options.spreadsheet ?? {
        name: 'panini-native-xlsx',
        readSheet: readXlsxSheet,
      };
      let rows: string[][];
      try {
        rows = spreadsheet.readSheet(input as Uint8Array).map((r) => [...r]);
      } catch (err) {
        return empty('xlsx', [
          `spreadsheet reader '${spreadsheet.name}' failed: ${err instanceof Error ? err.message : String(err)}`,
        ]);
      }
      if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r))) {
        return empty('xlsx', [
          `spreadsheet reader '${spreadsheet.name}' returned a non-tabular result`,
        ]);
      }
      const mined = statementFromRows(rows, layouts, 'xlsx', withLayout);
      return {
        ...mined,
        metadata: { ...mined.metadata, spreadsheetProvider: spreadsheet.name },
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
      return statementFromOcr(ocr, layouts, 'image', options.ocr.name, withLayout);
    }
    default:
      return empty('unknown', ['input format could not be identified']);
  }
}
