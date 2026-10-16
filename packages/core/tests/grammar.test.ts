/**
 * Copyright 2026 Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { compileRuleSet, compileRuleSets, GrammarError } from '../src/grammar';
import type { GrammarRuleSet } from '../src/grammar';

describe('compileRuleSet', () => {
  it('compiles patterns with defaults applied', () => {
    const compiled = compileRuleSet({
      id: 'test',
      bank: 'GENERIC',
      version: '1.0.0',
      patterns: [{ name: 'p1', regex: '^X$' }],
    });
    expect(compiled[0]?.media).toBe('any');
    expect(compiled[0]?.priority).toBe(0);
    expect(compiled[0]?.confidence).toBe(0.9);
    expect(compiled[0]?.regex.test('X')).toBe(true);
  });

  it('honours custom regexFlags', () => {
    const compiled = compileRuleSet({
      id: 'test',
      bank: 'GENERIC',
      version: '1.0.0',
      patterns: [{ name: 'p1', regex: '^neft$', regexFlags: 'i' }],
    });
    expect(compiled[0]?.regex.test('NEFT')).toBe(true);
  });

  it('throws GrammarError on an invalid regex', () => {
    const bad: GrammarRuleSet = {
      id: 'bad',
      bank: 'GENERIC',
      version: '1.0.0',
      patterns: [{ name: 'broken', regex: '(?<unclosed' }],
    };
    expect(() => compileRuleSet(bad)).toThrow(GrammarError);
    expect(() => compileRuleSet(bad)).toThrow(/'broken'.*'bad'/);
  });

  it('throws GrammarError when id or bank is missing', () => {
    expect(() => compileRuleSet({ id: '', bank: 'GENERIC', version: '1', patterns: [] })).toThrow(
      GrammarError,
    );
  });
});

describe('compileRuleSets', () => {
  const make = (bank: string, priority: number, name: string): GrammarRuleSet => ({
    id: name,
    bank,
    version: '1.0.0',
    patterns: [{ name, regex: 'x', priority }],
  });

  it('orders by priority desc, then bank-specific before GENERIC', () => {
    const compiled = compileRuleSets([
      make('GENERIC', 10, 'g-high'),
      make('SBI', 10, 's-high'),
      make('GENERIC', 5, 'g-low'),
    ]);
    expect(compiled.map((p) => p.name)).toEqual(['s-high', 'g-high', 'g-low']);
  });
});
