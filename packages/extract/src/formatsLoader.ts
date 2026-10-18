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
  /**
   * Account type the layout describes — `deposit` statements carry a
   * running balance; `credit_card` statements carry a signed amount +
   * direction column instead; `merchant` statements are settlement
   * exports (direction semantics differ from a bank account). Reported
   * as `metadata.accountKind`.
   */
  readonly kind?: 'deposit' | 'credit_card' | 'merchant';
  readonly requiredHeaders: readonly string[];
  /**
   * Normalized header cells that must NOT appear in the row — used to
   * keep narrow signatures (e.g. `date|transaction details|amount` on
   * card statements) from matching deposit tables that also carry
   * balance/debit/credit columns.
   */
  readonly forbiddenHeaders?: readonly string[];
  /**
   * Direction convention for single-amount columns: banks that export a
   * signed `Amount (INR)` column (e.g. Bank of Baroda .xls) treat an
   * unsigned positive value as a credit. Without this hint an unsigned
   * amount leaves `direction` null.
   */
  readonly unsignedAmount?: 'credit' | 'debit';
  readonly columns: Readonly<Record<string, readonly string[]>>;
}

export interface CsvLayoutsFile {
  readonly maxHeaderScanRows: number;
  readonly minRowsForDetection: number;
  readonly layouts: readonly CsvLayout[];
}

/** A canonical bank identity for preamble sniffing (`bank-names.json`). */
export interface BankName {
  readonly id: string;
  readonly names: readonly string[];
}

export interface BankNamesFile {
  readonly maxScanLines: number;
  readonly banks: readonly BankName[];
}

/**
 * Caller layouts are checked first and shadow bundled entries with the
 * same id — the same "caller wins" rule the grammar hotpatch path uses.
 */
export function mergeCsvLayouts(base: CsvLayoutsFile, extra?: CsvLayoutsFile): CsvLayoutsFile {
  if (extra === undefined) return base;
  const extraIds = new Set(extra.layouts.map((l) => l.id));
  return {
    ...base,
    layouts: [...extra.layouts, ...base.layouts.filter((l) => !extraIds.has(l.id))],
  };
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

/**
 * Like `loadFormatsJson` but returns undefined when the file is absent —
 * used for `extraFormatsDir`, where callers may provide only a subset of
 * the formats files.
 */
export function maybeLoadFormats<T>(name: string, dir: string): T | undefined {
  const path = join(dir, name);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
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

export function loadBankNames(dir?: string): BankNamesFile {
  return loadFormatsJson<BankNamesFile>('bank-names.json', dir);
}

/** Same caller-wins merge for the extra-formats seam. */
export function mergeSmsPatterns(base: SmsPatternsFile, extra?: SmsPatternsFile): SmsPatternsFile {
  if (extra === undefined) return base;
  const extraIds = new Set(extra.patterns.map((p) => p.id));
  return {
    ...base,
    patterns: [...extra.patterns, ...base.patterns.filter((p) => !extraIds.has(p.id))],
  };
}

export function mergeBankNames(base: BankNamesFile, extra?: BankNamesFile): BankNamesFile {
  if (extra === undefined) return base;
  const extraIds = new Set(extra.banks.map((b) => b.id));
  return {
    ...base,
    banks: [...extra.banks, ...base.banks.filter((b) => !extraIds.has(b.id))],
  };
}

export function mergePasswordPatterns(
  base: PasswordPatternsFile,
  extra?: PasswordPatternsFile,
): PasswordPatternsFile {
  if (extra === undefined) return base;
  return { ...base, patterns: [...extra.patterns, ...base.patterns] };
}
