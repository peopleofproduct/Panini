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

import { detectDelimiter, parseCsv } from '../src/csv/csvParser';

describe('parseCsv', () => {
  it('parses plain rows', () => {
    const { rows } = parseCsv('a,b,c\n1,2,3\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const { rows } = parseCsv('a,b\n"x,y","say ""hi"""');
    expect(rows[1]).toEqual(['x,y', 'say "hi"']);
  });

  it('handles CRLF, LF and CR-only endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows.length).toBe(2);
    expect(parseCsv('a,b\n1,2\n').rows.length).toBe(2);
    expect(parseCsv('a,b\r1,2').rows.length).toBe(2);
  });

  it('flattens multiline quoted fields with a space', () => {
    const { rows } = parseCsv('a,b\n"line1\nline2",x');
    expect(rows[1]?.[0]).toBe('line1 line2');
  });

  it('strips a leading BOM', () => {
    const { rows } = parseCsv('﻿a,b\n1,2');
    expect(rows[0]?.[0]).toBe('a');
  });

  it('never throws on degenerate input', () => {
    expect(() => parseCsv('')).not.toThrow();
    expect(() => parseCsv('"""')).not.toThrow();
    expect(() => parseCsv(',,,\n,,,\n,,,')).not.toThrow();
    expect(parseCsv('unterminated "quote,a,b').rows.length).toBeGreaterThan(0);
  });
});

describe('detectDelimiter', () => {
  it('detects comma, semicolon, tab and pipe', () => {
    expect(detectDelimiter('a,b\nc,d')).toBe(',');
    expect(detectDelimiter('a;b\nc;d')).toBe(';');
    expect(detectDelimiter('a\tb\nc\td')).toBe('\t');
    expect(detectDelimiter('a|b\nc|d')).toBe('|');
  });

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"a,b";c\n"d,e";f')).toBe(';');
  });
});
