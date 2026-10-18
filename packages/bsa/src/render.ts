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

import type { BsaReport } from './types';

/** Indian digit grouping: 123456789 paise → ₹12,34,567.89. */
export function formatInr(paise: number | null): string {
  if (paise === null || !Number.isFinite(paise)) return '—';
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const paiseStr = String(abs % 100).padStart(2, '0');
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest === '' ? last3 : `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  return `${sign}₹${grouped}.${paiseStr}`;
}

function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

/**
 * Deterministic Markdown rendering of a {@link BsaReport} — same input,
 * byte-identical output. Sections follow the lender's reading order:
 * what was analysed, income, obligations, FOIR, cash flow, trends, risks.
 */
export function renderMarkdown(report: BsaReport): string {
  const { summary, insights: i } = report;
  const lines: string[] = [];

  lines.push('# Bank Statement Analysis', '');
  lines.push(`- **Files processed:** ${summary.filesProcessed}`);
  lines.push(`- **Transactions analysed:** ${i.analyzedTransactions}`);
  lines.push(
    `- **Period:** ${summary.periodStart ?? '—'} → ${summary.periodEnd ?? '—'} (${i.cashflow.monthsObserved} month${i.cashflow.monthsObserved === 1 ? '' : 's'})`,
  );
  lines.push(
    `- **Accounts:** ${summary.accounts.length > 0 ? summary.accounts.join(', ') : '—'}`,
    '',
  );

  const hasRecon = report.statements.some((s) => s.reconciliation !== null);
  lines.push(
    '## Statements',
    '',
    `| File | Format | Bank | Layout | Txns | Warnings | Integrity |${hasRecon ? ' AA Reconcile |' : ''}`,
  );
  lines.push(`| --- | --- | --- | --- | --- | --- | --- |${hasRecon ? ' --- |' : ''}`);
  for (const s of report.statements) {
    lines.push(
      `| ${s.name} | ${s.format} | ${s.bank ?? '—'} | ${s.layoutId ?? '—'} | ${s.transactionCount} | ${s.warnings.length} | ${s.integrity?.verdict ?? '—'} |${hasRecon ? ` ${s.reconciliation?.verdict ?? '—'} |` : ''}`,
    );
  }
  lines.push('');

  const reconFlagged = report.statements.filter(
    (s) =>
      s.reconciliation !== null &&
      (s.reconciliation.verdict === 'fabrication_evidence' ||
        s.reconciliation.verdict === 'partial'),
  );
  if (reconFlagged.length > 0) {
    lines.push('## AA ↔ Document Reconciliation', '');
    lines.push(
      '> **`fabrication_evidence` means the document disagrees with the bank\u2019s own feed — fail closed.**',
      '',
    );
    for (const s of reconFlagged) {
      lines.push(`### ${s.name} — ${s.reconciliation!.verdict}`);
      lines.push(`- ${s.reconciliation!.summary}`);
      lines.push('');
    }
  }

  const flagged = report.statements.filter(
    (s) => s.integrity !== null && (s.integrity.critical > 0 || s.integrity.warnings > 0),
  );
  if (flagged.length > 0) {
    lines.push('## Document Integrity', '');
    lines.push(
      '> **A `tamper_evidence` verdict means the file must not drive an automated approval.**',
      '',
    );
    for (const s of flagged) {
      lines.push(`### ${s.name} — ${s.integrity!.verdict}`);
      for (const sig of s.integrity!.topSignals) lines.push(`- ${sig}`);
      lines.push('');
    }
  }

  lines.push('## Income', '');
  lines.push(`- **Monthly average:** ${formatInr(i.income.monthlyAveragePaise)}`);
  lines.push(`- **Credits detected:** ${i.income.credits.length}`);
  lines.push(`- **Consistency:** ${i.income.consistency}`);
  lines.push(
    `- **Sources:** ${i.income.sources.length > 0 ? i.income.sources.join(', ') : '—'}`,
    '',
  );

  lines.push('## Obligations', '');
  if (i.obligations.recurring.length === 0) {
    lines.push('No recurring obligations detected.', '');
  } else {
    lines.push('| Counterparty | Typical | Months | EMI? |', '| --- | --- | --- | --- |');
    for (const r of i.obligations.recurring) {
      lines.push(
        `| ${r.counterparty} | ${formatInr(r.typicalAmountPaise)} | ${r.monthsHit.length} | ${r.isEmi ? 'yes' : 'no'} |`,
      );
    }
    lines.push('');
  }

  lines.push('## FOIR', '');
  lines.push(`- **Ratio:** ${i.foir.ratio === null ? '—' : pct(i.foir.ratio)}`);
  lines.push(`- **Note:** ${i.foir.note}`, '');

  lines.push('## Cash Flow', '');
  lines.push(`- **Total credits:** ${formatInr(i.cashflow.totalCreditsPaise)}`);
  lines.push(`- **Total debits:** ${formatInr(i.cashflow.totalDebitsPaise)}`);
  lines.push(`- **Net:** ${formatInr(i.cashflow.netPaise)}`);
  lines.push(`- **Avg monthly net:** ${formatInr(i.cashflow.averageMonthlyNetPaise)}`);
  lines.push(
    `- **Balance range:** ${formatInr(i.cashflow.minBalancePaise)} → ${formatInr(i.cashflow.maxBalancePaise)}`,
    '',
  );

  lines.push('## Trends', '');
  lines.push(`- **Net flow direction:** ${i.trends.netFlowDirection}`);
  lines.push(`- **Balance velocity:** ${formatInr(i.trends.balanceVelocityPaisePerDay)}/day`);
  lines.push(`- **Credit volatility:** ${i.trends.creditVolatilityPct ?? '—'}%`);
  lines.push(`- **Debit volatility:** ${i.trends.debitVolatilityPct ?? '—'}%`, '');

  lines.push('## Risk Signals', '');
  if (i.signals.length === 0) {
    lines.push('None detected.', '');
  } else {
    for (const s of i.signals) {
      lines.push(`- **[${s.severity.toUpperCase()}] ${s.ruleId}** — ${s.note}`);
    }
    lines.push('');
  }

  if (i.warnings.length > 0 || report.statements.some((s) => s.warnings.length > 0)) {
    lines.push('## Data Quality', '');
    for (const w of i.warnings) lines.push(`- ${w}`);
    for (const s of report.statements) {
      for (const w of s.warnings) lines.push(`- \`${s.name}\`: ${w}`);
    }
    lines.push('');
  }

  lines.push(
    '---',
    '_Generated by Project Panini — deterministic, client-side, no data leaves this process._',
  );
  return lines.join('\n') + '\n';
}
