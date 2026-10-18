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
 * Arithmetic consistency forensics — the strongest deterministic tamper
 * signal available on any format: a running balance is a checksum that
 * covers every row. Edit one amount and every balance after it breaks;
 * recompute them all and the stated opening/closing no longer reconcile.
 * Every break is reported with the row index and expected-vs-actual.
 */

import type { ExtractedStatement } from '@paniniapi/extract';
import type { ConsistencyCheck, IntegritySignal } from './types';

/** Banks round differently across currencies — 1 paise covers drift. */
const TOLERANCE_PAISE = 1;

interface ChainRow {
  readonly index: number;
  readonly balance: number;
  readonly amount: number | null;
  readonly direction: string | null;
}

/** Extract the running-balance chain from rows that carry one. */
function balanceChain(st: ExtractedStatement): ChainRow[] {
  const chain: ChainRow[] = [];
  for (let i = 0; i < st.transactions.length; i++) {
    const t = st.transactions[i]!;
    if (t.balancePaise === null) continue;
    chain.push({
      index: i,
      balance: t.balancePaise,
      amount: t.amountPaise,
      direction: t.direction,
    });
  }
  return chain;
}

export function checkConsistency(st: ExtractedStatement): {
  check: ConsistencyCheck;
  signals: IntegritySignal[];
} {
  const signals: IntegritySignal[] = [];
  let balanceChainBreaks = 0;
  let openingMismatch: boolean | null = null;
  let closingMismatch: boolean | null = null;
  let outOfPeriodRows = 0;
  let duplicateRows = 0;

  const chain = balanceChain(st);

  // ── running-balance continuity ──────────────────────────────────────
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1]!;
    const cur = chain[i]!;
    if (cur.amount === null || cur.direction === null || cur.direction === 'UNKNOWN') continue;
    const delta = cur.direction === 'CREDIT' ? cur.amount : -cur.amount;
    const expected = prev.balance + delta;
    if (Math.abs(cur.balance - expected) > TOLERANCE_PAISE) {
      balanceChainBreaks++;
      if (balanceChainBreaks <= 5) {
        signals.push({
          ruleId: 'math.balance_chain_break',
          severity: 'critical',
          message: `row ${cur.index} balance breaks the running chain — the amount or balance was altered`,
          evidence: `expected ${expected} paise (prev ${prev.balance} ${cur.direction === 'CREDIT' ? '+' : '-'} ${cur.amount}), row shows ${cur.balance}`,
        });
      }
    }
  }
  if (balanceChainBreaks > 5) {
    signals.push({
      ruleId: 'math.balance_chain_break',
      severity: 'critical',
      message: `…plus ${balanceChainBreaks - 5} more balance-chain breaks`,
      evidence: `total ${balanceChainBreaks} breaks`,
    });
  }

  // ── opening/closing reconciliation ──────────────────────────────────
  const open = Number(st.metadata['openingBalancePaise'] ?? NaN);
  const close = Number(st.metadata['closingBalancePaise'] ?? NaN);
  const first = chain[0];
  const last = chain[chain.length - 1];
  if (
    !Number.isNaN(open) &&
    first !== undefined &&
    first.amount !== null &&
    first.direction !== null
  ) {
    // first row's pre-transaction balance should equal opening balance.
    const preFirst =
      first.direction === 'CREDIT' ? first.balance - first.amount : first.balance + first.amount;
    openingMismatch = Math.abs(preFirst - open) > TOLERANCE_PAISE;
    if (openingMismatch) {
      signals.push({
        ruleId: 'math.opening_mismatch',
        severity: 'critical',
        message: 'first transaction does not reconcile with the stated opening balance',
        evidence: `implied opening ${preFirst} paise vs stated ${open}`,
      });
    }
  }
  if (!Number.isNaN(close) && last !== undefined) {
    closingMismatch = Math.abs(last.balance - close) > TOLERANCE_PAISE;
    if (closingMismatch) {
      signals.push({
        ruleId: 'math.closing_mismatch',
        severity: 'critical',
        message: 'last running balance does not equal the stated closing balance',
        evidence: `last row ${last.balance} paise vs stated ${close}`,
      });
    }
  }

  // ── period bounds ────────────────────────────────────────────────────
  const from = st.metadata['statementFrom'];
  const to = st.metadata['statementTo'];
  if (from !== undefined && to !== undefined) {
    for (let i = 0; i < st.transactions.length; i++) {
      const d = st.transactions[i]!.date;
      if (d !== null && (d < from || d > to)) outOfPeriodRows++;
    }
    if (outOfPeriodRows > 0) {
      signals.push({
        ruleId: 'math.out_of_period',
        severity: 'warning',
        message: `${outOfPeriodRows} transaction(s) dated outside the stated period ${from}..${to}`,
        evidence: `period ${from}..${to}`,
      });
    }
  }

  // ── duplicate rows (copy-paste fabrication signature) ────────────────
  const seen = new Map<string, number>();
  for (const t of st.transactions) {
    if (t.amountPaise === null) continue;
    const k = `${t.date}|${t.narration}|${t.amountPaise}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, n] of seen) {
    if (n > 1) duplicateRows += n - 1;
    if (n > 2) {
      signals.push({
        ruleId: 'math.duplicate_rows',
        severity: 'warning',
        message: `row duplicated ${n}× — repeated identical transaction`,
        evidence: k.slice(0, 80),
      });
    }
  }
  if (duplicateRows > 0 && !signals.some((s) => s.ruleId === 'math.duplicate_rows')) {
    signals.push({
      ruleId: 'math.duplicate_rows',
      severity: 'info',
      message: `${duplicateRows} duplicate transaction row(s) — often legitimate (repeat purchases) but worth review`,
      evidence: `${duplicateRows} duplicates`,
    });
  }

  return {
    check: {
      balanceChainBreaks,
      openingMismatch,
      closingMismatch,
      sumMismatch: null,
      outOfPeriodRows,
      duplicateRows,
    },
    signals,
  };
}
