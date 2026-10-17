<!--
Copyright 2026 Kapil — Project Panini Contributors
SPDX-License-Identifier: Apache-2.0
-->

# FIU Sandbox Certification Runbook

End-to-end validation of `@paniniapi/fiu-client` against a real Account
Aggregator sandbox. The local mock-AA E2E suite proves the code paths; this
runbook proves them against **an actual AA speaking the ReBIT wire protocol**.

Scope note: this validates Panini as an FIU-side data consumer. It does not
certify you as a regulated entity — that happens with Sahamati/Central
Registry, out of band.

---

## 0. Prerequisites

| Need                                   | Where                                                               |
| -------------------------------------- | ------------------------------------------------------------------- |
| Sandbox account + FIU registration     | Sahamati AA sandbox (sandbox registration portal / community Slack) |
| Your `dataConsumerId` (FIU identifier) | Issued during sandbox registration                                  |
| AA base URL for the sandbox            | e.g. the sandbox AA's `/Consent`, `/FI` endpoints                   |
| The AA's JWS verification public key   | Published by the sandbox AA / Central Registry                      |
| A consented test customer handle       | Sandbox test customer (e.g. `customer@AA-name`)                     |

Set them as environment variables — **never hardcode or commit credentials**:

```bash
export AA_BASE_URL="https://<sandbox-aa-host>"
export DATA_CONSUMER_ID="<your-fiu-id>"
export AA_JWS_PUBLIC_KEY_PEM="$(cat sandbox-aa-pubkey.pem)"   # optional but recommended
export TEST_CUSTOMER_ID="<test-customer>@<aa-name>"
```

## 1. Wire the client

```ts
import { createFiuClient } from '@paniniapi/fiu-client';
import { validateFiData } from '@paniniapi/standards-schema';

const client = createFiuClient({
  baseUrl: process.env.AA_BASE_URL!,
  dataConsumerId: process.env.DATA_CONSUMER_ID!,
  timeoutMs: 15_000,
  // transport defaults to global fetch; inject for auth headers if the
  // sandbox requires a bearer token:
  fetch: (url, init) =>
    fetch(url, {
      ...init,
      headers: { ...init?.headers, authorization: `Bearer ${process.env.AA_TOKEN}` },
    }),
});
```

## 2. Certification checklist

Run each step; the pass criteria are what make this a certification and not
a demo.

### 2.1 Consent request

```ts
const res = await client.requestConsent({
  customerId: process.env.TEST_CUSTOMER_ID!,
  consentStart: '2024-01-01T00:00:00.000Z',
  consentExpiry: '2027-01-01T00:00:00.000Z',
  consentMode: 'STORE',
  fetchType: 'ONETIME',
  consentTypes: ['TRANSACTIONS', 'PROFILE', 'SUMMARY'],
  fiTypes: ['DEPOSIT'],
  purpose: { code: '101', text: 'Wealth management service' },
  fiDataRange: { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
  dataLife: { unit: 'MONTH', value: 6 },
  frequency: { unit: 'MONTH', value: 1 },
});
const consentHandle = res.ConsentHandle;
```

- [ ] **PASS**: AA returns `res.ConsentHandle` (HTTP 200), no exception

### 2.2 Consent approval + artefact verification

Approve the consent in the sandbox AA's UI/app for the test customer, then:

```ts
// poll until the status is ACTIVE (bounded — e.g. 24 polls × 5s)
const { consentId } = await client.consentStatus(consentHandle);
const { artefact, signature, signedConsent } = await client.fetchConsentArtefact(
  consentId!,
  process.env.AA_JWS_PUBLIC_KEY_PEM,
);
```

- [ ] **PASS**: `signature === 'verified'` (with AA key) or `'unverified'` without it
- [ ] **PASS**: artefact fields round-trip — `fiTypes`, `dataLife`, `purpose.code`
- [ ] **PASS (negative)**: a tampered artefact → `signature === 'invalid'`, never `'verified'`
- [ ] **PASS (negative)**: `alg: none` JWS → hard rejection, not a decode

### 2.3 FI request + decryption

```ts
const { sessionId } = await client.requestFi(
  artefact,
  { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
  signedConsent /* raw JWS string returned by fetchConsentArtefact */,
);
const response = await client.waitForFi(sessionId);
const records = await client.fetchAndDecryptFi(sessionId, validateFiData);
```

- [ ] **PASS**: `waitForFi` returns `COMPLETED` within `maxAttempts`
- [ ] **PASS**: `records` decrypt — this exercises the full Rahasya chain
      (X25519 ECDH → nonce XOR → HKDF-SHA256 → AES-256-GCM) against the AA's
      real encryptor, not our mirror
- [ ] **PASS**: each `DecryptedFi` payload passes `validateFiData` (or is a
      non-JSON payload flagged `isJson: false` — XML profiles are legal)

### 2.4 Adversarial cases (do not skip — this is the certification)

- [ ] **PASS**: `fetchAndDecryptFi` with a sessionId not created by this
      client instance → `SESSION` error, never a decrypt attempt
- [ ] **PASS**: corrupted FI ciphertext (flip one byte on the wire copy) →
      `DECRYPT`/`AUTH` failure, never silent garbage
- [ ] **PASS**: expired FIP `KeyMaterial` → typed `KEY` error
- [ ] **PASS**: request with `timeoutMs: 1` → aborts, typed timeout — no hang
- [ ] **PASS**: `waitForFi` on a never-completing session → exhausts
      `maxAttempts`, does not poll forever

## 3. Report

After the checklist, capture the receipt in the repo issue tracker:

```
sandbox AA: <name/host>    date: <YYYY-MM-DD>
consent flow: PASS         artefact JWS verify: PASS (key: <alg>)
FI decrypt: PASS (fiTypes tested: DEPOSIT, ...)
adversarial: N/N pass
```

That closes the last externally-gated item on the FIU track.

---

### Troubleshooting

| Symptom                                | Likely cause                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `CONFIG` error at client creation      | missing `baseUrl`/`dataConsumerId`/fetch                                                                       |
| Consent stuck `PENDING`                | customer hasn't approved in the sandbox app                                                                    |
| `signature: 'invalid'` on artefact     | wrong AA public key, or artefact base64-wrapped (we handle both — check key first)                             |
| `KEY`/`DECRYPT` on fetch               | key-expiry mismatch, or sessionId from a different client instance (keys are bound per-client, in-memory only) |
| `validateFiData` fails on real payload | FI type variant we haven't seen — file it, that's exactly what sandbox cert is for                             |
