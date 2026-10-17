/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

export {
  FiuError,
  type FiuErrorCode,
  type FiuKeyMaterial,
  type KeyMaterial,
  type DataFilter,
  type ConsentPurpose,
  type LifeUnit,
  type Frequency,
  type ConsentRequestInput,
  type ConsentRequestBody,
  type ConsentHandleResponse,
  type ConsentStatus,
  type ConsentArtefact,
  type ParsedConsent,
  type FiRequestBody,
  type FiRequestResponse,
  type FiDataItem,
  type FiSection,
  type FiFetchResponse,
  type DecryptedFi,
} from './types';
export {
  generateFiuKeyMaterial,
  importX25519Public,
  importX25519Private,
  deriveSharedSecret,
  toWireKeyMaterial,
  decodeB64,
} from './keys';
export { xorNonces, deriveSessionKey, decryptFi, encryptFi } from './crypto';
export { decodeJws, verifyJws, type DecodedJws } from './jws';
export { buildConsentRequest, parseConsentArtefact } from './consent';
export { buildFiRequest, decryptFiResponse } from './fi';
export { createFiuClient, type FiuClient, type FiuClientConfig, type FetchLike } from './client';
