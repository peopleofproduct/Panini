/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { JsonWebKey } from 'node:crypto';
import { buildConsentRequest, parseConsentArtefact } from './consent';
import { buildFiRequest, decryptFiResponse } from './fi';
import { generateFiuKeyMaterial } from './keys';
import {
  FiuError,
  type ConsentArtefact,
  type ConsentHandleResponse,
  type ConsentRequestInput,
  type DecryptedFi,
  type FiFetchResponse,
  type FiRequestResponse,
  type FiuKeyMaterial,
} from './types';

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface FiuClientConfig {
  /** AA base URL, e.g. 'https://api.aa.example.com' — no trailing slash needed. */
  readonly baseUrl: string;
  /** This FIU's identifier registered with the AA. */
  readonly dataConsumerId: string;
  /** Extra headers (API keys, mTLS hints as headers, tracing ids). */
  readonly headers?: Record<string, string>;
  /**
   * Transport seam — defaults to global fetch. **No request is ever made
   * except inside an explicit client method call.** Inject a mock for tests
   * or a policy-enforcing adapter for production.
   */
  readonly fetch?: FetchLike;
  /** Per-request timeout in ms (default 30_000). */
  readonly timeoutMs?: number;
}

export interface FiuClient {
  /** POST /Consent → consent handle. */
  requestConsent(input: ConsentRequestInput): Promise<ConsentHandleResponse>;
  /** GET /Consent/handle/{handle} → artefact status while consent is pending. */
  consentStatus(handle: string): Promise<{ status: string; consentId?: string }>;
  /** GET /Consent/{consentId} → signed artefact, optionally JWS-verified.
   *  `signedConsent` is the raw JWS — pass it to {@link FiuClient.requestFi}. */
  fetchConsentArtefact(
    consentId: string,
    aaPublicKey?: string | JsonWebKey,
  ): Promise<{
    artefact: ConsentArtefact;
    signature: 'verified' | 'unverified' | 'invalid';
    signedConsent: string;
  }>;
  /**
   * POST /FI/request → sessionId. Generates a fresh ephemeral key pair per
   * call and retains it (in-memory only) for the matching decrypt.
   */
  requestFi(
    artefact: ConsentArtefact,
    fiDataRange: { from: string; to: string },
    signedConsentB64: string,
  ): Promise<{ sessionId: string }>;
  /** GET /FI/fetch/{sessionId} → raw encrypted response. */
  fetchFi(sessionId: string): Promise<FiFetchResponse>;
  /**
   * Fetch + decrypt + (optionally) schema-validate one FI session.
   * `validate` receives (fiType, parsedJsonPayload) — wire it to
   * `validateFiData` from `@paniniapi/standards-schema` for ReBIT payloads.
   */
  fetchAndDecryptFi(
    sessionId: string,
    validate?: (fiType: string, payload: unknown) => { valid: boolean; errors: readonly string[] },
    fiType?: string,
  ): Promise<DecryptedFi[]>;
  /** Poll /FI/fetch until COMPLETED/FAILED/attempts exhausted. Bounded. */
  waitForFi(
    sessionId: string,
    opts?: { intervalMs?: number; maxAttempts?: number },
  ): Promise<FiFetchResponse>;
}

export function createFiuClient(config: FiuClientConfig): FiuClient {
  if (!config.baseUrl) throw new FiuError('CONFIG', 'baseUrl is required');
  if (!config.dataConsumerId) throw new FiuError('CONFIG', 'dataConsumerId is required');
  const base = config.baseUrl.replace(/\/+$/, '');
  const resolvedFetch = config.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!resolvedFetch) throw new FiuError('CONFIG', 'no fetch implementation — pass config.fetch');
  const doFetch: FetchLike = resolvedFetch;
  const timeoutMs = config.timeoutMs ?? 30_000;

  // sessionId → FIU key material used in the matching /FI/request.
  const sessionKeys = new Map<string, FiuKeyMaterial>();

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: { status: number; json: () => Promise<unknown> };
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(config.headers ?? {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: ac.signal,
      });
    } catch (e) {
      throw new FiuError('HTTP', `${method} ${path} failed (network/timeout)`, e);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 400) {
      let detail: unknown;
      try {
        detail = await res.json();
      } catch {
        /* non-JSON error body */
      }
      throw new FiuError('HTTP', `${method} ${path} → HTTP ${res.status}`, detail);
    }
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (e) {
      throw new FiuError(
        'SCHEMA',
        `${method} ${path} returned a non-JSON body (HTTP ${res.status})`,
        e,
      );
    }
    return parsed as T;
  }

  const fetchFi = (sessionId: string): Promise<FiFetchResponse> =>
    call('GET', `/FI/fetch/${encodeURIComponent(sessionId)}`);

  return {
    requestConsent(input) {
      return call('POST', '/Consent', buildConsentRequest(input, config.dataConsumerId));
    },

    async consentStatus(handle) {
      const res = await call<{ ConsentStatus?: { status: string }; Consent?: { id: string } }>(
        'GET',
        `/Consent/handle/${encodeURIComponent(handle)}`,
      );
      const out: { status: string; consentId?: string } = {
        status: res.ConsentStatus?.status ?? 'UNKNOWN',
      };
      if (res.Consent?.id) out.consentId = res.Consent.id;
      return out;
    },

    async fetchConsentArtefact(consentId, aaPublicKey) {
      const res = await call<{ signedConsent?: string; ConsentDetail?: unknown }>(
        'GET',
        `/Consent/${encodeURIComponent(consentId)}`,
      );
      if (!res.signedConsent) {
        throw new FiuError('SCHEMA', 'artefact response missing signedConsent');
      }
      return {
        ...parseConsentArtefact(res.signedConsent, aaPublicKey),
        signedConsent: res.signedConsent,
      };
    },

    async requestFi(artefact, fiDataRange, signedConsentB64) {
      if (artefact.status !== 'ACTIVE') {
        throw new FiuError(
          'STATE',
          `consent ${artefact.consentId} is ${artefact.status}, not ACTIVE`,
        );
      }
      const km = generateFiuKeyMaterial();
      const res = await call<FiRequestResponse>(
        'POST',
        '/FI/request',
        buildFiRequest(artefact.consentId, signedConsentB64, fiDataRange, km),
      );
      if (!res.sessionId) throw new FiuError('SCHEMA', 'FI/request response missing sessionId');
      sessionKeys.set(res.sessionId, km);
      return { sessionId: res.sessionId };
    },

    fetchFi(sessionId) {
      return fetchFi(sessionId);
    },

    async fetchAndDecryptFi(sessionId, validate, fiType) {
      const km = sessionKeys.get(sessionId);
      if (!km) {
        throw new FiuError(
          'STATE',
          `no key material for session ${sessionId} — only sessions created by this client's requestFi can be decrypted, and key material is discarded after the first decrypt`,
        );
      }
      const res = await fetchFi(sessionId);
      if (res.sessionStatus === 'FAILED') {
        // A FAILED session has no data to decrypt — surfacing it as an
        // empty success would silently mask the failure.
        sessionKeys.delete(sessionId);
        throw new FiuError(
          'STATE',
          `FI session ${sessionId} FAILED at the AA — no data will follow`,
        );
      }
      const blocks = decryptFiResponse(res, km.privateKeyB64, km.nonceB64);
      // Ephemeral keys live exactly as long as the matching decrypt.
      sessionKeys.delete(sessionId);
      if (validate && fiType) {
        for (const b of blocks) {
          if (b.isJson) {
            const v = validate(fiType, b.payload);
            if (!v.valid) {
              throw new FiuError('SCHEMA', `FI payload failed ${fiType} validation`, v.errors);
            }
          }
        }
      }
      return blocks;
    },

    async waitForFi(sessionId, opts) {
      const interval = opts?.intervalMs ?? 2000;
      const maxAttempts = opts?.maxAttempts ?? 15;
      for (let i = 0; i < maxAttempts; i++) {
        const res = await fetchFi(sessionId);
        if (res.sessionStatus === 'COMPLETED' || res.sessionStatus === 'FAILED') return res;
        if (i + 1 < maxAttempts) await new Promise((r) => setTimeout(r, interval));
      }
      throw new FiuError(
        'STATE',
        `FI session ${sessionId} not ready after ${maxAttempts} attempts`,
      );
    },
  };
}
