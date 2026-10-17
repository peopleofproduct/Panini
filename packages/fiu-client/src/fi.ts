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
import { decryptFi } from './crypto';
import { toWireKeyMaterial } from './keys';
import {
  FiuError,
  type DecryptedFi,
  type FiFetchResponse,
  type FiRequestBody,
  type FiuKeyMaterial,
} from './types';

/**
 * Build a POST /FI/request body. `keyMaterial` is the FIU's ephemeral
 * Curve25519 material — keep `privateKeyB64`/`nonceB64` for the matching
 * {@link decryptFiResponse} call; they never leave this process.
 */
export function buildFiRequest(
  consentId: string,
  digitalSignature: string,
  fiDataRange: { readonly from: string; readonly to: string },
  keyMaterial: FiuKeyMaterial,
): FiRequestBody {
  if (!consentId) throw new FiuError('CONFIG', 'consentId is required');
  if (!digitalSignature)
    throw new FiuError('CONFIG', 'digitalSignature (signed consent) is required');
  if (Date.parse(fiDataRange.from) >= Date.parse(fiDataRange.to)) {
    throw new FiuError('CONFIG', 'FIDataRange.from must be before FIDataRange.to');
  }
  return {
    ver: '2.0.0',
    timestamp: new Date().toISOString(),
    txnid: crypto.randomUUID(),
    FIDataRange: fiDataRange,
    Consent: { id: consentId, digitalSignature },
    KeyMaterial: toWireKeyMaterial(keyMaterial),
  };
}

/**
 * Decrypt every FI block in a /FI/fetch response using the FIU private key
 * and nonce that were sent in the matching /FI/request. Each block carries
 * its own FIP KeyMaterial (ephemeral FIP key + nonce).
 *
 * JSON payloads are parsed; non-JSON payloads (ReBIT FI XML) are returned as
 * strings — hand them to your XML/seam layer.
 */
export function decryptFiResponse(
  response: FiFetchResponse,
  fiuPrivateKeyB64: string,
  fiuNonceB64: string,
): DecryptedFi[] {
  const out: DecryptedFi[] = [];
  for (const section of response.FIData ?? []) {
    if (!section.KeyMaterial) {
      throw new FiuError('SCHEMA', 'FI section missing FIP KeyMaterial');
    }
    for (const item of section.data) {
      if (typeof item.encryptedFI !== 'string' || item.encryptedFI.length === 0) {
        throw new FiuError('SCHEMA', `FI block ${item.linkRefNumber} has empty encryptedFI`);
      }
      const plain = decryptFi(item.encryptedFI, section.KeyMaterial, fiuPrivateKeyB64, fiuNonceB64);
      const text = plain.toString('utf8');
      let payload: unknown = text;
      let isJson = false;
      try {
        payload = JSON.parse(text);
        isJson = true;
      } catch {
        /* XML or other payload — returned raw */
      }
      out.push({
        linkRefNumber: item.linkRefNumber,
        maskedAccNumber: item.maskedAccNumber,
        payload,
        isJson,
      });
    }
  }
  return out;
}
