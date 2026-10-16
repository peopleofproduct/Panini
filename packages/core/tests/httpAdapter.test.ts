/**
 * Copyright 2026 Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { createPaniniHttpHandler } from '../src/adapters/httpAdapter';
import type { HttpLikeRequest, HttpLikeResponse } from '../src/adapters/httpAdapter';
import {
  EnterpriseProxy,
  InMemoryBillingMeter,
  TokenBucketRateLimiter,
} from '../src/enterpriseProxy';
import { Normalizer } from '../src/normalizer';
import type { GrammarRuleSet } from '../src/grammar';

const ruleSets: readonly GrammarRuleSet[] = [
  {
    id: 'test',
    bank: 'GENERIC',
    version: '1.0.0',
    patterns: [
      {
        name: 'upi_dashed',
        channel: 'UPI',
        regex: '^UPI-(?<counterparty>[A-Za-z]+)-(?<txnId>\\d{6,16})',
      },
    ],
  },
];

interface MockRes extends HttpLikeResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

function makeReq(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  chunks?: Buffer[];
}): HttpLikeRequest & { fire: () => void } {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const req: HttpLikeRequest & { fire: () => void } = {
    method: options.method ?? 'POST',
    url: options.url ?? '/v1/parse',
    headers: options.headers ?? { 'x-api-key': 'test-key' },
    on(event: string, listener: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(listener);
      return req;
    },
    fire() {
      for (const chunk of options.chunks ?? []) {
        for (const l of listeners['data'] ?? []) l(chunk);
      }
      for (const l of listeners['end'] ?? []) l();
    },
    ...(options.body !== undefined ? { body: options.body } : {}),
  };
  return req;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    body: '',
    headers: {},
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    end(data?: string) {
      res.body = data ?? '';
    },
  };
  return res;
}

function makeHandler() {
  const billingMeter = new InMemoryBillingMeter();
  const proxy = new EnterpriseProxy({
    normalizer: new Normalizer({ ruleSets }),
    billingMeter,
    rateLimiter: new TokenBucketRateLimiter({ capacity: 3, refillPerSecond: 1 }),
  });
  return { handler: createPaniniHttpHandler({ proxy }), billingMeter };
}

async function flush() {
  // Allow the handler's async body-reading to settle.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('createPaniniHttpHandler', () => {
  it('parses a narration body and returns 200 JSON', async () => {
    const { handler, billingMeter } = makeHandler();
    const req = makeReq({ chunks: [Buffer.from('UPI-SWIGGY-826384')] });
    const res = makeRes();
    handler(req, res);
    req.fire();
    await flush();
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    const data = JSON.parse(res.body) as { channel: string; counterparty: string };
    expect(data.channel).toBe('UPI');
    expect(data.counterparty).toBe('Swiggy');
    // billing meter recorded the request with payload sizing
    expect(billingMeter.usageFor('test-key').requests).toBe(1);
  });

  it('routes JSON bodies through the payload path', async () => {
    const { handler } = makeHandler();
    const body = JSON.stringify({ narration: 'UPI-SWIGGY-826384', txnId: 'T9' });
    const req = makeReq({ chunks: [Buffer.from(body)] });
    const res = makeRes();
    handler(req, res);
    req.fire();
    await flush();
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body) as { transactionId: string };
    expect(data.transactionId).toBe('T9');
  });

  it('honours a pre-parsed req.body (Express JSON middleware)', async () => {
    const { handler } = makeHandler();
    const req = makeReq({ body: { narration: 'UPI-SWIGGY-826384', txnId: 'T10' } });
    const res = makeRes();
    handler(req, res);
    req.fire();
    await flush();
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { transactionId: string }).transactionId).toBe('T10');
  });

  it('supports Authorization: Bearer tokens', async () => {
    const { handler } = makeHandler();
    const req = makeReq({
      headers: { authorization: 'Bearer bearer-key-1' },
      chunks: [Buffer.from('UPI-SWIGGY-826384')],
    });
    const res = makeRes();
    handler(req, res);
    req.fire();
    await flush();
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests without an API key', async () => {
    const { handler } = makeHandler();
    const req = makeReq({ headers: {}, chunks: [Buffer.from('UPI-SWIGGY-826384')] });
    const res = makeRes();
    handler(req, res);
    req.fire();
    await flush();
    expect(res.statusCode).toBe(401);
  });

  it('returns 429 + retry-after when the bucket is exhausted', async () => {
    const { handler } = makeHandler();
    for (let i = 0; i < 3; i++) {
      const r = makeReq({ chunks: [Buffer.from('UPI-SWIGGY-826384')] });
      handler(r, makeRes());
      r.fire();
    }
    const req = makeReq({ chunks: [Buffer.from('UPI-SWIGGY-826384')] });
    const res = makeRes();
    handler(req, res);
    req.fire();
    await flush();
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('returns 413 for oversized bodies', async () => {
    const proxy = new EnterpriseProxy({ normalizer: new Normalizer({ ruleSets }) });
    const handler = createPaniniHttpHandler({ proxy, maxBodyBytes: 16 });
    const req = makeReq({ chunks: [Buffer.from('UPI-SWIGGY-826384-and-more')] });
    const res = makeRes();
    handler(req, res);
    req.fire();
    await flush();
    expect(res.statusCode).toBe(413);
  });

  it('passes non-matching requests to next()', () => {
    const { handler } = makeHandler();
    const req = makeReq({ method: 'GET', url: '/health' });
    const res = makeRes();
    let nextCalled = false;
    handler(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(0);
  });
});
