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

export type { SchemaNode, ValidationError, ValidationResult } from './validator';
export { validate } from './validator';
export { listSchemas, loadSchema, validateAgainst } from './loader';
export type {
  AAFIType,
  AAProfile,
  AATransaction,
  AATransactionMode,
  AATransactionType,
  OCENDisbursalAccount,
  OCENLoanApplication,
  OCENLoanType,
  OCENMetadata,
} from './types';
export {
  isAAConsentArtefact,
  isAAConsentRequest,
  isAAProfile,
  isOCENLoanApplication,
  validateAAConsentArtefact,
  validateAAConsentRequest,
  validateAAProfile,
  validateFiData,
  validateOCENLoanApplication,
  validateOndcEnvelope,
  validateOndcFsSearch,
  validateOndcCatalog,
  validateOndcOrder,
  validateOcenLifecycle,
} from './types';
