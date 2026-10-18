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

export { inspectStatement, type InspectOptions } from './report';
export { checkConsistency } from './consistency';
export { reconcileWithAa, transactionsFromAaData } from './reconcile';
export type {
  AaTransaction,
  ReconcileField,
  ReconcileMismatch,
  ReconcileOptions,
  ReconcileVerdict,
  ReconciliationReport,
} from './reconcile';
export { verifyPdfSignatures, type SignatureOptions } from './pdf/signature';
export { inspectPdfStructure, type StructureOptions } from './pdf/structure';
export { inspectPdfContent } from './pdf/content';
export type {
  ConsistencyCheck,
  IntegrityReport,
  IntegritySignal,
  IntegrityVerdict,
  SignalSeverity,
  SignatureCheck,
} from './types';
