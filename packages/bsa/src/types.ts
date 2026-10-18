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

import type { ExtractOptions, StatementFormat } from '@paniniapi/extract';
import type { InsightsOptions, InsightsReport } from '@paniniapi/insights';
import type { ParsedBankNarration } from '@paniniapi/rules-engine';
import type { IntegrityVerdict } from '@paniniapi/forensics';

/** One input document — bytes for PDF/XLSX/image, text for CSV/SMS. */
export interface BsaInputFile {
  /** Display name used in the report (e.g. 'hdfc_jan.pdf'). */
  readonly name: string;
  readonly data: string | Uint8Array;
}

/** Per-file extraction outcome. Never throws — failures are warnings. */
export interface StatementResult {
  readonly name: string;
  readonly format: StatementFormat;
  readonly bank: string | null;
  readonly layoutId: string | null;
  /** Masked account number when detected (e.g. 'XXXX1234'). */
  readonly accountMask: string | null;
  readonly transactionCount: number;
  readonly warnings: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  /**
   * Document-integrity verdict from @paniniapi/forensics — 'tamper_evidence'
   * means a lender must not auto-approve on this file. Omitted only when
   * forensics is disabled via `BsaOptions.forensics === false`.
   */
  readonly integrity: {
    readonly verdict: IntegrityVerdict;
    readonly critical: number;
    readonly warnings: number;
    readonly topSignals: readonly string[];
  } | null;
}

/** Enriched transaction — extracted row + narration intelligence merged. */
export interface EnrichedTransaction {
  readonly date: string | null;
  readonly narration: string;
  readonly refNo: string | null;
  readonly direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' | null;
  readonly amountPaise: number | null;
  readonly balancePaise: number | null;
  readonly counterparty: string | null;
  readonly merchant: string | null;
  readonly merchantCanonical: string | null;
  readonly category: string;
  readonly channel: ParsedBankNarration['channel'];
  readonly type: ParsedBankNarration['type'];
  readonly is_salary: boolean;
  readonly vpa: string | null;
  readonly vpaApp: string | null;
  readonly ifscBank: string | null;
  /** Index of the source file in the input array. */
  readonly fileIndex: number;
}

export interface BsaSummary {
  readonly filesProcessed: number;
  readonly filesWithTransactions: number;
  readonly totalTransactions: number;
  /** Earliest/latest transaction dates across all files (ISO). */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  /** Distinct masked accounts observed. */
  readonly accounts: readonly string[];
}

export interface BsaReport {
  readonly statements: readonly StatementResult[];
  readonly summary: BsaSummary;
  readonly insights: InsightsReport;
  readonly transactions: readonly EnrichedTransaction[];
}

export interface BsaOptions extends ExtractOptions {
  /** Narration enrichment via rules-engine dictionaries. Default true. */
  readonly enrich?: boolean;
  /** Document-integrity forensics per file. Default true. */
  readonly forensics?: boolean;
  /** PEM roots or X509Certificate anchors for PDF signature chain checks. */
  readonly trustStore?: readonly string[];
  readonly insightsOptions?: InsightsOptions;
}
