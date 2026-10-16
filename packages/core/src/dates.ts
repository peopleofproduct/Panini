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

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

function buildIso(year: number, month: number, day: number): string | null {
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Round-trip through Date to reject impossible days (e.g. 31 Feb).
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function twoDigitYear(yy: number): number {
  // Indian statement data rarely predates 2000; map 90-99 to 1990s, rest 20xx.
  return yy >= 90 ? 1900 + yy : 2000 + yy;
}

/**
 * Parses the date shapes common in Indian bank narrations/SMS:
 * `YYYYMMDD`, `DDMMYYYY`, `DDMMYY`, `YYYY-MM-DD`, `DD-MM-YY[YY]`
 * (separators may be `-`, `/` or `.`). Returns ISO `YYYY-MM-DD` or null.
 */
export function parseIndianDate(value: string): string | null {
  const v = value.trim();

  // Each shape is tried in turn; an out-of-range component (e.g. month 13 in
  // "20261345") falls through to the next interpretation instead of failing.
  const attempts: readonly [RegExp, (m: RegExpExecArray) => [number, number, number]][] = [
    [/^(\d{4})(\d{2})(\d{2})$/, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]], // YYYYMMDD
    [/^(\d{2})(\d{2})(\d{4})$/, (m) => [Number(m[3]), Number(m[2]), Number(m[1])]], // DDMMYYYY
    [/^(\d{2})(\d{2})(\d{2})$/, (m) => [twoDigitYear(Number(m[3])), Number(m[2]), Number(m[1])]], // DDMMYY
    [/^(\d{4})[-/.](\d{2})[-/.](\d{2})$/, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]], // YYYY-MM-DD
    [/^(\d{2})[-/.](\d{2})[-/.](\d{4})$/, (m) => [Number(m[3]), Number(m[2]), Number(m[1])]], // DD-MM-YYYY
    [
      /^(\d{2})[-/.](\d{2})[-/.](\d{2})$/,
      (m) => [twoDigitYear(Number(m[3])), Number(m[2]), Number(m[1])],
    ], // DD-MM-YY
  ];
  for (const [re, extract] of attempts) {
    const m = re.exec(v);
    if (m) {
      const [year, month, day] = extract(m);
      const iso = buildIso(year, month, day);
      if (iso !== null) return iso;
    }
  }
  return null;
}

/** Quick check used by the tokenizer before classifying a token as DATE. */
export function isPlausibleDate(value: string): boolean {
  return parseIndianDate(value) !== null;
}
