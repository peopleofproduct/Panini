/**
 * Copyright 2026 Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { loadBuiltinRuleSets, loadCategories } from '../src';
import { Normalizer } from '@panini/core';

describe('loadBuiltinRuleSets', () => {
  it('loads all bundled grammar files', () => {
    const sets = loadBuiltinRuleSets();
    const ids = sets.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(['generic-indian-banks', 'sbi', 'hdfc', 'icici']),
    );
  });

  it('produces rule sets that compile into a Normalizer without errors', () => {
    expect(
      () => new Normalizer({ ruleSets: loadBuiltinRuleSets() }),
    ).not.toThrow();
  });

  it('has unique rule set ids', () => {
    const ids = loadBuiltinRuleSets().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('excludes categories.json from the rule sets', () => {
    const sets = loadBuiltinRuleSets();
    expect(sets.every((s) => Array.isArray(s.patterns))).toBe(true);
  });
});

describe('loadCategories', () => {
  it('loads the shared category table', () => {
    const categories = loadCategories();
    expect(categories['SWIGGY']).toBe('Food & Dining');
    expect(categories['SALARY']).toBe('Income');
  });
});
