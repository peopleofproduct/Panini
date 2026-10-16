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

import type { Normalizer } from './normalizer';
import type { NormalizedTransaction, RawInput, TransactionChannel, TransactionType } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════
 * PANINI ENTERPRISE — DOWNSTREAM PAID-LAYER SCAFFOLD
 * ═══════════════════════════════════════════════════════════════════
 *
 * This module is the seam between the open-source parser and the paid
 * "Panini Enterprise" hosted API. It stays transport-agnostic (no HTTP
 * framework dependency) so the enterprise server can mount it behind
 * Fastify/Express/a Lambda handler unchanged.
 *
 * Hard privacy contract: the telemetry path is OPT-IN and constructed
 * field-by-field from an allowlist. Raw narrations, counterparties,
 * account masks and reference numbers can never reach a TelemetrySink —
 * they are structurally absent from `ParseTelemetryEvent`.
 * ═══════════════════════════════════════════════════════════════════
 */

// ── Rate limiting ────────────────────────────────────────────────────

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Suggested backoff for 429 responses. */
  readonly retryAfterMs?: number;
}

/** Pluggable per-API-key throttle. Implementations own their storage. */
export interface RateLimiter {
  check(apiKey: string): RateLimitDecision;
}

/**
 * Reference token-bucket limiter, fully in-memory. Suitable for a single
 * enterprise node; swap for Redis/etc. behind the same interface for a
 * fleet deployment.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(options: { capacity: number; refillPerSecond: number; now?: () => number }) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? (() => Date.now());
  }

  check(apiKey: string): RateLimitDecision {
    const now = this.now();
    const bucket = this.buckets.get(apiKey) ?? {
      tokens: this.capacity,
      lastRefill: now,
    };
    const elapsedSec = Math.max(0, (now - bucket.lastRefill) / 1000);
    const tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSecond);
    if (tokens >= 1) {
      this.buckets.set(apiKey, { tokens: tokens - 1, lastRefill: now });
      return { allowed: true };
    }
    const deficitMs = ((1 - tokens) / this.refillPerSecond) * 1000;
    this.buckets.set(apiKey, { tokens, lastRefill: now });
    return { allowed: false, retryAfterMs: Math.ceil(deficitMs) };
  }
}

// ── Billing / usage metering ─────────────────────────────────────────

export interface UsageRecord {
  readonly apiKey: string;
  /** Billable units consumed (1 per successful parse by default). */
  readonly units: number;
  /** Whether a grammar rule matched (heuristic parses may be free). */
  readonly ruleMatched: boolean;
  /** Size of the inbound payload in bytes, when known (HTTP layer). */
  readonly payloadBytes?: number;
  readonly occurredAt: string; // ISO-8601
}

/** Per-request extras forwarded by the HTTP adapter into billing. */
export interface RequestMeta {
  readonly payloadBytes?: number;
}

/** Metering slot — invoices/usage dashboards plug in here. */
export interface BillingMeter {
  recordUsage(record: UsageRecord): void;
}

export interface UsageSummary {
  readonly requests: number;
  readonly units: number;
}

/** In-memory meter for development and tests. */
export class InMemoryBillingMeter implements BillingMeter {
  private readonly records = new Map<string, UsageRecord[]>();

  recordUsage(record: UsageRecord): void {
    const list = this.records.get(record.apiKey) ?? [];
    list.push(record);
    this.records.set(record.apiKey, list);
  }

  usageFor(apiKey: string): UsageSummary {
    const list = this.records.get(apiKey) ?? [];
    return {
      requests: list.length,
      units: list.reduce((sum, r) => sum + r.units, 0),
    };
  }
}

// ── Telemetry (opt-in, PII-free by construction) ─────────────────────

/**
 * Fields allowed off the host. There is deliberately NO slot for the raw
 * narration, counterparty, transaction id, VPA, account mask or amounts —
 * anonymous metrics only.
 */
export interface ParseTelemetryEvent {
  readonly event: 'parse.completed' | 'request.rate_limited' | 'request.unauthorized';
  /** One-way FNV-1a hash of the API key — pseudonymous, not reversible. */
  readonly apiKeyHash: string;
  readonly occurredAt: string; // ISO-8601
  readonly durationMs?: number;
  readonly confidence?: number;
  readonly channel?: TransactionChannel;
  readonly transactionType?: TransactionType;
  readonly matchedRule?: string;
  readonly warningCount?: number;
}

/** Implementations decide where metrics go (HTTP collector, file, etc). */
export interface TelemetrySink {
  emit(event: ParseTelemetryEvent): void;
}

/** Test/dev sink that buffers events in memory. */
export class CollectingTelemetrySink implements TelemetrySink {
  readonly events: ParseTelemetryEvent[] = [];
  emit(event: ParseTelemetryEvent): void {
    this.events.push(event);
  }
}

/** FNV-1a 32-bit — enough to group metrics per client without storing keys. */
function hashApiKey(apiKey: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < apiKey.length; i++) {
    hash ^= apiKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ── Proxy ────────────────────────────────────────────────────────────

export interface EnterpriseProxyOptions {
  readonly normalizer: Normalizer;
  readonly rateLimiter?: RateLimiter;
  readonly billingMeter?: BillingMeter;
  /** Telemetry is OFF unless `enabled` is explicitly true. */
  readonly telemetry?: { readonly enabled: boolean; readonly sink: TelemetrySink };
  /** Injectable clock (ms epoch) for deterministic tests. */
  readonly now?: () => number;
}

export interface ProxyOk {
  readonly ok: true;
  readonly status: 200;
  readonly data: NormalizedTransaction;
}

export interface ProxyError {
  readonly ok: false;
  readonly status: 401 | 429;
  readonly error: string;
  readonly retryAfterMs?: number;
}

export type ProxyResult = ProxyOk | ProxyError;

export class EnterpriseProxy {
  private readonly normalizer: Normalizer;
  private readonly rateLimiter: RateLimiter | undefined;
  private readonly billingMeter: BillingMeter | undefined;
  private readonly telemetry: { enabled: boolean; sink: TelemetrySink } | undefined;
  private readonly now: () => number;

  constructor(options: EnterpriseProxyOptions) {
    this.normalizer = options.normalizer;
    this.rateLimiter = options.rateLimiter;
    this.billingMeter = options.billingMeter;
    this.telemetry = options.telemetry;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Authorize → throttle → parse → meter → (optionally) emit metrics.
   * The parse itself is always local and in-memory.
   */
  parse(apiKey: string | undefined, input: string | RawInput, meta?: RequestMeta): ProxyResult {
    return this.guard(apiKey, () => this.normalizer.normalize(input), meta);
  }

  /**
   * Payload entry point for Account Aggregator-style JSON bodies — runs the
   * normalizer's structured-field merge path instead of plain narration
   * parsing.
   */
  parsePayload(apiKey: string | undefined, payload: unknown, meta?: RequestMeta): ProxyResult {
    return this.guard(apiKey, () => this.normalizer.normalizePayload(payload), meta);
  }

  /**
   * Authorize → throttle → execute → meter → (optionally) emit metrics.
   * The parse itself is always local and in-memory.
   */
  private guard(
    apiKey: string | undefined,
    execute: () => NormalizedTransaction,
    meta?: RequestMeta,
  ): ProxyResult {
    if (apiKey === undefined || apiKey.trim().length === 0) {
      this.emit({ event: 'request.unauthorized', apiKeyHash: 'anonymous' });
      return { ok: false, status: 401, error: 'missing API key' };
    }

    const keyHash = hashApiKey(apiKey);

    if (this.rateLimiter !== undefined) {
      const decision = this.rateLimiter.check(apiKey);
      if (!decision.allowed) {
        this.emit({ event: 'request.rate_limited', apiKeyHash: keyHash });
        return {
          ok: false,
          status: 429,
          error: 'rate limit exceeded',
          ...(decision.retryAfterMs !== undefined ? { retryAfterMs: decision.retryAfterMs } : {}),
        };
      }
    }

    const started = this.now();
    const data = execute();
    const durationMs = Math.max(0, this.now() - started);

    this.billingMeter?.recordUsage({
      apiKey,
      units: 1,
      ruleMatched: data.matchedRule !== null,
      occurredAt: new Date(started).toISOString(),
      ...(meta?.payloadBytes !== undefined ? { payloadBytes: meta.payloadBytes } : {}),
    });

    // PII-free by construction: only the allowlisted aggregate fields below
    // can leave this process.
    this.emit({
      event: 'parse.completed',
      apiKeyHash: keyHash,
      durationMs,
      confidence: data.confidence,
      channel: data.channel,
      transactionType: data.type,
      ...(data.matchedRule !== null ? { matchedRule: data.matchedRule } : {}),
      warningCount: data.warnings.length,
    });

    return { ok: true, status: 200, data };
  }

  private emit(event: Omit<ParseTelemetryEvent, 'occurredAt'>): void {
    if (this.telemetry?.enabled !== true) return;
    this.telemetry.sink.emit({
      ...event,
      occurredAt: new Date(this.now()).toISOString(),
    });
  }
}
