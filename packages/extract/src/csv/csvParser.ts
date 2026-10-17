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

/**
 * RFC-4180-ish CSV tokenizer tuned for bank exports: quoted fields with
 * escaped `""` quotes, commas/newlines inside quotes, CRLF or LF endings,
 * semicolon/tab delimiters, a leading BOM, and junk prefix bytes some
 * banks emit before the real table.
 */

export interface CsvParseResult {
  /** Rows of cell strings. Multiline fields are flattened with a space. */
  readonly rows: readonly string[][];
  /** Delimiter actually used. */
  readonly delimiter: string;
}

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;

/** Counts delimiter occurrences outside quotes on a single physical line. */
function delimiterScore(line: string, delimiter: string): number {
  let score = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      score += 1;
    }
  }
  return score;
}

/** Picks the delimiter most consistently present across the first lines. */
export function detectDelimiter(text: string): string {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim());

  let best: string = ',';
  let bestScore = 0;
  for (const d of DELIMITER_CANDIDATES) {
    const scores = lines.slice(0, 10).map((l) => delimiterScore(l, d));
    const min = scores.length ? Math.min(...scores) : 0;
    const sum = scores.reduce((a, b) => a + b, 0);
    const score = min * 10 + sum;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Parses CSV text into rows. Tolerates malformed input: unterminated
 * quotes end the field at EOF, stray CRs are stripped, and no row ever
 * throws — worst case the caller gets odd cells and a warning upstream.
 */
export function parseCsv(text: string, delimiter?: string): CsvParseResult {
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else if (ch === '\r' || ch === '\n') {
        cell += ' ';
      } else {
        cell += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      if (ch === '\r' && src[i] === '\n') i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, delimiter: delim };
}
