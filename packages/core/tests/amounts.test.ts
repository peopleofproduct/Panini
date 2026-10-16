/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { parsePaise } from '../src/amounts';

describe('parsePaise', () => {
  it.each([
    ['500', 50000],
    ['500.00', 50000],
    ['99.9', 9990],
    ['1,50,000.50', 15000050],
    ['Rs.1,500.00', 150000],
    ['INR 250', 25000],
    ['₹75.25', 7525],
    ['0.01', 1],
  ])('parses %s → %i paise', (input, expected) => {
    expect(parsePaise(input)).toBe(expected);
  });

  it.each(['abc', '1.2.3', '', 'Rs.', '1,23,456.789'])(
    'returns null for invalid input %s',
    (input) => {
      expect(parsePaise(input)).toBeNull();
    },
  );
});
