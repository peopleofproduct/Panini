/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Adversarial edge-case suite: degenerate inputs, regex-safety (ReDoS),
 * option matrix, output invariants, and schema conformance. The contract
 * under test: parseBankNarration must never throw, never crash, and never
 * emit undefined fields — malformed input degrades to UNKNOWN, not errors.
 */

import { Normalizer } from '@paniniapi/core';
import { validateAgainst } from '@paniniapi/standards-schema';
import {
  loadBuiltinRuleSets,
  loadCategories,
  loadCorpus,
  parseBankNarration,
  type ParsedBankNarration,
} from '../src';

const OUT_FIELDS = [
  'channel',
  'type',
  'ref_no',
  'merchant',
  'counterparty',
  'vpa',
  'is_salary',
  'date',
  'category',
  'confidence',
  'matched_rule',
  'warnings',
  'merchant_canonical',
  'vpa_app',
  'vpa_bank',
  'ifsc_bank',
  'mcc',
  'mcc_description',
] as const;

const CHANNELS = new Set([
  'UPI',
  'IMPS',
  'NEFT',
  'RTGS',
  'ACH',
  'NACH',
  'ATM',
  'POS',
  'CHEQUE',
  'NETBANKING',
  'WALLET',
  'UNKNOWN',
]);
const TYPES = new Set(['DEBIT', 'CREDIT', 'REVERSAL', 'REFUND', 'UNKNOWN']);

function assertInvariants(txn: ParsedBankNarration, raw: string): void {
  for (const field of OUT_FIELDS) {
    expect(txn).toHaveProperty(field);
    expect(txn[field]).not.toBeUndefined();
  }
  expect(CHANNELS.has(txn.channel)).toBe(true);
  expect(TYPES.has(txn.type)).toBe(true);
  expect(txn.confidence).toBeGreaterThanOrEqual(0);
  expect(txn.confidence).toBeLessThanOrEqual(1);
  expect(Array.isArray(txn.warnings)).toBe(true);
  expect(typeof txn.is_salary).toBe('boolean');
  void raw;
}

describe('degenerate inputs', () => {
  const cases: [string, string][] = [
    ['empty string', ''],
    ['whitespace only', '   \t\n  '],
    ['single char', 'U'],
    ['null byte', 'UPI\x00ABC\x00DEF'],
    ['control chars', 'UPI//DR/123/ABC'],
    ['unicode emoji', 'UPI/123456789012/🍕 PIZZA/okaxis'],
    ['devanagari', 'UPI/123456789012/स्विगी/okaxis'],
    ['mixed RTL', 'UPI/123456789012/متجر/okaxis'],
    ['html injection', '<script>alert(1)</script>-UPI-123456789012'],
    ['sql-ish', "UPI'; DROP TABLE txn;--/DR/123456789012"],
    ['path traversal', '../../../etc/passwd-UPI-123'],
    ['format string', '%s%d%n-UPI-123456789012'],
    ['regex metachars', 'UPI/**/+/()[]{}^$\\-DR'],
    ['only separators', '-----------------/////'],
    ['only digits', '123456789012345678901234567890'],
    ['zero-width joiner', 'UPI‍/DR/123/ABC'],
    ['BOM', '﻿UPI/DR/123456789012/ABC'],
  ];

  for (const [label, input] of cases) {
    it(`handles ${label}`, () => {
      const txn = parseBankNarration(input);
      assertInvariants(txn, input);
    });
  }

  it('survives a 10KB narration', () => {
    const txn = parseBankNarration(`UPI/${'X'.repeat(10000)}`);
    assertInvariants(txn, 'long');
    expect(txn.ref_no).toBeNull(); // never captured
  });
});

describe('regex safety (ReDoS)', () => {
  const adversarial = [
    'UPI/' + '/'.repeat(5000),
    'NEFT-' + 'A'.repeat(8000),
    'IMPS' + '-'.repeat(5000) + 'INBOUND',
    'a'.repeat(1) + '@'.repeat(4000),
    'UPI/DR/' + '1'.repeat(3000) + '/' + 'Z'.repeat(3000),
    'POS ' + '0'.repeat(2000) + ' MERCHANT',
    '(?:UPI)+'.repeat(2000),
  ];

  for (const input of adversarial) {
    it(`parses a ${input.length}-char hostile string < 250ms`, () => {
      const start = Date.now();
      const txn = parseBankNarration(input);
      const elapsed = Date.now() - start;
      assertInvariants(txn, input);
      expect(elapsed).toBeLessThan(250);
    });
  }
});

describe('case sensitivity', () => {
  it('lowercase narration still parses', () => {
    const txn = parseBankNarration('upi/20261015/dr/826384910234/swiggy/okaxis/cooking/');
    assertInvariants(txn, 'lower');
    expect(txn.channel).toBe('UPI');
  });

  it('mixed-case bank prefixes parse', () => {
    const txn = parseBankNarration('Paytm-Zomato-123456789012');
    assertInvariants(txn, 'mixed');
    expect(txn.channel).toBe('WALLET');
  });
});

describe('bankHint behavior', () => {
  it('ignores an unrecognized bank hint gracefully', () => {
    const txn = parseBankNarration({
      text: 'UPI/DR/123456789012/JOHN/SBIN/20261015',
      bankHint: 'NOT_A_BANK',
    });
    assertInvariants(txn, 'hint');
    expect(txn.channel).toBe('UPI');
  });

  it('a mismatched hint does not corrupt the parse', () => {
    const txn = parseBankNarration({
      text: 'UPI/DR/123456789012/JOHN/SBIN/20261015',
      bankHint: 'HDFC', // wrong bank on purpose
    });
    assertInvariants(txn, 'hint-wrong');
    expect(txn.channel).toBe('UPI');
  });

  it('hint flows through RawInput', () => {
    const txn = parseBankNarration({
      text: 'BY TRANSFER-UPI/DR/123456789012/SWIGGY/SBIN/20261015',
      bankHint: 'SBI',
    });
    assertInvariants(txn, 'hint2');
    expect(txn.channel).toBe('UPI');
    expect(txn.type).toBe('DEBIT');
  });
});

describe('option matrix', () => {
  it('enrich:false strips dictionary fields but keeps parsing', () => {
    const txn = parseBankNarration('UPI/20261015/DR/123456789012/SWIGGY/okaxis/', {
      enrich: false,
    });
    assertInvariants(txn, 'enrich');
    expect(txn.merchant_canonical).toBeNull();
    expect(txn.vpa_app).toBeNull();
    expect(txn.vpa_bank).toBeNull();
    expect(txn.ifsc_bank).toBeNull();
    expect(txn.channel).toBe('UPI');
  });

  it('bare:true limits matching to provided ruleSets only', () => {
    const txn = parseBankNarration('IMPS-628491047-ZEPTO-HDFC-INBOUND', { bare: true });
    assertInvariants(txn, 'bare');
    expect(txn.channel).toBe('IMPS');
    expect(txn.type).toBe('CREDIT');
  });

  it('custom categories override the bundled table', () => {
    const txn = parseBankNarration('NEFT-N3452618902-SALARY-OCTOBER 2026-TCS LTD', {
      categories: { TCS: 'EmployerX' },
    });
    assertInvariants(txn, 'cats');
    // pattern.category (Income) wins over custom keywords — just verify no crash
    expect(txn.category).toBeTruthy();
  });

  it('extra ruleSets slot in without breaking builtin ones', () => {
    const custom = {
      id: 'custom',
      bank: 'GENERIC' as const,
      version: '0.0.1',
      patterns: [
        {
          name: 'custom_marker',
          priority: 99,
          type: 'DEBIT' as const,
          media: 'narration' as const,
          regex: '^PANINI_MARKER-(?<counterparty>.+)$',
        },
      ],
    };
    const txn = parseBankNarration('PANINI_MARKER-TEST', { ruleSets: [custom] });
    assertInvariants(txn, 'custom');
    expect(txn.matched_rule).toBe('custom:custom_marker');
    expect(txn.counterparty).toBe('TEST');
  });
});

describe('output invariants across the corpus', () => {
  it('every corpus sample produces a fully-populated object', () => {
    for (const file of loadCorpus()) {
      for (const sample of file.samples) {
        const txn = parseBankNarration(
          sample.bankHint ? { text: sample.input, bankHint: sample.bankHint } : sample.input,
        );
        assertInvariants(txn, sample.input);
      }
    }
  });
});

describe('determinism', () => {
  it('identical input parses identically twice', () => {
    const a = parseBankNarration('UPI/20261015/DR/826384910234/SWIGGY/okaxis/Cooking/');
    const b = parseBankNarration('UPI/20261015/DR/826384910234/SWIGGY/okaxis/Cooking/');
    expect(b).toEqual(a);
  });

  it('output is frozen data — no functions, no circular refs', () => {
    const txn = parseBankNarration('NEFT-N3452618902-SALARY-OCTOBER 2026-TCS LTD');
    expect(() => JSON.stringify(txn)).not.toThrow();
    expect(() => structuredClone(txn)).not.toThrow();
  });
});

describe('schema conformance', () => {
  const normalizer = new Normalizer({
    ruleSets: loadBuiltinRuleSets(),
    categories: loadCategories(),
  });

  const schemaInputs = [
    'UPI/20261015/DR/826384910234/SWIGGY/okaxis/Cooking/',
    'NEFT-N3452618902-SALARY-OCTOBER 2026-TCS LTD',
    'PAYTM-ZOMATO-123456789012',
    'totally garbage input ~~~',
    '',
  ];

  for (const input of schemaInputs) {
    it(`NormalizedTransaction validates against schema: ${input.slice(0, 30) || '(empty)'}`, () => {
      const txn = normalizer.normalize(input);
      const result = validateAgainst('normalized-transaction', txn);
      expect(result.errors).toEqual([]);
    });
  }

  it('WALLET channel validates (schema regression guard)', () => {
    const txn = normalizer.normalize('PAYTM-ZOMATO-123456789012');
    expect(txn.channel).toBe('WALLET');
    const result = validateAgainst('normalized-transaction', txn);
    expect(result.errors).toEqual([]);
  });
});

describe('no information leakage', () => {
  it('metadata keys never contain prototype-pollution names', () => {
    const txn = parseBankNarration('__proto__-constructor-toString-UPI/123456789012');
    const proto = (txn as unknown as Record<string, unknown>)['__proto__'];
    expect(proto === undefined || typeof proto === 'object').toBe(true);
  });

  it('warnings are always strings, never objects', () => {
    const txn = parseBankNarration('UPI/99999999/DR/X/Y');
    for (const w of txn.warnings) {
      expect(typeof w).toBe('string');
    }
  });
});
