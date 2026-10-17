/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { validateOndcEnvelope, validateOndcFsSearch } from '../src';

const envelope = {
  context: {
    domain: 'ONDC:FIS12',
    action: 'search',
    core_version: '1.2.0',
    bap_id: 'bap.example.com',
    bap_uri: 'https://bap.example.com/ondc',
    bpp_id: 'bpp.example.com',
    bpp_uri: 'https://bpp.example.com/ondc',
    transaction_id: 'txn-001',
    message_id: 'msg-001',
    timestamp: '2024-06-01T10:00:00.000Z',
    ttl: 'PT30S',
    location: { country: { code: 'IND' }, city: { code: 'std:080' } },
  },
  message: { intent: {} },
};

describe('ONDC Beckn envelope', () => {
  it('accepts a valid envelope', () => {
    expect(validateOndcEnvelope(envelope).valid).toBe(true);
  });

  it('accepts all Beckn actions', () => {
    for (const action of ['on_search', 'select', 'on_init', 'confirm', 'on_status']) {
      expect(
        validateOndcEnvelope({ ...envelope, context: { ...envelope.context, action } }).valid,
      ).toBe(true);
    }
  });

  it('rejects invalid domain, action, ttl, and URI shapes', () => {
    const bad = (ctx: Record<string, unknown>) =>
      validateOndcEnvelope({ ...envelope, context: { ...envelope.context, ...ctx } }).valid;
    expect(bad({ domain: 'FIS12' })).toBe(false);
    expect(bad({ action: 'teleport' })).toBe(false);
    expect(bad({ ttl: 'soon' })).toBe(false);
    expect(bad({ bap_uri: 'not-a-url' })).toBe(false);
    expect(bad({ timestamp: 'yesterday' })).toBe(false);
  });

  it('rejects missing context fields and non-object message', () => {
    const { context, ...noCtx } = envelope;
    void context;
    expect(validateOndcEnvelope({ ...envelope, context: undefined }).valid).toBe(false);
    expect(validateOndcEnvelope({ context: envelope.context, message: 'x' }).valid).toBe(false);
    void noCtx;
  });
});

describe('ONDC FS search intent', () => {
  const search = {
    intent: {
      category: { descriptor: { code: 'PERSONAL_LOAN', name: 'Personal Loan' } },
      provider: { id: 'lender-1', descriptor: { name: 'Acme NBFC' } },
      item: {
        id: 'i1',
        xinput: {
          form: { id: 'f-loan' },
          form_response: { status: 'SUCCESS', submission_id: 'sub-1' },
        },
      },
      payment: { collected_by: 'BPP', type: 'ON_ORDER' },
    },
  };

  it('accepts a valid FS search intent', () => {
    expect(validateOndcFsSearch(search).valid).toBe(true);
  });

  it('rejects unknown loan categories and missing form id', () => {
    expect(
      validateOndcFsSearch({ intent: { category: { descriptor: { code: 'PAYDAY_LOAN' } } } }).valid,
    ).toBe(false);
    expect(
      validateOndcFsSearch({
        intent: { category: { descriptor: { code: 'HOME_LOAN' } }, item: { xinput: { form: {} } } },
      }).valid,
    ).toBe(false);
  });
});
