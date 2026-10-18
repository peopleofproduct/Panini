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

import type { OcrProvider } from './ocr';
import type { PdfCredentials } from './pdf/encryption';
import type { SpreadsheetProvider } from './spreadsheet';

/** Detected container format of a statement input. */
export type StatementFormat = 'csv' | 'xlsx' | 'pdf' | 'image' | 'sms' | 'unknown';

/** Funds direction as implied by the source layout's column semantics. */
export type RowDirection = 'DEBIT' | 'CREDIT' | 'UNKNOWN' | null;

/**
 * One transaction line lifted out of a statement file. `narration` is the
 * untouched bank narration text — feed it to `parseBankNarration` /
 * `Normalizer` for channel/counterparty/category enrichment.
 */
export interface ExtractedTransaction {
  /** ISO-8601 calendar date (YYYY-MM-DD), or null when unparseable. */
  readonly date: string | null;
  /** Raw narration/description text from the statement. */
  readonly narration: string;
  /** Reference / cheque / UTR number when the layout exposes one. */
  readonly refNo: string | null;
  /** Debit/credit as declared by column semantics, or null when ambiguous. */
  readonly direction: RowDirection;
  /** Transaction amount in integer paise, or null. */
  readonly amountPaise: number | null;
  /** Running/closing balance in integer paise, or null. */
  readonly balancePaise: number | null;
  /** The raw source row/line for auditability. */
  readonly raw: string;
  /** Non-fatal issues encountered on this row. */
  readonly warnings: readonly string[];
}

/** Result of extracting transactions from a statement file or SMS body. */
export interface ExtractedStatement {
  /** Detected input format. */
  readonly format: StatementFormat;
  /** Bank id of the matched layout ('HDFC', 'SBI', ...), or null on generic. */
  readonly bank: string | null;
  /** Identifier of the layout/pattern that produced the rows, or null. */
  readonly layoutId: string | null;
  /** Masked account suffix when the document reveals it. */
  readonly accountMask: string | null;
  /** Extracted transaction rows, in document order. */
  readonly transactions: readonly ExtractedTransaction[];
  /** Non-fatal issues encountered while extracting. */
  readonly warnings: readonly string[];
  /** Extra key/value data (statement period, page count, ...). */
  readonly metadata: Readonly<Record<string, string>>;
}

/** Options accepted by `extractStatement`. */
export interface ExtractOptions {
  /** Hint naming the issuing bank (e.g. 'SBI', 'HDFC'). */
  readonly bankHint?: string;
  /** Force a specific layout id instead of auto-detection. */
  readonly layoutId?: string;
  /** Directory of layout/pattern JSONs; defaults to the bundled set. */
  readonly formatsDir?: string;
  /**
   * Additional formats directory merged ON TOP of the bundled (or
   * `formatsDir`) set — caller layouts/patterns/bank-names are checked
   * first and shadow same-id bundled entries. Lets a lender carry
   * private regional/co-op bank layouts without forking the formats set.
   */
  readonly extraFormatsDir?: string;
  /** Provider for XLSX input (spreadsheet files carry no native text). */
  readonly spreadsheet?: SpreadsheetProvider;
  /** Provider for image/scanned input (OCR). */
  readonly ocr?: OcrProvider;
  /** Credentials for password-protected PDFs (dob/name/pan → per-bank patterns). */
  readonly credentials?: PdfCredentials;
}
