/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * ReBIT Account Aggregator FIU-side types — consent lifecycle, KeyMaterial,
 * FI request/response shapes per the AA v2 technical spec.
 */

export type FiuErrorCode = 'CONFIG' | 'HTTP' | 'JWS' | 'CRYPTO' | 'SCHEMA' | 'STATE';

export class FiuError extends Error {
  readonly code: FiuErrorCode;
  readonly detail?: unknown;
  constructor(code: FiuErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'FiuError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** Ephemeral Curve25519 material the FIU generates per FI data request. */
export interface FiuKeyMaterial {
  /** Raw 32-byte X25519 private scalar, base64-encoded. KEEP SECRET. */
  readonly privateKeyB64: string;
  /** Raw 32-byte X25519 public key, base64-encoded. */
  readonly publicKeyB64: string;
  /** 256-bit random nonce, base64-encoded. */
  readonly nonceB64: string;
  /** ISO-8601 expiry for the public key (spec field `DHPublicKey.expiry`). */
  readonly expiry: string;
}

/** KeyMaterial as transmitted on the wire (FIU request and FIP response). */
export interface KeyMaterial {
  readonly cryptoAlg: 'ECDH';
  readonly curve: 'Curve25519';
  readonly params: 'AES/GCM/NoPadding';
  readonly DHPublicKey: {
    readonly expiry: string;
    readonly Parameters: string;
    readonly KeyValue: string;
  };
  readonly Nonce: string;
}

export interface DataFilter {
  readonly type: string;
  readonly operator: string;
  readonly value: string;
}

export interface ConsentPurpose {
  readonly code: string;
  readonly refUri?: string;
  readonly text?: string;
}

export interface LifeUnit {
  readonly unit: 'DAY' | 'MONTH' | 'YEAR' | 'INF';
  readonly value: number;
}

export interface Frequency {
  readonly unit: 'HOUR' | 'DAY' | 'MONTH' | 'YEAR';
  readonly value: number;
}

export interface ConsentRequestInput {
  readonly customerId: string;
  /** e.g. '2024-01-01T00:00:00.000Z' */
  readonly consentStart: string;
  readonly consentExpiry: string;
  readonly fiDataRange: { readonly from: string; readonly to: string };
  readonly consentMode: 'STORE' | 'QUERY' | 'STREAM' | 'VIEW';
  readonly fetchType: 'ONETIME' | 'PERIODIC';
  readonly consentTypes: readonly ('PROFILE' | 'SUMMARY' | 'TRANSACTIONS')[];
  readonly fiTypes: readonly string[];
  readonly purpose: ConsentPurpose;
  readonly dataLife: LifeUnit;
  readonly frequency: Frequency;
  readonly dataFilter?: readonly DataFilter[];
  readonly customerIdentifiers?: readonly { readonly type: string; readonly value: string }[];
}

/** POST /Consent request body (AA v2 envelope). */
export interface ConsentRequestBody {
  /** AA spec version — '2.0.0' by default; AAs on newer ReBIT revisions
   *  negotiate their own. */
  readonly ver: string;
  readonly timestamp: string;
  readonly txnid: string;
  readonly ConsentDetail: {
    readonly consentStart: string;
    readonly consentExpiry: string;
    readonly consentMode: ConsentRequestInput['consentMode'];
    readonly fetchType: ConsentRequestInput['fetchType'];
    readonly consentTypes: readonly string[];
    readonly fiTypes: readonly string[];
    readonly DataConsumer: { readonly id: string };
    readonly Customer: {
      readonly id: string;
      readonly Identifiers?: readonly { readonly type: string; readonly value: string }[];
    };
    readonly Purpose: ConsentPurpose;
    readonly FIDataRange: { readonly from: string; readonly to: string };
    readonly DataLife: LifeUnit;
    readonly Frequency: Frequency;
    readonly DataFilter: readonly DataFilter[];
  };
}

/** POST /Consent response — a handle for tracking approval. */
export interface ConsentHandleResponse {
  readonly ver: string;
  readonly timestamp: string;
  readonly txnid: string;
  readonly ConsentHandle: string;
  readonly ConsentStatus: { readonly id: string; readonly status: 'PENDING' | string };
  readonly Customer?: { readonly id: string };
}

export type ConsentStatus =
  'PENDING' | 'ACTIVE' | 'PAUSED' | 'REVOKED' | 'EXPIRED' | 'REJECTED' | 'FAILED';

/** The consent artefact — payload of the signed JWS. */
export interface ConsentArtefact {
  readonly consentId: string;
  readonly status: ConsentStatus;
  readonly createTimestamp: string;
  readonly signedConsent?: string;
  readonly consentUse?: {
    readonly count: number;
    readonly lastUseDateTime: string;
    readonly logUri?: string;
  };
  readonly consentDetail?: Record<string, unknown>;
}

export interface ParsedConsent {
  readonly artefact: ConsentArtefact;
  /** 'verified' when a public key was supplied and the JWS signature checks out,
   *  'unverified' when decoded without a key, 'invalid' on signature mismatch. */
  readonly signature: 'verified' | 'unverified' | 'invalid';
}

/** POST /FI/request body. */
export interface FiRequestBody {
  readonly ver: string;
  readonly timestamp: string;
  readonly txnid: string;
  readonly FIDataRange: { readonly from: string; readonly to: string };
  readonly Consent: { readonly id: string; readonly digitalSignature: string };
  readonly KeyMaterial: KeyMaterial;
}

export interface FiRequestResponse {
  readonly ver: string;
  readonly timestamp: string;
  readonly txnid: string;
  readonly sessionId: string;
  readonly ConsentId: string;
}

/** One encrypted FI data block inside an FI/fetch response. */
export interface FiDataItem {
  readonly linkRefNumber: string;
  readonly maskedAccNumber: string;
  readonly encryptedFI: string;
}

export interface FiSection {
  readonly data: readonly FiDataItem[];
  readonly KeyMaterial: KeyMaterial;
}

export interface FiFetchResponse {
  readonly ver: string;
  readonly timestamp: string;
  readonly txnid: string;
  readonly FIData?: readonly FiSection[];
  readonly sessionStatus?: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'FAILED';
}

export interface DecryptedFi {
  readonly linkRefNumber: string;
  readonly maskedAccNumber: string;
  /** Decrypted payload — JSON parsed when possible, else raw string (XML FI
   *  payloads stay strings; parse them via your XML seam). */
  readonly payload: unknown;
  /** Whether the payload was valid JSON. */
  readonly isJson: boolean;
}
