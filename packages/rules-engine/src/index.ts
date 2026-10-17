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

export { loadBuiltinRuleSets, loadCategories, loadRuleSets } from './loader';
export {
  loadIfscBanks,
  loadMerchants,
  loadVpaHandles,
  lookupIfscBank,
  lookupMerchant,
  lookupVpaHandle,
} from './dictionary';
export type { IfscBankInfo, MerchantEntry, VpaHandleInfo } from './dictionary';
export { checkSample, coverageReport, loadCorpus } from './coverage';
export type {
  BankCoverage,
  CorpusExpectation,
  CorpusFile,
  CorpusSample,
  ExpectationFailure,
} from './coverage';
export {
  BANK_NARRATION_RULE_SET,
  BANK_RULE_SETS,
  parseBankNarration,
  preserveAcronymCase,
} from './bankRules';
export type { ParseBankNarrationOptions, ParsedBankNarration } from './bankRules';
