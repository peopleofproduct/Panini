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

/** Payment rails and channels seen in Indian banking narration strings. */
export type TransactionChannel =
  | 'UPI'
  | 'IMPS'
  | 'NEFT'
  | 'RTGS'
  | 'ACH'
  | 'NACH'
  | 'ATM'
  | 'POS'
  | 'CHEQUE'
  | 'NETBANKING'
  | 'WALLET'
  | 'UNKNOWN';

/** Direction of funds. REVERSAL/REFUND indicate a returned transaction. */
export type TransactionType = 'DEBIT' | 'CREDIT' | 'REVERSAL' | 'REFUND' | 'UNKNOWN';

/** Where the raw text originated. */
export type InputSource = 'narration' | 'sms' | 'auto';

export interface RawInput {
  /** Narration string or SMS body. */
  readonly text: string;
  /** Optional hint naming the issuing bank (e.g. 'SBI', 'HDFC'). */
  readonly bankHint?: string;
  /** Medium of the input; 'auto' lets the engine detect SMS vs narration. */
  readonly source?: InputSource;
}

/**
 * Canonical output of the normalization engine. All monetary values are
 * integer paise to avoid floating-point drift. `raw` always preserves the
 * untouched input for auditability.
 */
export interface NormalizedTransaction {
  readonly channel: TransactionChannel;
  readonly counterparty: string | null;
  readonly transactionId: string | null;
  /** UPI VPA handle (e.g. 'okaxis', 'ybl') when present. */
  readonly vpaHandle: string | null;
  readonly type: TransactionType;
  /** Merchant/spend category; 'Uncategorized' when no rule applies. */
  readonly category: string;
  /** ISO-8601 calendar date (YYYY-MM-DD) or null when unparseable. */
  readonly date: string | null;
  /** Transaction amount in integer paise, or null. */
  readonly amountPaise: number | null;
  /** Reported post-transaction balance in paise (e.g. SMS 'Avl Bal'), or null. */
  readonly balancePaise: number | null;
  readonly currency: 'INR';
  /** Masked account suffix (e.g. '1234') when the source reveals it. */
  readonly accountMask: string | null;
  /** The exact input text, unmodified. */
  readonly raw: string;
  /** Identifier of the grammar pattern that matched, or null on fallback. */
  readonly matchedRule: string | null;
  /** Bank whose grammar set matched, or null. */
  readonly bank: string | null;
  /** Deterministic confidence score in [0, 1]. */
  readonly confidence: number;
  /** Extra key/value data captured during parsing (flags, remarks, ...). */
  readonly metadata: Record<string, string>;
  /** Non-fatal issues encountered while parsing. */
  readonly warnings: readonly string[];
}
