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
import { inspectStatement, reconcileWithAa, transactionsFromAaData } from '@paniniapi/forensics';
import type { AccountSlice, InsightTransaction } from '@paniniapi/insights';
import {
  analyzeTransactions,
  consolidateAccounts,
  detectFraudIndicators,
  detectPortfolioIndicators,
} from '@paniniapi/insights';
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
  const enrichedByFile: InsightTransaction[][] = [];
  const aaTransactions =
    options.aaData === undefined ? null : transactionsFromAaData(options.aaData);

  for (const [fileIndex, file] of files.entries()) {
    const st = await extractStatement(file.data, options);
    let integrity: BsaReport['statements'][number]['integrity'] = null;
    if (options.forensics !== false) {
      const report = await inspectStatement(file.data, {
        extract: options,
        ...(options.trustStore === undefined ? {} : { trustStore: options.trustStore }),
      });
      integrity = {
        verdict: report.verdict,
        critical: report.critical,
        warnings: report.warningCount,
        topSignals: report.signals
          .filter((s) => s.severity !== 'info')
          .slice(0, 5)
          .map((s) => `${s.ruleId}: ${s.message}`),
      };
    }
    let reconciliation: BsaReport['statements'][number]['reconciliation'] = null;
    if (aaTransactions !== null) {
      const r = reconcileWithAa(st, aaTransactions);
      reconciliation = {
        verdict: r.verdict,
        matchedRows: r.matchedRows,
        documentOnlyRows: r.documentOnlyRows.length,
        aaOnlyRows: r.aaOnlyRows.length,
        unverifiableRows: r.unverifiableRows.length,
        summary: r.summary,
      };
    }
    statements.push({
      name: file.name,
      format: st.format,
      bank: st.bank,
      layoutId: st.layoutId,
      accountMask: st.accountMask,
      transactionCount: st.transactions.length,
      warnings: st.warnings,
      metadata: st.metadata,
      integrity,
      reconciliation,
    });
    const fileRows: InsightTransaction[] = [];
    for (const t of st.transactions) {
      const parsed = enrich ? parseBankNarration(t.narration) : null;
      const row: EnrichedTransaction = {
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
      };
      enriched.push(row);
      fileRows.push({
        date: row.date,
        narration: row.narration,
        refNo: row.refNo,
        direction: row.direction === 'UNKNOWN' ? null : row.direction,
        amountPaise: row.amountPaise,
        balancePaise: row.balancePaise,
        counterparty: row.merchantCanonical ?? row.counterparty,
        merchant: row.merchantCanonical ?? row.merchant,
        category: row.category,
        channel: row.channel,
        is_salary: row.is_salary,
      });
    }
    enrichedByFile.push(fileRows);
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

  // Fraud indicators: pooled single-statement rules plus the portfolio-level
  // checks that only exist across the borrower's full account set.
  const fraud =
    options.fraud === false ? null : detectFraudIndicators(insightsInput, options.fraudOptions);
  const slices: AccountSlice[] = statements.map((s, fi) => ({
    accountKey: `${s.bank ?? 'BANK'}-${s.accountMask ?? `file-${fi}`}`,
    accountMask: s.accountMask,
    bank: s.bank,
    transactions: enrichedByFile[fi] ?? [],
  }));
  const portfolio =
    options.fraud === false ? null : consolidateAccounts(slices, options.fraudOptions);
  const portfolioFraud =
    options.fraud === false ? null : detectPortfolioIndicators(slices, options.fraudOptions);
  const fraudReport =
    fraud === null
      ? null
      : {
          indicators: [...fraud.indicators, ...(portfolioFraud?.indicators ?? [])],
          warnings: [...fraud.warnings, ...(portfolioFraud?.warnings ?? [])],
        };

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
    fraud: fraudReport,
    portfolio,
    transactions: enriched,
  };
}
