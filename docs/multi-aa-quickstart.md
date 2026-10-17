# Multi-AA quickstart — plug into Finvu, OneMoney & CAMSfinserv in one config

`@paniniapi/fiu-client` treats every AA as just another entry in one config
object. No per-AA integration code, no gateway, no PII leaving your stack —
transport is your injected `fetch`, so mTLS/proxies/auth all stay under your
control.

## 1. The whole setup

```ts
import { createMultiFiuClient } from '@paniniapi/fiu-client';

const aa = createMultiFiuClient({
  clients: {
    finvu: {
      dataConsumerId: process.env.FIU_DC_ID!,
      baseUrl: process.env.FINVU_BASE_URL!, // from your Finvu onboarding
      headers: { 'x-api-key': process.env.FINVU_KEY! },
    },
    onemoney: {
      dataConsumerId: process.env.FIU_DC_ID!,
      baseUrl: process.env.ONEMONEY_BASE_URL!,
      headers: { client_id: process.env.ONEMONEY_ID!, client_secret: process.env.ONEMONEY_SECRET! },
    },
    camsfinserv: {
      dataConsumerId: process.env.FIU_DC_ID!,
      baseUrl: process.env.CAMS_BASE_URL!,
      headers: { Authorization: `Bearer ${process.env.CAMS_TOKEN}` },
    },
  },
});
```

That's the entire multi-AA integration. Each AA authenticates differently —
per-entry `headers` carries whatever scheme each one requires.

## 2. Consent — routed, or fanned out

```ts
// Customer picked their AA? One call, routed by handle:
const r = await aa.requestConsent('customer@finvu', consentInput);
if (r.ok) console.log(r.value.ConsentHandle, `via ${r.aaId} in ${r.latencyMs}ms`);

// Don't know which AA the customer uses? Ask all of them at once:
const results = await aa.requestConsentAcross(consentInput);
//   → [{aaId:'finvu', ok:true, ...}, {aaId:'onemoney', ok:false, error:FiuError}, ...]
//   Latency = max(AA latencies), not the sum. One AA down never sinks the rest.
```

Unresolvable handles don't throw — you get a `CONFIG` error with did-you-mean
suggestions:

```ts
const out = await aa.requestConsent('customer@finv', consentInput);
if (!out.ok) console.error(out.error.message);
// → "cannot resolve AA for handle 'customer@finv' — did you mean: finvu?"
```

## 3. Per-AA consent → FI → decrypt

Each AA's full lifecycle is on the per-AA client (`aa.clientFor(aaId)`) —
`consentStatus`, `fetchConsentArtefact` (returns raw `signedConsent` for the
FI request), `requestFi`, `waitForFi`, `fetchAndDecryptFi`. See
[`fiu-sandbox-certification.md`](fiu-sandbox-certification.md) for the
step-by-step against a live sandbox.

## 4. Data pull across AAs

Sessions are per-AA — map each session to the AA that issued it, then wait +
decrypt in bounded parallel:

```ts
import { validateFiData } from '@paniniapi/standards-schema';

const data = await aa.decryptFiAcross(
  { finvu: sessionFinvu, onemoney: sessionOm, camsfinserv: sessionCams },
  { validate: validateFiData, fiType: 'DEPOSIT' },
);
for (const r of data) {
  if (r.ok) feedIntoPaniniInsights(r.aaId, r.value);
  else console.error(`${r.aaId} failed: ${r.error.code} ${r.error.message}`);
}
```

## 5. Tuning & safety knobs

| Option             | Default           | Notes                                                   |
| ------------------ | ----------------- | ------------------------------------------------------- |
| `maxConcurrency`   | `4`               | Fan-out never fires more than this many in-flight calls |
| `clock`            | `performance.now` | Inject for deterministic latency tests                  |
| `directory`        | `AA_DIRECTORY`    | Add sandbox/private AAs without forking                 |
| per-AA `timeoutMs` | `30_000`          | Bounded polling on every call                           |

## 6. What's intentionally NOT here

- **Hosted failover / SLA routing** — that's an _operated service_ property
  (Finarkein Smart Switch territory), not a library. Your fan-out results
  carry per-AA latency + errors, so _your_ ops layer can make routing calls.
- **AA onboarding** — each fintech registers with each AA (regulatory step,
  not a technical one). This module removes the integration bill, not the
  registration.
- **Credential custody** — env vars/injected secrets, never in the directory.
