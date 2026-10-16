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

import {
  Normalizer,
  type GrammarRuleSet,
  type RawInput,
  type TransactionChannel,
  type TransactionType,
} from '@panini/core';
import { loadBuiltinRuleSets, loadCategories } from './loader';

/**
 * High-priority grammar covering the dominant Indian-bank narration
 * archetypes. Patterns run before the bundled bank-specific and generic
 * rule sets (priority > 30).
 *
 * Archetypes covered:
 *  1. Full-pipeline UPI: `UPI/20261015/DR/826384910234/SWIGGY/okaxis/Cooking/`
 *  2. IMPS inbound/outbound: `IMPS-628491047-ZEPTO-HDFC-INBOUND`
 *  3. Salary credits: `NEFT-N3452618902-SALARY-OCTOBER 2026-TCS LTD`
 */
export const BANK_NARRATION_RULE_SET: GrammarRuleSet = {
  id: 'bank-narration-archetypes',
  bank: 'GENERIC',
  version: '2.0.0',
  description:
    'Dominant Indian banking narration archetypes: pipeline UPI, INBOUND/OUTBOUND IMPS, salary NEFT credits, alphanumeric reference rails.',
  patterns: [
    {
      // UPI/<yyyymmdd>/<DR|CR>/<ref>/<merchant>/<vpa>[/<purpose>][/]
      name: 'upi_full_pipeline',
      priority: 40,
      channel: 'UPI',
      media: 'narration',
      regexFlags: 'i',
      confidence: 0.95,
      regex:
        '^UPI[\\/](?<date>\\d{8}|\\d{2}[-/.]\\d{2}[-/.]\\d{2,4})[\\/](?<direction>DR|CR)[\\/](?<txnId>\\d{6,18})[\\/](?<counterparty>[^\\/]+?)[\\/](?<vpaHandle>@?[A-Za-z0-9._-]+)(?:[\\/](?<remarks>[^\\/]*))?[\\/]?\\s*$',
    },
    {
      // IMPS-<ref>-<merchant>-<bank>-<INBOUND|OUTBOUND>
      name: 'imps_directional',
      priority: 35,
      channel: 'IMPS',
      media: 'narration',
      regexFlags: 'i',
      confidence: 0.93,
      regex:
        '^IMPS[-/](?<txnId>\\d{6,16})[-/](?<counterparty>[^-/]+?)[-/ ](?<bankCode>[A-Z]{4}\\d{0,7})[-/](?<direction>INBOUND|OUTBOUND|INWARD|OUTWARD)\\b(?<tail>.*)$',
    },
    {
      // NEFT-<alnum-ref>-SALARY-<MONTH YEAR>-<employer>
      name: 'neft_salary_credit',
      priority: 40,
      channel: 'NEFT',
      type: 'CREDIT',
      category: 'Income',
      media: 'narration',
      regexFlags: 'i',
      confidence: 0.95,
      regex:
        '^NEFT[-/](?<txnId>[A-Z]{0,3}\\d{5,16})[-/]SAL(?:ARY)?[-/ ](?<remarks>[A-Za-z]+\\s*\\d{4})[-/](?<counterparty>.+?)\\s*$',
      setMetadata: { is_salary: 'true' },
    },
    {
      // NEFT-<alnum-ref>-<counterparty>[-<remarks>] — refs like N3452618902
      name: 'neft_alnum_ref',
      priority: 30,
      channel: 'NEFT',
      media: 'narration',
      regexFlags: 'i',
      confidence: 0.85,
      regex:
        '^NEFT[-/](?<txnId>[A-Z0-9]{6,18})[-/](?<counterparty>[^-]+)(?:[-/](?<remarks>.+?))?\\s*$',
    },
    {
      // RTGS-<alnum-ref>-<counterparty>
      name: 'rtgs_alnum_ref',
      priority: 30,
      channel: 'RTGS',
      media: 'narration',
      regexFlags: 'i',
      confidence: 0.85,
      regex:
        '^RTGS[-/](?<txnId>[A-Z0-9]{6,18})[-/](?<counterparty>[^-]+)(?:[-/](?<remarks>.+?))?\\s*$',
    },
    {
      // ACH/ECS credits (dividends, refunds): ACH-CR-<ref>-<counterparty>
      name: 'ach_credit',
      priority: 30,
      channel: 'ACH',
      media: 'narration',
      regexFlags: 'i',
      regex:
        '^(?:ACH|ECS)[-/ ](?<direction>CR|DR)[-/ ](?<txnId>[A-Z0-9]{6,18})[-/](?<counterparty>.+?)\\s*$',
    },
    {
      // Bare cash deposit/withdrawal narrations: CASH WDL-SELF / CASH DEP-BRANCH
      name: 'cash_transaction',
      priority: 30,
      channel: 'ATM',
      media: 'narration',
      regexFlags: 'i',
      regex: '^CASH[-/ ](?<direction>WDL|DEP|WITHDRAWAL|DEPOSIT)[-/ ](?<counterparty>.+?)\\s*$',
      setMetadata: { instrument: 'CASH' },
    },
  ],
};

/** All rule sets a consumer should load for maximum archetype coverage. */
export const BANK_RULE_SETS: readonly GrammarRuleSet[] = [BANK_NARRATION_RULE_SET];

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
}

export interface ParseBankNarrationOptions {
  /** Extra rule sets merged in *after* the archetype + builtin sets. */
  readonly ruleSets?: readonly GrammarRuleSet[];
  /** Category keyword table; defaults to the bundled categories.json. */
  readonly categories?: Record<string, string>;
  /** Skip loading bundled rules — use only archetypes + provided ruleSets. */
  readonly bare?: boolean;
}

/**
 * Corporate suffixes that always get title-cased even when a neighbouring
 * word stays uppercase ('TCS LTD' → 'TCS Ltd').
 */
const CORPORATE_SUFFIXES: ReadonlySet<string> = new Set([
  'LTD',
  'PVT',
  'INC',
  'LLP',
  'LLC',
  'CORP',
  'CO',
]);

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
 *
 * Wired into the Normalizer via `NormalizerOptions.displayCase`.
 */
export function preserveAcronymCase(value: string): string {
  const words = value
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length <= 1) return titleCase(words[0] ?? value);
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
      ruleSets: [...BANK_RULE_SETS, ...loadBuiltinRuleSets()],
      categories: loadCategories(),
      displayCase: preserveAcronymCase,
    });
    return defaultNormalizer;
  }
  return new Normalizer({
    ruleSets: [
      BANK_NARRATION_RULE_SET,
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
  return {
    channel: txn.channel,
    type: txn.type,
    ref_no: txn.transactionId,
    merchant: txn.counterparty,
    counterparty: txn.counterparty,
    vpa: txn.vpaHandle,
    is_salary: txn.metadata['is_salary'] === 'true',
    date: txn.date,
    category: txn.category,
    confidence: txn.confidence,
    matched_rule: txn.matchedRule,
    warnings: txn.warnings,
  };
}
