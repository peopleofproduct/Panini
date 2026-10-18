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

import { parseIndianDate } from '@paniniapi/core';

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const NAMED = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ](\d{2,4})$/;
/** Day-first numeric dates with 1–2 digit day/month: `5/1/2026`, `5-1-26`. */
const SHORT_DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;
/** A trailing clock time (24h or 12h) with optional fraction and zone. */
const TIME_SUFFIX =
  /[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AP]M)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Statement-date parser: everything `parseIndianDate` handles plus the
 * month-name shapes statement exports use (`15 Oct 2026`, `15-Oct-26`,
 * `15.Oct.2026`), single-digit day/month shapes (read **day-first**, the
 * Indian convention) and date-times whose clock part is discarded
 * (`2026-01-05 10:30:00`, `05/01/2026 10:30 AM`). Returns ISO
 * `YYYY-MM-DD` or null.
 */
export function parseStatementDate(value: string): string | null {
  const v = value.trim().replace(TIME_SUFFIX, '').trim();
  const direct = parseIndianDate(v);
  if (direct !== null) return direct;
  const short = SHORT_DMY.exec(v);
  if (short) {
    const dd = (short[1] ?? '').padStart(2, '0');
    const mm = (short[2] ?? '').padStart(2, '0');
    return parseIndianDate(`${dd}-${mm}-${short[3]}`);
  }
  const m = NAMED.exec(v);
  if (!m) return null;
  const month = MONTHS[(m[2] ?? '').toLowerCase()];
  if (month === undefined) return null;
  const day = (m[1] ?? '').padStart(2, '0');
  return parseIndianDate(`${day}-${String(month).padStart(2, '0')}-${m[3]}`);
}
