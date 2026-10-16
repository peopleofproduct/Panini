/**
 * Copyright 2026 Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Normalizer } from '../src/normalizer';
import type { GrammarRuleSet } from '../src/grammar';

const ruleSets: readonly GrammarRuleSet[] = [
  {
    id: 'generic-indian-banks',
    bank: 'GENERIC',
    version: '1.0.0',
    patterns: [
      {
        name: 'upi_dashed_vpa',
        priority: 10,
        channel: 'UPI',
        media: 'narration',
        regex:
          "^UPI[-/:](?<counterparty>[A-Za-z0-9 .&'_]+?)[-/:](?<txnId>\\d{6,16})(?:@(?<vpaHandle>[A-Za-z0-9]+))?(?:[-/:](?<date>\\d{6,8}|\\d{2}[-/.]\\d{2}[-/.]\\d{2,4}))?(?<tail>[-/: ].*)?$",
        flags: {
          REV: 'REVERSAL',
          RTN: 'REVERSAL',
          DEBIT: 'DEBIT',
          CREDIT: 'CREDIT',
          DR: 'DEBIT',
          CR: 'CREDIT',
        },
      },
      {
        name: 'upi_slashed_direction',
        priority: 12,
        channel: 'UPI',
        media: 'narration',
        regex:
          '^(?:(?:BY|TO)\\s+TRANSFER[-/ ])?UPI[\\/](?<direction>DR|CR)[\\/](?<txnId>\\d{9,18})[\\/](?<counterparty>[^\\/]+)(?:[\\/](?<bankCode>[A-Z]{2,4}\\d*))?(?:[\\/](?<date>\\d{8}))?(?<tail>[\\/\\- ].*)?$',
      },
      {
        name: 'neft_bankcode',
        priority: 8,
        channel: 'NEFT',
        media: 'narration',
        regexFlags: 'i',
        regex:
          '^NEFT[- ](?<direction>CR|DR|Cr|Dr)?[- ]?(?<bankCode>[A-Z]{4}\\d{7})[- ](?<counterparty>[^-]+)(?:[- ](?<remarks>.+))?$',
      },
      {
        name: 'atm_withdrawal',
        priority: 6,
        channel: 'ATM',
        type: 'DEBIT',
        category: 'Cash Withdrawal',
        media: 'narration',
        regex: '^(?:ATM[-/ ]?)?(?:CASH[-/ ]?)?WDL\\b(?<tail>.*)$',
      },
      {
        name: 'sms_amount_first',
        priority: 20,
        media: 'sms',
        regexFlags: 'i',
        confidence: 0.92,
        regex:
          '(?:Rs\\.?|INR|₹)\\s*(?<amount>[\\d,]+(?:\\.\\d{1,2})?)\\s+(?<direction>debited|credited)\\s+from\\s+(?:a\\/c|ac|acct|account)\\s*(?:no\\.?\\s*)?(?:[xX*]+\\s*)?(?<accountMask>\\d{3,4})\\s+on\\s+(?<date>\\d{2}[-/.]\\d{2}[-/.]\\d{2,4}|\\d{8})(?:\\s+at\\s+(?<counterparty>[A-Za-z0-9 .&*-]+?)(?:\\.|\\s+on\\s|\\s+Avl|$))?(?:.*?[Aa]vl\\s*[Bb]al(?:ance)?[:\\s]*(?:Rs\\.?|INR|₹)?\\s*(?<balance>[\\d,]+(?:\\.\\d{1,2})?))?',
      },
      {
        name: 'sms_amount_then_direction',
        priority: 5,
        media: 'sms',
        regexFlags: 'i',
        confidence: 0.75,
        regex:
          '(?:Rs\\.?|INR|₹)\\s*(?<amount>[\\d,]+(?:\\.\\d{1,2})?)\\s+(?<direction>debited|credited)',
      },
    ],
  },
];

const categories = {
  SWIGGY: 'Food & Dining',
  ZOMATO: 'Food & Dining',
  AMAZON: 'Shopping',
  SALARY: 'Income',
  WDL: 'Cash Withdrawal',
};

const normalizer = new Normalizer({ ruleSets, categories });

describe('Normalizer.normalize — grammar matches', () => {
  it('normalizes the spec UPI example', () => {
    const txn = normalizer.normalize('UPI-SWIGGY-826384@okaxis-20261015-REV-DEBIT');
    expect(txn.channel).toBe('UPI');
    expect(txn.counterparty).toBe('Swiggy');
    expect(txn.transactionId).toBe('826384');
    expect(txn.vpaHandle).toBe('okaxis');
    expect(txn.type).toBe('DEBIT');
    expect(txn.category).toBe('Food & Dining');
    expect(txn.date).toBe('2026-10-15');
    expect(txn.matchedRule).toBe('generic-indian-banks:upi_dashed_vpa');
    expect(txn.metadata['flags']).toBe('REV,DEBIT');
    expect(txn.warnings).toEqual([]);
  });

  it('normalizes a slashed UPI narration with direction', () => {
    const txn = normalizer.normalize('UPI/DR/123456789012/SWIGGY KOLKATA/SBIN/20261015');
    expect(txn.channel).toBe('UPI');
    expect(txn.type).toBe('DEBIT');
    expect(txn.transactionId).toBe('123456789012');
    expect(txn.counterparty).toBe('Swiggy Kolkata');
    expect(txn.date).toBe('2026-10-15');
  });

  it('normalizes an NEFT salary credit', () => {
    const txn = normalizer.normalize('NEFT Cr-SBIN0001234-EMPLOYER PVT LTD-SALARY OCT');
    expect(txn.channel).toBe('NEFT');
    expect(txn.type).toBe('CREDIT');
    expect(txn.counterparty).toBe('Employer Pvt Ltd');
    expect(txn.category).toBe('Income');
  });

  it('normalizes an ATM withdrawal', () => {
    const txn = normalizer.normalize('ATM WDL AT SELF 123456');
    expect(txn.channel).toBe('ATM');
    expect(txn.type).toBe('DEBIT');
    expect(txn.category).toBe('Cash Withdrawal');
  });

  it('marks a pure reversal as REVERSAL', () => {
    const txn = normalizer.normalize('UPI-AMAZON-123456789012-REV');
    expect(txn.type).toBe('REVERSAL');
    expect(txn.category).toBe('Shopping');
  });

  it('parses an HDFC-style SMS end to end', () => {
    const txn = normalizer.normalize(
      'Rs.1,500.00 debited from A/c **1234 on 15-10-26 at SWIGGY. Avl Bal:Rs.50,000.00',
    );
    expect(txn.type).toBe('DEBIT');
    expect(txn.amountPaise).toBe(150000);
    expect(txn.accountMask).toBe('1234');
    expect(txn.date).toBe('2026-10-15');
    expect(txn.counterparty).toBe('Swiggy');
    expect(txn.balancePaise).toBe(5000000);
    expect(txn.category).toBe('Food & Dining');
  });
});

describe('Normalizer.normalize — edge cases', () => {
  it('handles a truncated narration via heuristic fallback', () => {
    const txn = normalizer.normalize('UPI-SWIGGY-');
    expect(txn.channel).toBe('UPI');
    expect(txn.counterparty).toBe('Swiggy');
    expect(txn.matchedRule).toBeNull();
    expect(txn.confidence).toBeLessThan(0.9);
    expect(txn.warnings).toContain('no grammar pattern matched; applied heuristic tokenization');
  });

  it('warns on a corrupted date but still parses the rest', () => {
    const txn = normalizer.normalize('UPI-SWIGGY-826384@okaxis-99999999-DEBIT');
    expect(txn.date).toBeNull();
    expect(txn.warnings).toContain("unparseable date '99999999'");
    expect(txn.transactionId).toBe('826384');
    expect(txn.type).toBe('DEBIT');
  });

  it('returns a zero-confidence UNKNOWN result for empty input', () => {
    const txn = normalizer.normalize('   ');
    expect(txn.channel).toBe('UNKNOWN');
    expect(txn.confidence).toBe(0);
    expect(txn.warnings).toContain('input is empty');
  });

  it('handles garbage input without throwing', () => {
    const txn = normalizer.normalize('!@#$%^&*()');
    expect(txn.channel).toBe('UNKNOWN');
    expect(txn.matchedRule).toBeNull();
  });

  it('preserves the raw input for audit', () => {
    const raw = 'UPI-SWIGGY-826384@okaxis-20261015-REV-DEBIT';
    expect(normalizer.normalize(raw).raw).toBe(raw);
  });
});

describe('Normalizer.normalizePayload — Account Aggregator inputs', () => {
  it('merges structured AA fields over the parsed narration', () => {
    const txn = normalizer.normalizePayload({
      txnId: 'AA-TXN-9001',
      amount: '250.50',
      type: 'DEBIT',
      mode: 'UPI',
      narration: 'UPI-SWIGGY-826384@okaxis-20261015',
      valueDate: '2026-10-15',
      transactionTimestamp: '2026-10-15T10:30:00+05:30',
      reference: 'UTR-ABC-123',
      balance: '6000.00',
    });
    expect(txn.transactionId).toBe('AA-TXN-9001');
    expect(txn.amountPaise).toBe(25050);
    expect(txn.type).toBe('DEBIT');
    expect(txn.channel).toBe('UPI');
    expect(txn.date).toBe('2026-10-15');
    expect(txn.balancePaise).toBe(600000);
    expect(txn.metadata['reference']).toBe('UTR-ABC-123');
    expect(txn.counterparty).toBe('Swiggy');
    expect(txn.confidence).toBeGreaterThan(0.9);
  });

  it('finds narration nested inside a transaction container', () => {
    const txn = normalizer.normalizePayload({
      transaction: { narration: 'UPI-ZOMATO-999888777666-DEBIT' },
    });
    expect(txn.counterparty).toBe('Zomato');
    expect(txn.category).toBe('Food & Dining');
  });

  it('accepts a bare string payload', () => {
    const txn = normalizer.normalizePayload('UPI-AMAZON-123456789012-DEBIT');
    expect(txn.channel).toBe('UPI');
    expect(txn.counterparty).toBe('Amazon');
  });

  it('does not throw on unparseable payloads', () => {
    const txn = normalizer.normalizePayload({ foo: 'bar', n: 42 });
    expect(txn.channel).toBe('UNKNOWN');
  });

  it('handles corrupted payload fields with warnings, not exceptions', () => {
    const txn = normalizer.normalizePayload({
      txnId: 'T1',
      amount: 'not-a-number',
      narration: 'UPI-SWIGGY-826384@okaxis-20261015',
    });
    expect(txn.amountPaise).toBeNull();
    expect(txn.warnings).toContain("unparseable amount 'not-a-number'");
  });
});
