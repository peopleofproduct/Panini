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

import { AA_DIRECTORY, resolveAaHandle, suggestAas } from './aaDirectory';
import type { AaClientConfig, AaEndpoint } from './aaDirectory';
import { createFiuClient } from './client';
import type { FiuClient } from './client';
import { FiuError } from './types';
import type { ConsentHandleResponse, ConsentRequestInput, DecryptedFi } from './types';

/**
 * Per-AA call outcome — allSettled semantics: one AA's failure never
 * discards the others' results. `latencyMs` is measured per call so
 * callers can rank AAs empirically instead of trusting claims.
 */
export type AaOutcome<T> =
  | { readonly aaId: string; readonly ok: true; readonly value: T; readonly latencyMs: number }
  | {
      readonly aaId: string;
      readonly ok: false;
      readonly error: FiuError;
      readonly latencyMs: number;
    };

export interface MultiFiuConfig {
  /** aaId → per-AA client config (credentials, transport, timeout). */
  readonly clients: Readonly<Record<string, AaClientConfig>>;
  /** Override/extend the seeded directory (e.g. sandbox AAs). */
  readonly directory?: readonly AaEndpoint[];
  /** Injectable clock for deterministic tests; defaults to performance.now. */
  readonly clock?: () => number;
  /** Max concurrent calls in fan-out operations. Default 4. */
  readonly maxConcurrency?: number;
}

export interface MultiFiuClient {
  /** 'user@finvu' → the AA serving that handle (longest-suffix match). */
  resolveAa(handleOrVua: string): AaEndpoint | null;
  /** Did-you-mean suggestions when resolveAa returns null. */
  suggestAas(handleOrVua: string): readonly AaEndpoint[];
  /** The underlying per-AA client — lazily created, cached. */
  clientFor(aaId: string): FiuClient;
  /**
   * Consent request routed by the customer's VUA handle — the multi-AA
   * equivalent of 'which AA do I send this to?'.
   */
  requestConsent(
    handleOrVua: string,
    input: ConsentRequestInput,
  ): Promise<AaOutcome<ConsentHandleResponse>>;
  /**
   * Bounded parallel fan-out of a consent request across all configured
   * AAs (or an explicit subset). One AA failing never sinks the others.
   */
  requestConsentAcross(
    input: ConsentRequestInput,
    aaIds?: readonly string[],
  ): Promise<readonly AaOutcome<ConsentHandleResponse>[]>;
  /**
   * The full data pull across AAs — wait for each session + decrypt +
   * optional validate, in bounded parallel. Sessions are per-AA, so the
   * input maps aaId → sessionId. One AA's failure never sinks the others.
   */
  decryptFiAcross(
    sessions: Readonly<Record<string, string>>,
    opts?: {
      validate?: (
        fiType: string,
        payload: unknown,
      ) => { valid: boolean; errors: readonly string[] };
      fiType?: string;
      poll?: { intervalMs?: number; maxAttempts?: number };
    },
  ): Promise<readonly AaOutcome<readonly DecryptedFi[]>[]>;
}

function asFiuError(aaId: string, err: unknown): FiuError {
  if (err instanceof FiuError) return err;
  return new FiuError('HTTP', `[${aaId}] ${err instanceof Error ? err.message : String(err)}`);
}

export function createMultiFiuClient(config: MultiFiuConfig): MultiFiuClient {
  const directory = config.directory ?? AA_DIRECTORY;
  const clock = config.clock ?? (() => performance.now());
  // NaN/Infinity would silently produce an empty worker pool — fall back
  // to the default instead.
  const rawConcurrency = config.maxConcurrency ?? 4;
  const maxConcurrency = Math.max(1, Number.isFinite(rawConcurrency) ? rawConcurrency : 4);
  const clients = new Map<string, FiuClient>();

  function clientFor(aaId: string): FiuClient {
    const cached = clients.get(aaId);
    if (cached) return cached;
    const cfg = config.clients[aaId];
    if (!cfg) {
      throw new FiuError('CONFIG', `no client config for AA '${aaId}'`);
    }
    const entry = directory.find((e) => e.aaId === aaId);
    const baseUrl = cfg.baseUrl ?? entry?.baseUrl;
    if (!baseUrl) {
      throw new FiuError(
        'CONFIG',
        `AA '${aaId}' has no baseUrl — pass one in clients['${aaId}'] or the directory entry`,
      );
    }
    const client = createFiuClient({
      baseUrl,
      dataConsumerId: cfg.dataConsumerId,
      ...(cfg.headers !== undefined ? { headers: cfg.headers } : {}),
      ...(cfg.fetch !== undefined ? { fetch: cfg.fetch } : {}),
      ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
    });
    clients.set(aaId, client);
    return client;
  }

  async function call<T>(aaId: string, fn: (c: FiuClient) => Promise<T>): Promise<AaOutcome<T>> {
    const start = clock();
    try {
      const value = await fn(clientFor(aaId));
      return { aaId, ok: true, value, latencyMs: Math.round(clock() - start) };
    } catch (err) {
      return {
        aaId,
        ok: false,
        error: asFiuError(aaId, err),
        latencyMs: Math.round(clock() - start),
      };
    }
  }

  /** Bounded parallel fan-out — never fires more than maxConcurrency at once. */
  async function fanOut<T>(
    aaIds: readonly string[],
    fn: (c: FiuClient, aaId: string) => Promise<T>,
  ): Promise<AaOutcome<T>[]> {
    const results: AaOutcome<T>[] = new Array<AaOutcome<T>>(aaIds.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(maxConcurrency, aaIds.length) }, async () => {
      while (cursor < aaIds.length) {
        const i = cursor++;
        const aaId = aaIds[i]!;
        results[i] = await call(aaId, (c) => fn(c, aaId));
      }
    });
    await Promise.all(workers);
    return results;
  }

  return {
    resolveAa: (handleOrVua) => resolveAaHandle(handleOrVua, directory),
    suggestAas: (handleOrVua) => suggestAas(handleOrVua, directory),
    clientFor,

    async requestConsent(handleOrVua, input) {
      const entry = resolveAaHandle(handleOrVua, directory);
      if (!entry) {
        const names = suggestAas(handleOrVua, directory).map((e) => e.aaId);
        return {
          aaId: 'unresolved',
          ok: false,
          latencyMs: 0,
          error: new FiuError(
            'CONFIG',
            `cannot resolve AA for handle '${handleOrVua}'` +
              (names.length > 0 ? ` — did you mean: ${names.join(', ')}?` : ''),
          ),
        };
      }
      return call(entry.aaId, (c) => c.requestConsent(input));
    },

    requestConsentAcross(input, aaIds) {
      const targets = aaIds ?? Object.keys(config.clients);
      if (targets.length === 0) {
        throw new FiuError('CONFIG', 'no AAs configured for fan-out');
      }
      return fanOut(targets, (c) => c.requestConsent(input));
    },

    decryptFiAcross(sessions, opts) {
      const aaIds = Object.keys(sessions);
      if (aaIds.length === 0) {
        throw new FiuError('CONFIG', 'no sessions provided for decryptFiAcross');
      }
      return fanOut(aaIds, async (c, aaId) => {
        await c.waitForFi(sessions[aaId]!, opts?.poll);
        return c.fetchAndDecryptFi(sessions[aaId]!, opts?.validate, opts?.fiType);
      });
    },
  };
}
