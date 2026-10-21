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
 *
 * Browser entry point for the playground. Grammar/dictionary data comes
 * from the browser package's generated module — one source of truth, so
 * new bank grammars and entity updates flow in automatically (no fs).
 */

import type { InputSource } from '@paniniapi/core';
import { parseBankNarration, setDictionaries, setTaxonomy } from '@paniniapi/rules-engine';
import { CATEGORIES, DICTIONARIES, RULE_SETS, TAXONOMY } from '../packages/browser/src/data.gen';

setDictionaries(DICTIONARIES);
setTaxonomy(TAXONOMY);

export interface PaniniWindow {
  paniniParse: (text: string, bankHint?: string, source?: InputSource) => unknown;
}

(window as unknown as PaniniWindow).paniniParse = (text, bankHint, source) =>
  parseBankNarration(
    {
      text,
      ...(bankHint !== undefined && bankHint.length > 0 ? { bankHint } : {}),
      ...(source !== undefined ? { source } : {}),
    },
    { bare: true, ruleSets: RULE_SETS, categories: CATEGORIES },
  );
