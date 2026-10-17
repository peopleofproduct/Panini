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

/**
 * Statement-date parser: everything `parseIndianDate` handles plus the
 * month-name shapes statement exports use (`15 Oct 2026`, `15-Oct-26`,
 * `15.Oct.2026`). Returns ISO `YYYY-MM-DD` or null.
 */
export function parseStatementDate(value: string): string | null {
  const direct = parseIndianDate(value);
  if (direct !== null) return direct;
  const m = NAMED.exec(value.trim());
  if (!m) return null;
  const month = MONTHS[(m[2] ?? '').toLowerCase()];
  if (month === undefined) return null;
  const day = (m[1] ?? '').padStart(2, '0');
  return parseIndianDate(`${day}-${String(month).padStart(2, '0')}-${m[3]}`);
}
