/**
 * Copyright 2026 Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Normalizer } from '@panini/core';
import { loadBuiltinRuleSets, loadCategories } from '../src';

const normalizer = new Normalizer({
  ruleSets: loadBuiltinRuleSets(),
  categories: loadCategories(),
});

describe('bundled grammars — spec example', () => {
  it('produces the documented output for the UPI narration', () => {
    const txn = normalizer.normalize('UPI-SWIGGY-826384@okaxis-20261015-REV-DEBIT');
    expect(txn.channel).toBe('UPI');
    expect(txn.counterparty).toBe('Swiggy');
    expect(txn.transactionId).toBe('826384');
    expect(txn.vpaHandle).toBe('okaxis');
    expect(txn.type).toBe('DEBIT');
    expect(txn.category).toBe('Food & Dining');
  });
});

describe('bundled grammars — SBI', () => {
  it('parses a BY TRANSFER UPI debit', () => {
    const txn = normalizer.normalize({
      text: 'BY TRANSFER-UPI/DR/123456789012/SWIGGY BUNDL TECH/SBIN/20261015',
      bankHint: 'SBI',
    });
    expect(txn.channel).toBe('UPI');
    expect(txn.type).toBe('DEBIT');
    expect(txn.transactionId).toBe('123456789012');
    expect(txn.counterparty).toBe('Swiggy Bundl Tech');
    expect(txn.date).toBe('2026-10-15');
  });

  it('parses a star-delimited NEFT credit', () => {
    const txn = normalizer.normalize('BY TRANSFER-NEFT*HDFC0000240*ACME CORP PVT LTD-SALARY OCT');
    expect(txn.channel).toBe('NEFT');
    expect(txn.counterparty).toBe('Acme Corp Pvt Ltd');
    expect(txn.category).toBe('Income');
  });

  it('parses an ATM NFS withdrawal', () => {
    const txn = normalizer.normalize('ATM NFS WDL SELF 0042');
    expect(txn.channel).toBe('ATM');
    expect(txn.type).toBe('DEBIT');
    expect(txn.category).toBe('Cash Withdrawal');
  });
});

describe('bundled grammars — HDFC', () => {
  it('parses an NWD network withdrawal', () => {
    const txn = normalizer.normalize('NWD-4567XXXXXXXX1234-ANDHERI MUMBAI');
    expect(txn.channel).toBe('ATM');
    expect(txn.type).toBe('DEBIT');
  });

  it('parses an MMT/IMPS transfer', () => {
    const txn = normalizer.normalize('MMT/IMPS/123456789012/JOHN DOE/ICIC');
    expect(txn.channel).toBe('IMPS');
    expect(txn.counterparty).toBe('John Doe');
    expect(txn.transactionId).toBe('123456789012');
  });

  it('parses a paid cheque narration', () => {
    const txn = normalizer.normalize('CHQ PAID-000123-VENDOR NAME');
    expect(txn.channel).toBe('CHEQUE');
    expect(txn.type).toBe('DEBIT');
  });
});

describe('bundled grammars — ICICI', () => {
  it('parses reference-first UPI narration', () => {
    const txn = normalizer.normalize('UPI-123456789012-ZOMATO-151026');
    expect(txn.channel).toBe('UPI');
    expect(txn.transactionId).toBe('123456789012');
    expect(txn.counterparty).toBe('Zomato');
    expect(txn.date).toBe('2026-10-15');
    expect(txn.category).toBe('Food & Dining');
  });

  it('parses a BIL bill payment', () => {
    const txn = normalizer.normalize('BIL/BESCOM ELECTRICITY/999888777');
    expect(txn.type).toBe('DEBIT');
    expect(txn.category).toBe('Utilities');
  });

  it('parses an INF/INFT fund transfer', () => {
    const txn = normalizer.normalize('INF/INFT/009876543210/JANE DOE/DR');
    expect(txn.channel).toBe('NETBANKING');
    expect(txn.type).toBe('DEBIT');
    expect(txn.counterparty).toBe('Jane Doe');
  });
});

describe('bundled grammars — SMS and edge cases', () => {
  it('parses an HDFC-style debit SMS', () => {
    const txn = normalizer.normalize(
      'Rs.1,500.00 debited from A/c **1234 on 15-10-26 at SWIGGY. Avl Bal:Rs.50,000.00',
    );
    expect(txn.type).toBe('DEBIT');
    expect(txn.amountPaise).toBe(150000);
    expect(txn.accountMask).toBe('1234');
    expect(txn.balancePaise).toBe(5000000);
    expect(txn.counterparty).toBe('Swiggy');
  });

  it('parses an SBI-style credit SMS', () => {
    const txn = normalizer.normalize(
      'Dear Customer, Your A/c XX5678 is credited by Rs 75,000.00 on 01-10-26 towards EMPLOYER PVT LTD SALARY. Avl Bal Rs 80,000.00',
    );
    expect(txn.type).toBe('CREDIT');
    expect(txn.amountPaise).toBe(7500000);
    expect(txn.accountMask).toBe('5678');
    expect(txn.category).toBe('Income');
  });

  it('recovers truncated transaction lines heuristically', () => {
    const txn = normalizer.normalize('UPI-ZOMATO-');
    expect(txn.channel).toBe('UPI');
    expect(txn.counterparty).toBe('Zomato');
    expect(txn.matchedRule).toBeNull();
  });

  it('survives corrupted dates inside otherwise valid narrations', () => {
    const txn = normalizer.normalize('UPI-SWIGGY-826384@okaxis-99139999-DEBIT');
    expect(txn.date).toBeNull();
    expect(txn.warnings.some((w) => w.includes('unparseable date'))).toBe(true);
  });
});
