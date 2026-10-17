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

const CURRENCY_PREFIX = /^(?:rs\.?|inr|₹)\s*/i;
const AMOUNT_BODY = /^-?\d+(?:\.\d{1,2})?$/;

/**
 * Parses an Indian-formatted amount (`Rs.1,50,000.50`, `INR 250`, `99.9`)
 * into integer paise. Returns null when the value is not a valid amount.
 */
export function parsePaise(value: string): number | null {
  const stripped = value.trim().replace(CURRENCY_PREFIX, '').replace(/,/g, '');
  if (!AMOUNT_BODY.test(stripped)) return null;
  return Math.round(Number(stripped) * 100);
}
