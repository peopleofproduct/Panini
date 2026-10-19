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

import type { JsonWebKey } from 'node:crypto';
import type { FetchLike } from './client';

/** One entry in the community AA directory — see aa-directory.schema.json. */
export interface AaEndpoint {
  /** Stable kebab-case id, e.g. 'finvu'. */
  readonly aaId: string;
  readonly name: string;
  /** VUA handle suffixes served by this AA, lowercase, without '@'. */
  readonly handles: readonly string[];
  readonly environment: 'production' | 'sandbox';
  /** FI API base URL when publicly documented — integrators may override. */
  readonly baseUrl?: string;
  readonly publicKeyUrl?: string;
  readonly fiTypes?: readonly string[];
  /** 'unknown' until community-verified; 'sunset' for retired AAs. */
  readonly status: 'active' | 'sunset' | 'unknown';
}

/**
 * Seeded AA directory. Handles are filled only where publicly documented;
 * entries with `status: 'unknown'` are awaiting community verification —
 * file a PR to update. Type-checked data (not loose JSON), so schema drift
 * fails compile, and `aa-directory.schema.json` conformance is tested.
 */
export const AA_DIRECTORY: readonly AaEndpoint[] = [
  {
    aaId: 'finvu',
    name: 'Finvu (Cookiejar Technologies)',
    handles: ['finvu'],
    environment: 'production',
    status: 'active',
  },
  {
    aaId: 'onemoney',
    name: 'OneMoney',
    handles: ['onemoney'],
    environment: 'production',
    status: 'active',
  },
  {
    aaId: 'camsfinserv',
    name: 'CAMSfinserv',
    handles: ['camsfinserv'],
    environment: 'production',
    status: 'unknown',
  },
  {
    aaId: 'protean-surakshaa',
    name: 'Protean SurakshAA',
    handles: [],
    environment: 'production',
    status: 'unknown',
  },
  {
    aaId: 'phonepe-aa',
    name: 'PhonePe AA',
    handles: [],
    environment: 'production',
    status: 'unknown',
  },
  {
    aaId: 'agya',
    name: 'Agya (Setu/Pine Labs)',
    handles: [],
    environment: 'production',
    status: 'unknown',
  },
  {
    aaId: 'anumati',
    name: 'Anumati (Perfios)',
    handles: [],
    environment: 'production',
    status: 'unknown',
  },
  {
    aaId: 'saafe',
    name: 'Saafe',
    handles: [],
    environment: 'production',
    status: 'unknown',
  },
  {
    aaId: 'tally',
    name: 'TallyEdge (Tally Solutions)',
    handles: [],
    environment: 'production',
    status: 'unknown',
  },
  {
    aaId: 'nadl',
    name: 'NADL',
    handles: [],
    environment: 'production',
    status: 'unknown',
  },
  {
    aaId: 'sahamati-sandbox',
    name: 'Sahamati sandbox AA',
    handles: ['sandbox-aa'],
    environment: 'sandbox',
    status: 'unknown',
  },
];

/**
 * Resolves a customer VUA handle to its AA — longest-suffix wins so
 * 'user@okhdfc' style sub-handles resolve correctly. Case-insensitive.
 * Also accepts a bare handle ('finvu') or full aaId.
 * Returns null when unresolvable — check {@link suggestAas}.
 */
export function resolveAaHandle(
  handleOrVua: string,
  directory: readonly AaEndpoint[] = AA_DIRECTORY,
): AaEndpoint | null {
  const norm = handleOrVua.trim().toLowerCase();
  const suffix = norm.includes('@') ? norm.slice(norm.indexOf('@') + 1) : norm;
  if (suffix === '') return null;
  let best: AaEndpoint | null = null;
  let bestLen = -1;
  for (const entry of directory) {
    if (entry.status === 'sunset') continue;
    if (entry.aaId === suffix && bestLen < entry.aaId.length) {
      best = entry;
      bestLen = entry.aaId.length;
    }
    for (const h of entry.handles) {
      // Exact match or dotted sub-handle ('user@x.finvu' → 'finvu').
      if ((suffix === h || suffix.endsWith('.' + h)) && h.length > bestLen) {
        best = entry;
        bestLen = h.length;
      }
    }
  }
  return best;
}

/** Did-you-mean suggestions for an unresolved handle — prefix matches first. */
export function suggestAas(
  handleOrVua: string,
  directory: readonly AaEndpoint[] = AA_DIRECTORY,
  limit = 3,
): readonly AaEndpoint[] {
  const norm = handleOrVua.trim().toLowerCase();
  const suffix = norm.includes('@') ? norm.slice(norm.indexOf('@') + 1) : norm;
  // Empty/blank handles carry no signal — scoring every entry equally and
  // returning arbitrary suggestions would be noise, not help.
  if (suffix === '') return [];
  const scored: { entry: AaEndpoint; score: number }[] = [];
  for (const entry of directory) {
    const names = [entry.aaId, ...entry.handles];
    let score = 0;
    for (const n of names) {
      if (n.startsWith(suffix) || suffix.startsWith(n)) score = Math.max(score, 2);
      else if (n.includes(suffix) || suffix.includes(n)) score = Math.max(score, 1);
    }
    if (score > 0) scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.aaId.localeCompare(b.entry.aaId))
    .slice(0, limit)
    .map((s) => s.entry);
}

/** Per-AA client configuration for {@link createMultiFiuClient}. */
export interface AaClientConfig {
  /** Overrides the directory baseUrl when the integrator has their own. */
  readonly baseUrl?: string;
  readonly dataConsumerId: string;
  /** Per-AA auth headers (API keys, client-ids) — each AA authenticates differently. */
  readonly headers?: Record<string, string>;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  /** AA's JWS verification key (PEM or JWK) for artefact verification. */
  readonly aaPublicKey?: string | JsonWebKey;
  /** AA spec revision to send in request envelopes (default '2.0.0'). */
  readonly specVersion?: string;
}
