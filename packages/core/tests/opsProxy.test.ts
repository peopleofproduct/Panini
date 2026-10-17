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
  CollectingTelemetrySink,
  OpsProxy,
  InMemoryBillingMeter,
  TokenBucketRateLimiter,
} from '../src/opsProxy';
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

const normalizer = new Normalizer({ ruleSets });
const INPUT = 'UPI-SWIGGY-826384';

function makeProxy(overrides?: {
  rateLimiter?: TokenBucketRateLimiter;
  billingMeter?: InMemoryBillingMeter;
  telemetry?: { enabled: boolean; sink: CollectingTelemetrySink };
  now?: () => number;
}) {
  const billingMeter = overrides?.billingMeter ?? new InMemoryBillingMeter();
  const sink = overrides?.telemetry?.sink ?? new CollectingTelemetrySink();
  const proxy = new OpsProxy({
    normalizer,
    billingMeter,
    ...(overrides?.rateLimiter !== undefined ? { rateLimiter: overrides.rateLimiter } : {}),
    telemetry: { enabled: overrides?.telemetry?.enabled ?? false, sink },
    ...(overrides?.now !== undefined ? { now: overrides.now } : {}),
  });
  return { proxy, billingMeter, sink };
}

describe('OpsProxy — happy path', () => {
  it('parses and returns 200 with the normalized transaction', () => {
    const { proxy } = makeProxy();
    const result = proxy.parse('client-key-1', INPUT);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    if (result.ok) {
      expect(result.data.channel).toBe('UPI');
      expect(result.data.counterparty).toBe('Swiggy');
    }
  });

  it('meters usage per API key', () => {
    const billingMeter = new InMemoryBillingMeter();
    const { proxy } = makeProxy({ billingMeter });
    proxy.parse('key-a', INPUT);
    proxy.parse('key-a', INPUT);
    proxy.parse('key-b', INPUT);
    expect(billingMeter.usageFor('key-a')).toEqual({ requests: 2, units: 2 });
    expect(billingMeter.usageFor('key-b')).toEqual({ requests: 1, units: 1 });
  });
});

describe('OpsProxy — auth & throttling', () => {
  it('rejects a missing API key with 401', () => {
    const { proxy } = makeProxy();
    const result = proxy.parse(undefined, INPUT);
    expect(result).toEqual({ ok: false, status: 401, error: 'missing API key' });
  });

  it('rate-limits per API key and reports retryAfterMs', () => {
    let now = 0;
    const rateLimiter = new TokenBucketRateLimiter({
      capacity: 2,
      refillPerSecond: 1,
      now: () => now,
    });
    const { proxy, billingMeter } = makeProxy({ rateLimiter, now: () => now });
    expect(proxy.parse('k', INPUT).ok).toBe(true);
    expect(proxy.parse('k', INPUT).ok).toBe(true);
    const limited = proxy.parse('k', INPUT);
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.status).toBe(429);
      expect(limited.retryAfterMs).toBeGreaterThan(0);
    }
    // rejected request is not billed
    expect(billingMeter.usageFor('k').requests).toBe(2);
    // a different key is unaffected
    expect(proxy.parse('other', INPUT).ok).toBe(true);
    // tokens refill over time
    now += 2000;
    expect(proxy.parse('k', INPUT).ok).toBe(true);
  });
});

describe('OpsProxy — telemetry', () => {
  it('emits nothing when telemetry is disabled (default)', () => {
    const { proxy, sink } = makeProxy();
    proxy.parse('key-1', INPUT);
    expect(sink.events).toEqual([]);
  });

  it('emits anonymous, PII-free metrics when opted in', () => {
    const sink = new CollectingTelemetrySink();
    const { proxy } = makeProxy({ telemetry: { enabled: true, sink } });
    proxy.parse('secret-api-key', INPUT);
    expect(sink.events).toHaveLength(1);
    const event = sink.events[0]!;
    expect(event.event).toBe('parse.completed');
    expect(event.channel).toBe('UPI');
    expect(event.confidence).toBeGreaterThan(0);
    // Pseudonymized key, never the raw key
    expect(event.apiKeyHash).not.toContain('secret-api-key');
    // Nothing PII-shaped can appear in a telemetry event
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('SWIGGY');
    expect(serialized).not.toContain('Swiggy');
    expect(serialized).not.toContain('826384');
    expect(serialized).not.toContain(INPUT);
  });
});
