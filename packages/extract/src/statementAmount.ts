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

/** A parsed statement amount: always a non-negative magnitude plus its sign. */
export interface StatementAmount {
  /** Magnitude in integer paise (never negative). */
  readonly paise: number;
  /** `'neg'` for -x, (x), x-; `'pos'` for an explicit +x; null when unsigned. */
  readonly sign: 'neg' | 'pos' | null;
}

const CURRENCY_PREFIX = /^(?:rs\.?|inr|₹)\s*/i;
const BODY = /^(?:(\d+(?:,\d+)*)(?:\.(\d{1,2}))?|\.(\d{1,2}))$/;
/** Largest rupee integer part we accept — keeps paise exact in a double. */
const MAX_INTEGER_DIGITS = 13;

/**
 * Statement-cell amount parser — a superset of core `parsePaise` for the
 * shapes bank exports actually use: `-100`, `+50`, `(100.00)`, `100.00-`,
 * `Rs. 1,000/-`, `₹1,000.00`, `.50`. Pure decimal-string arithmetic, so
 * paise are exact. Returns null for anything ambiguous or malformed;
 * callers decide direction from the sign plus column semantics.
 */
export function parseStatementAmount(value: string): StatementAmount | null {
  let s = value.trim();
  if (s === '') return null;

  let neg = false;
  let pos = false;

  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    neg = true;
    s = (paren[1] ?? '').trim();
  }

  const takeLeadingSign = (): boolean => {
    const c = s[0];
    if (c !== '-' && c !== '+') return true;
    if (neg || pos) return false;
    if (c === '-') neg = true;
    else pos = true;
    s = s.slice(1).trim();
    return true;
  };

  if (!takeLeadingSign()) return null;
  s = s.replace(CURRENCY_PREFIX, '');
  if (!takeLeadingSign()) return null;

  if (s.endsWith('/-')) s = s.slice(0, -2).trim();
  if (s.endsWith('-')) {
    if (neg || pos) return null;
    neg = true;
    s = s.slice(0, -1).trim();
  }

  const m = BODY.exec(s);
  if (!m) return null;
  const intPart = (m[1] ?? '').replace(/,/g, '');
  const frac = (m[2] ?? m[3] ?? '').padEnd(2, '0');
  if (intPart.length > MAX_INTEGER_DIGITS) return null;
  const paise = Number(intPart === '' ? '0' : intPart) * 100 + Number(frac);
  return { paise, sign: neg ? 'neg' : pos ? 'pos' : null };
}
