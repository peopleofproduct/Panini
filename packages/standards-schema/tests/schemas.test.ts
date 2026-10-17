/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { listSchemas, loadSchema, validateAgainst } from '../src';
import { Normalizer } from '@paniniapi/core';
import { loadBuiltinRuleSets, loadCategories } from '@paniniapi/rules-engine';

describe('bundled schemas', () => {
  it('lists the bundled schemas', () => {
    expect(listSchemas()).toEqual(
      expect.arrayContaining(['normalized-transaction', 'aa-transaction']),
    );
  });

  it('throws for an unknown schema name', () => {
    expect(() => loadSchema('does-not-exist')).toThrow('unknown schema');
  });
});

describe('aa-transaction schema', () => {
  const validAA = {
    txnId: 'AA-TXN-9001',
    amount: '250.50',
    narration: 'UPI-SWIGGY-826384@okaxis-20261015',
    type: 'DEBIT',
    mode: 'UPI',
    valueDate: '2026-10-15',
    transactionTimestamp: '2026-10-15T10:30:00+05:30',
    reference: 'UTR-ABC-123',
    balance: '6000.00',
  };

  it('accepts a conforming AA transaction', () => {
    expect(validateAgainst('aa-transaction', validAA).valid).toBe(true);
  });

  it('rejects an AA transaction missing required fields', () => {
    const { narration: _narration, ...incomplete } = validAA;
    const result = validateAgainst('aa-transaction', incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('narration'))).toBe(true);
  });

  it('rejects an invalid mode enum', () => {
    const result = validateAgainst('aa-transaction', { ...validAA, mode: 'TELEPORT' });
    expect(result.valid).toBe(false);
  });
});

describe('normalized-transaction schema', () => {
  it('validates real Normalizer output end to end', () => {
    const normalizer = new Normalizer({
      ruleSets: loadBuiltinRuleSets(),
      categories: loadCategories(),
    });
    const txn = normalizer.normalize('UPI-SWIGGY-826384@okaxis-20261015-REV-DEBIT');
    const result = validateAgainst('normalized-transaction', txn);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('also validates heuristic/UNKNOWN output', () => {
    const normalizer = new Normalizer({ ruleSets: loadBuiltinRuleSets() });
    const txn = normalizer.normalize('totally opaque input');
    const result = validateAgainst('normalized-transaction', txn);
    expect(result.valid).toBe(true);
  });
});
