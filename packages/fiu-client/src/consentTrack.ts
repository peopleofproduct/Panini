/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Consent-lifecycle tracking — the open-ended answer to hosted consent
 * managers (Flux Consent et al.).
 *
 * The deterministic part — "what state is this consent in, and when does
 * it need attention?" — is a pure function of the artefact and the clock,
 * so Panini ships it. The operational part — where artefacts persist and
 * how renewals are initiated — stays caller-owned via the ConsentStore
 * seam, so lenders compose a complete lifecycle over their own
 * infrastructure instead of adopting a half-built product.
 */

import { FiuError, type ConsentArtefact } from './types';

export type ConsentLifecycle =
  'pending' | 'active' | 'expiring' | 'expired' | 'revoked' | 'rejected' | 'failed';

export interface ConsentStatusInfo {
  readonly consentId: string;
  readonly lifecycle: ConsentLifecycle;
  /** Raw AA status string from the artefact, preserved for audit. */
  readonly rawStatus: string;
  /** Days until consentExpiry, or null when the artefact lacks one. */
  readonly daysToExpiry: number | null;
  /** True when renewal should be initiated (active + inside lead window). */
  readonly renewalDue: boolean;
}

const DAY_MS = 86_400_000;

function artefactExpiry(a: ConsentArtefact): number | null {
  const detail = a.consentDetail;
  if (detail === undefined) return null;
  const raw = detail['consentExpiry'];
  if (typeof raw !== 'string') return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/**
 * Derive lifecycle state from an artefact + clock. Pure: same artefact,
 * same `now`, same answer. `renewalLeadDays` (default 7) is how far
 * ahead of expiry the consent counts as renewal-due.
 */
export function consentStatus(
  artefact: ConsentArtefact,
  now: Date = new Date(),
  renewalLeadDays = 7,
): ConsentStatusInfo {
  const raw = artefact.status;
  const expiry = artefactExpiry(artefact);
  const daysTo = expiry === null ? null : Math.floor((expiry - now.getTime()) / DAY_MS);
  const expiryPast = expiry !== null && expiry <= now.getTime();

  let lifecycle: ConsentLifecycle;
  switch (raw) {
    case 'PENDING':
      lifecycle = 'pending';
      break;
    case 'PAUSED':
    case 'ACTIVE':
      lifecycle = expiryPast
        ? 'expired'
        : daysTo !== null && daysTo <= renewalLeadDays
          ? 'expiring'
          : 'active';
      break;
    case 'REVOKED':
      lifecycle = 'revoked';
      break;
    case 'EXPIRED':
      lifecycle = 'expired';
      break;
    case 'REJECTED':
      lifecycle = 'rejected';
      break;
    case 'FAILED':
      lifecycle = 'failed';
      break;
    default:
      throw new FiuError('SCHEMA', `unrecognised consent status '${raw}'`);
  }
  return {
    consentId: artefact.consentId,
    lifecycle,
    rawStatus: raw,
    daysToExpiry: daysTo,
    renewalDue: lifecycle === 'expiring',
  };
}

/* ------------------------------------------------------------------ */
/* Caller-owned seam — where artefacts live is the lender's business    */
/* ------------------------------------------------------------------ */

/**
 * Persistence seam for consent artefacts — the lender's database, an
 * encrypted store, whatever they run. Panini never sees the bytes.
 */
export interface ConsentStore {
  /** Stored artefact by consentId, or null when unknown. */
  load(consentId: string): Promise<ConsentArtefact | null>;
  save(artefact: ConsentArtefact): Promise<void>;
  /** Enumerate tracked consentIds (for lifecycle sweeps). */
  list(): Promise<readonly string[]>;
}

export interface ConsentSweep {
  /** renewalDue=true — initiate renewal journeys for these. */
  readonly renewing: readonly ConsentStatusInfo[];
  /** Already dead — stop attempting fetches, flag for ops. */
  readonly expired: readonly ConsentStatusInfo[];
  readonly revoked: readonly ConsentStatusInfo[];
  /** Everything else, un-actioned (active, pending, rejected, failed). */
  readonly others: readonly ConsentStatusInfo[];
}

/**
 * Sweep every tracked consent and bucket by lifecycle — the nightly
 * job a lender runs over their own ConsentStore to find renewals and
 * dead consents. Individual unreadable artefacts are skipped with the
 * rest still reported (a corrupt record shouldn't hide 999 live ones).
 */
export async function sweepConsents(
  store: ConsentStore,
  now: Date = new Date(),
  renewalLeadDays = 7,
): Promise<ConsentSweep> {
  const out: {
    renewing: ConsentStatusInfo[];
    expired: ConsentStatusInfo[];
    revoked: ConsentStatusInfo[];
    others: ConsentStatusInfo[];
  } = { renewing: [], expired: [], revoked: [], others: [] };

  for (const consentId of await store.list()) {
    const artefact = await store.load(consentId);
    if (artefact === null) continue;
    const info = consentStatus(artefact, now, renewalLeadDays);
    if (info.renewalDue) out.renewing.push(info);
    else if (info.lifecycle === 'expired') out.expired.push(info);
    else if (info.lifecycle === 'revoked') out.revoked.push(info);
    else out.others.push(info);
  }
  return out;
}
