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

import { loadSchema } from './loader';
import { validate, type ValidationResult } from './validator';

/** ReBIT Account Aggregator transaction modes. */
export type AATransactionMode =
  | 'UPI'
  | 'IMPS'
  | 'NEFT'
  | 'RTGS'
  | 'ATM'
  | 'CARD'
  | 'POS'
  | 'CASH'
  | 'NACH'
  | 'ACH'
  | 'FT'
  | 'OTHERS';

export type AATransactionType = 'DEBIT' | 'CREDIT' | 'OTHERS';

/** A single transaction record inside a ReBIT AA `Transaction` array. */
export interface AATransaction {
  readonly txnId: string;
  readonly amount: string | number;
  readonly narration: string;
  readonly type: AATransactionType;
  readonly mode: AATransactionMode;
  /** YYYY-MM-DD. */
  readonly valueDate: string;
  /** ISO-8601 timestamp. */
  readonly transactionTimestamp: string;
  readonly reference: string;
  readonly currentBalance: string | number;
}

/** ReBIT FI types. */
export type AAFIType =
  | 'DEPOSIT'
  | 'TERM-DEPOSIT'
  | 'RECURRING_DEPOSIT'
  | 'SIP'
  | 'CP'
  | 'GOVT_SECURITIES'
  | 'EQUITIES'
  | 'BONDS'
  | 'DEBENTURES'
  | 'MUTUAL_FUNDS'
  | 'ETF'
  | 'IDR'
  | 'CIS'
  | 'AIF'
  | 'INSURANCE_POLICIES'
  | 'NPS'
  | 'INVIT'
  | 'REIT'
  | 'OTHER';

/**
 * ReBIT 2.0 Account Aggregator FI profile payload — FIP/FIU envelope
 * metadata plus the canonical `Transaction` array.
 * Matches `aa-profile.schema.json`.
 */
export interface AAProfile {
  /** Financial Information Provider id. */
  readonly FIPId: string;
  /** ISO-8601 timestamp of the FIU data pull. */
  readonly FIUTimestamp: string;
  /** Masked account identifier, e.g. 'XXXXXX1234'. */
  readonly maskedAccountNumber: string;
  readonly Transaction: readonly AATransaction[];
  readonly consentId?: string;
  readonly fiType?: AAFIType;
}

/** OCEN 4.0 disbursement destination. */
export interface OCENDisbursalAccount {
  readonly accountNumber: string;
  /** 11-char IFSC, e.g. 'HDFC0001234'. */
  readonly ifsc: string;
  readonly vpa?: string;
  readonly accountHolderName?: string;
}

/** OCEN 4.0 async message metadata envelope. */
export interface OCENMetadata {
  readonly originatorOrgId: string;
  readonly originatorParticipantId: string;
  readonly traceId: string;
  readonly requestId: string;
  readonly loanApplicationId: string;
  readonly version?: string;
  readonly timestamp?: string;
}

export type OCENLoanType =
  'TERM_LOAN' | 'BULLET' | 'EMI' | 'BULLET_PLUS_LINE' | 'LINE_OF_CREDIT' | 'OTHER';

/** OCEN 4.0 asynchronous loan application. Matches `ocen-loan.schema.json`. */
export interface OCENLoanApplication {
  readonly metadata: OCENMetadata;
  readonly loanApplicationId: string;
  readonly disbursalAccount: OCENDisbursalAccount;
  readonly tenorMonths: number;
  readonly requestedAmount?: number;
  readonly currency?: 'INR';
  readonly loanType?: OCENLoanType;
  readonly interestRatePct?: number;
  readonly processingFeePct?: number;
  readonly borrowerId?: string;
}

/** Validates an AA FI profile payload against the bundled schema. */
export function validateAAProfile(value: unknown): ValidationResult {
  return validate(loadSchema('aa-profile'), value);
}

/** ReBIT consent request (ConsentDetail) payload — `POST /Consent`. */
export function validateAAConsentRequest(value: unknown): ValidationResult {
  return validate(loadSchema('aa-consent-request'), value);
}

/** ReBIT signed consent artefact + ConsentUse — artefact exchange shape. */
export function validateAAConsentArtefact(value: unknown): ValidationResult {
  return validate(loadSchema('aa-consent-artefact'), value);
}

/** FI types sharing the investment (Holdings) payload shape. */
const INVESTMENT_FI_TYPES = new Set<AAFIType>([
  'SIP',
  'CP',
  'GOVT_SECURITIES',
  'EQUITIES',
  'BONDS',
  'DEBENTURES',
  'MUTUAL_FUNDS',
  'ETF',
  'IDR',
  'CIS',
  'AIF',
  'INVIT',
  'REIT',
]);

/**
 * Validates an FI data payload against the schema for its `fiType` —
 * DEPOSIT uses the canonical Transaction schema; term/recurring deposits,
 * investments, insurance policies, and NPS each use their own shape.
 * Unknown/OTHER types validate against the generic DEPOSIT envelope only
 * when a Transaction array is present.
 */
export function validateFiData(fiType: AAFIType, value: unknown): ValidationResult {
  switch (fiType) {
    case 'DEPOSIT':
      return validateAAProfile(value);
    case 'TERM-DEPOSIT':
    case 'RECURRING_DEPOSIT':
      return validate(loadSchema('aa-fi-deposit'), value);
    case 'INSURANCE_POLICIES':
      return validate(loadSchema('aa-fi-insurance'), value);
    case 'NPS':
      return validate(loadSchema('aa-fi-nps'), value);
    default:
      if (INVESTMENT_FI_TYPES.has(fiType)) {
        return validate(loadSchema('aa-fi-investment'), value);
      }
      // 'OTHER' — no dedicated shape; enforce envelope fields only.
      return validateAAProfile(value);
  }
}

/** Validates an OCEN loan application against the bundled schema. */
export function validateOCENLoanApplication(value: unknown): ValidationResult {
  return validate(loadSchema('ocen-loan'), value);
}

/** Type guard: validates and narrows to {@link AAProfile}. */
export function isAAProfile(value: unknown): value is AAProfile {
  return validateAAProfile(value).valid;
}

/** Type guard: validates and narrows to {@link OCENLoanApplication}. */
export function isOCENLoanApplication(value: unknown): value is OCENLoanApplication {
  return validateOCENLoanApplication(value).valid;
}

/** Type guard: validates a consent request payload. */
export function isAAConsentRequest(value: unknown): boolean {
  return validateAAConsentRequest(value).valid;
}

/** Type guard: validates a signed consent artefact payload. */
export function isAAConsentArtefact(value: unknown): boolean {
  return validateAAConsentArtefact(value).valid;
}
