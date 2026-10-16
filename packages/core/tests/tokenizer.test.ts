/**
 * Copyright 2026 Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { tokenize } from '../src/tokenizer';

describe('tokenize', () => {
  it('splits a hyphenated UPI narration into classified tokens', () => {
    const tokens = tokenize('UPI-SWIGGY-826384@okaxis-20261015-REV-DEBIT');
    expect(tokens.map((t) => t.kind)).toEqual([
      'KEYWORD', // UPI
      'ALPHA', // SWIGGY
      'VPA', // 826384@okaxis
      'DATE', // 20261015
      'KEYWORD', // REV
      'KEYWORD', // DEBIT
    ]);
    expect(tokens.map((t) => t.value)).toEqual([
      'UPI',
      'SWIGGY',
      '826384@okaxis',
      '20261015',
      'REV',
      'DEBIT',
    ]);
  });

  it('splits on slashes and whitespace too', () => {
    const tokens = tokenize('UPI/DR/123456789012/SWIGGY KOLKATA/SBIN');
    expect(tokens.map((t) => t.kind)).toEqual([
      'KEYWORD', // UPI
      'KEYWORD', // DR
      'NUMERIC', // 123456789012
      'ALPHA', // SWIGGY
      'ALPHA', // KOLKATA
      'ALPHA', // SBIN
    ]);
  });

  it('classifies Indian-formatted amounts as AMOUNT, currency prefix included', () => {
    const tokens = tokenize('Rs.1,50,000.50 credited');
    expect(tokens.map((t) => t.kind)).toEqual(['AMOUNT', 'KEYWORD']);
    expect(tokens.map((t) => t.value)).toEqual(['Rs.1,50,000.50', 'credited']);
  });

  it('does not treat a 12-digit UPI reference as a DATE', () => {
    const tokens = tokenize('123456789012');
    expect(tokens[0]?.kind).toBe('NUMERIC');
  });

  it('does not treat an impossible 8-digit number as a DATE', () => {
    const tokens = tokenize('99999999');
    expect(tokens[0]?.kind).toBe('NUMERIC');
  });

  it('classifies DD-MM-YY as a DATE', () => {
    const tokens = tokenize('15-10-26');
    expect(tokens[0]?.kind).toBe('DATE');
  });

  it('returns an empty stream for blank input', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});
