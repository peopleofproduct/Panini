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

export type {
  ExtractedStatement,
  ExtractedTransaction,
  ExtractOptions,
  RowDirection,
  StatementFormat,
} from './types';
export { extractStatement } from './extract';
export { sniffFormat } from './sniff';
export { extractCsvStatement, statementFromRows } from './csv/csvStatement';
export { parseCsv, detectDelimiter } from './csv/csvParser';
export { detectTable, normalizeHeaderCell } from './csv/layouts';
export type { ColumnField, DetectedTable } from './csv/layouts';
export { extractSms } from './sms';
export { extractPdfFragments, extractPdfLines, linesFromFragments } from './pdf/pdfText';
export type { PdfFragment, PdfLine } from './pdf/pdfText';
export { mapRow, findAccountMask } from './rowMapper';
export type { SpreadsheetProvider } from './spreadsheet';
export type { OcrFragment, OcrProvider, OcrResult } from './ocr';
export { createSheetJsProvider, createTesseractProvider } from './providers';
export type { SheetJsLike, TesseractLike } from './providers';
export { extractPdfStatement, statementFromFragments } from './pdf/pdfStatement';
export type { ExtractPdfOptions } from './pdf/pdfStatement';
export { decryptPdf, passwordCandidates } from './pdf/encryption';
export type { EncryptionInfo, PdfCredentials, PdfUnlock, StreamCipher } from './pdf/encryption';
export {
  loadCsvLayouts,
  loadPasswordPatterns,
  loadSmsPatterns,
  resolveFormatsDir,
} from './formatsLoader';
export type {
  CsvLayout,
  CsvLayoutsFile,
  PasswordPattern,
  PasswordPatternsFile,
  SmsPattern,
  SmsPatternsFile,
} from './formatsLoader';
export { mineStatementMetadata } from './statementMetadata';
export { parseStatementDate } from './statementDate';
