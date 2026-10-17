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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PasswordPatternsFile } from './pdf/encryption';

export type { PasswordPattern, PasswordPatternsFile } from './pdf/encryption';

/** A bank CSV/Excel layout: header signature + semantic column mapping. */
export interface CsvLayout {
  readonly id: string;
  readonly bank: string;
  readonly requiredHeaders: readonly string[];
  readonly columns: Readonly<Record<string, readonly string[]>>;
}

export interface CsvLayoutsFile {
  readonly maxHeaderScanRows: number;
  readonly minRowsForDetection: number;
  readonly layouts: readonly CsvLayout[];
}

/** One SMS extraction pattern; regex uses JS syntax with named groups. */
export interface SmsPattern {
  readonly id: string;
  readonly bank: string;
  readonly regex: string;
  readonly flags?: string;
  readonly direction?: string;
}

export interface SmsPatternsFile {
  readonly patterns: readonly SmsPattern[];
  /** Regex with a named `balance` group for "Avl Bal" extraction. */
  readonly balanceRegex?: string;
  /** Regex with a named `date` group for SMS dates. */
  readonly dateRegex?: string;
}

/**
 * Locates the bundled `formats/` directory across dev (`src`), build
 * (`dist`) and installed-package layouts.
 */
export function resolveFormatsDir(dir?: string): string {
  if (dir) return dir;
  const candidates = [
    join(__dirname, 'formats'),
    join(__dirname, '..', 'formats'),
    join(__dirname, '..', '..', 'formats'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'csv-layouts.json'))) return candidate;
  }
  throw new Error(
    `@paniniapi/extract: could not locate bundled formats directory. Checked: ${candidates.join(', ')}`,
  );
}

// The bundled formats directory never changes during a process lifetime —
// cache its parsed files so per-statement calls don't re-read disk. Explicit
// caller-supplied dirs stay uncached (tests/dev workflows write them).
const defaultCache = new Map<string, unknown>();

function loadFormatsJson<T>(name: string, dir: string | undefined): T {
  if (dir !== undefined) {
    return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
  }
  const cached = defaultCache.get(name);
  if (cached !== undefined) return cached as T;
  const parsed = JSON.parse(readFileSync(join(resolveFormatsDir(), name), 'utf8')) as T;
  defaultCache.set(name, parsed);
  return parsed;
}

export function loadCsvLayouts(dir?: string): CsvLayoutsFile {
  return loadFormatsJson<CsvLayoutsFile>('csv-layouts.json', dir);
}

export function loadSmsPatterns(dir?: string): SmsPatternsFile {
  return loadFormatsJson<SmsPatternsFile>('sms-patterns.json', dir);
}

export function loadPasswordPatterns(dir?: string): PasswordPatternsFile {
  return loadFormatsJson<PasswordPatternsFile>('pdf-passwords.json', dir);
}
