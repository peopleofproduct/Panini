<!--
Copyright 2026 Kapil — Project Panini Contributors
SPDX-License-Identifier: Apache-2.0
-->

# AA Partner Readiness — integrating Panini with a live Account Aggregator

This document is the reference an AA team (Finvu, OneMoney, CAMSfinserv,
…), a TSP, or an FIU's vendor-assessment reviewer can use to evaluate
Panini's FIU-side client for a pilot. It maps the Sahamati FIU
certification surface to the code, lists what is deliberately out of
scope, and gives the concrete integration checklist.

> Status language is precise throughout: **spec-faithful and
> mock-verified**, with wire-compatibility against a live AA pending
> sandbox credentials. Nothing here claims Sahamati certification —
> certification is granted to regulated entities by Sahamati/Central
> Registry, not to libraries.

## What the client implements

`@paniniapi/fiu-client` — the FIU-side half of the ReBIT AA spec:

- **Consent**: `POST /Consent`, `GET /Consent/handle/{handle}`,
  `GET /Consent/{id}` — artefact fetch + detached-JWS verification
  (PEM/JWK keys, `alg: none` hard-rejected).
- **FI**: `POST /FI/request`, `GET /FI/fetch/{sessionId}`, bounded
  polling; per-session ephemeral X25519 key material held in memory only
  and discarded after the matching decrypt.
- **Decryption**: the full Rahasya chain — X25519 ECDH → nonce XOR →
  HKDF-SHA256 → AES-256-GCM — verified end-to-end against a spec-faithful
  mock AA that re-encrypts as a real FIP would.
- **Notifications**: `validateConsentNotification()` — the receiver-side
  validator for `POST /Consent/Notification`, enforcing the
  certification-tested checks (below).
- **Liveness**: `client.heartbeat()` → `GET /Heartbeat`.
- **Orchestration**: `createMultiFiuClient` — handle→AA resolution,
  bounded parallel fan-out, per-AA credentials/version/transport, and
  failure isolation (one AA down never sinks the others).
- **Directory**: `aaDirectory.ts` — a community-maintained handle→AA
  registry (Finvu included: `user@finvu` resolves automatically).

## Certification-scenario conformance matrix

Mapped against `Sahamati/certification-framework` FIU scenarios
(github.com/Sahamati/certification-framework → `certification-scenarios/fiu.md`):

| Scenario family  | Requirement                                                                                                                | Panini coverage                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1001–1003        | Valid `POST /Consent`, `GET /Consent/{handle}`, `GET /Consent/{id}`                                                        | `buildConsentRequest` (spec envelope), `consentStatus`, `fetchConsentArtefact`                           |
| 1004–1009        | `POST /Consent/Notification` receiver — 200 on valid; `InvalidNotifier`, `InvalidConsentId`, `InvalidRequest` on malformed | `validateConsentNotification` returns the spec error codes; `consentNotificationAck` builds the 200 body |
| 1010             | 15-min timestamp tolerance                                                                                                 | `timestampToleranceMs` (default 15 min), `InvalidRequest` on breach                                      |
| 1011–1012        | Discard schematically-invalid AA responses                                                                                 | Typed `SCHEMA`/`HTTP` errors — no partial parsing, no silent defaults                                    |
| 1013             | `NoSuchVersion` on invalid `ver`                                                                                           | Validator returns 404 `NoSuchVersion`; request version is caller-configurable (`specVersion`)            |
| 1016–1018        | PAUSED/EXPIRED/REVOKED consent must block FI requests                                                                      | `requestFi` throws `STATE` unless `artefact.status === 'ACTIVE'`                                         |
| 1019–1024        | Discard invalid-ver / invalid-timestamp / mismatched-txnid / wrong-customer / bad-JWS responses                            | `checkTxnId` enforces txnid echo; JWS verify on artefact; schema-typed rejection                         |
| FI request/fetch | KeyMaterial exchange + decrypt                                                                                             | X25519 ECDH → HKDF → AES-256-GCM, per-session ephemeral keys                                             |
| Heartbeat        | Liveness probe                                                                                                             | `client.heartbeat()`                                                                                     |

Run the mock-AA E2E locally: `npx jest packages/fiu-client` — it replays
the full consent→artefact→FI decrypt chain against an in-process,
spec-faithful AA (including a real re-encryption path, so the crypto is
verified against independent key derivation, not our own mirror).

## Security posture (what a partner reviews first)

- **No ambient I/O**: the client makes network calls only inside explicit
  method calls, on the AA base URL you configure. Inject the transport
  (`fetch` seam) to add auth headers, mTLS, or egress policy.
- **Keys are ephemeral and in-memory**: FIU private keys exist only
  between `requestFi` and the matching decrypt; they are never persisted,
  logged, or returned.
- **Fail-closed**: corrupted ciphertext, expired key material, unknown
  sessions, and schema violations are typed `FiuError`s — never silent
  defaults.
- **Zero runtime dependencies**: auditable surface — `npm ls
--omit=dev` is empty.
- **PII-free by construction**: no telemetry exists; there is nothing to
  leak.

## Integrating against a specific AA (e.g. Finvu)

```ts
import { createMultiFiuClient } from '@paniniapi/fiu-client';

const fiu = createMultiFiuClient({
  clients: {
    finvu: {
      baseUrl: process.env.FINVU_BASE_URL!, // issued at AA onboarding
      dataConsumerId: process.env.FIU_ID!,
      specVersion: '2.1.0', // whatever onboarding specifies
      aaPublicKey: process.env.FINVU_JWS_PEM!, // artefact verification
      headers: { 'x-api-key': process.env.FINVU_API_KEY! },
    },
  },
});
```

Customer handles like `user@finvu` resolve via the seeded directory;
sandbox AA entries can be added through the `directory` override.

**What you still need from the AA** (this is the onboarding contract, not
Panini's gap): FIU `dataConsumerId`, base URL, JWS verification key, API
credentials, and the spec revision they serve. Everything else — consent
flows, artefact verification, FI decrypt, notification validation — is in
the library.

## What we deliberately do not ship

- **AA-side APIs** (we are an FIU client, not an AA).
- **AA-proprietary analytics** (e.g. Finvu Lens/FasTrack) — those are
  per-AA products, not spec.
- **Consent UI/journey management** — `consentTrack` gives the
  deterministic lifecycle math; hosting the customer-facing journey is
  the FIU's product surface.
- **Certification itself** — obtained by the regulated FIU entity through
  Sahamati, out of band. Panini is built to _pass_ the scenarios; the
  certificate attaches to the entity, not the library.

## The ask of an AA partner

1. A sandbox tenant + test customer handle (see
   `docs/fiu-sandbox-certification.md` for the runbook).
2. The AA's JWS public key + expected `ver`.
3. 30 minutes of their integration engineer's time — the mock-suite
   output plus one live consent cycle answers every question on the
   matrix above.
