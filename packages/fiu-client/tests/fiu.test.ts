/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import crypto from 'node:crypto';
import {
  buildConsentRequest,
  buildFiRequest,
  createFiuClient,
  decodeB64,
  decryptFi,
  decryptFiResponse,
  deriveSharedSecret,
  encryptFi,
  FiuError,
  generateFiuKeyMaterial,
  parseConsentArtefact,
  suggestAas,
  validateConsentNotification,
  consentNotificationAck,
  toWireKeyMaterial,
  verifyJws,
  xorNonces,
  type FiFetchResponse,
  type KeyMaterial,
} from '@paniniapi/fiu-client';
import { FI_JSON, fipEncrypt, fipKeyMaterial, makeMockAa } from './mockAa';

describe('key material', () => {
  it('generates 32-byte X25519 material + nonce with expiry', () => {
    const km = generateFiuKeyMaterial();
    expect(Buffer.from(km.privateKeyB64, 'base64')).toHaveLength(32);
    expect(Buffer.from(km.publicKeyB64, 'base64')).toHaveLength(32);
    expect(Buffer.from(km.nonceB64, 'base64')).toHaveLength(32);
    expect(Date.parse(km.expiry)).toBeGreaterThan(Date.now());
  });

  it('produces wire-format KeyMaterial per spec', () => {
    const wire = toWireKeyMaterial(generateFiuKeyMaterial());
    expect(wire).toMatchObject({
      cryptoAlg: 'ECDH',
      curve: 'Curve25519',
      params: 'AES/GCM/NoPadding',
    });
    expect(wire.DHPublicKey.Parameters).toBe('');
    expect(wire.DHPublicKey.KeyValue).toHaveLength(44); // 32-byte base64
  });

  it('derives identical shared secrets on both sides (ECDH symmetry)', () => {
    const a = generateFiuKeyMaterial();
    const b = generateFiuKeyMaterial();
    expect(deriveSharedSecret(a.privateKeyB64, b.publicKeyB64)).toEqual(
      deriveSharedSecret(b.privateKeyB64, a.publicKeyB64),
    );
  });

  it('rejects low-order (all-zero) public keys', () => {
    const a = generateFiuKeyMaterial();
    expect(() => deriveSharedSecret(a.privateKeyB64, Buffer.alloc(32).toString('base64'))).toThrow(
      FiuError,
    );
  });
});

describe('FI decryption (Rahasya-compatible)', () => {
  const fiu = generateFiuKeyMaterial();
  const fip = generateFiuKeyMaterial();

  it('decrypts FI data encrypted by an independent spec-side encryptor', () => {
    const enc = fipEncrypt(
      FI_JSON,
      fip.privateKeyB64,
      fip.nonceB64,
      fiu.publicKeyB64,
      fiu.nonceB64,
    );
    const plain = decryptFi(
      enc,
      fipKeyMaterial(fip.publicKeyB64, fip.nonceB64),
      fiu.privateKeyB64,
      fiu.nonceB64,
    );
    expect(plain.toString('utf8')).toBe(FI_JSON);
  });

  it('our own encryptFi round-trips (FIP-side tooling)', () => {
    const enc = encryptFi(
      'hello fiu',
      fip.privateKeyB64,
      fip.nonceB64,
      fiu.publicKeyB64,
      fiu.nonceB64,
    );
    const dec = decryptFi(
      enc.toString('base64'),
      fipKeyMaterial(fip.publicKeyB64, fip.nonceB64),
      fiu.privateKeyB64,
      fiu.nonceB64,
    );
    expect(dec.toString('utf8')).toBe('hello fiu');
  });

  it('rejects tampered ciphertext (GCM auth failure)', () => {
    const enc = Buffer.from(
      fipEncrypt(FI_JSON, fip.privateKeyB64, fip.nonceB64, fiu.publicKeyB64, fiu.nonceB64),
      'base64',
    );
    enc[5] = (enc[5] ?? 0) ^ 0xff;
    expect(() =>
      decryptFi(
        enc.toString('base64'),
        fipKeyMaterial(fip.publicKeyB64, fip.nonceB64),
        fiu.privateKeyB64,
        fiu.nonceB64,
      ),
    ).toThrow(/authentication failed/);
  });

  it('rejects expired FIP keys, wrong-size keys, bad base64, and wrong algorithms', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(() =>
      decryptFi(
        'AAAA',
        fipKeyMaterial(fip.publicKeyB64, fip.nonceB64, past),
        fiu.privateKeyB64,
        fiu.nonceB64,
      ),
    ).toThrow(/expired/);
    expect(() =>
      decryptFi(
        'AAAA',
        fipKeyMaterial(Buffer.alloc(8).toString('base64'), fip.nonceB64),
        fiu.privateKeyB64,
        fiu.nonceB64,
      ),
    ).toThrow(FiuError);
    expect(() =>
      decryptFi(
        'AAAA',
        { ...fipKeyMaterial(fip.publicKeyB64, fip.nonceB64), curve: 'P-256' } as KeyMaterial,
        fiu.privateKeyB64,
        fiu.nonceB64,
      ),
    ).toThrow(/unsupported/);
  });
});

describe('JWS + consent artefact', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

  function sign(payload: object): string {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey)
      .toString('base64url');
    return `${h}.${p}.${sig}`;
  }

  const artefact = {
    consentId: 'c-123',
    status: 'ACTIVE',
    createTimestamp: new Date().toISOString(),
  };

  it('decodes and verifies a signed artefact (RS256)', () => {
    const jws = sign(artefact);
    const parsed = parseConsentArtefact(jws, pem);
    expect(parsed.signature).toBe('verified');
    expect(parsed.artefact.consentId).toBe('c-123');
    expect(verifyJws(jws, pem)).toBe(true);
  });

  it('accepts base64-wrapped JWS (some AAs ship it double-encoded)', () => {
    const jws = sign(artefact);
    const parsed = parseConsentArtefact(Buffer.from(jws).toString('base64'), pem);
    expect(parsed.signature).toBe('verified');
  });

  it('returns invalid on tampered payload', () => {
    const [h, , sig] = sign(artefact).split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...artefact, consentId: 'evil' })).toString('base64url')}.${sig}`;
    const parsed = parseConsentArtefact(tampered, pem);
    expect(parsed.artefact.consentId).toBe('evil');
    expect(parsed.signature).toBe('invalid');
  });

  it('decodes unverified when no key supplied', () => {
    expect(parseConsentArtefact(sign(artefact)).signature).toBe('unverified');
  });

  it('rejects alg=none and malformed JWS', () => {
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.AA`;
    expect(() => verifyJws(none, pem)).toThrow(/refusing/);
    expect(() => parseConsentArtefact('not.a-jws-at-all')).toThrow(FiuError);
  });
});

describe('request builders', () => {
  const base = {
    customerId: 'cust@aa',
    consentStart: '2024-01-01T00:00:00.000Z',
    consentExpiry: '2025-01-01T00:00:00.000Z',
    fiDataRange: { from: '2024-01-01T00:00:00.000Z', to: '2024-12-31T00:00:00.000Z' },
    consentMode: 'STORE' as const,
    fetchType: 'PERIODIC' as const,
    consentTypes: ['TRANSACTIONS' as const],
    fiTypes: ['DEPOSIT'],
    purpose: { code: '101' },
    dataLife: { unit: 'MONTH' as const, value: 12 },
    frequency: { unit: 'MONTH' as const, value: 1 },
  };

  it('builds a spec-shaped consent request', () => {
    const body = buildConsentRequest(base, 'fiu-1');
    expect(body.ver).toBe('2.0.0');
    expect(body.ConsentDetail.DataConsumer.id).toBe('fiu-1');
    expect(body.ConsentDetail.fiTypes).toEqual(['DEPOSIT']);
  });

  it('rejects inverted expiry and empty fiTypes', () => {
    expect(() =>
      buildConsentRequest({ ...base, consentExpiry: '2023-01-01T00:00:00.000Z' }, 'f'),
    ).toThrow(FiuError);
    expect(() => buildConsentRequest({ ...base, fiTypes: [] }, 'f')).toThrow(FiuError);
  });

  it('builds FI request with wire KeyMaterial', () => {
    const km = generateFiuKeyMaterial();
    const req = buildFiRequest('c-1', 'sig', base.fiDataRange, km);
    expect(req.Consent.id).toBe('c-1');
    expect(req.KeyMaterial.Nonce).toBe(km.nonceB64);
    expect(req.FIDataRange).toEqual(base.fiDataRange);
  });

  it('rejects inverted FI date range', () => {
    expect(() =>
      buildFiRequest(
        'c',
        's',
        { from: '2025-01-01T00:00:00Z', to: '2024-01-01T00:00:00Z' },
        generateFiuKeyMaterial(),
      ),
    ).toThrow(FiuError);
  });
});

describe('decryptFiResponse', () => {
  it('decrypts multi-block responses and flags JSON payloads', () => {
    const fiu = generateFiuKeyMaterial();
    const fip = generateFiuKeyMaterial();
    const xml = '<Account><Transactions/></Account>';
    const res: FiFetchResponse = {
      ver: '2.0.0',
      timestamp: new Date().toISOString(),
      txnid: 't',
      FIData: [
        {
          KeyMaterial: fipKeyMaterial(fip.publicKeyB64, fip.nonceB64),
          data: [
            {
              linkRefNumber: 'l1',
              maskedAccNumber: 'XX1234',
              encryptedFI: fipEncrypt(
                FI_JSON,
                fip.privateKeyB64,
                fip.nonceB64,
                fiu.publicKeyB64,
                fiu.nonceB64,
              ),
            },
            {
              linkRefNumber: 'l2',
              maskedAccNumber: 'XX5678',
              encryptedFI: fipEncrypt(
                xml,
                fip.privateKeyB64,
                fip.nonceB64,
                fiu.publicKeyB64,
                fiu.nonceB64,
              ),
            },
          ],
        },
      ],
    };
    const out = decryptFiResponse(res, fiu.privateKeyB64, fiu.nonceB64);
    expect(out).toHaveLength(2);
    expect(out[0]?.isJson).toBe(true);
    expect(
      (out[0]?.payload as { Transactions: { Transaction: unknown[] } }).Transactions.Transaction,
    ).toHaveLength(1);
    expect(out[1]?.isJson).toBe(false);
    expect(out[1]?.payload).toBe(xml);
  });

  it('throws on missing KeyMaterial and empty encryptedFI', () => {
    const bad: FiFetchResponse = {
      ver: '2.0.0',
      timestamp: '',
      txnid: '',
      FIData: [
        {
          data: [{ linkRefNumber: 'x', maskedAccNumber: 'y', encryptedFI: '' }],
          KeyMaterial: undefined as unknown as KeyMaterial,
        },
      ],
    };
    expect(() => decryptFiResponse(bad, 'a', 'b')).toThrow(FiuError);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a mock AA speaking the real wire protocol.
// ---------------------------------------------------------------------------

describe('FiuClient E2E against mock AA', () => {
  const mock = makeMockAa();
  const { aaPem, signJws, artefact, requests } = mock;
  const fetchImpl = mock.fetch;

  const consentInput = {
    customerId: 'cust@aa',
    consentStart: '2024-01-01T00:00:00.000Z',
    consentExpiry: '2025-01-01T00:00:00.000Z',
    fiDataRange: { from: '2024-01-01T00:00:00.000Z', to: '2024-12-31T00:00:00.000Z' },
    consentMode: 'STORE' as const,
    fetchType: 'ONETIME' as const,
    consentTypes: ['TRANSACTIONS' as const],
    fiTypes: ['DEPOSIT'],
    purpose: { code: '101' },
    dataLife: { unit: 'MONTH' as const, value: 12 },
    frequency: { unit: 'MONTH' as const, value: 1 },
  };

  it('runs the full consent → fetch → decrypt flow', async () => {
    const client = createFiuClient({
      baseUrl: 'https://aa.test',
      dataConsumerId: 'fiu-1',
      fetch: fetchImpl,
    });

    const handle = await client.requestConsent(consentInput);
    expect(handle.ConsentHandle).toBe('h-1');
    expect(requests[0]?.url).toBe('https://aa.test/Consent');

    const { artefact: art, signature } = await client.fetchConsentArtefact('c-42', aaPem);
    expect(signature).toBe('verified');
    expect(art.status).toBe('ACTIVE');

    const { sessionId } = await client.requestFi(art, consentInput.fiDataRange, signJws(art));
    expect(sessionId).toBe('s-9');

    const blocks = await client.fetchAndDecryptFi(sessionId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.isJson).toBe(true);
  });

  it('validates FI payloads via injected validator', async () => {
    const client = createFiuClient({
      baseUrl: 'https://aa.test',
      dataConsumerId: 'fiu-1',
      fetch: fetchImpl,
    });
    const { sessionId } = await client.requestFi(
      artefact,
      consentInput.fiDataRange,
      signJws(artefact),
    );
    const validate = jest.fn().mockReturnValue({ valid: true, errors: [] });
    await client.fetchAndDecryptFi(sessionId, validate, 'DEPOSIT');
    expect(validate).toHaveBeenCalledWith('DEPOSIT', expect.any(Object));
  });

  it('rejects FI requests on non-ACTIVE consent', async () => {
    const client = createFiuClient({
      baseUrl: 'https://aa.test',
      dataConsumerId: 'fiu-1',
      fetch: fetchImpl,
    });
    await expect(
      client.requestFi({ ...artefact, status: 'REVOKED' }, consentInput.fiDataRange, 'sig'),
    ).rejects.toThrow(/REVOKED/);
  });

  it('rejects decrypting unknown sessions', async () => {
    const client = createFiuClient({
      baseUrl: 'https://aa.test',
      dataConsumerId: 'fiu-1',
      fetch: fetchImpl,
    });
    await expect(client.fetchAndDecryptFi('nope')).rejects.toThrow(/no key material/);
  });

  it('maps HTTP errors to FiuError', async () => {
    const client = createFiuClient({
      baseUrl: 'https://aa.test',
      dataConsumerId: 'fiu-1',
      fetch: fetchImpl,
    });
    await expect(client.fetchFi('missing')).rejects.toThrow(/HTTP 404/);
  });
});

describe('audit-fix regressions', () => {
  const activeArtefact = {
    consentId: 'c-audit',
    status: 'ACTIVE',
    createTimestamp: new Date().toISOString(),
  } as const;

  function clientWithFetch(respond: (url: string) => { status: number; body: unknown }) {
    return createFiuClient({
      baseUrl: 'https://aa.test',
      dataConsumerId: 'fiu-1',
      fetch: async (url) => {
        const r = respond(url);
        return { status: r.status, json: async () => r.body };
      },
    });
  }

  it('surfaces a FAILED FI session as an error, never an empty success', async () => {
    const client = clientWithFetch((url) =>
      url.endsWith('/FI/request')
        ? { status: 200, body: { sessionId: 's-fail' } }
        : { status: 200, body: { ver: '1', txnid: 't', sessionStatus: 'FAILED' } },
    );
    const { sessionId } = await client.requestFi(
      activeArtefact,
      { from: '2024-01-01', to: '2024-12-31' },
      'sig',
    );
    await expect(client.fetchAndDecryptFi(sessionId)).rejects.toThrow(/FAILED/);
  });

  it('discards session key material after the first decrypt', async () => {
    const client = clientWithFetch((url) =>
      url.endsWith('/FI/request')
        ? { status: 200, body: { sessionId: 's-once' } }
        : { status: 200, body: { ver: '1', txnid: 't', sessionStatus: 'COMPLETED', FIData: [] } },
    );
    const { sessionId } = await client.requestFi(
      activeArtefact,
      { from: '2024-01-01', to: '2024-12-31' },
      'sig',
    );
    await client.fetchAndDecryptFi(sessionId); // first decrypt succeeds
    await expect(client.fetchAndDecryptFi(sessionId)).rejects.toThrow(/no key material/);
  });

  it('rejects nonce length mismatches instead of wrapping short nonces', () => {
    const full = Buffer.alloc(32, 0x41).toString('base64');
    const short = Buffer.alloc(16, 0x42).toString('base64');
    expect(() => xorNonces(full, short)).toThrow(/nonce length mismatch/);
    expect(() => xorNonces(short, full)).toThrow(/nonce length mismatch/);
  });

  it('rejects non-base64 alphabets strictly (no silent character drops)', () => {
    expect(() => decodeB64('not!!base64', 'test')).toThrow(/not valid base64/);
    expect(() => decodeB64('a-b_c', 'test')).toThrow(/not valid base64/);
    expect(decodeB64('QUJD', 'test').toString()).toBe('ABC');
  });

  it('suggestAas returns nothing for empty handles', () => {
    expect(suggestAas('')).toEqual([]);
    expect(suggestAas('   ')).toEqual([]);
    expect(suggestAas('@').length).toBe(0);
  });
});

describe('certification-surface hardening', () => {
  const now = new Date('2026-10-20T10:00:00.000Z');

  function notification(over: Record<string, unknown> = {}) {
    return {
      ver: '2.0.0',
      timestamp: now.toISOString(),
      txnid: 'txn-notify-1',
      Notifier: { type: 'AA', id: 'finvu' },
      ConsentStatusNotification: {
        consentId: 'c-1',
        consentHandle: 'h-1',
        consentStatus: 'ACTIVE',
      },
      ...over,
    };
  }

  it('accepts a well-formed notification and extracts the fields', () => {
    const v = validateConsentNotification(notification(), {
      allowedNotifierIds: ['finvu'],
      now,
    });
    expect(v.ok).toBe(true);
    expect(v.consentId).toBe('c-1');
    expect(v.consentStatus).toBe('ACTIVE');
    const ack = consentNotificationAck(v.txnid!);
    expect(ack.txnid).toBe('txn-notify-1');
    expect(ack.response).toBe('OK');
  });

  it('rejects wrong spec version with NoSuchVersion (404)', () => {
    const v = validateConsentNotification(notification({ ver: '9.9.9' }), { now });
    expect(v.rejection).toMatchObject({ httpStatus: 404, errorCode: 'NoSuchVersion' });
  });

  it('rejects stale timestamps — replay window is 15 min', () => {
    const stale = notification({ timestamp: '2026-10-20T09:30:00.000Z' });
    const v = validateConsentNotification(stale, { now });
    expect(v.rejection).toMatchObject({ errorCode: 'InvalidRequest' });
  });

  it('rejects non-AA notifier types and unlisted notifier ids', () => {
    const fip = validateConsentNotification(notification({ Notifier: { type: 'FIP', id: 'x' } }), {
      now,
    });
    expect(fip.rejection).toMatchObject({ errorCode: 'InvalidNotifier' });
    const rogue = validateConsentNotification(notification(), {
      allowedNotifierIds: ['onemoney'],
      now,
    });
    expect(rogue.rejection).toMatchObject({ errorCode: 'InvalidNotifier' });
  });

  it('rejects missing consentId / handle / unknown status', () => {
    const noId = notification({
      ConsentStatusNotification: { consentHandle: 'h', consentStatus: 'ACTIVE' },
    });
    expect(validateConsentNotification(noId, { now }).rejection).toMatchObject({
      errorCode: 'InvalidConsentId',
    });
    const noHandle = notification({
      ConsentStatusNotification: { consentId: 'c', consentStatus: 'ACTIVE' },
    });
    expect(validateConsentNotification(noHandle, { now }).rejection).toMatchObject({
      errorCode: 'InvalidConsentHandle',
    });
    const badStatus = notification({
      ConsentStatusNotification: { consentId: 'c', consentHandle: 'h', consentStatus: 'MAYBE' },
    });
    expect(validateConsentNotification(badStatus, { now }).rejection).toMatchObject({
      errorCode: 'InvalidConsentStatus',
    });
  });

  it('discards responses whose txnid does not echo the request', async () => {
    const client = createFiuClient({
      baseUrl: 'https://aa.test',
      dataConsumerId: 'fiu-1',
      fetch: async () => ({
        status: 200,
        json: async () => ({ ver: '2.0.0', txnid: 'not-ours', ConsentHandle: 'h' }),
      }),
    });
    await expect(
      client.requestConsent({
        customerId: 'u@finvu',
        consentStart: '2026-01-01T00:00:00Z',
        consentExpiry: '2028-01-01T00:00:00Z',
        fiDataRange: { from: '2024-01-01', to: '2026-01-01' },
        consentMode: 'STORE',
        fetchType: 'ONETIME',
        consentTypes: ['TRANSACTIONS'],
        fiTypes: ['DEPOSIT'],
        purpose: { code: '101' },
        dataLife: { unit: 'MONTH', value: 6 },
        frequency: { unit: 'MONTH', value: 1 },
      }),
    ).rejects.toThrow(/does not echo request txnid/);
  });

  it('sends the configured specVersion and probes heartbeat', async () => {
    let capturedBody = '';
    const client = createFiuClient({
      baseUrl: 'https://aa.test',
      dataConsumerId: 'fiu-1',
      specVersion: '2.1.0',
      fetch: async (url, init) => {
        capturedBody = init.body ?? '';
        return { status: 200, json: async () => ({ Status: 'UP' }) };
      },
    });
    await client.requestConsent({
      customerId: 'u@finvu',
      consentStart: '2026-01-01T00:00:00Z',
      consentExpiry: '2028-01-01T00:00:00Z',
      fiDataRange: { from: '2024-01-01', to: '2026-01-01' },
      consentMode: 'STORE',
      fetchType: 'ONETIME',
      consentTypes: ['TRANSACTIONS'],
      fiTypes: ['DEPOSIT'],
      purpose: { code: '101' },
      dataLife: { unit: 'MONTH', value: 6 },
      frequency: { unit: 'MONTH', value: 1 },
    });
    expect(JSON.parse(capturedBody).ver).toBe('2.1.0');
    expect(await client.heartbeat()).toEqual({ Status: 'UP' });
  });
});
