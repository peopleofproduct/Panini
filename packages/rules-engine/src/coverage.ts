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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBankNarration, type ParsedBankNarration } from './bankRules';

/** Fields a corpus sample may assert — any subset of the parse output. */
export type CorpusExpectation = Partial<
  Pick<
    ParsedBankNarration,
    | 'channel'
    | 'type'
    | 'ref_no'
    | 'merchant'
    | 'counterparty'
    | 'vpa'
    | 'is_salary'
    | 'date'
    | 'category'
    | 'merchant_canonical'
    | 'vpa_app'
    | 'vpa_bank'
    | 'ifsc_bank'
  >
>;

export interface CorpusSample {
  readonly input: string;
  readonly bankHint?: string;
  readonly expect: CorpusExpectation;
  readonly note?: string;
}

export interface CorpusFile {
  readonly bank: string;
  readonly samples: readonly CorpusSample[];
}

export interface ExpectationFailure {
  readonly field: keyof CorpusExpectation;
  readonly expected: unknown;
  readonly actual: unknown;
}

export interface BankCoverage {
  readonly bank: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly ruleMatched: number;
  readonly avgConfidence: number;
  readonly failures: readonly { input: string; failures: readonly ExpectationFailure[] }[];
}

/** Locates `rules/corpus/` across src, dist and installed-package layouts. */
function resolveCorpusDir(): string {
  const candidates = [
    join(__dirname, 'rules', 'corpus'),
    join(__dirname, '..', 'rules', 'corpus'),
    join(__dirname, '..', '..', 'rules', 'corpus'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    `@panini/rules-engine: could not locate corpus directory. Checked: ${candidates.join(', ')}`,
  );
}

/** Loads every corpus fixture file (community-maintained sample narrations). */
export function loadCorpus(dir?: string): readonly CorpusFile[] {
  const corpusDir = dir ?? resolveCorpusDir();
  return readdirSync(corpusDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(corpusDir, file), 'utf8')) as CorpusFile);
}

/**
 * Diff one parsed sample against its expectations. Returns an empty array
 * when every asserted field matches.
 */
function parseSample(sample: CorpusSample): ParsedBankNarration {
  return parseBankNarration(
    sample.bankHint !== undefined
      ? { text: sample.input, bankHint: sample.bankHint }
      : sample.input,
  );
}

export function checkSample(sample: CorpusSample): readonly ExpectationFailure[] {
  const parsed = parseSample(sample);
  const failures: ExpectationFailure[] = [];
  for (const [field, expected] of Object.entries(sample.expect)) {
    const actual = parsed[field as keyof ParsedBankNarration];
    if (actual !== expected) {
      failures.push({ field: field as keyof CorpusExpectation, expected, actual });
    }
  }
  return failures;
}

/**
 * Runs the full corpus through the engine and returns per-bank coverage
 * stats — matched-rule rate, mean confidence and every expectation failure.
 * Used by the test gate and available for CI reporting.
 */
export function coverageReport(dir?: string): readonly BankCoverage[] {
  return loadCorpus(dir).map((file) => {
    let passed = 0;
    let ruleMatched = 0;
    let confidenceSum = 0;
    const failures: { input: string; failures: readonly ExpectationFailure[] }[] = [];

    for (const sample of file.samples) {
      const parsed = parseSample(sample);
      if (parsed.matched_rule !== null) ruleMatched++;
      confidenceSum += parsed.confidence;
      const sampleFailures = checkSample(sample);
      if (sampleFailures.length === 0) {
        passed++;
      } else {
        failures.push({ input: sample.input, failures: sampleFailures });
      }
    }

    return {
      bank: file.bank,
      total: file.samples.length,
      passed,
      failed: file.samples.length - passed,
      ruleMatched,
      avgConfidence: file.samples.length > 0 ? confidenceSum / file.samples.length : 0,
      failures,
    };
  });
}
