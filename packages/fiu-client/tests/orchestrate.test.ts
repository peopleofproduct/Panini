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
  AA_DIRECTORY,
  createMultiFiuClient,
  FiuError,
  resolveAaHandle,
  suggestAas,
  type ConsentHandleResponse,
  type FetchLike,
} from '@paniniapi/fiu-client';
import { validateAaDirectoryEntry } from '@paniniapi/standards-schema';
import { makeMockAa } from './mockAa';

// ---------------------------------------------------------------------------
// Mock transports — capture the URL each AA is called on so routing is
// observable without any network.
// ---------------------------------------------------------------------------

function recordingFetch(
  calls: string[],
  respond: (url: string, body?: unknown) => { status: number; body: unknown },
): FetchLike {
  return async (url, init) => {
    calls.push(url);
    const r = respond(url, init.body ? JSON.parse(init.body) : undefined);
    return { status: r.status, json: async () => r.body };
  };
}

// Per spec the response txnid echoes the request's.
const consentOk = (
  handle: string,
  reqTxn = 'txn-1',
): { status: number; body: ConsentHandleResponse } => ({
  status: 200,
  body: {
    ver: '1',
    timestamp: '2026-01-01T00:00:00Z',
    txnid: reqTxn,
    ConsentHandle: handle,
    ConsentStatus: { id: 'c1', status: 'PENDING' },
    Customer: { id: 'user' },
  },
});

const baseInput = {
  customerId: 'user@finvu',
  consentStart: '2026-01-01T00:00:00Z',
  consentExpiry: '2026-12-31T00:00:00Z',
  fiDataRange: { from: '2025-01-01T00:00:00Z', to: '2025-12-31T00:00:00Z' },
  consentMode: 'VIEW' as const,
  fetchType: 'ONETIME' as const,
  consentTypes: ['TRANSACTIONS' as const],
  fiTypes: ['DEPOSIT'],
  purpose: { code: '101' },
  dataLife: { unit: 'DAY' as const, value: 30 },
  frequency: { unit: 'DAY' as const, value: 1 },
};

describe('resolveAaHandle', () => {
  it('resolves a VUA by handle suffix', () => {
    expect(resolveAaHandle('user@finvu')?.aaId).toBe('finvu');
  });

  it('is case-insensitive and trims', () => {
    expect(resolveAaHandle('  User@ONEMONEY ')?.aaId).toBe('onemoney');
  });

  it('resolves dotted sub-handles via longest suffix', () => {
    expect(resolveAaHandle('user@x.finvu')?.aaId).toBe('finvu');
  });

  it('accepts a bare handle or aaId', () => {
    expect(resolveAaHandle('finvu')?.aaId).toBe('finvu');
    expect(resolveAaHandle('onemoney')?.aaId).toBe('onemoney');
  });

  it('returns null for unresolvable handles', () => {
    expect(resolveAaHandle('user@nonexistent')).toBeNull();
    expect(resolveAaHandle('')).toBeNull();
  });

  it('suggestAas ranks prefix matches first', () => {
    const s = suggestAas('fin');
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]!.aaId).toBe('finvu');
  });
});

describe('AA_DIRECTORY conformance', () => {
  it('every seeded entry validates against aa-directory.schema.json', () => {
    for (const entry of AA_DIRECTORY) {
      const res = validateAaDirectoryEntry(entry);
      expect(res.errors).toEqual([]);
      expect(res.valid).toBe(true);
    }
  });

  it('aaIds are unique', () => {
    const ids = AA_DIRECTORY.map((e) => e.aaId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('createMultiFiuClient', () => {
  it('requestConsent routes to the AA serving the customer handle', async () => {
    const calls: string[] = [];
    const multi = createMultiFiuClient({
      clients: {
        finvu: {
          baseUrl: 'https://finvu.example.com',
          dataConsumerId: 'dc-1',
          fetch: recordingFetch(calls, (_u, b) => consentOk('h1', (b as { txnid?: string } | undefined)?.txnid)),
        },
      },
    });
    const out = await multi.requestConsent('user@finvu', baseInput);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.ConsentHandle).toBe('h1');
    expect(calls).toEqual(['https://finvu.example.com/Consent']);
  });

  it('unresolvable handle returns CONFIG error with suggestions — never throws', async () => {
    const multi = createMultiFiuClient({ clients: {} });
    const out = await multi.requestConsent('user@finv', baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBeInstanceOf(FiuError);
      expect(out.error.code).toBe('CONFIG');
      expect(out.error.message).toContain('finvu');
    }
  });

  it('fan-out isolates failures — one AA down never sinks the others', async () => {
    const multi = createMultiFiuClient({
      clients: {
        finvu: {
          baseUrl: 'https://a.example.com',
          dataConsumerId: 'dc',
          fetch: recordingFetch([], (_u, b) => consentOk('h-a', (b as { txnid?: string } | undefined)?.txnid)),
        },
        onemoney: {
          baseUrl: 'https://b.example.com',
          dataConsumerId: 'dc',
          fetch: async () => ({ status: 500, json: async () => ({ error: 'down' }) }),
        },
      },
    });
    const out = await multi.requestConsentAcross(baseInput, ['finvu', 'onemoney']);
    expect(out).toHaveLength(2);
    const a = out.find((o) => o.aaId === 'finvu');
    const b = out.find((o) => o.aaId === 'onemoney');
    expect(a?.ok).toBe(true);
    expect(b?.ok).toBe(false);
    if (b && !b.ok) expect(b.error).toBeInstanceOf(FiuError);
  });

  it('reports per-AA latency via the injected clock', async () => {
    let t = 0;
    const multi = createMultiFiuClient({
      clock: () => (t += 7),
      clients: {
        finvu: {
          baseUrl: 'https://a.example.com',
          dataConsumerId: 'dc',
          fetch: recordingFetch([], (_u, b) => consentOk('h', (b as { txnid?: string } | undefined)?.txnid)),
        },
      },
    });
    const out = await multi.requestConsent('user@finvu', baseInput);
    expect(out.latencyMs).toBe(7);
  });

  it('bounds concurrency in fan-out', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow: FetchLike = async (_url, init) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      const reqTxn = init.body ? (JSON.parse(init.body) as { txnid?: string }).txnid : undefined;
      return { status: 200, json: async () => consentOk('h', reqTxn) };
    };
    const multi = createMultiFiuClient({
      maxConcurrency: 2,
      clients: {
        a: { baseUrl: 'https://a.x', dataConsumerId: 'dc', fetch: slow },
        b: { baseUrl: 'https://b.x', dataConsumerId: 'dc', fetch: slow },
        c: { baseUrl: 'https://c.x', dataConsumerId: 'dc', fetch: slow },
        d: { baseUrl: 'https://d.x', dataConsumerId: 'dc', fetch: slow },
        e: { baseUrl: 'https://e.x', dataConsumerId: 'dc', fetch: slow },
      },
    });
    const out = await multi.requestConsentAcross(baseInput);
    expect(out).toHaveLength(5);
    expect(out.every((o) => o.ok)).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('clientFor caches clients and throws CONFIG for unknown aaId', () => {
    const multi = createMultiFiuClient({
      clients: { finvu: { baseUrl: 'https://a.x', dataConsumerId: 'dc' } },
    });
    expect(multi.clientFor('finvu')).toBe(multi.clientFor('finvu'));
    expect(() => multi.clientFor('ghost')).toThrow(FiuError);
  });

  it('empty fan-out target throws CONFIG', () => {
    const multi = createMultiFiuClient({ clients: {} });
    expect(() => multi.requestConsentAcross(baseInput)).toThrow(FiuError);
  });

  it('decryptFiAcross runs the real wait+decrypt round-trip per AA session', async () => {
    // Two independent mock AAs — each does the full X25519/HKDF/AES round-trip.
    const mockA = makeMockAa({ sessionId: 's-a' });
    const mockB = makeMockAa({ sessionId: 's-b' });
    const multi = createMultiFiuClient({
      clients: {
        finvu: { baseUrl: 'https://a.x', dataConsumerId: 'dc', fetch: mockA.fetch },
        onemoney: { baseUrl: 'https://b.x', dataConsumerId: 'dc', fetch: mockB.fetch },
      },
    });

    // Drive each AA through consent → artefact → FI request so sessions exist.
    for (const aaId of ['finvu', 'onemoney'] as const) {
      const c = multi.clientFor(aaId);
      const { artefact, signedConsent } = await c.fetchConsentArtefact('c-42');
      const { sessionId } = await c.requestFi(artefact, baseInput.fiDataRange, signedConsent);
      expect(sessionId).toBe(aaId === 'finvu' ? 's-a' : 's-b');
    }

    const out = await multi.decryptFiAcross({ finvu: 's-a', onemoney: 's-b' });
    expect(out).toHaveLength(2);
    for (const o of out) {
      expect(o.ok).toBe(true);
      if (o.ok) {
        expect(o.value).toHaveLength(1);
        expect(o.value[0]!.isJson).toBe(true);
        expect(o.value[0]!.maskedAccNumber).toBe('XX1234');
      }
    }
  });

  it('decryptFiAcross isolates a failing session', async () => {
    const good = makeMockAa({ sessionId: 's-ok' });
    const multi = createMultiFiuClient({
      clients: {
        finvu: { baseUrl: 'https://a.x', dataConsumerId: 'dc', fetch: good.fetch },
        onemoney: {
          baseUrl: 'https://b.x',
          dataConsumerId: 'dc',
          fetch: async () => ({ status: 503, json: async () => ({ error: 'down' }) }),
        },
      },
    });
    const c = multi.clientFor('finvu');
    const { artefact, signedConsent } = await c.fetchConsentArtefact('c-42');
    await c.requestFi(artefact, baseInput.fiDataRange, signedConsent);

    const out = await multi.decryptFiAcross({ finvu: 's-ok', onemoney: 's-bad' });
    expect(out.find((o) => o.aaId === 'finvu')?.ok).toBe(true);
    const bad = out.find((o) => o.aaId === 'onemoney');
    expect(bad?.ok).toBe(false);
    if (bad && !bad.ok) expect(bad.error.code).toBe('HTTP');
  });

  it('decryptFiAcross surfaces a FAILED session as an error outcome, not an empty success', async () => {
    const good = makeMockAa({ sessionId: 's-ok' });
    // The failing AA accepts /FI/request but reports the session FAILED.
    const multi = createMultiFiuClient({
      clients: {
        finvu: { baseUrl: 'https://a.x', dataConsumerId: 'dc', fetch: good.fetch },
        onemoney: {
          baseUrl: 'https://b.x',
          dataConsumerId: 'dc',
          fetch: async (url) =>
            url.endsWith('/FI/request')
              ? { status: 200, json: async () => ({ sessionId: 's-dead' }) }
              : {
                  status: 200,
                  json: async () => ({ ver: '1', txnid: 't', sessionStatus: 'FAILED' }),
                },
        },
      },
    });
    const c = multi.clientFor('finvu');
    const { artefact, signedConsent } = await c.fetchConsentArtefact('c-42');
    await c.requestFi(artefact, baseInput.fiDataRange, signedConsent);
    const dead = multi.clientFor('onemoney');
    const { sessionId } = await dead.requestFi(
      { ...artefact, consentId: 'c-other' },
      baseInput.fiDataRange,
      signedConsent,
    );
    expect(sessionId).toBe('s-dead');

    const out = await multi.decryptFiAcross({ finvu: 's-ok', onemoney: 's-dead' });
    expect(out.find((o) => o.aaId === 'finvu')?.ok).toBe(true);
    const failed = out.find((o) => o.aaId === 'onemoney');
    expect(failed?.ok).toBe(false);
    if (failed && !failed.ok) {
      expect(failed.error.code).toBe('STATE');
      expect(failed.error.message).toMatch(/FAILED/);
    }
  });

  it('treats NaN maxConcurrency as the default instead of an empty worker pool', async () => {
    const okFetch: FetchLike = async (_url, init) => {
      const reqTxn = init.body ? (JSON.parse(init.body) as { txnid?: string }).txnid : undefined;
      return { status: 200, json: async () => consentOk('h', reqTxn).body };
    };
    const multi = createMultiFiuClient({
      clients: {
        finvu: { baseUrl: 'https://a.x', dataConsumerId: 'dc', fetch: okFetch },
        onemoney: { baseUrl: 'https://b.x', dataConsumerId: 'dc', fetch: okFetch },
      },
      maxConcurrency: Number.NaN,
    });
    const out = await multi.requestConsentAcross(baseInput);
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.ok)).toBe(true);
  });
});
