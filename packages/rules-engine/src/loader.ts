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
import type { GrammarRuleSet } from '@paniniapi/core';

const CATEGORIES_FILE = 'categories.json';
const TAXONOMY_FILE = 'taxonomy.json';
/** Files under rules/ that are data, not grammar rule sets. */
const NON_GRAMMAR_FILES = new Set([CATEGORIES_FILE, TAXONOMY_FILE]);

/**
 * Locates the bundled `rules/` directory across dev (`src`), build (`dist`)
 * and installed-package layouts.
 */
function resolveRulesDir(): string {
  const candidates = [
    join(__dirname, 'rules'),
    join(__dirname, '..', 'rules'),
    join(__dirname, '..', '..', 'rules'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    `@paniniapi/rules-engine: could not locate bundled rules directory. Checked: ${candidates.join(', ')}`,
  );
}

/**
 * Loads every grammar rule set (`*.json`) from `dir`. Callers may point this
 * at their own directory of grammar files — rules are data, not code, so a
 * bank grammar can be updated without touching the parser.
 */
export function loadRuleSets(dir?: string): readonly GrammarRuleSet[] {
  const rulesDir = dir ?? resolveRulesDir();
  return readdirSync(rulesDir)
    .filter((file) => file.endsWith('.json') && !NON_GRAMMAR_FILES.has(file))
    .sort()
    .map((file) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(join(rulesDir, file), 'utf8'));
      } catch (e) {
        // `cause` is assigned property-style so the repo's ES2021 lib
        // target stays valid (the Error(msg, { cause }) overload is ES2022).
        const wrapped = new Error(
          `@paniniapi/rules-engine: '${file}' in ${rulesDir} is not valid JSON: ${(e as Error).message}`,
        ) as Error & { cause?: unknown };
        wrapped.cause = e;
        throw wrapped;
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as { patterns?: unknown }).patterns)
      ) {
        throw new Error(
          `@paniniapi/rules-engine: '${file}' in ${rulesDir} is not a grammar rule set (missing patterns array)`,
        );
      }
      return parsed as GrammarRuleSet;
    });
}

/** Loads the grammar sets bundled with this package. */
export function loadBuiltinRuleSets(): readonly GrammarRuleSet[] {
  return loadRuleSets();
}

/** Loads the shared counterparty-keyword → spend-category table. */
export function loadCategories(dir?: string): Record<string, string> {
  const rulesDir = dir ?? resolveRulesDir();
  const file = join(rulesDir, CATEGORIES_FILE);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
}

export interface TaxonomyEntry {
  /** Stable machine-readable id, safe for consumers to persist. */
  readonly id: string;
  /** Rollup bucket for grouping categories in reports. */
  readonly group: string;
}

export interface Taxonomy {
  readonly version: number;
  readonly categories: Readonly<Record<string, TaxonomyEntry>>;
}

/** Loads the governed taxonomy (label → stable id + group). */
export function loadTaxonomy(dir?: string): Taxonomy {
  const rulesDir = dir ?? resolveRulesDir();
  const file = join(rulesDir, TAXONOMY_FILE);
  if (!existsSync(file)) return { version: 0, categories: {} };
  return JSON.parse(readFileSync(file, 'utf8')) as Taxonomy;
}
