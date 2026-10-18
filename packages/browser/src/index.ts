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

/**
 * Browser-safe Panini: narration parsing, CSV/SMS statement extraction and
 * deterministic insights — all grammar/dictionary data inlined, zero node:
 * imports in the emitted bundle. PDF/XLSX/OCR extraction stays Node-side
 * (zlib/crypto/filesystem) and is intentionally out of scope here.
 */

import type { ParseBankNarrationOptions } from '@paniniapi/rules-engine';
import { parseBankNarration, setDictionaries, setTaxonomy } from '@paniniapi/rules-engine';
// Leaf-module imports keep the bundle free of extract's Node-only PDF/zlib
// path — esbuild inlines these sources; consumers never resolve them.
import { extractCsvStatement } from '../../extract/src/csv/csvStatement';
import { extractSms } from '../../extract/src/sms';
import type { ExtractedStatement } from '@paniniapi/extract';
import type { InsightTransaction, InsightsReport } from '@paniniapi/insights';
import { analyzeTransactions } from '@paniniapi/insights';
import {
  BANK_NAMES,
  CATEGORIES,
  CSV_LAYOUTS,
  DICTIONARIES,
  RULE_SETS,
  SMS_PATTERNS,
  TAXONOMY,
} from './data.gen';

let initialised = false;

/** Idempotent dictionary injection — safe to call on every use. */
export function initPaniniBrowser(): void {
  if (initialised) return;
  setDictionaries(DICTIONARIES);
  setTaxonomy(TAXONOMY);
  initialised = true;
}
initPaniniBrowser();

/** Parse one bank narration — full grammar + dictionary enrichment. */
export function parseNarration(
  text: string,
  options?: Omit<ParseBankNarrationOptions, 'ruleSets' | 'categories' | 'bare'>,
): ReturnType<typeof parseBankNarration> {
  initPaniniBrowser();
  return parseBankNarration(text, {
    ...options,
    bare: true,
    ruleSets: RULE_SETS,
    categories: CATEGORIES,
  } as ParseBankNarrationOptions);
}

/** Extract a CSV bank statement using the bundled layouts. */
export function extractCsv(
  text: string,
  options?: { bankHint?: string; layoutId?: string },
): ExtractedStatement {
  return extractCsvStatement(text, CSV_LAYOUTS, { bankNames: BANK_NAMES, ...options });
}

/** Extract bank transactions from an SMS/alert body. */
export function extractSmsText(text: string, options?: { bankHint?: string }): ExtractedStatement {
  return extractSms(text, SMS_PATTERNS, options ?? {});
}

export {
  analyzeTransactions,
  consolidateAccounts,
  counterpartyFlows,
  detectConductMetrics,
  detectFraudIndicators,
  detectPortfolioIndicators,
  FLOW_RULE_IDS,
  FRAUD_RULE_IDS,
} from '@paniniapi/insights';
export type {
  AccountSlice,
  ConductMetrics,
  CounterpartyFlowReport,
  FraudReport,
  InsightTransaction,
  InsightsReport,
  PortfolioReport,
} from '@paniniapi/insights';

export interface CsvAnalysis {
  readonly statement: ExtractedStatement;
  readonly insights: InsightsReport;
}

/**
 * One-shot: CSV text → transactions → insights. Enrichment comes from the
 * bundled dictionaries — equivalent to the Node BSA pipeline for CSV input.
 */
export function analyzeCsvStatement(
  text: string,
  options?: { bankHint?: string; layoutId?: string },
): CsvAnalysis {
  const statement = extractCsv(text, options);
  const txns: InsightTransaction[] = statement.transactions.map((t) => {
    const p = parseNarration(t.narration);
    return {
      date: t.date,
      narration: t.narration,
      refNo: t.refNo,
      direction: t.direction === 'UNKNOWN' ? null : t.direction,
      amountPaise: t.amountPaise,
      balancePaise: t.balancePaise,
      counterparty: p.merchant_canonical ?? p.counterparty,
      merchant: p.merchant_canonical ?? p.merchant,
      category: p.category,
      channel: p.channel,
      is_salary: p.is_salary,
    };
  });
  return { statement, insights: analyzeTransactions(txns) };
}
