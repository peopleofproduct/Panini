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

/**
 * Grammar-rule suggestion: given narrations the current grammar can't
 * match (e.g. after a bank format change), align their token skeletons
 * and draft a candidate pattern. The draft is *self-tested* against the
 * full corpus so a suggestion that would shadow existing expectations is
 * flagged unsafe rather than silently shipped.
 */

import type { GrammarPattern, GrammarRuleSet } from '@paniniapi/core';
import { parseBankNarration } from './bankRules';
import { loadCorpus } from './coverage';

const SEPARATORS = /[-/:|]+|\s+/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Classify one token column across samples → regex fragment + role. */
function columnFragment(
  tokens: readonly string[],
  col: number,
): { re: string; role: string } | null {
  const unique = new Set(tokens);
  if (unique.size === 1) return { re: escapeRe(tokens[0]!), role: 'literal' };
  const allDigits = tokens.every((t) => /^\d+$/.test(t));
  if (allDigits) {
    const lens = tokens.map((t) => t.length);
    const min = Math.min(...lens);
    const max = Math.max(...lens);
    return { re: `\\d{${min},${max}}`, role: min >= 6 ? 'txnId' : 'digits' };
  }
  const allDates = tokens.every(
    (t) => /^\d{2}[-/.]\d{2}[-/.]\d{2,4}$/.test(t) || /^\d{6,8}$/.test(t),
  );
  if (allDates) return { re: String.raw`\d{6,8}|\d{2}[-/.]\d{2}[-/.]\d{2,4}`, role: 'date' };
  const allVpa = tokens.every((t) => /^[A-Za-z0-9._-]+@[A-Za-z0-9]+$/.test(t));
  if (allVpa) {
    const handles = new Set(tokens.map((t) => t.split('@')[1]));
    if (handles.size === 1) {
      return {
        re: String.raw`(?<vpaUser${col}>[A-Za-z0-9._-]+)@${escapeRe(tokens[0]!.split('@')[1]!)}`,
        role: 'vpa',
      };
    }
    return {
      re: String.raw`(?<vpaUser${col}>[A-Za-z0-9._-]+)@(?<vpaHandle${col}>[A-Za-z0-9]+)`,
      role: 'vpa',
    };
  }
  const allAlpha = tokens.every((t) => /^[A-Za-z0-9 .&'_]+$/.test(t) && /[A-Za-z]/.test(t));
  if (allAlpha)
    return { re: String.raw`(?<counterparty${col}>[A-Za-z0-9 .&'_]+?)`, role: 'counterparty' };
  return null; // heterogeneous column → can't generalise safely
}

export interface RuleSuggestion {
  /** Draft pattern — paste-ready for a rules/<bank>.json entry. */
  readonly pattern: Omit<GrammarPattern, never>;
  /** Column roles inferred for review (literal/txnId/counterparty/…). */
  readonly columnRoles: readonly string[];
  /** Corpus samples whose expectations this rule would flip — >0 = unsafe. */
  readonly corpusImpact: number;
  readonly safe: boolean;
  readonly note: string;
}

/**
 * Draft a grammar pattern from unmatched samples of the same skeleton.
 * Returns null when samples are too heterogeneous to generalise.
 */
export function suggestGrammarRule(
  samples: readonly string[],
  opts: { id?: string; priority?: number } = {},
): RuleSuggestion | null {
  if (samples.length === 0) return null;
  const rows = samples.map((s) => s.split(SEPARATORS).filter((t) => t !== ''));
  const width = rows[0]!.length;
  if (!rows.every((r) => r.length === width)) {
    // differing token counts — only try when near-uniform (±1)
    const counts = new Set(rows.map((r) => r.length));
    if (counts.size > 2) return null;
  }
  const target = rows.filter((r) => r.length === width);
  if (target.length === 0) return null;

  const fragments: string[] = [];
  const roles: string[] = [];
  for (let c = 0; c < width; c++) {
    const col = target.map((r) => r[c]!);
    const f = columnFragment(col, c);
    if (f === null) return null;
    fragments.push(f.re);
    roles.push(f.role);
  }
  const regex = `^${fragments.join('[-/|: ]')}(?<tail>[-/|: ].*)?$`;

  const anchor = roles
    .map((role, i) => (role === 'literal' ? fragments[i]! : null))
    .find((f) => f !== null);
  const draft: GrammarPattern = {
    name: `suggested_${(anchor ?? 'rule').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    priority: opts.priority ?? 5,
    media: 'narration',
    regex,
  };

  // Self-test: inject the draft and count corpus expectation flips.
  const draftSet: GrammarRuleSet = {
    id: opts.id ?? 'suggested-overlay',
    bank: 'GENERIC',
    version: '0.0.0',
    patterns: [draft],
  };
  let corpusImpact = 0;
  for (const file of loadCorpus()) {
    for (const sample of file.samples) {
      const parsed = parseBankNarration(
        sample.bankHint !== undefined
          ? { text: sample.input, bankHint: sample.bankHint }
          : sample.input,
        { ruleSets: [draftSet] },
      );
      for (const [field, expected] of Object.entries(sample.expect)) {
        const actual = parsed[field as keyof typeof parsed];
        if (actual !== expected) corpusImpact++;
      }
    }
  }

  return {
    pattern: draft,
    columnRoles: roles,
    corpusImpact,
    safe: corpusImpact === 0,
    note:
      corpusImpact === 0
        ? 'draft matches all samples and flips zero corpus expectations — review literals before merging'
        : `draft would flip ${corpusImpact} corpus expectation(s) — DO NOT merge without narrowing`,
  };
}
