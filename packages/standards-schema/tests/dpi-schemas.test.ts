/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  isAAProfile,
  isOCENLoanApplication,
  validateAAProfile,
  validateOCENLoanApplication,
} from '../src';
import { listSchemas } from '../src';

const validAATransaction = {
  txnId: 'AA-TXN-9001',
  amount: '250.50',
  narration: 'UPI-SWIGGY-826384@okaxis-20261015',
  type: 'DEBIT',
  mode: 'UPI',
  valueDate: '2026-10-15',
  transactionTimestamp: '2026-10-15T10:30:00+05:30',
  reference: 'UTR-ABC-123',
  currentBalance: '6000.00',
};

const validAAProfile = {
  FIPId: 'fip-sbi-001',
  FIUTimestamp: '2026-10-15T10:30:00+05:30',
  maskedAccountNumber: 'XXXXXX1234',
  consentId: 'consent-abc-123456',
  fiType: 'DEPOSIT',
  Transaction: [validAATransaction],
};

const validOCEN = {
  metadata: {
    version: '4.0',
    originatorOrgId: 'org-lsp-001',
    originatorParticipantId: 'participant-42',
    traceId: 'trace-9f8e7d',
    requestId: 'req-20261016-0001',
    loanApplicationId: 'LN-APP-2026-0001',
    timestamp: '2026-10-16T09:00:00Z',
  },
  loanApplicationId: 'LN-APP-2026-0001',
  disbursalAccount: {
    accountNumber: '50200012345678',
    ifsc: 'HDFC0001234',
    accountHolderName: 'Priya Sharma',
  },
  tenorMonths: 24,
  requestedAmount: 250000,
  currency: 'INR',
  loanType: 'TERM_LOAN',
};

describe('aa-profile schema', () => {
  it('accepts a conforming AA FI profile', () => {
    const result = validateAAProfile(validAAProfile);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each(['FIPId', 'FIUTimestamp', 'maskedAccountNumber', 'Transaction'])(
    'rejects a profile missing %s',
    (field) => {
      const profile = { ...validAAProfile } as Record<string, unknown>;
      delete profile[field];
      const result = validateAAProfile(profile);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes(field))).toBe(true);
    },
  );

  it('rejects an unmasked account number', () => {
    const result = validateAAProfile({
      ...validAAProfile,
      maskedAccountNumber: '50200012345678',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a malformed FIU timestamp', () => {
    const result = validateAAProfile({ ...validAAProfile, FIUTimestamp: '15-10-2026' });
    expect(result.valid).toBe(false);
  });

  it('rejects a transaction missing amount', () => {
    const { amount: _amount, ...txnRest } = validAATransaction;
    const result = validateAAProfile({
      ...validAAProfile,
      Transaction: [txnRest],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe('/Transaction/0');
  });

  it('rejects a transaction with a bad mode enum', () => {
    const bad = {
      ...validAAProfile,
      Transaction: [{ ...validAATransaction, mode: 'TELEPORT' }],
    };
    const result = validateAAProfile(bad);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toContain('/Transaction/0/mode');
  });

  it('isAAProfile narrows valid payloads', () => {
    expect(isAAProfile(validAAProfile)).toBe(true);
    expect(isAAProfile({ FIPId: 'x' })).toBe(false);
  });
});

describe('ocen-loan schema (OCEN 4.0)', () => {
  it('accepts a conforming OCEN loan application', () => {
    const result = validateOCENLoanApplication(validOCEN);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each(['metadata', 'loanApplicationId', 'disbursalAccount', 'tenorMonths'])(
    'rejects an application missing %s',
    (field) => {
      const app = { ...validOCEN } as Record<string, unknown>;
      delete app[field];
      const result = validateOCENLoanApplication(app);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes(field))).toBe(true);
    },
  );

  it.each([
    'originatorOrgId',
    'originatorParticipantId',
    'traceId',
    'requestId',
    'loanApplicationId',
  ])('rejects a metadata envelope missing %s', (field) => {
    const metadata = { ...validOCEN.metadata } as Record<string, unknown>;
    delete metadata[field];
    const result = validateOCENLoanApplication({ ...validOCEN, metadata });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(field))).toBe(true);
  });

  it('rejects a malformed IFSC', () => {
    const result = validateOCENLoanApplication({
      ...validOCEN,
      disbursalAccount: { accountNumber: '50200012345678', ifsc: 'BADIFSC' },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects out-of-range tenor', () => {
    expect(validateOCENLoanApplication({ ...validOCEN, tenorMonths: 0 }).valid).toBe(false);
    expect(validateOCENLoanApplication({ ...validOCEN, tenorMonths: 24.5 }).valid).toBe(false);
  });

  it('isOCENLoanApplication narrows valid payloads', () => {
    expect(isOCENLoanApplication(validOCEN)).toBe(true);
    expect(isOCENLoanApplication({})).toBe(false);
  });
});

describe('schema registry', () => {
  it('lists the new DPI schemas', () => {
    expect(listSchemas()).toEqual(
      expect.arrayContaining([
        'aa-profile',
        'aa-transaction',
        'normalized-transaction',
        'ocen-loan',
      ]),
    );
  });
});
