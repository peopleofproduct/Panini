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

import { parsePaise } from './amounts';
import { parseIndianDate } from './dates';
import { compileRuleSets, type CompiledPattern, type GrammarRuleSet } from './grammar';
import { CHANNEL_KEYWORDS, DIRECTION_KEYWORDS, tokenize, type Token } from './tokenizer';
import type {
  InputSource,
  NormalizedTransaction,
  RawInput,
  TransactionChannel,
  TransactionType,
} from './types';

export interface NormalizerOptions {
  /** Grammar rule sets, e.g. loaded from @panini/rules-engine. */
  readonly ruleSets: readonly GrammarRuleSet[];
  /** Global keyword → category table merged over rule-set categories. */
  readonly categories?: Record<string, string>;
  /**
   * Optional display-casing policy applied to extracted counterparty names.
   * Defaults to plain title-casing; consumers can inject rules such as
   * acronym preservation (@panini/rules-engine's `preserveAcronymCase`).
   */
  readonly displayCase?: (value: string) => string;
}

const SMS_SIGNAL = /\b(debited|credited|avl\s*bal|a\/c\s*(?:no|xx|\*+))/i;
const REVERSAL_TYPES: ReadonlySet<TransactionType> = new Set(['REVERSAL', 'REFUND']);
const DIRECTION_TYPES: ReadonlySet<TransactionType> = new Set(['DEBIT', 'CREDIT']);

const AA_MODE_TO_CHANNEL: Readonly<Record<string, TransactionChannel>> = {
  UPI: 'UPI',
  IMPS: 'IMPS',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  ATM: 'ATM',
  CASH: 'ATM',
  POS: 'POS',
  CARD: 'POS',
  NACH: 'NACH',
  ACH: 'ACH',
};

interface CategoryRule {
  readonly keyword: string;
  readonly category: string;
  readonly matcher: RegExp;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

function sanitize(text: string): string {
  // Strip control bytes, then collapse whitespace.
  return text.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

function detectSource(text: string): Exclude<InputSource, 'auto'> {
  return SMS_SIGNAL.test(text) ? 'sms' : 'narration';
}

/**
 * Default display-casing: title-cases each word of all-caps or all-lower
 * input, leaves deliberate mixed case untouched. Consumers needing
 * acronym-aware casing inject a `displayCase` option.
 */
function toDisplayCase(value: string): string {
  if (value !== value.toUpperCase() && value !== value.toLowerCase()) return value;
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function cleanCounterparty(
  value: string | undefined,
  displayCase: (v: string) => string,
): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/^(?:(?:M\/S|TO|BY|FROM|AT|THE|UPI|IMPS|NEFT|RTGS|ECS|ACH|NACH)[\s\-/]+)+/i, '')
    .replace(/[\s\-./]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? displayCase(cleaned) : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveType(
  patternType: TransactionType | undefined,
  directionGroup: string | undefined,
  flagTypes: readonly TransactionType[],
): TransactionType {
  if (patternType) return patternType;
  if (directionGroup) {
    const mapped = DIRECTION_KEYWORDS[directionGroup.toUpperCase()];
    if (mapped) return mapped;
  }
  const direction = flagTypes.find((t) => DIRECTION_TYPES.has(t));
  if (direction) return direction;
  const reversal = flagTypes.find((t) => REVERSAL_TYPES.has(t));
  return reversal ?? 'UNKNOWN';
}

function emptyResult(raw: string, warnings: readonly string[]): NormalizedTransaction {
  return {
    channel: 'UNKNOWN',
    counterparty: null,
    transactionId: null,
    vpaHandle: null,
    type: 'UNKNOWN',
    category: 'Uncategorized',
    date: null,
    amountPaise: null,
    balancePaise: null,
    currency: 'INR',
    accountMask: null,
    raw,
    matchedRule: null,
    bank: null,
    confidence: 0,
    metadata: {},
    warnings,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const NARRATION_FIELDS = ['narration', 'description', 'remarks', 'remitterNarration'] as const;
const NESTED_CONTAINERS = ['transaction', 'txn', 'data'] as const;

function findNarration(payload: Record<string, unknown>): string | undefined {
  for (const field of NARRATION_FIELDS) {
    const v = payload[field];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const key of NESTED_CONTAINERS) {
    const nested = payload[key];
    if (isRecord(nested)) {
      const found = findNarration(nested);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Grammar-driven transaction normalizer. Deterministic, in-memory, and
 * completely offline — the engine makes no I/O of any kind.
 */
export class Normalizer {
  private readonly patterns: readonly CompiledPattern[];
  private readonly categoryRules: readonly CategoryRule[];
  private readonly displayCase: (value: string) => string;

  constructor(options: NormalizerOptions) {
    this.patterns = compileRuleSets(options.ruleSets);
    this.displayCase = options.displayCase ?? toDisplayCase;
    const merged: Record<string, string> = {};
    for (const rs of options.ruleSets) {
      if (rs.categories) Object.assign(merged, rs.categories);
    }
    if (options.categories) Object.assign(merged, options.categories);
    this.categoryRules = Object.keys(merged)
      .sort((a, b) => b.length - a.length)
      .map((keyword) => ({
        keyword,
        category: merged[keyword]!,
        matcher: new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i'),
      }));
  }

  /** Normalizes a narration string or {@link RawInput} into a typed record. */
  normalize(input: string | RawInput): NormalizedTransaction {
    const req: RawInput = typeof input === 'string' ? { text: input } : input;
    const raw = req.text;
    const text = sanitize(raw);
    if (text.length === 0) {
      return emptyResult(raw, ['input is empty']);
    }
    const source: Exclude<InputSource, 'auto'> =
      req.source !== undefined && req.source !== 'auto' ? req.source : detectSource(text);

    const warnings: string[] = [];
    for (const pattern of this.candidates(source, req.bankHint)) {
      const match = pattern.regex.exec(text);
      if (match) {
        return this.buildFromMatch(pattern, match, text, raw, warnings);
      }
    }
    return this.heuristicParse(text, raw, req.bankHint, warnings);
  }

  /**
   * Normalizes an Account Aggregator-style payload. Structured fields
   * present in the payload (amount, type, mode, dates) take precedence over
   * values inferred from the embedded narration string.
   */
  normalizePayload(payload: unknown): NormalizedTransaction {
    if (typeof payload === 'string') return this.normalize(payload);
    if (!isRecord(payload)) {
      return emptyResult(String(payload), ['payload is not a string or object']);
    }

    const narration = findNarration(payload);
    const base = narration !== undefined ? this.normalize(narration) : emptyResult('', []);
    const warnings = [...base.warnings];
    const metadata = { ...base.metadata };
    let confidence = base.confidence;
    let merged = 0;

    const txnId = payload['txnId'];
    const amount = payload['amount'];
    const type = payload['type'];
    const mode = payload['mode'];
    const valueDate = payload['valueDate'];
    const timestamp = payload['transactionTimestamp'];
    const balance = payload['balance'];
    const reference = payload['reference'];

    const transactionId =
      typeof txnId === 'string' || typeof txnId === 'number' ? String(txnId) : base.transactionId;
    if (typeof txnId === 'string' || typeof txnId === 'number') merged++;

    let amountPaise = base.amountPaise;
    if (typeof amount === 'string' || typeof amount === 'number') {
      const parsed = parsePaise(String(amount));
      if (parsed !== null) {
        amountPaise = parsed;
        merged++;
      } else {
        warnings.push(`unparseable amount '${String(amount)}'`);
      }
    }

    let txnType = base.type;
    if (typeof type === 'string') {
      const upper = type.toUpperCase();
      if (upper === 'DEBIT' || upper === 'CREDIT') {
        txnType = upper;
        merged++;
      } else if (upper !== 'OTHERS') {
        warnings.push(`unrecognized transaction type '${type}'`);
      }
    }

    let channel = base.channel;
    if (typeof mode === 'string') {
      channel = AA_MODE_TO_CHANNEL[mode.toUpperCase()] ?? 'UNKNOWN';
      merged++;
    }

    let date = base.date;
    for (const candidate of [valueDate, timestamp]) {
      if (typeof candidate === 'string' && candidate.length >= 10) {
        const iso = candidate.slice(0, 10);
        const parsed = parseIndianDate(iso) ?? (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null);
        if (parsed !== null) {
          date = parsed;
          merged++;
          break;
        }
        warnings.push(`unparseable payload date '${candidate}'`);
      }
    }

    let balancePaise = base.balancePaise;
    if (typeof balance === 'string' || typeof balance === 'number') {
      const parsed = parsePaise(String(balance));
      if (parsed !== null) {
        balancePaise = parsed;
        merged++;
      }
    }

    if (typeof reference === 'string' && reference.length > 0) {
      metadata['reference'] = reference;
    }
    if (merged > 0) {
      confidence = Math.min(0.98, confidence + 0.08);
      warnings.push(`merged ${merged} structured payload field(s)`);
    }

    return {
      ...base,
      transactionId,
      amountPaise,
      type: txnType,
      channel,
      date,
      balancePaise,
      confidence,
      metadata,
      warnings,
    };
  }

  private candidates(
    source: Exclude<InputSource, 'auto'>,
    bankHint: string | undefined,
  ): readonly CompiledPattern[] {
    const applicable = this.patterns.filter((p) => p.media === 'any' || p.media === source);
    if (!bankHint) return applicable;
    const hint = bankHint.toUpperCase();
    const preferred = applicable.filter((p) => p.bank.toUpperCase() === hint);
    const rest = applicable.filter((p) => p.bank.toUpperCase() !== hint);
    return [...preferred, ...rest];
  }

  private buildFromMatch(
    pattern: CompiledPattern,
    match: RegExpExecArray,
    text: string,
    raw: string,
    warnings: string[],
  ): NormalizedTransaction {
    const groups: Record<string, string | undefined> = match.groups ?? {};
    const metadata: Record<string, string> = {};

    const flagTypes: TransactionType[] = [];
    const appliedFlags: string[] = [];
    if (groups['tail']) {
      for (const token of tokenize(groups['tail'])) {
        const upper = token.value.toUpperCase();
        const mapped = pattern.flags[upper] ?? DIRECTION_KEYWORDS[upper];
        if (mapped !== undefined) {
          flagTypes.push(mapped);
          appliedFlags.push(upper);
        }
      }
    }
    if (appliedFlags.length > 0) metadata['flags'] = appliedFlags.join(',');
    if (groups['remarks']) metadata['remarks'] = groups['remarks'].trim();
    if (groups['bankCode']) metadata['bank_code'] = groups['bankCode'].trim();
    // Rule-authored metadata wins over computed values (e.g. is_salary).
    Object.assign(metadata, pattern.setMetadata);

    const tokens = tokenize(text);
    const channel = pattern.channel ?? this.channelFromTokens(tokens) ?? 'UNKNOWN';
    const type = resolveType(pattern.type, groups['direction'], flagTypes);

    const counterparty = cleanCounterparty(groups['counterparty'], this.displayCase);
    const transactionId = groups['txnId']?.trim() ?? null;

    let vpaHandle = groups['vpaHandle'] ?? null;
    if (vpaHandle !== null) vpaHandle = vpaHandle.replace(/^@/, '').toLowerCase();

    const date = this.parseField(groups['date'], parseIndianDate, 'date', warnings);
    const amountPaise = this.parseField(groups['amount'], parsePaise, 'amount', warnings);
    const balancePaise = this.parseField(groups['balance'], parsePaise, 'balance', warnings);
    const accountMask = groups['accountMask']?.trim() ?? null;

    const category =
      pattern.category ?? this.categorize(`${counterparty ?? ''} ${text}`) ?? 'Uncategorized';

    return {
      channel,
      counterparty,
      transactionId: transactionId !== null && transactionId.length > 0 ? transactionId : null,
      vpaHandle,
      type,
      category,
      date,
      amountPaise,
      balancePaise,
      currency: 'INR',
      accountMask,
      raw,
      matchedRule: `${pattern.ruleSetId}:${pattern.name}`,
      bank: pattern.bank === 'GENERIC' ? null : pattern.bank,
      confidence: pattern.confidence,
      metadata,
      warnings: [...warnings],
    };
  }

  private parseField<T extends string | number>(
    value: string | undefined,
    parser: (v: string) => T | null,
    label: string,
    warnings: string[],
  ): T | null {
    if (value === undefined || value.trim().length === 0) return null;
    const parsed = parser(value.trim());
    if (parsed === null) warnings.push(`unparseable ${label} '${value.trim()}'`);
    return parsed;
  }

  private channelFromTokens(tokens: readonly Token[]): TransactionChannel | null {
    for (const token of tokens) {
      const channel = CHANNEL_KEYWORDS[token.value.toUpperCase()];
      if (channel !== undefined) return channel;
    }
    return null;
  }

  private categorize(text: string): string | null {
    for (const rule of this.categoryRules) {
      if (rule.matcher.test(text)) return rule.category;
    }
    return null;
  }

  /**
   * Best-effort parse used when no grammar pattern matches. Driven purely by
   * the tokenizer's lexical classification.
   */
  private heuristicParse(
    text: string,
    raw: string,
    bankHint: string | undefined,
    warnings: string[],
  ): NormalizedTransaction {
    const tokens = tokenize(text);
    const metadata: Record<string, string> = {};
    const flagTypes: TransactionType[] = [];
    const appliedFlags: string[] = [];
    for (const token of tokens) {
      const mapped = DIRECTION_KEYWORDS[token.value.toUpperCase()];
      if (mapped !== undefined) {
        flagTypes.push(mapped);
        appliedFlags.push(token.value.toUpperCase());
      }
    }
    if (appliedFlags.length > 0) metadata['flags'] = appliedFlags.join(',');

    const channel = this.channelFromTokens(tokens) ?? 'UNKNOWN';
    const type = resolveType(undefined, undefined, flagTypes);

    let transactionId: string | null = null;
    let vpaHandle: string | null = null;
    const vpaToken = tokens.find((t) => t.kind === 'VPA');
    if (vpaToken) {
      const [left = '', right = ''] = vpaToken.value.split('@');
      if (/^\d+$/.test(left)) transactionId = left;
      // VPA handles are alphanumeric — anything else is noise, not a handle.
      if (/^[a-zA-Z0-9]+$/.test(right)) vpaHandle = right.toLowerCase();
    }
    if (transactionId === null) {
      const idToken = tokens
        .filter((t) => t.kind === 'NUMERIC' && t.value.length >= 6)
        .sort((a, b) => b.value.length - a.value.length)[0];
      transactionId = idToken?.value ?? null;
    }

    const dateToken = tokens.find((t) => t.kind === 'DATE');
    const date = dateToken !== undefined ? parseIndianDate(dateToken.value) : null;
    const amountToken = tokens.find((t) => t.kind === 'AMOUNT');
    const amountPaise = amountToken !== undefined ? parsePaise(amountToken.value) : null;

    const channelPosition = tokens.find(
      (t) => CHANNEL_KEYWORDS[t.value.toUpperCase()] !== undefined,
    )?.position;
    const counterpartyToken = tokens.find(
      (t) =>
        (t.kind === 'ALPHA' || t.kind === 'ALNUM') &&
        t.value.length >= 3 &&
        CHANNEL_KEYWORDS[t.value.toUpperCase()] === undefined &&
        DIRECTION_KEYWORDS[t.value.toUpperCase()] === undefined &&
        (channelPosition === undefined || t.position > channelPosition),
    );
    const counterparty = counterpartyToken ? this.displayCase(counterpartyToken.value) : null;

    const category = this.categorize(`${counterparty ?? ''} ${text}`) ?? 'Uncategorized';

    warnings.push('no grammar pattern matched; applied heuristic tokenization');

    return {
      channel,
      counterparty,
      transactionId,
      vpaHandle,
      type,
      category,
      date,
      amountPaise,
      balancePaise: null,
      currency: 'INR',
      accountMask: null,
      raw,
      matchedRule: null,
      bank: bankHint ?? null,
      confidence: 0.55,
      metadata,
      warnings: [...warnings],
    };
  }
}
