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

import { STATEMENT_SPECS, generateCsvStatement } from '@paniniapi/simulator';
import { analyzeStatementFiles } from '../src/pipeline';
import { formatInr, renderMarkdown } from '../src/render';

function csvFile(name: string, layoutId: string, seed: number, txns = 30) {
  const spec = STATEMENT_SPECS.find((s) => s.layoutId === layoutId)!;
  const gen = generateCsvStatement(spec, { seed, transactions: txns });
  return { name, data: gen.text };
}

describe('analyzeStatementFiles', () => {
  it('runs files → extract → enrich → insights end-to-end', async () => {
    const report = await analyzeStatementFiles([
      csvFile('hdfc_jan.csv', 'hdfc_statement', 7),
      csvFile('sbi_jan.csv', 'sbi_statement', 11),
    ]);
    expect(report.summary.filesProcessed).toBe(2);
    expect(report.summary.totalTransactions).toBeGreaterThan(0);
    expect(report.insights.analyzedTransactions).toBe(report.summary.totalTransactions);
    expect(report.statements[0]?.name).toBe('hdfc_jan.csv');
    expect(report.statements[0]?.format).toBe('csv');
    expect(report.summary.periodStart).not.toBeNull();
    expect(report.summary.periodEnd).not.toBeNull();
  });

  it('enriches narrations — salary keywords produce income credits', async () => {
    const report = await analyzeStatementFiles([csvFile('hdfc.csv', 'hdfc_statement', 7, 40)]);
    // Simulator embeds 'SALARY' narrations; enrichment + keyword rule must
    // lift them into income credits (fallback: regular_credit pattern).
    const salaryRows = report.transactions.filter((t) => t.is_salary);
    const incomeCount = report.insights.income.credits.length;
    expect(salaryRows.length + incomeCount).toBeGreaterThan(0);
    // Enriched rows carry category/channel/channel metadata.
    const enriched = report.transactions.find((t) => t.category !== 'Uncategorized');
    expect(enriched).toBeDefined();
  });

  it('runs integrity forensics per file — tampered balance chain flags tamper_evidence', async () => {
    const tampered =
      'HDFC BANK LTD.\nStatement From 01/10/26 To 31/10/26\n' +
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n' +
      '15/10/26,NEFT-N1-SALARY-TCS,N1,15/10/26,,85000.00,90000.00\n' +
      '16/10/26,UPI-X,U1,16/10/26,1250.00,,99999.00\n'; // balance chain breaks
    const report = await analyzeStatementFiles([
      { name: 'tampered.csv', data: tampered },
      csvFile('clean.csv', 'hdfc_statement', 5, 10),
    ]);
    const t = report.statements.find((s) => s.name === 'tampered.csv');
    expect(t?.integrity?.verdict).toBe('tamper_evidence');
    const md = renderMarkdown(report);
    expect(md).toContain('Document Integrity');
  });

  const AA_DOC =
    'HDFC BANK LTD.\nStatement From 01/10/26 To 31/10/26\n' +
    'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n' +
    '15/10/26,NEFT-N1-SALARY-TCS,N1,15/10/26,,85000.00,90000.00\n' +
    '16/10/26,UPI-SWIGGY,U1,16/10/26,1250.00,,88750.00\n';
  const AA_FEED = {
    Account: {
      Transactions: {
        Transaction: [
          {
            txnId: '1',
            amount: '85000.00',
            type: 'CREDIT',
            valueDate: '2026-10-15',
            narration: 'NEFT-N1-SALARY-TCS',
          },
          {
            txnId: '2',
            amount: '1250.00',
            type: 'DEBIT',
            valueDate: '2026-10-16',
            narration: 'UPI-SWIGGY',
          },
        ],
      },
    },
  };

  it('reconciles statements against AA data when provided', async () => {
    const report = await analyzeStatementFiles([{ name: 'stmt.csv', data: AA_DOC }], {
      aaData: AA_FEED,
    });
    const s = report.statements[0]!;
    expect(s.reconciliation).not.toBeNull();
    expect(s.reconciliation!.verdict).toBe('consistent');
    expect(s.reconciliation!.matchedRows).toBe(2);
  });

  it('flags fabrication when AA feed carries rows the document omits', async () => {
    const aaExtra = {
      Account: {
        Transactions: {
          Transaction: [
            ...AA_FEED.Account.Transactions.Transaction,
            {
              txnId: '3',
              amount: '500.00',
              type: 'DEBIT',
              valueDate: '2026-10-17',
              narration: 'UPI EMI BOUNCE',
            },
          ],
        },
      },
    };
    const report = await analyzeStatementFiles([{ name: 'stmt.csv', data: AA_DOC }], {
      aaData: aaExtra,
    });
    const s = report.statements[0]!;
    expect(s.reconciliation!.verdict).toBe('fabrication_evidence');
    expect(s.reconciliation!.aaOnlyRows).toBe(1);
    const md = renderMarkdown(report);
    expect(md).toContain('AA ↔ Document Reconciliation');
  });

  it('omits reconciliation when no AA data is supplied', async () => {
    const report = await analyzeStatementFiles([{ name: 'stmt.csv', data: AA_DOC }]);
    expect(report.statements[0]!.reconciliation).toBeNull();
  });

  it('never throws on garbage input — warnings only', async () => {
    const report = await analyzeStatementFiles([
      { name: 'garbage.bin', data: new Uint8Array([0, 1, 2, 3, 255]) },
      { name: 'empty.csv', data: 'date,amount\n' },
    ]);
    expect(report.summary.filesProcessed).toBe(2);
    expect(report.summary.filesWithTransactions).toBe(0);
    expect(report.insights.analyzedTransactions).toBe(0);
  });

  it('is deterministic — identical inputs give byte-identical markdown', async () => {
    const files = [csvFile('a.csv', 'icici_statement', 5)];
    const a = renderMarkdown(await analyzeStatementFiles(files));
    const b = renderMarkdown(await analyzeStatementFiles(files));
    expect(a).toBe(b);
    expect(a).toContain('# Bank Statement Analysis');
    expect(a).toContain('## FOIR');
    expect(a).toContain('## Risk Signals');
  });

  it('respects enrich:false — rows pass through unlabelled', async () => {
    const report = await analyzeStatementFiles([csvFile('a.csv', 'hdfc_statement', 7)], {
      enrich: false,
    });
    expect(report.transactions.every((t) => t.category === 'Uncategorized')).toBe(true);
    expect(report.transactions.every((t) => !t.is_salary)).toBe(true);
  });

  it('surfaces fraud indicators + multi-account consolidation', async () => {
    const header =
      'HDFC BANK LTD.\nStatement From 01/01/26 To 31/01/26\n' +
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n';
    // Two accounts, same borrower's money rotating A→B (₹50,000 out of A,
    // ₹50,000 into B next day) — portfolio-level detection.
    const acctA =
      header +
      '01/01/26,NEFT-SALARY-ACME,S1,01/01/26,,75000.00,100000.00\n' +
      '05/01/26,NEFT TO ALPHA,S2,05/01/26,50000.00,,50000.00\n';
    const acctB =
      header +
      '06/01/26,NEFT FROM A OWN,B1,06/01/26,,50000.00,51000.00\n' +
      '10/01/26,UPI-SWIGGY,B2,10/01/26,450.00,,50550.00\n';
    const report = await analyzeStatementFiles([
      { name: 'a.csv', data: acctA },
      { name: 'b.csv', data: acctB },
    ]);
    expect(report.fraud).not.toBeNull();
    expect(report.portfolio).not.toBeNull();
    // Two files with no detected masks → distinct accountKeys.
    expect(report.portfolio!.accounts).toHaveLength(2);
    // ₹50k debit in file-a mirrored by ₹50k credit in file-b.
    const internal = report.portfolio!.internalTransfers;
    expect(internal.length).toBeGreaterThanOrEqual(1);
    expect(internal[0]!.amountPaise).toBe(50000_00);
    // External turnover nets out the internal legs.
    expect(report.portfolio!.consolidated.externalCreditsPaise).toBe(75000_00);
    const md = renderMarkdown(report);
    expect(md).toContain('## Fraud Indicators');
    expect(md).toContain('## Multi-Account Consolidation');
  });

  it('fraud:false leaves fraud and portfolio null', async () => {
    const report = await analyzeStatementFiles([csvFile('a.csv', 'hdfc_statement', 7)], {
      fraud: false,
    });
    expect(report.fraud).toBeNull();
    expect(report.portfolio).toBeNull();
  });

  it('classifies non-statement income documents instead of zero-transaction silence', async () => {
    const payslip =
      'ACME TECHNOLOGIES PVT LTD\nPayslip for the month of March 2024\n' +
      'Employee Name    RAHUL SHARMA\nPAN              AXYPD1234K\n' +
      'Basic            52,000.00\nHRA              20,800.00\n' +
      'Gross Earnings   72,800.00\nPF               6,240.00\n' +
      'Total Deductions 6,240.00\nNet Pay          66,560.00\n';
    const report = await analyzeStatementFiles([{ name: 'payslip.txt', data: payslip }]);
    const st = report.statements[0]!;
    expect(st.document?.kind).toBe('payslip');
    if (st.document?.kind === 'payslip') {
      expect(st.document.netPayPaise).toBe(6656000);
      expect(st.document.arithmeticCheck).toBe('ok');
    }
    const md = renderMarkdown(report);
    expect(md).toContain('## Income Documents');
    expect(md).toContain('payslip');
  });
});

describe('formatInr — Indian digit grouping', () => {
  it.each([
    [500, '₹5.00'],
    [123456789, '₹12,34,567.89'],
    [-100050, '-₹1,000.50'],
    [null, '—'],
    [Number.NaN, '—'],
  ])('formats %p paise as %s', (paise, expected) => {
    expect(formatInr(paise)).toBe(expected);
  });
});
