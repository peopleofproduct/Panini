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

import { parsePaise } from '@paniniapi/core';
import { parseStatementDate } from './statementDate';

const DATE_TOKEN = String.raw`(\d{1,2}\s*[\/\-.]\s*\w{3,9}\s*[\/\-.]\s*\d{2,4}|\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{2,4})`;

/** "Statement 01/10/26 to 31/10/26" / "From 1 Oct 2026 To 31 Oct 2026". */
const PERIOD_RE = new RegExp(
  String.raw`(?:statement|period|from)?[^0-9a-z]{0,20}${DATE_TOKEN}\s+(?:to|-)\s+${DATE_TOKEN}`,
  'i',
);

const IFSC_RE = /\b(?:IFSC|IFS\s?Code)\s*(?:code)?\s*[:.-]?\s*([A-Z]{4}0[A-Z0-9]{6})\b/i;

const NAME_RE =
  /\b(?:customer\s+name|account\s+holder|account\s+name|name)\s*(?:of\s+customer)?\s*[:.-]\s*([A-Z][A-Za-z. ]{1,39}?)(?=\s+(?:ifsc|ifs|branch|account|a\/c|statement|period|address|customer|date|opening|closing)\b|\s{2,}|[\n,;]|$)/i;

// Require an explicit separator or currency marker before the amount so a
// bare "Closing Balance" header cell doesn't swallow the next column.
const OPENING_BAL_RE =
  /(?:opening|brought\s+forward|b\/f)\s+balance\s*(?:[:=-]|(?:of|is)\s+(?:inr|rs\.?)?)\s*([\d,]+\.\d{1,2}|[\d,]{5,})/i;
const CLOSING_BAL_RE =
  /(?:closing|carried\s+forward|c\/f)\s+balance\s*(?:[:=-]|(?:of|is)\s+(?:inr|rs\.?)?)\s*([\d,]+\.\d{1,2}|[\d,]{5,})/i;

/**
 * Mines statement-level fields from preamble/first-page text: period,
 * IFSC, account-holder name, opening/closing balance. Conservative —
 * anything ambiguous is omitted rather than guessed, since this lands
 * in `metadata` for downstream audit.
 */
export function mineStatementMetadata(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  const period = PERIOD_RE.exec(text);
  const from = period?.[1] ? parseStatementDate(period[1]) : null;
  const to = period?.[2] ? parseStatementDate(period[2]) : null;
  if (from) out['statementFrom'] = from;
  if (to) out['statementTo'] = to;

  const ifsc = IFSC_RE.exec(text);
  if (ifsc?.[1]) out['ifsc'] = ifsc[1].toUpperCase();

  const name = NAME_RE.exec(text);
  if (name?.[1]) out['accountHolder'] = name[1].trim();

  const open = OPENING_BAL_RE.exec(text);
  if (open?.[1]) {
    const paise = parsePaise(open[1]);
    if (paise !== null) out['openingBalancePaise'] = String(paise);
  }
  const close = CLOSING_BAL_RE.exec(text);
  if (close?.[1]) {
    const paise = parsePaise(close[1]);
    if (paise !== null) out['closingBalancePaise'] = String(paise);
  }

  return out;
}
