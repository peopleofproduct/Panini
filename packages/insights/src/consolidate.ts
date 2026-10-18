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

import { epochDay } from './analyze';
import type { InsightTransaction } from './types';

/** One borrower's statement slice — transactions plus the account identity
 *  the extractor recovered (mask/bank), or a caller-provided key. */
export interface AccountSlice {
  /** Caller label, e.g. 'HDFC-****1234'. Defaults to 'account-N'. */
  readonly accountKey?: string;
  readonly accountMask?: string | null;
  readonly bank?: string | null;
  readonly transactions: readonly InsightTransaction[];
}

export interface ConsolidationOptions {
  /** Amount tolerance for pairing a debit leg with a credit leg. Default 0.02. */
  readonly amountTolerance?: number;
  /** Max days between the debit leg and the credit leg. Default 3. */
  readonly transferWindowDays?: number;
  /** Max days apart for two same-refNo rows to count as duplicates. Default 1. */
  readonly duplicateWindowDays?: number;
}

/** A debit in one account mirrored by a credit in another — the borrower's
 *  own money moving, not external flow. */
export interface InternalTransfer {
  readonly fromAccount: string;
  readonly toAccount: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly amountPaise: number;
  readonly daysApart: number;
}

/** Same refNo + amount + direction appearing in two places — the same
 *  statement uploaded twice, overlapping statement periods, or a genuine
 *  double posting. */
export interface DuplicateTxn {
  readonly accountA: string;
  readonly indexA: number;
  readonly accountB: string;
  readonly indexB: number;
  readonly refNo: string;
  readonly amountPaise: number;
  readonly daysApart: number;
}

export interface AccountRollup {
  readonly accountKey: string;
  readonly bank: string | null;
  readonly accountMask: string | null;
  readonly txnCount: number;
  readonly totalCreditsPaise: number;
  readonly totalDebitsPaise: number;
  readonly netPaise: number;
  /** First and last dated transaction, ISO 'YYYY-MM-DD'. */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

export interface ConsolidatedFlow {
  /** Raw sums across every account — includes internal legs. */
  readonly totalCreditsPaise: number;
  readonly totalDebitsPaise: number;
  /** External-only sums — internal transfer legs removed. What an
   *  underwriter should read as real turnover. */
  readonly externalCreditsPaise: number;
  readonly externalDebitsPaise: number;
  readonly netPaise: number;
  /** Volume of money that moved only between the borrower's own accounts. */
  readonly internalVolumePaise: number;
}

export interface PortfolioReport {
  readonly accounts: readonly AccountRollup[];
  readonly internalTransfers: readonly InternalTransfer[];
  readonly duplicates: readonly DuplicateTxn[];
  readonly consolidated: ConsolidatedFlow;
  readonly warnings: readonly string[];
}

function sliceKey(slice: AccountSlice, position: number): string {
  if (slice.accountKey !== undefined && slice.accountKey.trim() !== '') return slice.accountKey;
  if (slice.accountMask !== null && slice.accountMask !== undefined && slice.accountMask !== '') {
    return `${slice.bank ?? 'BANK'}-${slice.accountMask}`;
  }
  return `account-${position}`;
}

function normalizeRefNo(ref: string | null | undefined): string | null {
  if (ref === null || ref === undefined) return null;
  const cleaned = ref.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned.length >= 6 ? cleaned : null;
}

interface Leg {
  account: string;
  index: number;
  amountPaise: number;
  day: number | null;
  ref?: string;
}

function rollup(slice: AccountSlice, key: string): AccountRollup {
  let credits = 0;
  let debits = 0;
  let start: string | null = null;
  let end: string | null = null;
  for (const t of slice.transactions) {
    if (t.amountPaise !== null && Number.isFinite(t.amountPaise)) {
      if (t.direction === 'CREDIT') credits += t.amountPaise;
      if (t.direction === 'DEBIT') debits += t.amountPaise;
    }
    const day = epochDay(t.date);
    if (day !== null) {
      const iso = t.date!.slice(0, 10);
      if (start === null || iso < start) start = iso;
      if (end === null || iso > end) end = iso;
    }
  }
  return {
    accountKey: key,
    bank: slice.bank ?? null,
    accountMask: slice.accountMask ?? null,
    txnCount: slice.transactions.length,
    totalCreditsPaise: credits,
    totalDebitsPaise: debits,
    netPaise: credits - debits,
    periodStart: start,
    periodEnd: end,
  };
}

/**
 * Consolidates one borrower's statements across accounts into a single
 * picture: per-account rollups, internal (own-account) transfers netted out,
 * and cross-account duplicates flagged. Deterministic — every pairing is
 * amount+date+refNo arithmetic, no model. Never throws.
 */
export function consolidateAccounts(
  accounts: readonly AccountSlice[],
  options?: ConsolidationOptions,
): PortfolioReport {
  const warnings: string[] = [];
  const tolerance = options?.amountTolerance ?? 0.02;
  const windowDays = options?.transferWindowDays ?? 3;
  const dupWindow = options?.duplicateWindowDays ?? 1;

  if (accounts.length === 0) {
    warnings.push('no accounts supplied — portfolio report is empty');
  }
  if (accounts.length === 1) {
    warnings.push('single account supplied — consolidation is identical to per-account analysis');
  }

  const keyed = accounts.map((slice, i) => ({ slice, key: sliceKey(slice, i) }));
  const keys = keyed.map((k) => k.key);
  if (new Set(keys).size !== keys.length) {
    warnings.push('duplicate accountKey values — internal-transfer detection may misfire');
  }

  // ── Internal transfers: debit leg in one account ↔ credit leg in another,
  // same amount within tolerance, within windowDays. Greedy one-to-one.
  const debitLegs: Leg[] = [];
  const creditLegs: Leg[] = [];
  for (const { slice, key } of keyed) {
    slice.transactions.forEach((t, index) => {
      if (t.amountPaise === null || !Number.isFinite(t.amountPaise)) return;
      const leg: Leg = { account: key, index, amountPaise: t.amountPaise, day: epochDay(t.date) };
      if (t.direction === 'DEBIT') debitLegs.push(leg);
      if (t.direction === 'CREDIT') creditLegs.push(leg);
    });
  }
  const internalTransfers: InternalTransfer[] = [];
  const matchedCredits = new Set<string>();
  for (const d of debitLegs) {
    for (const c of creditLegs) {
      if (c.account === d.account) continue;
      const cid = `${c.account}:${c.index}`;
      if (matchedCredits.has(cid)) continue;
      if (
        Math.abs(c.amountPaise - d.amountPaise) >
        Math.max(c.amountPaise, d.amountPaise) * tolerance
      )
        continue;
      const daysApart = d.day !== null && c.day !== null ? c.day - d.day : null;
      if (daysApart !== null && (daysApart < -windowDays || daysApart > windowDays)) continue;
      matchedCredits.add(cid);
      internalTransfers.push({
        fromAccount: d.account,
        toAccount: c.account,
        fromIndex: d.index,
        toIndex: c.index,
        amountPaise: d.amountPaise,
        daysApart: daysApart ?? 0,
      });
      break;
    }
  }

  // ── Duplicates: same normalized refNo + same direction + same amount,
  // within dupWindow days — in the same account (period overlap) or across
  // accounts (same statement uploaded under two labels).
  const byRef = new Map<string, Leg[]>();
  for (const { slice, key } of keyed) {
    slice.transactions.forEach((t, index) => {
      const ref = normalizeRefNo(t.refNo);
      if (ref === null || t.amountPaise === null || t.direction === null) return;
      const refKey = `${t.direction}:${ref}`;
      const list = byRef.get(refKey) ?? [];
      list.push({ account: key, index, amountPaise: t.amountPaise, day: epochDay(t.date), ref });
      byRef.set(refKey, list);
    });
  }
  const duplicates: DuplicateTxn[] = [];
  for (const legs of byRef.values()) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        const a = legs[i]!;
        const b = legs[j]!;
        if (a.amountPaise !== b.amountPaise) continue;
        const apart = a.day !== null && b.day !== null ? Math.abs(a.day - b.day) : 0;
        if (a.day !== null && b.day !== null && apart > dupWindow) continue;
        if (a.account === b.account && a.index === b.index) continue;
        duplicates.push({
          accountA: a.account,
          indexA: a.index,
          accountB: b.account,
          indexB: b.index,
          refNo: a.ref ?? '',
          amountPaise: a.amountPaise,
          daysApart: apart,
        });
      }
    }
  }

  // Consolidated flow: external = totals minus both legs of each internal
  // transfer (the debit leaving one account and the credit landing in
  // another are the same money, counted twice raw).
  const rollups = keyed.map(({ slice, key }) => rollup(slice, key));
  const totalCredits = rollups.reduce((s, r) => s + r.totalCreditsPaise, 0);
  const totalDebits = rollups.reduce((s, r) => s + r.totalDebitsPaise, 0);
  const internalVolume = internalTransfers.reduce((s, t) => s + t.amountPaise, 0);
  const consolidated: ConsolidatedFlow = {
    totalCreditsPaise: totalCredits,
    totalDebitsPaise: totalDebits,
    externalCreditsPaise: totalCredits - internalVolume,
    externalDebitsPaise: totalDebits - internalVolume,
    netPaise: totalCredits - totalDebits,
    internalVolumePaise: internalVolume,
  };

  return {
    accounts: rollups,
    internalTransfers,
    duplicates,
    consolidated,
    warnings,
  };
}
