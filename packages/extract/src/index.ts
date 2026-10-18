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
export { sniffFormat, decodeBytes } from './sniff';
export { parseStatementAmount, type StatementAmount } from './statementAmount';
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
export {
  createHttpQueueProvider,
  createNativeXlsxProvider,
  createOpenAiVisionProvider,
  createSheetJsProvider,
  createTesseractProvider,
} from './providers';
export type {
  FetchLike,
  HttpQueueOptions,
  OpenAiVisionOptions,
  SheetJsLike,
  TesseractLike,
} from './providers';
export type { QueueJob, QueueOcrProvider } from './queue';
export type { VisionPage, VisionProvider, VisionResult } from './vision';
export { verifyStatement } from './verify';
export type { VerificationResult, VerifyIssue } from './verify';
export { extractWithRouter } from './router';
export type {
  ExtractionAttempt,
  ExtractionRouterOptions,
  RoutedExtraction,
  RouterTier,
} from './router';
export { consensusCompare, consensusWithVerification } from './consensus';
export type { ConsensusDisagreement, ConsensusResult, ConsensusVerdict } from './consensus';
export { extractPdfStatement, statementFromFragments } from './pdf/pdfStatement';
export type { ExtractPdfOptions } from './pdf/pdfStatement';
export { decryptPdf, passwordCandidates } from './pdf/encryption';
export type { EncryptionInfo, PdfCredentials, PdfUnlock, StreamCipher } from './pdf/encryption';
export { detectBankId } from './bankNames';
export { looksLikeUpiAppStatement, parseUpiAppStatement } from './upiStatement';
export {
  loadBankNames,
  loadCsvLayouts,
  loadPasswordPatterns,
  loadSmsPatterns,
  maybeLoadFormats,
  mergeBankNames,
  mergeCsvLayouts,
  mergePasswordPatterns,
  mergeSmsPatterns,
  resolveFormatsDir,
} from './formatsLoader';
export type {
  BankName,
  BankNamesFile,
  CsvLayout,
  CsvLayoutsFile,
  PasswordPattern,
  PasswordPatternsFile,
  SmsPattern,
  SmsPatternsFile,
} from './formatsLoader';
export { mineStatementMetadata } from './statementMetadata';
export { parseStatementDate } from './statementDate';
