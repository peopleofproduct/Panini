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

/** Severity of a forensic signal — verdict rolls up to the worst seen. */
export type SignalSeverity = 'info' | 'warning' | 'critical';

/** One explainable integrity finding. `ruleId` is stable for alerting. */
export interface IntegritySignal {
  readonly ruleId: string;
  readonly severity: SignalSeverity;
  readonly message: string;
  /** Human-readable evidence: offsets, row indices, expected vs actual. */
  readonly evidence: string;
}

/** Result of validating one embedded PDF signature. */
export interface SignatureCheck {
  /** True when a signature field was found and processed. */
  readonly present: boolean;
  readonly fieldName: string | null;
  readonly signer: string | null;
  readonly signTime: string | null;
  /** Byte-range digest matched the CMS messageDigest attribute. */
  readonly digestValid: boolean | null;
  /** RSA/ECDSA signature verified over signedAttrs. */
  readonly signatureValid: boolean | null;
  /** Chain reached a caller-supplied trust anchor; null = no store. */
  readonly chainTrusted: boolean | null;
  /** Content exists after the signed ByteRange (post-sign append). */
  readonly postSignBytes: boolean;
  readonly errors: readonly string[];
}

/** Arithmetic-consistency findings over an extracted statement. */
export interface ConsistencyCheck {
  readonly balanceChainBreaks: number;
  readonly openingMismatch: boolean | null;
  readonly closingMismatch: boolean | null;
  readonly sumMismatch: boolean | null;
  readonly outOfPeriodRows: number;
  readonly duplicateRows: number;
}

export type IntegrityVerdict = 'clean' | 'warnings' | 'tamper_evidence' | 'inconclusive';

/** Top-level document integrity verdict — explainable, never a score. */
export interface IntegrityReport {
  readonly verdict: IntegrityVerdict;
  readonly format: string;
  readonly signals: readonly IntegritySignal[];
  readonly signatures: readonly SignatureCheck[];
  readonly consistency: ConsistencyCheck | null;
  /** Counts by severity for quick gating. */
  readonly critical: number;
  readonly warningCount: number;
}
