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

/** One normalized transaction row — the shared input contract. Any shape
 *  carrying these fields qualifies: `ExtractedTransaction`, enriched
 *  `ParsedBankNarration` + amount, or a caller-built row. */
export interface InsightTransaction {
  /** ISO-8601 date 'YYYY-MM-DD', or null when unparseable. */
  readonly date: string | null;
  readonly direction: 'DEBIT' | 'CREDIT' | null;
  readonly amountPaise: number | null;
  readonly balancePaise?: number | null;
  readonly narration?: string | null;
  readonly counterparty?: string | null;
  readonly merchant?: string | null;
  readonly category?: string | null;
  readonly channel?: string | null;
  readonly is_salary?: boolean | null;
  readonly refNo?: string | null;
}

/** Stable rule identifier, e.g. 'PANINI-INC-001'. */
export type RuleId = string;

/** Pointing-at-the-data proof for every claim an insight makes. */
export interface Evidence {
  readonly ruleId: RuleId;
  readonly note: string;
  /** Indices into the input array the claim rests on. */
  readonly txnIndices: readonly number[];
}

export interface IncomeEvent {
  readonly index: number;
  readonly date: string | null;
  readonly amountPaise: number;
  readonly employer: string | null;
  /** Why this credit counts as income. */
  readonly basis: 'is_salary_flag' | 'salary_keyword' | 'regular_credit';
}

export interface IncomeSummary {
  /** Detected income credits, oldest first. */
  readonly credits: readonly IncomeEvent[];
  /** Distinct employer/counterparty names seen paying in. */
  readonly sources: readonly string[];
  /** Mean monthly income across observed months, or null when no income. */
  readonly monthlyAveragePaise: number | null;
  /** Same source, similar amount, recurring across months → 'regular'. */
  readonly consistency: 'regular' | 'irregular' | 'insufficient_data';
  readonly monthsObserved: number;
}

export interface RecurringObligation {
  /** Normalized counterparty/merchant the payments go to. */
  readonly counterparty: string;
  readonly occurrences: readonly number[];
  /** Median-ish amount — the middle value of observed debits. */
  readonly typicalAmountPaise: number;
  /** Distinct 'YYYY-MM' buckets the debits landed in. */
  readonly monthsHit: readonly string[];
  readonly isEmi: boolean;
}

export interface ObligationsSummary {
  readonly recurring: readonly RecurringObligation[];
  readonly emis: readonly RecurringObligation[];
  /** Sum of typical monthly obligation amounts, or null when none found. */
  readonly monthlyObligationPaise: number | null;
}

/** Fixed-obligation-to-income ratio — the underwriting staple. */
export interface FoirSummary {
  /** obligations ÷ income, 0–1, or null when income is unknown. */
  readonly ratio: number | null;
  readonly monthlyIncomePaise: number | null;
  readonly monthlyObligationPaise: number | null;
  readonly note: string;
}

export interface CashflowSummary {
  readonly totalCreditsPaise: number;
  readonly totalDebitsPaise: number;
  readonly netPaise: number;
  readonly monthsObserved: number;
  readonly averageMonthlyNetPaise: number | null;
  readonly minBalancePaise: number | null;
  readonly maxBalancePaise: number | null;
  /** Last observed balance, or null when balance column absent. */
  readonly closingBalancePaise: number | null;
}

export type SignalSeverity = 'low' | 'medium' | 'high';

export interface RiskSignal {
  readonly ruleId: RuleId;
  readonly severity: SignalSeverity;
  readonly note: string;
  readonly evidence: readonly Evidence[];
}

export interface InsightsReport {
  readonly income: IncomeSummary;
  readonly obligations: ObligationsSummary;
  readonly foir: FoirSummary;
  readonly cashflow: CashflowSummary;
  readonly signals: readonly RiskSignal[];
  /** Data-quality caveats — never an exception, always a string. */
  readonly warnings: readonly string[];
  readonly analyzedTransactions: number;
}

export interface InsightsOptions {
  /** Amount tolerance for "same payment" matching. Defaults to 0.1 (10%). */
  readonly amountTolerance?: number;
  /** Days within which a credit↔debit pair counts as a round trip. Default 5. */
  readonly roundTripWindowDays?: number;
  /** Min occurrences in distinct months before a debit counts as recurring.
   *  Defaults to 3; drop to 2 for short statements. */
  readonly minRecurringOccurrences?: number;
}
