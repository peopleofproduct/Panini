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

import { consentStatus, sweepConsents } from '../src/consentTrack';
import type { ConsentStore } from '../src/consentTrack';
import type { ConsentArtefact, ConsentStatus } from '../src/types';

const NOW = new Date('2026-10-20T00:00:00Z');

function artefact(
  status: ConsentStatus,
  expiry = '2026-12-31T00:00:00Z',
  id = 'c-1',
): ConsentArtefact {
  return {
    consentId: id,
    status,
    createTimestamp: '2026-10-01T00:00:00Z',
    consentDetail: { consentExpiry: expiry },
  };
}

describe('consentStatus', () => {
  it('maps ACTIVE artefact far from expiry to active', () => {
    const s = consentStatus(artefact('ACTIVE'), NOW);
    expect(s.lifecycle).toBe('active');
    expect(s.renewalDue).toBe(false);
    expect(s.daysToExpiry).toBe(72);
  });

  it('marks ACTIVE inside the renewal lead window as expiring', () => {
    const s = consentStatus(artefact('ACTIVE', '2026-10-25T00:00:00Z'), NOW);
    expect(s.lifecycle).toBe('expiring');
    expect(s.renewalDue).toBe(true);
    expect(s.daysToExpiry).toBe(5);
  });

  it('treats ACTIVE past expiry as expired', () => {
    const s = consentStatus(artefact('ACTIVE', '2026-10-01T00:00:00Z'), NOW);
    expect(s.lifecycle).toBe('expired');
  });

  it('passes through terminal and in-flight states', () => {
    expect(consentStatus(artefact('PENDING'), NOW).lifecycle).toBe('pending');
    expect(consentStatus(artefact('REVOKED'), NOW).lifecycle).toBe('revoked');
    expect(consentStatus(artefact('EXPIRED'), NOW).lifecycle).toBe('expired');
    expect(consentStatus(artefact('REJECTED'), NOW).lifecycle).toBe('rejected');
  });

  it('throws on unrecognised status strings', () => {
    expect(() => consentStatus(artefact('BOGUS' as ConsentStatus), NOW)).toThrow();
  });
});

describe('sweepConsents', () => {
  it('buckets tracked consents by lifecycle', async () => {
    const store: ConsentStore = {
      async load(id) {
        const map: Record<string, ConsentArtefact> = {
          fresh: artefact('ACTIVE', '2026-12-31T00:00:00Z', 'fresh'),
          due: artefact('ACTIVE', '2026-10-25T00:00:00Z', 'due'),
          dead: artefact('EXPIRED', '2026-09-01T00:00:00Z', 'dead'),
          gone: artefact('REVOKED', '2026-12-31T00:00:00Z', 'gone'),
        };
        return map[id] ?? null;
      },
      async save() {},
      async list() {
        return ['fresh', 'due', 'dead', 'gone'];
      },
    };
    const sweep = await sweepConsents(store, NOW);
    expect(sweep.renewing.map((c) => c.consentId)).toEqual(['due']);
    expect(sweep.expired.map((c) => c.consentId)).toEqual(['dead']);
    expect(sweep.revoked.map((c) => c.consentId)).toEqual(['gone']);
    expect(sweep.others.map((c) => c.consentId)).toEqual(['fresh']);
  });
});
