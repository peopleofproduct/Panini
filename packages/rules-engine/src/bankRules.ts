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

import {
  Normalizer,
  type GrammarRuleSet,
  type RawInput,
  type TransactionChannel,
  type TransactionType,
} from '@paniniapi/core';
import { loadBuiltinRuleSets, loadCategories } from './loader';
import { lookupIfscBank, lookupMcc, lookupMerchant, lookupVpaHandle } from './dictionary';

/**
 * Structured output of {@link parseBankNarration}. Field names follow the
 * downstream enterprise API contract (snake_case) rather than the internal
 * `NormalizedTransaction` shape.
 */
export interface ParsedBankNarration {
  readonly channel: TransactionChannel;
  readonly type: TransactionType;
  /** Bank reference / transaction id, e.g. '826384910234' or 'N3452618902'. */
  readonly ref_no: string | null;
  /** Merchant name when the counterparty is a business (e.g. 'Swiggy'). */
  readonly merchant: string | null;
  /** Cleaned counterparty — always equals `merchant` when one was detected. */
  readonly counterparty: string | null;
  /** UPI VPA handle (e.g. 'okaxis') when present. */
  readonly vpa: string | null;
  /** True when the narration is a salary credit. */
  readonly is_salary: boolean;
  /** ISO-8601 date or null when absent/corrupt. */
  readonly date: string | null;
  readonly category: string;
  readonly confidence: number;
  readonly matched_rule: string | null;
  readonly warnings: readonly string[];
  /** Canonical merchant name from the community dictionary, when matched. */
  readonly merchant_canonical: string | null;
  /** PSP app behind the VPA handle (e.g. 'PhonePe'), or null. */
  readonly vpa_app: string | null;
  /** Bank behind the VPA handle (e.g. 'Axis Bank'), or null. */
  readonly vpa_bank: string | null;
  /** Bank resolved from an embedded IFSC/bank code, or null. */
  readonly ifsc_bank: string | null;
  /** ISO 18245 merchant category code when the narration carries one or the
   *  merchant dictionary declares it, or null. */
  readonly mcc: string | null;
  /** Human-readable MCC description (e.g. 'Grocery stores and supermarkets'). */
  readonly mcc_description: string | null;
}

export interface ParseBankNarrationOptions {
  /** Extra rule sets merged in *after* the bundled grammar sets. */
  readonly ruleSets?: readonly GrammarRuleSet[];
  /** Category keyword table; defaults to the bundled categories.json. */
  readonly categories?: Record<string, string>;
  /** Skip loading bundled rules — use only the provided ruleSets. */
  readonly bare?: boolean;
  /**
   * Dictionary enrichment (canonical merchant, VPA/IFSC resolution,
   * category upgrade). Defaults to true; set false for the rawest output.
   */
  readonly enrich?: boolean;
}

/**
 * Corporate suffixes that always get title-cased even when a neighbouring
 * word stays uppercase ('TCS LTD' → 'TCS Ltd').
 */
const CORPORATE_SUFFIXES: ReadonlySet<string> = new Set(['LTD', 'PVT', 'INC', 'CORP', 'CO']);

/** Matches standalone abbreviations: 2–5 uppercase letters. */
const ACRONYM_RE = /^[A-Z]{2,5}$/;

function titleCase(word: string): string {
  return word.length > 0 ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : word;
}

/**
 * Regex-driven display casing for extracted counterparty names —
 * abbreviations detected via `\b[A-Z]{2,5}\b` keep their uppercase form,
 * corporate suffixes become title-case, everything else is title-cased.
 *
 *   'HDFC BANK'        → 'HDFC BANK'
 *   'TCS LTD'          → 'TCS Ltd'
 *   'EMPLOYER PVT LTD' → 'Employer Pvt Ltd'
 *   'ZEPTO'            → 'Zepto'   (a lone word is a brand, not an acronym)
 *   'EPFO'             → 'EPFO'    (short lone abbreviations stay uppercase)
 *
 * Wired into the Normalizer via `NormalizerOptions.displayCase`.
 */
export function preserveAcronymCase(value: string): string {
  const words = value
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length <= 1) {
    const word = words[0] ?? value;
    return /^[A-Z]{2,4}$/.test(word) ? word : titleCase(word);
  }
  return words
    .map((word) => {
      if (CORPORATE_SUFFIXES.has(word.toUpperCase())) return titleCase(word);
      if (ACRONYM_RE.test(word)) return word;
      return titleCase(word);
    })
    .join(' ');
}

let defaultNormalizer: Normalizer | undefined;

function buildNormalizer(options?: ParseBankNarrationOptions): Normalizer {
  if (options === undefined) {
    defaultNormalizer ??= new Normalizer({
      ruleSets: loadBuiltinRuleSets(),
      categories: loadCategories(),
      displayCase: preserveAcronymCase,
    });
    return defaultNormalizer;
  }
  return new Normalizer({
    ruleSets: [
      ...(options.bare === true ? [] : loadBuiltinRuleSets()),
      ...(options.ruleSets ?? []),
    ],
    categories: options.categories ?? loadCategories(),
    displayCase: preserveAcronymCase,
  });
}

/**
 * Normalizes a bank narration into the enterprise API's snake_case
 * contract. Runs entirely in memory; never throws on malformed input —
 * failures surface as `confidence`/`warnings` instead.
 */
export function parseBankNarration(
  input: string | RawInput,
  options?: ParseBankNarrationOptions,
): ParsedBankNarration {
  const txn = buildNormalizer(options).normalize(input);
  const doEnrich = options?.enrich !== false;

  // Dictionary enrichment: canonical merchant identity, VPA handle
  // resolution, and IFSC bank resolution. Category upgrades apply only when
  // keyword matching left the transaction Uncategorized.
  const merchantEntry = doEnrich ? lookupMerchant(txn.counterparty) : null;
  const vpaInfo = doEnrich ? lookupVpaHandle(txn.vpaHandle) : null;
  const ifscSource = txn.metadata['bank_code'] ?? (doEnrich ? txn.raw : null);
  const ifscInfo = doEnrich ? lookupIfscBank(ifscSource) : null;
  // MCC can come from the narration itself ('POS 5411' / 'MCC-5411' tokens)
  // or from the merchant dictionary entry.
  const mccToken = txn.metadata['mcc'] ?? (doEnrich ? txn.raw : null);
  const mccFromNarration = doEnrich ? lookupMcc(mccToken) : null;
  const mccEntry =
    doEnrich && mccFromNarration === null && merchantEntry?.mcc !== undefined
      ? lookupMcc(merchantEntry.mcc)
      : mccFromNarration;

  const merchant = merchantEntry?.canonical ?? txn.counterparty;
  const category =
    txn.category === 'Uncategorized' && merchantEntry !== null
      ? merchantEntry.category
      : txn.category === 'Uncategorized' && mccEntry !== null
        ? mccEntry.category
        : txn.category;

  return {
    channel: txn.channel,
    type: txn.type,
    ref_no: txn.transactionId,
    merchant,
    counterparty: txn.counterparty,
    vpa: txn.vpaHandle,
    is_salary: txn.metadata['is_salary'] === 'true',
    date: txn.date,
    category,
    confidence: txn.confidence,
    matched_rule: txn.matchedRule,
    warnings: txn.warnings,
    merchant_canonical: merchantEntry?.canonical ?? null,
    vpa_app: vpaInfo?.app ?? null,
    vpa_bank: vpaInfo?.bank ?? null,
    ifsc_bank: ifscInfo?.name ?? null,
    mcc: extractMccToken(mccToken) ?? merchantEntry?.mcc ?? null,
    mcc_description: mccEntry?.description ?? null,
  };
}

const MCC_TOKEN_RE = /\bMCC[-\s:]?(\d{4})\b/i;

/** Pulls a bare 4-digit MCC out of a narration token, or null. */
function extractMccToken(raw: string | null): string | null {
  if (raw === null) return null;
  const m = MCC_TOKEN_RE.exec(raw);
  return m !== null && m[1] !== undefined ? m[1] : null;
}
