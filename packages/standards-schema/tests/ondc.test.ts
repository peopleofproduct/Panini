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
  validateOndcEnvelope,
  validateOndcFsSearch,
  validateOndcCatalog,
  validateOndcOrder,
  validateOcenLifecycle,
} from '../src';

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

describe('ONDC on_search catalog', () => {
  const catalog = {
    catalog: {
      descriptor: { name: 'Acme Credit Marketplace' },
      providers: [
        {
          id: 'lender-1',
          descriptor: { name: 'Acme NBFC' },
          items: [
            {
              id: 'pl-1',
              descriptor: { name: 'Personal Loan', code: 'PERSONAL_LOAN' },
              price: { value: '50000', currency: 'INR' },
              xinput: { form: { id: 'f-loan' }, required: true },
            },
          ],
          payments: [{ id: 'p1', collected_by: 'BPP', type: 'ON_ORDER' }],
        },
      ],
    },
  };

  it('accepts a valid catalog', () => {
    expect(validateOndcCatalog(catalog).valid).toBe(true);
  });

  it('rejects empty providers, missing item descriptor, bad price', () => {
    expect(
      validateOndcCatalog({ catalog: { descriptor: { name: 'x' }, providers: [] } }).valid,
    ).toBe(false);
    expect(
      validateOndcCatalog({
        catalog: {
          descriptor: { name: 'x' },
          providers: [{ id: 'p', items: [{ id: 'i' }] }],
        },
      }).valid,
    ).toBe(false);
    expect(
      validateOndcCatalog({
        catalog: {
          descriptor: { name: 'x' },
          providers: [
            { id: 'p', items: [{ id: 'i', descriptor: { name: 'n' }, price: { value: 'abc' } }] },
          ],
        },
      }).valid,
    ).toBe(false);
  });
});

describe('ONDC order lifecycle object', () => {
  const order = {
    order: {
      id: 'ord-1',
      state: 'IN_PROGRESS',
      provider: { id: 'lender-1' },
      items: [{ id: 'pl-1' }],
      quote: {
        price: { value: '52000', currency: 'INR' },
        breakup: [{ title: 'Principal', price: { value: '50000', currency: 'INR' } }],
      },
      payments: [{ id: 'p1', type: 'ON_ORDER', status: 'PAID', collected_by: 'BPP' }],
      fulfillments: [{ id: 'f1', state: { descriptor: { code: 'SANCTIONED' } } }],
    },
  };

  it('accepts a valid order across lifecycle states', () => {
    for (const state of ['CREATED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
      expect(validateOndcOrder({ order: { ...order.order, state } }).valid).toBe(true);
    }
  });

  it('rejects bad state, empty items, bad payment status', () => {
    expect(validateOndcOrder({ order: { ...order.order, state: 'LOST' } }).valid).toBe(false);
    expect(validateOndcOrder({ order: { ...order.order, items: [] } }).valid).toBe(false);
    expect(
      validateOndcOrder({ order: { ...order.order, payments: [{ status: 'MAYBE' }] } }).valid,
    ).toBe(false);
  });
});

describe('OCEN loan lifecycle', () => {
  const meta = {
    originatorOrgId: 'org-1',
    originatorParticipantId: 'lsp-1',
    traceId: 'tr-1',
    requestId: 'req-1',
    loanApplicationId: 'la-001',
    timestamp: '2024-06-01T10:00:00.000Z',
  };
  const event = {
    metadata: meta,
    loanApplicationId: 'la-001',
    status: 'DISBURSED',
    disbursement: {
      amount: 50000,
      currency: 'INR',
      utr: 'UTR123456',
      disbursementDate: '2024-06-01T12:00:00.000Z',
      account: { accountNumber: '12345678901', ifsc: 'HDFC0001234' },
    },
    repaymentSchedule: [
      {
        installmentNo: 1,
        dueDate: '2024-07-01',
        amount: { principal: 4000, interest: 500, total: 4500 },
        status: 'DUE',
      },
      { installmentNo: 2, dueDate: '2024-08-01', amount: { total: 4500 } },
    ],
    mandate: { type: 'ENACH', status: 'REGISTERED', umn: 'UMN123', amount: 4500 },
    kfs: { annualPercentageRate: 18.5, coolingOffDays: 3 },
  };

  it('accepts a full lifecycle event', () => {
    expect(validateOcenLifecycle(event).valid).toBe(true);
  });

  it('accepts all lifecycle states', () => {
    for (const status of [
      'APPLICATION_SUBMITTED',
      'OFFER_GENERATED',
      'OFFER_ACCEPTED',
      'AGREEMENT_SIGNED',
      'DISBURSED',
      'CLOSED',
      'REJECTED',
    ]) {
      expect(validateOcenLifecycle({ ...event, status }).valid).toBe(true);
    }
  });

  it('rejects unknown status, bad IFSC, malformed repayment rows', () => {
    expect(validateOcenLifecycle({ ...event, status: 'APPROVED?' }).valid).toBe(false);
    expect(
      validateOcenLifecycle({
        ...event,
        disbursement: { amount: 1, account: { ifsc: 'badifsc' } },
      }).valid,
    ).toBe(false);
    expect(
      validateOcenLifecycle({
        ...event,
        repaymentSchedule: [{ installmentNo: 0, dueDate: '2024-07-01', amount: { total: 1 } }],
      }).valid,
    ).toBe(false);
    expect(
      validateOcenLifecycle({
        ...event,
        repaymentSchedule: [{ installmentNo: 1, dueDate: '1 July', amount: { total: 1 } }],
      }).valid,
    ).toBe(false);
  });
});
