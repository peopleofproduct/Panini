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

import { extractStatement } from '@paniniapi/extract';
import type { InsightTransaction } from '@paniniapi/insights';
import { analyzeTransactions } from '@paniniapi/insights';
import { parseBankNarration } from '@paniniapi/rules-engine';
import type { BsaInputFile, BsaOptions, BsaReport, EnrichedTransaction } from './types';

/**
 * BSA-in-a-box pipeline: files → extraction → narration enrichment →
 * insights. Never throws — per-file failures land in `warnings`, malformed
 * rows are dropped by the analyzer. Runs entirely in-process; the only
 * optional plug-ins (spreadsheet/OCR providers) are caller-injected, so no
 * implicit network or filesystem access exists here.
 */
export async function analyzeStatementFiles(
  files: readonly BsaInputFile[],
  options: BsaOptions = {},
): Promise<BsaReport> {
  const enrich = options.enrich !== false;
  const statements: BsaReport['statements'][number][] = [];
  const enriched: EnrichedTransaction[] = [];

  for (const [fileIndex, file] of files.entries()) {
    const st = await extractStatement(file.data, options);
    statements.push({
      name: file.name,
      format: st.format,
      bank: st.bank,
      layoutId: st.layoutId,
      accountMask: st.accountMask,
      transactionCount: st.transactions.length,
      warnings: st.warnings,
      metadata: st.metadata,
    });
    for (const t of st.transactions) {
      const parsed = enrich ? parseBankNarration(t.narration) : null;
      enriched.push({
        date: t.date,
        narration: t.narration,
        refNo: t.refNo,
        direction: t.direction,
        amountPaise: t.amountPaise,
        balancePaise: t.balancePaise,
        counterparty: parsed?.counterparty ?? null,
        merchant: parsed?.merchant ?? null,
        merchantCanonical: parsed?.merchant_canonical ?? null,
        category: parsed?.category ?? 'Uncategorized',
        channel: parsed?.channel ?? 'UNKNOWN',
        type: parsed?.type ?? 'UNKNOWN',
        is_salary: parsed?.is_salary ?? false,
        vpa: parsed?.vpa ?? null,
        vpaApp: parsed?.vpa_app ?? null,
        ifscBank: parsed?.ifsc_bank ?? null,
        fileIndex,
      });
    }
  }

  const insightsInput: InsightTransaction[] = enriched.map((t) => {
    const base: InsightTransaction = {
      date: t.date,
      narration: t.narration,
      refNo: t.refNo,
      direction: t.direction === 'UNKNOWN' ? null : t.direction,
      amountPaise: t.amountPaise,
      balancePaise: t.balancePaise,
      counterparty: t.merchantCanonical ?? t.counterparty,
      merchant: t.merchantCanonical ?? t.merchant,
      category: t.category,
      channel: t.channel,
      is_salary: t.is_salary,
    };
    return base;
  });
  const insights = analyzeTransactions(insightsInput, options.insightsOptions);

  const dates = enriched
    .map((t) => t.date)
    .filter((d): d is string => d !== null)
    .sort();
  const accounts = [
    ...new Set(statements.map((s) => s.accountMask).filter((a): a is string => a !== null)),
  ];

  return {
    statements,
    summary: {
      filesProcessed: files.length,
      filesWithTransactions: statements.filter((s) => s.transactionCount > 0).length,
      totalTransactions: enriched.length,
      periodStart: dates[0] ?? null,
      periodEnd: dates[dates.length - 1] ?? null,
      accounts,
    },
    insights,
    transactions: enriched,
  };
}
