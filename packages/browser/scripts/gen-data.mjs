#!/usr/bin/env node
// Copyright 2026 Kapil — Project Panini Contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Generates src/data.gen.ts — every grammar ruleset, the category table,
 * entity dictionaries and extract format JSONs inlined as a TS module so
 * the browser bundle needs no filesystem. Deterministic: sorted file order.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rulesDir = join(here, '../../rules-engine/rules');
const entitiesDir = join(rulesDir, 'entities');
const formatsDir = join(here, '../../extract/formats');

const ruleFiles = readdirSync(rulesDir)
  .filter((f) => f.endsWith('.json') && f !== 'categories.json')
  .sort();
const categories = JSON.parse(readFileSync(join(rulesDir, 'categories.json'), 'utf8'));
const ruleSets = ruleFiles.map((f) => JSON.parse(readFileSync(join(rulesDir, f), 'utf8')));

const dictionaries = {
  merchants: JSON.parse(readFileSync(join(entitiesDir, 'merchants.json'), 'utf8')).merchants,
  vpaHandles: JSON.parse(readFileSync(join(entitiesDir, 'vpa-handles.json'), 'utf8')).handles,
  ifscBanks: JSON.parse(readFileSync(join(entitiesDir, 'ifsc-codes.json'), 'utf8')).banks,
  mccCodes: JSON.parse(readFileSync(join(entitiesDir, 'mcc-codes.json'), 'utf8')).codes,
};

const csvLayouts = JSON.parse(readFileSync(join(formatsDir, 'csv-layouts.json'), 'utf8'));
const smsPatterns = JSON.parse(readFileSync(join(formatsDir, 'sms-patterns.json'), 'utf8'));

const out = `/**
 * Copyright 2026 Kapil — Project Panini Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * GENERATED FILE — do not edit. Regenerate: node scripts/gen-data.mjs
 * Bundled grammar/dictionary/format data for the browser build.
 */

import type { GrammarRuleSet } from '@paniniapi/core';
import type { DictionaryData } from '@paniniapi/rules-engine';
import type { CsvLayoutsFile, SmsPatternsFile } from '@paniniapi/extract';

export const RULE_SET_FILES = ${JSON.stringify(ruleFiles)} as const;

export const RULE_SETS = ${JSON.stringify(ruleSets)} as unknown as readonly GrammarRuleSet[];

export const CATEGORIES = ${JSON.stringify(categories)} as Record<string, string>;

export const DICTIONARIES = ${JSON.stringify(dictionaries)} as DictionaryData;

export const CSV_LAYOUTS = ${JSON.stringify(csvLayouts)} as unknown as CsvLayoutsFile;

export const SMS_PATTERNS = ${JSON.stringify(smsPatterns)} as unknown as SmsPatternsFile;
`;

writeFileSync(join(here, '../src/data.gen.ts'), out);
console.log(
  `data.gen.ts: ${ruleSets.length} rulesets, ${dictionaries.merchants.length} merchants, ` +
    `${Object.keys(dictionaries.vpaHandles).length} vpa handles, ${Object.keys(dictionaries.ifscBanks).length} ifsc banks`,
);
