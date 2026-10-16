/**
 * Copyright 2026 Project Panini Contributors
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

import { generateMockProfile, generateMockProfiles, mulberry32 } from '../src';
import { validateAAProfile } from '@panini/standards-schema';
import { parseBankNarration } from '@panini/rules-engine';

describe('mulberry32', () => {
  it('produces a deterministic stream for a fixed seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('stays in the [0, 1) range', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateMockProfile', () => {
  it('emits a schema-valid ReBIT v2.0 profile when anomalies are disabled', () => {
    for (let seed = 0; seed < 15; seed++) {
      const profile = generateMockProfile({ seed, anomalyRate: 0 });
      const result = validateAAProfile(profile);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('is deterministic for a fixed seed', () => {
    expect(generateMockProfile({ seed: 99 })).toEqual(generateMockProfile({ seed: 99 }));
    expect(generateMockProfile({ seed: 99 })).not.toEqual(generateMockProfile({ seed: 100 }));
  });

  it('generates narrations the rules engine can parse end-to-end', () => {
    const profile = generateMockProfile({ seed: 5, anomalyRate: 0, transactionsPerProfile: 30 });
    const channels = new Set<string>();
    for (const txn of profile.Transaction) {
      const parsed = parseBankNarration(String(txn.narration));
      expect(parsed.ref_no).toBe(txn.txnId);
      expect(parsed.confidence).toBeGreaterThan(0.6);
      channels.add(parsed.channel);
    }
    expect(channels).toContain('UPI');
    expect(channels).toContain('IMPS');
  });

  it('produces salary credits flagged as is_salary', () => {
    const profiles = generateMockProfiles(10, { seed: 3, anomalyRate: 0 });
    const salaryNarrations = profiles
      .flatMap((p) => p.Transaction)
      .map((t) => String(t.narration))
      .filter((n) => n.includes('SALARY'));
    expect(salaryNarrations.length).toBeGreaterThan(0);
    for (const narration of salaryNarrations) {
      const parsed = parseBankNarration(narration);
      expect(parsed.is_salary).toBe(true);
      expect(parsed.type).toBe('CREDIT');
    }
  });
});

describe('generateMockProfiles', () => {
  it('returns the requested count', () => {
    expect(generateMockProfiles(50, { seed: 1 })).toHaveLength(50);
    expect(generateMockProfiles(0)).toEqual([]);
  });

  it('injects schema-breaking anomalies at the configured rate', () => {
    const profiles = generateMockProfiles(20, {
      seed: 8,
      anomalyRate: 1,
      transactionsPerProfile: 10,
    });
    const invalid = profiles.filter((p) => !validateAAProfile(p).valid);
    expect(invalid.length).toBeGreaterThan(0);
    const malformed = profiles
      .flatMap((p) => p.Transaction)
      .filter((t) => t.amount === undefined || t.txnId === undefined || t.narration === undefined);
    expect(malformed.length).toBeGreaterThan(0);
  });

  it('produces narrations that stress the parser when anomalyRate is high', () => {
    const profiles = generateMockProfiles(10, {
      seed: 8,
      anomalyRate: 1,
      transactionsPerProfile: 10,
    });
    const weak = profiles
      .flatMap((p) => p.Transaction)
      .map((t) => parseBankNarration(String(t.narration ?? '')))
      .filter((p) => p.confidence < 0.9 || p.warnings.length > 0);
    expect(weak.length).toBeGreaterThan(0);
  });
});
