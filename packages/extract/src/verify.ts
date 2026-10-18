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

/**
 * Deterministic verification gate for non-native extraction paths
 * (OCR / vision-model / queued TSP output).
 *
 * Whatever engine produced the rows, the numbers must obey arithmetic:
 * a running balance can only move by the transaction's amount; dates
 * must be parseable and in-period; opening→closing must reconcile.
 * A hallucinated or misread row breaks the chain — this module is what
 * turns "the model said so" into "the model's output survived the math".
 */

import type { ExtractedStatement } from './types';

export interface VerifyIssue {
  readonly ruleId: string;
  /** Row index the issue points at, or -1 for statement-level. */
  readonly row: number;
  readonly message: string;
  /** e.g. 'expected 102500.00, observed 103000.00' */
  readonly evidence?: string;
}

export interface VerificationResult {
  /** issues.length === 0 on rows that could be checked. */
  readonly pass: boolean;
  /** 0–1 — fraction of applicable checks that held. */
  readonly score: number;
  readonly issues: readonly VerifyIssue[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Verify an extracted statement's internal arithmetic. Deterministic,
 * never throws. Rows missing balance/amount data simply don't
 * contribute checks — the score is a pass fraction, not a guess.
 */
export function verifyStatement(statement: ExtractedStatement): VerificationResult {
  const issues: VerifyIssue[] = [];
  let checks = 0;
  let held = 0;

  const txns = statement.transactions;

  // Balance-chain continuity: prev ± amount === next balance.
  let prevBalance: number | null = null;
  for (let i = 0; i < txns.length; i++) {
    const t = txns[i]!;
    if (
      prevBalance !== null &&
      t.balancePaise !== null &&
      t.amountPaise !== null &&
      (t.direction === 'DEBIT' || t.direction === 'CREDIT')
    ) {
      checks++;
      const expected: number =
        t.direction === 'CREDIT' ? prevBalance + t.amountPaise : prevBalance - t.amountPaise;
      if (expected === t.balancePaise) {
        held++;
      } else {
        issues.push({
          ruleId: 'verify.balance_chain',
          row: i,
          message: `row ${i} balance breaks the running chain`,
          evidence:
            `expected ${(expected / 100).toFixed(2)}, ` +
            `observed ${(t.balancePaise / 100).toFixed(2)}`,
        });
      }
    }
    if (t.balancePaise !== null) prevBalance = t.balancePaise;
  }

  // Date plausibility: every date must be ISO-parseable.
  for (let i = 0; i < txns.length; i++) {
    const d = txns[i]!.date;
    if (d === null) continue;
    checks++;
    if (ISO_DATE.test(d) && !Number.isNaN(Date.parse(d))) {
      held++;
    } else {
      issues.push({
        ruleId: 'verify.bad_date',
        row: i,
        message: `row ${i} carries an unparseable date '${d}'`,
      });
    }
  }

  // Reconciliation: opening → closing via net of rows when metadata exists.
  const open = Number(statement.metadata['openingBalancePaise'] ?? NaN);
  const close = Number(statement.metadata['closingBalancePaise'] ?? NaN);
  if (!Number.isNaN(open) && !Number.isNaN(close) && txns.length > 0) {
    checks++;
    const net = txns.reduce((sum, t) => {
      if (t.amountPaise === null || (t.direction !== 'DEBIT' && t.direction !== 'CREDIT'))
        return sum;
      return sum + (t.direction === 'CREDIT' ? t.amountPaise : -t.amountPaise);
    }, 0);
    const expected = open + net;
    if (expected === close) {
      held++;
    } else {
      issues.push({
        ruleId: 'verify.reconciliation',
        row: -1,
        message: 'opening→closing balance does not reconcile',
        evidence:
          `expected ${(expected / 100).toFixed(2)}, ` + `observed ${(close / 100).toFixed(2)}`,
      });
    }
  }

  // Parse-rate floor: a statement whose rows are mostly unusable is a
  // degraded extraction, not a clean one.
  if (txns.length > 0) {
    checks++;
    const usable = txns.filter(
      (t) => t.amountPaise !== null && (t.direction === 'DEBIT' || t.direction === 'CREDIT'),
    ).length;
    if (usable / txns.length >= 0.5) {
      held++;
    } else {
      issues.push({
        ruleId: 'verify.low_parse_rate',
        row: -1,
        message: `only ${usable}/${txns.length} rows carry amount+direction`,
      });
    }
  }

  const score = checks === 0 ? 1 : held / checks;
  return { pass: issues.length === 0, score, issues };
}
