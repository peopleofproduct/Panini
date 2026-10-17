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
import { FiuError } from './types';

export interface DecodedJws {
  readonly header: Record<string, unknown>;
  /** Raw payload bytes (usually UTF-8 JSON). */
  readonly payload: Buffer;
  readonly signature: Buffer;
  /** header.payload — the exact bytes that were signed. */
  readonly signingInput: string;
}

function b64urlDecode(seg: string, what: string): Buffer {
  try {
    return Buffer.from(seg, 'base64url');
  } catch {
    throw new FiuError('JWS', `invalid base64url in ${what}`);
  }
}

/** Decode a compact JWS — never throws on signature validity (that is
 *  {@link verifyJws}'s job), only on malformed structure. */
export function decodeJws(compact: string): DecodedJws {
  const parts = compact.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new FiuError('JWS', `malformed JWS — expected 3 segments, got ${parts.length}`);
  }
  const headerBuf = b64urlDecode(parts[0] ?? '', 'header');
  let header: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(headerBuf.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not object');
    header = parsed as Record<string, unknown>;
  } catch {
    throw new FiuError('JWS', 'JWS header is not valid JSON');
  }
  return {
    header,
    payload: b64urlDecode(parts[1] ?? '', 'payload'),
    signature: b64urlDecode(parts[2] ?? '', 'signature'),
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

/**
 * Verify a compact JWS. Supports RS256/RS384/RS512 (PEM or JWK key) and
 * ES256/ES384/ES512 (JWK or PEM EC key). The `none` alg is always rejected.
 */
export function verifyJws(compact: string, key: string | crypto.JsonWebKey): boolean {
  const jws = decodeJws(compact);
  const alg = jws.header['alg'];
  if (typeof alg !== 'string' || alg === 'none') {
    throw new FiuError('JWS', `refusing to verify JWS with alg=${String(alg)}`);
  }

  const keyObject =
    typeof key === 'string'
      ? crypto.createPublicKey(key)
      : crypto.createPublicKey({ key, format: 'jwk' });

  if (alg.startsWith('RS') || alg.startsWith('PS')) {
    const hash = `RSA-SHA${alg.slice(2)}`;
    const opts = alg.startsWith('PS')
      ? { key: keyObject, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }
      : { key: keyObject };
    return crypto.verify(hash, Buffer.from(jws.signingInput), opts, jws.signature);
  }
  if (alg.startsWith('ES')) {
    const hash = `sha${alg.slice(2)}`;
    return crypto.verify(
      hash,
      Buffer.from(jws.signingInput),
      { key: keyObject, dsaEncoding: 'ieee-p1363' },
      jws.signature,
    );
  }
  if (alg === 'EdDSA') {
    return crypto.verify(null, Buffer.from(jws.signingInput), keyObject, jws.signature);
  }
  throw new FiuError('JWS', `unsupported JWS alg: ${alg}`);
}
