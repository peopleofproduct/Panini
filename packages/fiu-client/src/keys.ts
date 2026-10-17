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
import { FiuError, type FiuKeyMaterial, type KeyMaterial } from './types';

// DER prefixes for wrapping raw 32-byte X25519 key material.
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const X25519_KEY_LEN = 32;
const NONCE_LEN = 32;

export function decodeB64(value: string, field: string, expectedLen?: number): Buffer {
  let buf: Buffer;
  try {
    buf = Buffer.from(value, 'base64');
  } catch {
    throw new FiuError('CRYPTO', `${field} is not valid base64`);
  }
  if (expectedLen !== undefined && buf.length !== expectedLen) {
    throw new FiuError('CRYPTO', `${field} must decode to ${expectedLen} bytes, got ${buf.length}`);
  }
  return buf;
}

/** Generate a fresh ephemeral X25519 key pair + nonce for one FI request. */
export function generateFiuKeyMaterial(expiry?: string): FiuKeyMaterial {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-X25519_KEY_LEN);
  const privRaw = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-X25519_KEY_LEN);
  return {
    privateKeyB64: privRaw.toString('base64'),
    publicKeyB64: pubRaw.toString('base64'),
    nonceB64: crypto.randomBytes(NONCE_LEN).toString('base64'),
    expiry: expiry ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function importX25519Public(base64: string): crypto.KeyObject {
  const raw = decodeB64(base64, 'X25519 public key', X25519_KEY_LEN);
  return crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

export function importX25519Private(base64: string): crypto.KeyObject {
  const raw = decodeB64(base64, 'X25519 private key', X25519_KEY_LEN);
  return crypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** ECDH shared secret. Rejects low-order public keys (all-zero secret). */
export function deriveSharedSecret(privateKeyB64: string, remotePublicKeyB64: string): Buffer {
  let secret: Buffer;
  try {
    secret = crypto.diffieHellman({
      privateKey: importX25519Private(privateKeyB64),
      publicKey: importX25519Public(remotePublicKeyB64),
    });
  } catch (e) {
    throw new FiuError('CRYPTO', 'X25519 key agreement failed — invalid key material', e);
  }
  if (secret.every((b) => b === 0)) {
    throw new FiuError('CRYPTO', 'all-zero ECDH shared secret — low-order public key rejected');
  }
  return secret;
}

/** Wire-format KeyMaterial from generated FIU key material. */
export function toWireKeyMaterial(km: FiuKeyMaterial): KeyMaterial {
  return {
    cryptoAlg: 'ECDH',
    curve: 'Curve25519',
    params: 'AES/GCM/NoPadding',
    DHPublicKey: {
      expiry: km.expiry,
      Parameters: '',
      KeyValue: km.publicKeyB64,
    },
    Nonce: km.nonceB64,
  };
}
