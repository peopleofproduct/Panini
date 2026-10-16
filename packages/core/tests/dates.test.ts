/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { isPlausibleDate, parseIndianDate } from '../src/dates';

describe('parseIndianDate', () => {
  it.each([
    ['20261015', '2026-10-15'],
    ['15102026', '2026-10-15'],
    ['151026', '2026-10-15'],
    ['2026-10-15', '2026-10-15'],
    ['15-10-2026', '2026-10-15'],
    ['15-10-26', '2026-10-15'],
    ['15/10/2026', '2026-10-15'],
    ['15.10.26', '2026-10-15'],
    ['010199', '1999-01-01'],
  ])('parses %s → %s', (input, expected) => {
    expect(parseIndianDate(input)).toBe(expected);
  });

  it.each([
    '99999999', // impossible month
    '20261345', // month 13
    '32-10-2026', // day 32
    '2026-02-30', // impossible day
    '1234567', // 7 digits — not a date shape
    'abcdef',
    '',
  ])('returns null for corrupt input %s', (input) => {
    expect(parseIndianDate(input)).toBeNull();
  });
});

describe('isPlausibleDate', () => {
  it('accepts valid dates and rejects numeric ids', () => {
    expect(isPlausibleDate('20261015')).toBe(true);
    expect(isPlausibleDate('826384')).toBe(false);
    expect(isPlausibleDate('123456789012')).toBe(false);
  });
});
