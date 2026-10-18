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

import {
  detectDocumentType,
  extractDocument,
  extractForm26as,
  extractItrV,
  extractPayslip,
} from '../src';

const PAYSLIP = `
ACME TECHNOLOGIES PVT LTD
Payslip for the month of March 2024
Employee Name    RAHUL SHARMA
Employee ID      EMP1234
Designation      Senior Engineer
PAN              AXYPD1234K
UAN              100912345678
PF No.           MH/BAN/1234567
Bank A/c         XXXX5678

EARNINGS
Basic            52,000.00
HRA              20,800.00
Special Allowance    15,000.00
Conveyance       1,600.00
Gross Earnings   89,400.00

DEDUCTIONS
PF               6,240.00
Professional Tax 200.00
TDS              3,500.00
Total Deductions 9,940.00

Net Pay          79,460.00
`;

const ITRV = `
INDIAN INCOME TAX RETURN VERIFICATION FORM
ITR-V
Assessment Year 2024-25
Name RAHUL SHARMA
PAN AXYPD1234K
Form No. which has been electronically transmitted ITR-1
Status Individual
Original or Revised ORIGINAL
E-filing Acknowledgement Number 123456789012345
Date (DD-MM-YYYY) 17-10-2024
1 Gross Total Income 850000
2 Deductions under Chapter-VI-A 150000
3 Total Income 700000
3a Current Year loss, if any 0
4 Net Tax Payable 58500
5 Interest Payable 0
6 Total Tax and Interest Payable 58500
7a Advance Tax 0
7b TDS 81219
7c TCS 0
7d Self Assessment Tax 0
7e Total Taxes Paid (7a+7b+7c+7d) 81219
8 Tax Payable (6-7e) 0
9 Refund (7e-6) 22719
10 Exempt Income Agriculture 0 Others 0
VERIFICATION
`;

const F26AS = `
FORM NO. 26AS
Annual Tax Statement under Section 203AA
Name of Assessee RAHUL SHARMA
PAN of Assessee AXYPD1234K
Assessment Year 2024-25
PART A - Details of Tax Deducted at Source
ACME TECHNOLOGIES PVT LTD MUMA12345E 192 31-03-2024 850000.00 81219.00 81219.00
XYZ BANK LIMITED MUMB67890F 194A 31-03-2024 15000.00 1500.00 1500.00
Total 865000.00 82719.00 82719.00
`;

describe('detectDocumentType', () => {
  it('routes each document class', () => {
    expect(detectDocumentType(PAYSLIP)).toBe('payslip');
    expect(detectDocumentType(ITRV)).toBe('itrv');
    expect(detectDocumentType(F26AS)).toBe('form26as');
    expect(detectDocumentType('Date,Narration,Withdrawal\n01/01/24,X,100')).toBe('statement');
    expect(detectDocumentType('hello world')).toBe('unknown');
  });
});

describe('extractPayslip', () => {
  const slip = extractPayslip(PAYSLIP);

  it('extracts identity + period', () => {
    expect(slip.kind).toBe('payslip');
    expect(slip.employeeName).toBe('RAHUL SHARMA');
    expect(slip.employer).toContain('ACME TECHNOLOGIES');
    expect(slip.period).toBe('2024-03');
    expect(slip.ids.pan).toBe('AXYPD1234K');
    expect(slip.ids.uan).toBe('100912345678');
  });

  it('extracts components with original labels and sides', () => {
    const labels = slip.components.map((c) => `${c.side}:${c.label}`);
    expect(labels).toContain('earning:Basic');
    expect(labels).toContain('earning:HRA');
    expect(labels).toContain('deduction:PF');
    expect(labels).toContain('deduction:TDS');
    expect(labels).toContain('deduction:Professional Tax');
  });

  it('totals + arithmetic check', () => {
    expect(slip.grossPaise).toBe(8940000);
    expect(slip.deductionsPaise).toBe(994000);
    expect(slip.netPayPaise).toBe(7946000);
    expect(slip.arithmeticCheck).toBe('ok');
  });

  it('flags arithmetic mismatch', () => {
    const bad = extractPayslip(
      PAYSLIP.replace('Net Pay          79,460.00', 'Net Pay          99,460.00'),
    );
    expect(bad.arithmeticCheck).toBe('mismatch');
    expect(bad.warnings.join(' ')).toContain('≠');
  });
});

describe('extractItrV', () => {
  const doc = extractItrV(ITRV);

  it('extracts identity + ack + numbered boxes', () => {
    expect(doc.kind).toBe('itrv');
    expect(doc.pan).toBe('AXYPD1234K');
    expect(doc.ackNo).toBe('123456789012345');
    expect(doc.filingDate).toBe('17-10-2024');
    expect(doc.assessmentYear).toBe('2024-25');
    expect(doc.itrForm).toBe('ITR-1');
    expect(doc.grossTotalIncomePaise).toBe(85000000);
    expect(doc.deductionsChapterViaPaise).toBe(15000000);
    expect(doc.totalIncomePaise).toBe(70000000);
    expect(doc.tdsPaise).toBe(8121900);
    expect(doc.refundPaise).toBe(2271900);
    expect(doc.arithmeticCheck).toBe('ok');
  });
});

describe('extractForm26as', () => {
  const doc = extractForm26as(F26AS);

  it('extracts TAN-keyed TDS entries', () => {
    expect(doc.pan).toBe('AXYPD1234K');
    expect(doc.entries).toHaveLength(2);
    expect(doc.entries[0]).toMatchObject({
      deductor: 'ACME TECHNOLOGIES PVT LTD',
      tan: 'MUMA12345E',
      section: '192',
      paidPaise: 85000000,
      taxDeductedPaise: 8121900,
    });
    expect(doc.entries[1]!.tan).toBe('MUMB67890F');
    expect(doc.totalTaxDeductedPaise).toBe(8271900);
  });
});

describe('extractDocument dispatcher', () => {
  it('parses known kinds, nulls others', () => {
    expect(extractDocument(PAYSLIP)?.kind).toBe('payslip');
    expect(extractDocument(ITRV)?.kind).toBe('itrv');
    expect(extractDocument('unstructured text')).toBeNull();
  });
});
