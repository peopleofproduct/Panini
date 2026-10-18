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
import type {
  ConductMetrics,
  CounterpartyFlowReport,
  FraudOptions,
  FraudReport,
  InsightsOptions,
  InsightsReport,
  PortfolioReport,
} from '@paniniapi/insights';
import type { ParsedBankNarration } from '@paniniapi/rules-engine';
import type { IntegrityVerdict, ReconcileVerdict } from '@paniniapi/forensics';

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
  /**
   * AA ↔ document reconciliation — present only when `BsaOptions.aaData`
   * was supplied. 'fabrication_evidence' means the document disagrees
   * with the bank's own feed: fail closed.
   */
  readonly reconciliation: {
    readonly verdict: ReconcileVerdict;
    readonly matchedRows: number;
    readonly documentOnlyRows: number;
    readonly aaOnlyRows: number;
    readonly unverifiableRows: number;
    readonly summary: string;
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
  /**
   * Named fraud-indicator findings — pooled single-statement rules plus
   * portfolio-level checks (cross-account rotation, inflated turnover).
   * Null when `BsaOptions.fraud === false`.
   */
  readonly fraud: FraudReport | null;
  /** Multi-account consolidation: per-account rollups, internal transfers,
   *  cross-statement duplicates, external-only flow totals. */
  readonly portfolio: PortfolioReport | null;
  /** Behavioural conduct metrics — overdrawn days, EOD balance stats,
   *  bounce rate. Always computed (deterministic, no options). */
  readonly conduct: ConductMetrics;
  /** Top-25 counterparties by volume — the money-trail table. */
  readonly counterpartyFlows: CounterpartyFlowReport;
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
  /** Fraud-indicator suite (pooled + portfolio). Default true. */
  readonly fraud?: boolean;
  readonly fraudOptions?: FraudOptions;
  /**
   * Decrypted ReBIT AA FI payload (or a bare transaction array). When
   * supplied, every extracted statement is reconciled against the bank's
   * own feed — see docs/aa-reconciliation.md.
   */
  readonly aaData?: unknown;
}
