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

import { parseBankNarration } from '../src';

const cp = (text: string): string => (parseBankNarration(text).counterparty ?? '').toLowerCase();

describe('N1 — SELF is not a cash withdrawal', () => {
  it('self fund transfers are Transfers', () => {
    expect(parseBankNarration('IB FUNDS TRANSFER TO SELF 1234').category).toBe('Transfers');
    expect(parseBankNarration('INB/FT/OWN ACCOUNT/1234').category).toBe('Transfers');
  });

  it('cash deposit by self stays a cash deposit', () => {
    expect(parseBankNarration('CASH DEPOSIT BY SELF').category).toBe('Cash Deposit');
  });

  it('self cheques remain cash withdrawals', () => {
    expect(parseBankNarration('CHQ SELF 000456').category).toBe('Cash Withdrawal');
    expect(parseBankNarration('SELF CHEQUE 000456').category).toBe('Cash Withdrawal');
  });

  it('ATM self withdrawals (grammar-assigned) are untouched', () => {
    expect(parseBankNarration('ATM WDL-SELF-0042').category).toBe('Cash Withdrawal');
  });
});

describe('N2 — NACH / ECS is a rail, not a loan', () => {
  it('an unrecognised NACH debit is not an EMI', () => {
    expect(parseBankNarration('ACH D- UNKNOWNBILLER-12345').category).not.toBe('Loan & EMI');
    expect(parseBankNarration('NACH-DR-SOMEBILLER-99887').category).not.toBe('Loan & EMI');
  });

  it('a NACH debit to a known subscription merchant is that merchant category', () => {
    expect(parseBankNarration('NACH-DR-NETFLIX-99887').category).toBe('Subscriptions');
  });

  it('EMI / LOAN wording still makes it a Loan & EMI', () => {
    expect(parseBankNarration('ECS/NACH/BAJAJ FINANCE/EMI').category).toBe('Loan & EMI');
    expect(parseBankNarration('NACH-DR-HDFC LTD-LOAN A/C 123').category).toBe('Loan & EMI');
    expect(parseBankNarration('NACH-ABC FINANCE-EMI-123456').category).toBe('Loan & EMI');
  });

  it('well-known NBFC lenders are Loan & EMI', () => {
    for (const n of [
      'ACH D- TATA CAPITAL-1234',
      'ACH D- BAJAJ FINANCE LTD-5566',
      'ACH D- HDB FINANCIAL SERVICES-5566',
    ]) {
      expect(parseBankNarration(n).category).toBe('Loan & EMI');
    }
  });

  it('keeps the full lender name as counterparty', () => {
    expect(cp('ACH D- TATA CAPITAL-1234')).toBe('tata capital');
  });
});

describe('N3 — cheque narration direction', () => {
  it('a paid cheque is a debit even when it mentions inward clearing', () => {
    const r = parseBankNarration('CHQ PAID-MICR INWARD CLEARING-000123');
    expect(r.channel).toBe('CHEQUE');
    expect(r.type).toBe('DEBIT');
  });

  it('INWARD / OUTWARD next to CLEARING is not read as a remittance direction', () => {
    expect(parseBankNarration('OUTWARD CLEARING 000123').type).toBe('UNKNOWN');
    expect(parseBankNarration('INWARD CLG 000123').type).toBe('UNKNOWN');
  });

  it('INWARD / OUTWARD still carry direction for remittances', () => {
    expect(parseBankNarration('RTGS INWARD REMITTANCE ACME').type).toBe('CREDIT');
  });
});

describe('N5 — BIL / BBPS payment counterparty', () => {
  it('skips the channel code and reference number', () => {
    expect(cp('BIL/BPAY/000123456/BSES RAJDHANI/CRN12345')).toBe('bses rajdhani');
    expect(cp('BIL/INFT/000123456/BESCOM/CRN1')).toBe('bescom');
    expect(cp('BIL/ONL/000123/AIRTEL/PREPAID')).toBe('airtel');
  });

  it('still reads the original two-segment shape', () => {
    expect(cp('BIL/BESCOM/CRN555')).toBe('bescom');
  });

  it('keeps the bill-payment type and category', () => {
    const r = parseBankNarration('BIL/BPAY/000123456/BSES RAJDHANI/CRN12345');
    expect(r.type).toBe('DEBIT');
    expect(r.category).toBe('Utilities');
  });
});

describe('N6 — counterparty is the full name span, not the first token', () => {
  it('HDFC pipe-less UPI shape: name-vpa-ifsc-rrn-note', () => {
    const r = parseBankNarration(
      'UPI-RAMESH KUMAR-ramesh@okhdfcbank-HDFC0001234-123456789012-Sent via UPI',
    );
    expect(r.counterparty?.toLowerCase()).toBe('ramesh kumar');
    expect(r.vpa).toBe('okhdfcbank');
    expect(r.ref_no).toBe('123456789012');
  });

  it('HDFC shape resolves merchants through the dictionary', () => {
    const r = parseBankNarration('UPI-SWIGGY-SWIGGY@YBL-YESB0YBLUPI-123456789012-UPI');
    expect(r.merchant).toBe('Swiggy');
    expect(r.vpa).toBe('ybl');
  });

  it('heuristic path keeps multi-word names', () => {
    expect(cp('UPI-DR-1234-RAMESH KUMAR-ybl')).toBe('ramesh kumar');
    expect(cp('UPI-DR-1234-SCHOOL FEES-ybl')).toBe('school fees');
    expect(cp('MIN BAL CHRG')).toBe('min bal chrg');
  });

  it('never runs a name across a separator into a VPA handle', () => {
    expect(cp('UPI-DR-1234-RAMESH KUMAR-ybl')).not.toContain('ybl');
  });
});

describe('N7 — UPI remark segment is not the counterparty', () => {
  it('uses the VPA user when segment 3 is a generic UPI remark', () => {
    const r = parseBankNarration('UPI/123456789012/Payment from PhonePe/user@ybl/YES BANK');
    expect(r.counterparty?.toLowerCase()).toBe('user');
    expect(r.vpa).toBe('ybl');
    expect(r.ref_no).toBe('123456789012');
  });

  it('keeps a named segment 3 as the counterparty', () => {
    const r = parseBankNarration('UPI/123456789012/SWIGGY/swiggy@ybl/Order');
    expect(r.merchant).toBe('Swiggy');
  });
});

describe('N8 — charge and maturity coverage gaps', () => {
  it('abbreviated charge wording is Bank Charges', () => {
    expect(parseBankNarration('SMS CHRGS 2026').category).toBe('Bank Charges');
    expect(parseBankNarration('MIN BAL CHRG').category).toBe('Bank Charges');
    expect(parseBankNarration('DEBIT CARD ANNUAL FEE').category).toBe('Bank Charges');
  });

  it('FD / RD events are Investments', () => {
    expect(parseBankNarration('FD CLOSURE PROCEEDS 123').category).toBe('Investments');
    expect(parseBankNarration('RD INSTALMENT 4455').category).toBe('Investments');
  });
});
