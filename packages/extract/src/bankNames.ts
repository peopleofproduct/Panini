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

import type { BankNamesFile } from './formatsLoader';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identifies the issuing bank from free-form statement text (the preamble
 * lines above the transaction table). Matching is word-bounded — a name
 * only hits as whole words — and when several names match one line the
 * longest wins, so 'union bank of india' resolves to UNION rather than
 * the 'bank of india' substring inside it.
 *
 * Only the first `maxScanLines` lines are scanned: bank names appear in
 * the letterhead, and restricting the scan keeps narration text like
 * 'NEFT TO HDFC BANK' from claiming the statement's identity.
 */
export function detectBankId(text: string, dict: BankNamesFile): string | null {
  const lines = text.split('\n').slice(0, dict.maxScanLines);
  for (const line of lines) {
    const padded = ` ${normalize(line)} `;
    if (padded.trim() === '') continue;
    let best: string | null = null;
    let bestLen = 0;
    for (const bank of dict.banks) {
      for (const name of bank.names) {
        if (name.length > bestLen && padded.includes(` ${name} `)) {
          best = bank.id;
          bestLen = name.length;
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}
