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

/** A canonical merchant with its known narration aliases. */
export interface MerchantEntry {
  readonly canonical: string;
  readonly aliases: readonly string[];
  readonly category: string;
  readonly mcc?: string;
}

/** What a UPI VPA suffix (@handle) tells us about the receiving side. */
export interface VpaHandleInfo {
  /** PSP app issuing the handle (e.g. 'PhonePe') or null for bank-native handles. */
  readonly app: string | null;
  /** Bank settling the handle, or null when unknown. */
  readonly bank: string | null;
}

/** Bank resolved from an IFSC prefix. `code` matches grammar-set bank tags. */
export interface IfscBankInfo {
  readonly name: string;
  readonly code: string;
}

interface MerchantsFile {
  readonly merchants: readonly MerchantEntry[];
}
interface VpaFile {
  readonly handles: Readonly<Record<string, VpaHandleInfo>>;
}
interface IfscFile {
  readonly banks: Readonly<Record<string, IfscBankInfo>>;
}

/** Locates `rules/entities/` across src, dist and installed-package layouts. */
function resolveEntitiesDir(): string {
  const candidates = [
    join(__dirname, 'rules', 'entities'),
    join(__dirname, '..', 'rules', 'entities'),
    join(__dirname, '..', '..', 'rules', 'entities'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    `@paniniapi/rules-engine: could not locate entities directory. Checked: ${candidates.join(', ')}`,
  );
}

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(resolveEntitiesDir(), file), 'utf8')) as T;
}

/** The three community datasets bundled under `rules/entities/`. */
export interface DictionaryData {
  readonly merchants: readonly MerchantEntry[];
  readonly vpaHandles: Readonly<Record<string, VpaHandleInfo>>;
  readonly ifscBanks: Readonly<Record<string, IfscBankInfo>>;
}

let merchantsCache: readonly MerchantEntry[] | undefined;
let vpaCache: Readonly<Record<string, VpaHandleInfo>> | undefined;
let ifscCache: Readonly<Record<string, IfscBankInfo>> | undefined;

/**
 * Injects dictionary data without touching the filesystem. Required for
 * browser/edge runtimes (the playground bundles the JSON at build time);
 * Node callers can ignore this — the bundled files load lazily.
 */
export function setDictionaries(data: DictionaryData): void {
  merchantsCache = data.merchants;
  vpaCache = data.vpaHandles;
  ifscCache = data.ifscBanks;
}

/** Loads the community merchant dictionary (cached). */
export function loadMerchants(): readonly MerchantEntry[] {
  merchantsCache ??= loadJson<MerchantsFile>('merchants.json').merchants;
  return merchantsCache;
}

/** Loads the VPA-handle map (cached). Keys are lowercase handles. */
export function loadVpaHandles(): Readonly<Record<string, VpaHandleInfo>> {
  vpaCache ??= loadJson<VpaFile>('vpa-handles.json').handles;
  return vpaCache;
}

/** Loads the IFSC-prefix → bank map (cached). Keys are 4-letter codes. */
export function loadIfscBanks(): Readonly<Record<string, IfscBankInfo>> {
  ifscCache ??= loadJson<IfscFile>('ifsc-codes.json').banks;
  return ifscCache;
}

/** Normalizes a counterparty string for dictionary matching. */
function normalizeKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a raw counterparty string to a canonical merchant.
 * Exact normalized match first, then longest-alias prefix match so
 * narrations like 'SWIGGY BUNDL TECH' still resolve to 'Swiggy'.
 */
export function lookupMerchant(counterparty: string | null | undefined): MerchantEntry | null {
  if (!counterparty) return null;
  const key = normalizeKey(counterparty);
  if (key.length === 0) return null;
  const merchants = loadMerchants();

  for (const entry of merchants) {
    if (normalizeKey(entry.canonical) === key || entry.aliases.some((a) => a === key)) {
      return entry;
    }
  }

  let best: MerchantEntry | null = null;
  let bestLen = 0;
  for (const entry of merchants) {
    for (const alias of [entry.canonical, ...entry.aliases]) {
      const norm = normalizeKey(alias);
      if (norm.length > bestLen && key.startsWith(`${norm} `)) {
        best = entry;
        bestLen = norm.length;
      }
    }
  }
  return best;
}

/** Resolves a VPA handle ('okaxis') to its app/bank, or null. */
export function lookupVpaHandle(handle: string | null | undefined): VpaHandleInfo | null {
  if (!handle) return null;
  return loadVpaHandles()[handle.toLowerCase()] ?? null;
}

const IFSC_RE = /([A-Z]{4})0[A-Z0-9]{6}/;

/**
 * Resolves an IFSC code or 4-letter prefix to a bank. Accepts a full IFSC
 * ('HDFC0001234'), a bare prefix ('SBIN'), or any string containing an
 * IFSC-shaped token.
 */
export function lookupIfscBank(value: string | null | undefined): IfscBankInfo | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  const ifsc = IFSC_RE.exec(upper);
  const prefix =
    ifsc !== null ? ifsc[1] : /^[A-Z]{4}$/.test(upper.trim()) ? upper.trim() : undefined;
  if (prefix === undefined) return null;
  return loadIfscBanks()[prefix] ?? null;
}
