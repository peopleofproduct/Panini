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

import type { TransactionChannel, TransactionType } from './types';

/**
 * A single grammar rule. `regex` may use named capture groups; the engine
 * understands the conventional group names:
 * `counterparty`, `txnId`, `vpaHandle`, `date`, `amount`, `balance`,
 * `accountMask`, `direction`, `tail`.
 */
export interface GrammarPattern {
  readonly name: string;
  readonly regex: string;
  /** Optional flags for the RegExp constructor, e.g. 'i'. */
  readonly regexFlags?: string;
  /** Which inputs this pattern applies to. Defaults to 'any'. */
  readonly media?: 'narration' | 'sms' | 'any';
  readonly channel?: TransactionChannel;
  readonly type?: TransactionType;
  readonly category?: string;
  /** Higher-priority patterns are tried first. Defaults to 0. */
  readonly priority?: number;
  /** Confidence awarded on match; defaults to 0.9. */
  readonly confidence?: number;
  /** Maps tokens found in the `tail` group to a transaction type. */
  readonly flags?: Record<string, TransactionType>;
}

/** A versioned bank grammar file as loaded from JSON. */
export interface GrammarRuleSet {
  readonly id: string;
  /** Issuing bank code, or 'GENERIC' for cross-bank patterns. */
  readonly bank: string;
  readonly version: string;
  readonly description?: string;
  /** Keyword → spend category overrides bundled with this rule set. */
  readonly categories?: Record<string, string>;
  readonly patterns: readonly GrammarPattern[];
}

export interface CompiledPattern {
  readonly name: string;
  readonly ruleSetId: string;
  readonly bank: string;
  readonly regex: RegExp;
  readonly media: 'narration' | 'sms' | 'any';
  readonly channel: TransactionChannel | undefined;
  readonly type: TransactionType | undefined;
  readonly category: string | undefined;
  readonly priority: number;
  readonly confidence: number;
  readonly flags: Record<string, TransactionType>;
}

export class GrammarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrammarError';
  }
}

/** Compiles one rule set, validating every regex eagerly. */
export function compileRuleSet(ruleSet: GrammarRuleSet): readonly CompiledPattern[] {
  if (!ruleSet.id || !ruleSet.bank) {
    throw new GrammarError(`Rule set is missing required 'id' or 'bank' field`);
  }
  return ruleSet.patterns.map((p) => {
    let regex: RegExp;
    try {
      regex = new RegExp(p.regex, p.regexFlags ?? '');
    } catch (err) {
      throw new GrammarError(
        `Invalid regex in pattern '${p.name}' of rule set '${ruleSet.id}': ${(err as Error).message}`,
      );
    }
    return {
      name: p.name,
      ruleSetId: ruleSet.id,
      bank: ruleSet.bank,
      regex,
      media: p.media ?? 'any',
      channel: p.channel,
      type: p.type,
      category: p.category,
      priority: p.priority ?? 0,
      confidence: p.confidence ?? 0.9,
      flags: p.flags ?? {},
    };
  });
}

/**
 * Compiles multiple rule sets into a single ordered pattern list.
 * Ordering: priority (desc), then bank-specific before GENERIC, stable.
 */
export function compileRuleSets(ruleSets: readonly GrammarRuleSet[]): readonly CompiledPattern[] {
  const compiled = ruleSets.flatMap((rs) => compileRuleSet(rs));
  return compiled
    .map((pattern, index) => ({ pattern, index }))
    .sort((a, b) => {
      if (b.pattern.priority !== a.pattern.priority) {
        return b.pattern.priority - a.pattern.priority;
      }
      const aGeneric = a.pattern.bank === 'GENERIC' ? 1 : 0;
      const bGeneric = b.pattern.bank === 'GENERIC' ? 1 : 0;
      if (aGeneric !== bGeneric) return aGeneric - bGeneric;
      return a.index - b.index;
    })
    .map((entry) => entry.pattern);
}
