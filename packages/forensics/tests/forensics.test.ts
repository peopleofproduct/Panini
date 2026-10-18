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

import { inspectPdfStructure } from '../src/pdf/structure';
import { inspectPdfContent } from '../src/pdf/content';
import { verifyPdfSignatures } from '../src/pdf/signature';
import { checkConsistency } from '../src/consistency';
import { inspectStatement } from '../src';
import type { ExtractedStatement } from '@paniniapi/extract';
import { buildSignedPdf, tamperSignedByte, TEST_CERT_PEM } from './signedPdfFixture';

const ROWS = [
  ['15/10/26', 'NEFT-N345-SALARY-TCS LTD', 'N345', '', '85000.00', '90000.00'],
  ['16/10/26', 'UPI-DR-SWIGGY', '402512', '1250.00', '', '88750.00'],
];

function pdfWithText(extraOps: string): Uint8Array {
  // minimal uncompressed content stream carrying the given operators
  const ops = `BT /F1 10 Tf ${extraOps} ET`;
  const body = Buffer.from(ops, 'latin1');
  const doc = `%PDF-1.4\n1 0 obj << /Length ${body.length} >> stream\n${ops}\nendstream\nendobj\n%%EOF`;
  return new Uint8Array(Buffer.from(doc, 'latin1'));
}

function stWith(partial: Partial<ExtractedStatement>): ExtractedStatement {
  return {
    format: 'csv',
    bank: 'HDFC',
    layoutId: 'hdfc_statement',
    accountMask: null,
    transactions: [],
    warnings: [],
    metadata: {},
    ...partial,
  };
}

const txn = (o: {
  date?: string | null;
  narration?: string;
  amount?: number | null;
  balance?: number | null;
  direction?: 'DEBIT' | 'CREDIT' | null;
}) => ({
  date: o.date ?? '2026-10-15',
  narration: o.narration ?? 'NEFT-X',
  refNo: null,
  direction: o.direction ?? 'DEBIT',
  amountPaise: o.amount ?? 10000,
  balancePaise: o.balance ?? 90000,
  raw: '',
  warnings: [],
});

describe('pdf structure forensics', () => {
  it('incremental update (double %%EOF) warns', () => {
    const doc = Buffer.from('%PDF-1.4\n%%EOF\n%%EOF\n', 'latin1');
    const sig = inspectPdfStructure(new Uint8Array(doc));
    expect(sig.some((s) => s.ruleId === 'pdf.incremental_update')).toBe(true);
  });

  it('editor producer is critical', () => {
    const doc = Buffer.from(
      '%PDF-1.4\ntrailer << /Info 9 0 R >>\n9 0 obj << /Producer (iLovePDF) >> endobj\n%%EOF',
      'latin1',
    );
    const sig = inspectPdfStructure(new Uint8Array(doc));
    const hit = sig.find((s) => s.ruleId === 'pdf.editor_producer');
    expect(hit?.severity).toBe('critical');
  });

  it('ModDate after CreationDate warns', () => {
    const doc = Buffer.from(
      '%PDF-1.4\ntrailer << /Info 9 0 R >>\n9 0 obj << /Producer (BankGen) /CreationDate (D:20261001) /ModDate (D:20261020) >> endobj\n%%EOF',
      'latin1',
    );
    const sig = inspectPdfStructure(new Uint8Array(doc));
    expect(sig.some((s) => s.ruleId === 'pdf.modified_after_creation')).toBe(true);
  });

  it('AcroForm without signature fields warns; with /Sig stays silent', () => {
    const form = Buffer.from(
      '%PDF-1.4\n1 0 obj << /AcroForm << /Fields [] >> >> endobj\n%%EOF',
      'latin1',
    );
    const signed = Buffer.from(
      '%PDF-1.4\n1 0 obj << /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >> endobj\n5 0 obj << /FT /Sig >> endobj\n%%EOF',
      'latin1',
    );
    expect(
      inspectPdfStructure(new Uint8Array(form)).some((s) => s.ruleId === 'pdf.acroform_overlay'),
    ).toBe(true);
    expect(
      inspectPdfStructure(new Uint8Array(signed)).some((s) => s.ruleId === 'pdf.acroform_overlay'),
    ).toBe(false);
  });
});

describe('pdf content forensics', () => {
  it('invisible text (Tr 3) is critical', () => {
    const pdf = pdfWithText('3 Tr 72 720 Td (HIDDEN) Tj');
    const sig = inspectPdfContent(pdf);
    expect(sig.find((s) => s.ruleId === 'pdf.invisible_text')?.severity).toBe('critical');
  });

  it('overlapping fragments (typed-over text) are critical', () => {
    const pdf = pdfWithText('1 0 0 1 50 700 Tm (LOAN BOUNCE) Tj 1 0 0 1 50 700 Tm (Salary) Tj');
    const sig = inspectPdfContent(pdf);
    const hit = sig.find((s) => s.ruleId === 'pdf.overlapping_text');
    expect(hit?.severity).toBe('critical');
    expect(hit?.evidence).toContain('LOAN BOUNCE');
  });
});

describe('CMS signature validation', () => {
  it('a genuinely signed statement verifies fully', () => {
    const pdf = buildSignedPdf(ROWS);
    const checks = verifyPdfSignatures(pdf, { trustStore: [TEST_CERT_PEM] });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      digestValid: true,
      signatureValid: true,
      chainTrusted: true,
      postSignBytes: false,
    });
    expect(checks[0]!.signer).toContain('TEST BANK');
  });

  it('a byte flipped inside the signed range fails the digest', () => {
    const pdf = tamperSignedByte(buildSignedPdf(ROWS));
    const checks = verifyPdfSignatures(pdf, { trustStore: [TEST_CERT_PEM] });
    expect(checks[0]!.digestValid).toBe(false);
    expect(checks[0]!.errors.join(' ')).toContain('altered');
  });

  it('bytes appended after the signed range flag post-sign append', () => {
    const pdf = buildSignedPdf(ROWS, { appendAfter: '\n9 0 obj <<>> endobj\n%%EOF\n' });
    const checks = verifyPdfSignatures(pdf);
    expect(checks[0]!.postSignBytes).toBe(true);
    expect(checks[0]!.digestValid).toBe(true); // signed bytes themselves intact
  });

  it('a signature covering a different digest is caught', () => {
    const pdf = buildSignedPdf(ROWS, { badDigest: true });
    const checks = verifyPdfSignatures(pdf);
    expect(checks[0]!.digestValid).toBe(false);
  });

  it('a corrupted signature fails verification', () => {
    const pdf = buildSignedPdf(ROWS, { badSignature: true });
    const checks = verifyPdfSignatures(pdf);
    expect(checks[0]!.signatureValid).toBe(false);
  });

  it('no trust store → chainTrusted null, not a false clean', () => {
    const pdf = buildSignedPdf(ROWS);
    const checks = verifyPdfSignatures(pdf);
    expect(checks[0]!.chainTrusted).toBeNull();
  });

  it('garbage trust anchor → skipped gracefully, chain untrusted-not-crash', () => {
    const pdf = buildSignedPdf(ROWS);
    const other = `-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----`;
    const checks = verifyPdfSignatures(pdf, { trustStore: [other] });
    expect(checks[0]!.chainTrusted).toBe(false);
    expect(checks[0]!.errors.join(' ')).toContain('unparsable trust anchor');
  });
});

describe('arithmetic consistency', () => {
  it('balance chain intact → no breaks', () => {
    const st = stWith({
      transactions: [
        txn({ balance: 500000, direction: 'CREDIT', amount: 100000 }),
        txn({ balance: 450000, direction: 'DEBIT', amount: 50000 }),
        txn({ balance: 400000, direction: 'DEBIT', amount: 50000 }),
      ],
      metadata: { openingBalancePaise: '400000', closingBalancePaise: '400000' },
    });
    const { check } = checkConsistency(st);
    expect(check.balanceChainBreaks).toBe(0);
    expect(check.openingMismatch).toBe(false);
    expect(check.closingMismatch).toBe(false);
  });

  it('one edited amount breaks every following balance link', () => {
    const st = stWith({
      transactions: [
        txn({ balance: 500000, direction: 'CREDIT', amount: 100000 }),
        txn({ balance: 450000, direction: 'DEBIT', amount: 50000 }),
        txn({ balance: 440000, direction: 'DEBIT', amount: 99999 }), // edited!
      ],
      metadata: { openingBalancePaise: '400000', closingBalancePaise: '440000' },
    });
    const { check, signals } = checkConsistency(st);
    expect(check.balanceChainBreaks).toBe(1);
    expect(signals[0]!.severity).toBe('critical');
    expect(signals[0]!.message).toContain('row 2');
    expect(signals[0]!.evidence).toContain('expected');
  });

  it('closing balance mismatch fires', () => {
    const st = stWith({
      transactions: [txn({ balance: 500000, direction: 'CREDIT', amount: 100000 })],
      metadata: { openingBalancePaise: '400000', closingBalancePaise: '999999' },
    });
    const { check } = checkConsistency(st);
    expect(check.closingMismatch).toBe(true);
  });

  it('duplicate rows are flagged informational', () => {
    const st = stWith({
      transactions: [txn({}), txn({}), txn({})],
    });
    const { check } = checkConsistency(st);
    expect(check.duplicateRows).toBe(2);
  });
});

describe('inspectStatement orchestration', () => {
  it('tampered signed pdf → tamper_evidence', async () => {
    const report = await inspectStatement(tamperSignedByte(buildSignedPdf(ROWS)));
    expect(report.verdict).toBe('tamper_evidence');
    expect(report.signals.some((s) => s.ruleId === 'sig.digest_mismatch')).toBe(true);
  });

  it('valid signed pdf → clean', async () => {
    const report = await inspectStatement(buildSignedPdf(ROWS), {
      trustStore: [TEST_CERT_PEM],
    });
    expect(report.verdict).toBe('clean');
    expect(report.signals.some((s) => s.ruleId === 'sig.verified')).toBe(true);
  });

  it('csv input → consistency runs, container honesty noted', async () => {
    const csv = 'Date,Narration,Debit,Credit,Balance\n15/10/26,NEFT-X,100.00,,900.00\n';
    const report = await inspectStatement(csv);
    expect(report.format).toBe('csv');
    expect(report.signals.some((s) => s.ruleId === 'container.no_integrity_layer')).toBe(true);
  });

  it('never throws on garbage', async () => {
    const garbage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x01]);
    const report = await inspectStatement(garbage);
    expect(['clean', 'warnings', 'tamper_evidence', 'inconclusive']).toContain(report.verdict);
  });
});
