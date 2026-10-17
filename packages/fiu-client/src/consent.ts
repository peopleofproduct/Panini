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
import { decodeJws, verifyJws } from './jws';
import {
  FiuError,
  type ConsentArtefact,
  type ConsentRequestBody,
  type ConsentRequestInput,
  type ParsedConsent,
} from './types';

/** Build a POST /Consent request body per the ReBIT AA v2 envelope. */
export function buildConsentRequest(
  input: ConsentRequestInput,
  dataConsumerId: string,
): ConsentRequestBody {
  if (!input.customerId) throw new FiuError('CONFIG', 'customerId is required');
  if (!dataConsumerId) throw new FiuError('CONFIG', 'dataConsumerId is required');
  const start = Date.parse(input.consentStart);
  const expiry = Date.parse(input.consentExpiry);
  if (Number.isNaN(start) || Number.isNaN(expiry)) {
    throw new FiuError('CONFIG', 'consentStart/consentExpiry must be ISO-8601 timestamps');
  }
  if (expiry <= start) throw new FiuError('CONFIG', 'consentExpiry must be after consentStart');
  if (input.fiTypes.length === 0) throw new FiuError('CONFIG', 'at least one fiType is required');

  return {
    ver: '2.0.0',
    timestamp: new Date().toISOString(),
    txnid: crypto.randomUUID(),
    ConsentDetail: {
      consentStart: input.consentStart,
      consentExpiry: input.consentExpiry,
      consentMode: input.consentMode,
      fetchType: input.fetchType,
      consentTypes: input.consentTypes,
      fiTypes: input.fiTypes,
      DataConsumer: { id: dataConsumerId },
      Customer: {
        id: input.customerId,
        ...(input.customerIdentifiers ? { Identifiers: input.customerIdentifiers } : {}),
      },
      Purpose: input.purpose,
      FIDataRange: input.fiDataRange,
      DataLife: input.dataLife,
      Frequency: input.frequency,
      DataFilter: input.dataFilter ?? [],
    },
  };
}

/**
 * Parse a signed consent artefact. Accepts either a raw compact JWS or a
 * base64-encoded JWS (both seen in the wild across AAs). If `aaPublicKey`
 * (PEM or JWK) is supplied the signature is verified; otherwise the artefact
 * is returned decoded-but-unverified — callers must decide whether that is
 * acceptable for their trust model.
 */
export function parseConsentArtefact(
  signedConsent: string,
  aaPublicKey?: string | crypto.JsonWebKey,
): ParsedConsent {
  let compact = signedConsent.trim();
  if (compact.split('.').length !== 3) {
    const decoded = Buffer.from(compact, 'base64').toString('utf8');
    if (decoded.split('.').length !== 3) {
      throw new FiuError('JWS', 'signedConsent is neither a JWS nor a base64-encoded JWS');
    }
    compact = decoded;
  }

  const jws = decodeJws(compact);
  let artefact: ConsentArtefact;
  try {
    const parsed: unknown = JSON.parse(jws.payload.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not object');
    artefact = parsed as ConsentArtefact;
  } catch {
    throw new FiuError('JWS', 'consent artefact payload is not valid JSON');
  }
  if (typeof artefact.consentId !== 'string' || artefact.consentId.length === 0) {
    throw new FiuError('SCHEMA', 'consent artefact missing consentId');
  }

  let signature: ParsedConsent['signature'] = 'unverified';
  if (aaPublicKey !== undefined) {
    signature = verifyJws(compact, aaPublicKey) ? 'verified' : 'invalid';
  }
  return { artefact, signature };
}
