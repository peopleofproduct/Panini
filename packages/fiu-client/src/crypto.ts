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
import { decodeB64, deriveSharedSecret } from './keys';
import { FiuError, type KeyMaterial } from './types';

// Per Sahamati Rahasya reference (CipherService.java):
//   HKDF salt  = first 20 bytes of XORed nonce
//   AES-GCM IV = last 12 bytes of XORed nonce (offset 20, len 12)
//   ciphertext layout = AES-256-GCM output with 16-byte auth tag appended
const HKDF_SALT_LEN = 20;
const GCM_IV_OFFSET = 20;
const GCM_IV_LEN = 12;
const GCM_TAG_LEN = 16;
const SESSION_KEY_LEN = 32;
const NONCE_LEN = HKDF_SALT_LEN + GCM_IV_LEN; // 32 bytes, per Rahasya

export function xorNonces(fiuNonceB64: string, fipNonceB64: string): Buffer {
  const a = decodeB64(fiuNonceB64, 'FIU nonce');
  const b = decodeB64(fipNonceB64, 'FIP nonce');
  // Both sides must carry the spec-mandated 32-byte nonce; wrapping a
  // short nonce (the old modulo behaviour) would derive a spec-noncompliant
  // session key instead of rejecting malformed peer material.
  if (a.length !== NONCE_LEN || b.length !== NONCE_LEN) {
    throw new FiuError(
      'CRYPTO',
      `nonce length mismatch — expected ${NONCE_LEN} bytes each, got FIU=${a.length}, FIP=${b.length}`,
    );
  }
  const out = Buffer.alloc(NONCE_LEN);
  for (let i = 0; i < NONCE_LEN; i++) {
    out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return out;
}

/** HKDF-SHA256(sharedSecret, salt=xoredNonce[0:20], info=null) → 32-byte AES key. */
export function deriveSessionKey(sharedSecret: Buffer, xoredNonce: Buffer): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      sharedSecret,
      xoredNonce.subarray(0, HKDF_SALT_LEN),
      Buffer.alloc(0),
      SESSION_KEY_LEN,
    ),
  );
}

function validateKeyMaterial(km: KeyMaterial): void {
  if (km.cryptoAlg !== 'ECDH' || km.curve !== 'Curve25519' || km.params !== 'AES/GCM/NoPadding') {
    throw new FiuError(
      'CRYPTO',
      `unsupported KeyMaterial ${km.cryptoAlg}/${km.curve}/${km.params} — expected ECDH/Curve25519/AES/GCM/NoPadding`,
    );
  }
}

/**
 * Decrypt one AA `encryptedFI` block.
 *   sharedSecret = X25519(fiuPrivate, fipPublic)
 *   sessionKey   = HKDF-SHA256(sharedSecret, xor(nonce_fiu, nonce_fip)[0:20])
 *   plaintext    = AES-256-GCM(sessionKey, iv=xor[20:32]) over ciphertext+tag
 */
export function decryptFi(
  encryptedFiB64: string,
  fipKeyMaterial: KeyMaterial,
  fiuPrivateKeyB64: string,
  fiuNonceB64: string,
): Buffer {
  validateKeyMaterial(fipKeyMaterial);
  const expiryMs = new Date(fipKeyMaterial.DHPublicKey.expiry).getTime();
  // NaN (unparseable expiry) previously slipped through the comparison —
  // treat it as invalid rather than unexpired.
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    throw new FiuError(
      'CRYPTO',
      `FIP public key has invalid or expired expiry '${fipKeyMaterial.DHPublicKey.expiry}'`,
    );
  }
  const sharedSecret = deriveSharedSecret(fiuPrivateKeyB64, fipKeyMaterial.DHPublicKey.KeyValue);
  const xored = xorNonces(fiuNonceB64, fipKeyMaterial.Nonce);
  const sessionKey = deriveSessionKey(sharedSecret, xored);
  const iv = xored.subarray(GCM_IV_OFFSET, GCM_IV_OFFSET + GCM_IV_LEN);

  const blob = decodeB64(encryptedFiB64, 'encryptedFI');
  if (blob.length <= GCM_TAG_LEN) {
    throw new FiuError('CRYPTO', `encryptedFI too short (${blob.length} bytes)`);
  }
  const ciphertext = blob.subarray(0, blob.length - GCM_TAG_LEN);
  const tag = blob.subarray(blob.length - GCM_TAG_LEN);

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv, {
      authTagLength: GCM_TAG_LEN,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new FiuError(
      'CRYPTO',
      'AES-GCM authentication failed — ciphertext tampered with, or wrong key material/nonces',
    );
  }
}

/** Encrypt side — FIP-side tooling for sandboxes/simulators and round-trip
 *  interop tests. Mirrors {@link decryptFi} exactly. */
export function encryptFi(
  plaintext: Buffer | string,
  fipPrivateKeyB64: string,
  fipNonceB64: string,
  fiuPublicKeyB64: string,
  fiuNonceB64: string,
): Buffer {
  const sharedSecret = deriveSharedSecret(fipPrivateKeyB64, fiuPublicKeyB64);
  const xored = xorNonces(fipNonceB64, fiuNonceB64);
  return encryptWithSecrets(plaintext, sharedSecret, xored);
}

function encryptWithSecrets(
  plaintext: Buffer | string,
  sharedSecret: Buffer,
  xored: Buffer,
): Buffer {
  const sessionKey = deriveSessionKey(sharedSecret, xored);
  const iv = xored.subarray(GCM_IV_OFFSET, GCM_IV_OFFSET + GCM_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv, {
    authTagLength: GCM_TAG_LEN,
  });
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
}
