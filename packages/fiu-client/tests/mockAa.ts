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
import { generateFiuKeyMaterial } from '../src';
import type { FetchLike } from '../src';
import type { KeyMaterial } from '../src';

// ---------------------------------------------------------------------------
// Independent spec-side encryptor — written from Sahamati Rahasya's
// CipherService.java (manual HKDF extract+expand, not our helpers), so a bug
// in our derivation can't cancel itself out in tests.
// ---------------------------------------------------------------------------

const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

function pubKeyObj(b64: string) {
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(b64, 'base64')]),
    format: 'der',
    type: 'spki',
  });
}
function privKeyObj(b64: string) {
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(b64, 'base64')]),
    format: 'der',
    type: 'pkcs8',
  });
}

function hkdfManual(ikm: Buffer, salt: Buffer): Buffer {
  // RFC 5869 extract+expand, info = empty, L = 32 — mirrors BC's HKDFParameters(secret, salt, null)
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto
    .createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.alloc(0), Buffer.from([1])]))
    .digest();
}

export function fipEncrypt(
  plaintext: string,
  fipPriv: string,
  fipNonce: string,
  fiuPub: string,
  fiuNonce: string,
): string {
  const secret = crypto.diffieHellman({
    privateKey: privKeyObj(fipPriv),
    publicKey: pubKeyObj(fiuPub),
  });
  const a = Buffer.from(fipNonce, 'base64');
  const b = Buffer.from(fiuNonce, 'base64');
  const xored = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) xored[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  const sessionKey = hkdfManual(secret, xored.subarray(0, 20));
  const iv = xored.subarray(20, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]).toString('base64');
}

export function fipKeyMaterial(pub: string, nonce: string, expiry?: string): KeyMaterial {
  return {
    cryptoAlg: 'ECDH',
    curve: 'Curve25519',
    params: 'AES/GCM/NoPadding',
    DHPublicKey: {
      expiry: expiry ?? new Date(Date.now() + 3600_000).toISOString(),
      Parameters: '',
      KeyValue: pub,
    },
    Nonce: nonce,
  };
}

export const FI_JSON = JSON.stringify({
  account: { linkedAccRef: 'lnk1', maskedAccNumber: 'XXXX1234', type: 'deposit' },
  Transactions: {
    Transaction: [
      {
        txnId: 't1',
        amount: '1000',
        narration: 'UPI/DR/SWIGGY',
        type: 'DEBIT',
        mode: 'UPI',
        valueDate: '2024-06-01',
        currentBalance: '50000',
      },
    ],
  },
});

/**
 * A full mock AA speaking the real protocol: signs consent artefacts (RS256),
 * decrypts FI requests to recover FIU key material, and encrypts the FI
 * payload as a FIP would. Use for any test that needs a wire-level round-trip
 * without a live AA.
 */
export function makeMockAa(opts?: { sessionId?: string; fiJson?: string }) {
  const sessionId = opts?.sessionId ?? 's-9';
  const fiJson = opts?.fiJson ?? FI_JSON;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const aaPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const fip = generateFiuKeyMaterial();
  const requests: { url: string; body?: unknown }[] = [];
  let lastEncrypted = '';

  const artefact = {
    consentId: 'c-42',
    status: 'ACTIVE',
    createTimestamp: '2024-06-01T00:00:00.000Z',
  };

  function signJws(payload: object): string {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
  }

  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    requests.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    if (path === '/Consent') {
      // Per spec the response txnid echoes the request's.
      const reqTxn = (JSON.parse(init.body ?? '{}') as { txnid?: string }).txnid ?? 'x';
      return {
        status: 200,
        json: async () => ({
          ConsentHandle: 'h-1',
          ConsentStatus: { id: 'c-42', status: 'PENDING' },
          ver: '2.0.0',
          timestamp: '',
          txnid: reqTxn,
        }),
      };
    }
    if (path === '/Consent/c-42') {
      return { status: 200, json: async () => ({ signedConsent: signJws(artefact) }) };
    }
    if (path === '/FI/request') {
      const body = JSON.parse(init.body ?? '{}') as {
        KeyMaterial: { DHPublicKey: { KeyValue: string }; Nonce: string };
        txnid?: string;
      };
      lastEncrypted = fipEncrypt(
        fiJson,
        fip.privateKeyB64,
        fip.nonceB64,
        body.KeyMaterial.DHPublicKey.KeyValue,
        body.KeyMaterial.Nonce,
      );
      return {
        status: 200,
        json: async () => ({
          sessionId,
          ConsentId: 'c-42',
          ver: '2.0.0',
          timestamp: '',
          txnid: body.txnid ?? 'x',
        }),
      };
    }
    if (path === `/FI/fetch/${sessionId}`) {
      return {
        status: 200,
        json: async () => ({
          ver: '2.0.0',
          timestamp: '',
          txnid: 'x',
          sessionStatus: 'COMPLETED',
          FIData: [
            {
              KeyMaterial: fipKeyMaterial(fip.publicKeyB64, fip.nonceB64),
              data: [
                { linkRefNumber: 'l1', maskedAccNumber: 'XX1234', encryptedFI: lastEncrypted },
              ],
            },
          ],
        }),
      };
    }
    return { status: 404, json: async () => ({ error: 'not found' }) };
  };

  return { fetch, requests, artefact, signJws, aaPem, fip, sessionId };
}
