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
 * Document ↔ Account Aggregator cross-verification — the strongest
 * fraud check this stack can produce.
 *
 * Arithmetic forensics ({@link checkConsistency}) proves a document is
 * *internally* consistent — but a fraudster can fabricate a perfectly
 * self-consistent statement. The AA feed is the ground truth: it comes
 * from the bank itself, encrypted end-to-end, and cannot be edited by
 * the borrower. Diffing the claimed document against the AA truth
 * answers the question that ends every forensic debate: **did the
 * document lie about what actually happened?**
 *
 * Matching is a deterministic multiset join on (date ± window,
 * amount ± tolerance, direction). Rows the document claims but the AA
 * feed doesn't know — inside the AA coverage window — are fabrication
 * evidence. Rows the AA feed carries that the document omits inside the
 * document's own period are omissions — a fabricated statement hiding
 * debits. Soft fields (narration, balance) surface as warnings; amounts,
 * dates and direction are hard facts.
 */

import type { ExtractedStatement } from '@paniniapi/extract';

/** One transaction from a ReBIT AA FI feed (deposit/current-account shape). */
export interface AaTransaction {
  readonly txnId?: string;
  /** Rupees (string or number) — converted to paise internally. */
  readonly amount: number | string;
  readonly type: string; // 'DEBIT' | 'CREDIT' | 'OTHERS'
  readonly valueDate: string; // ISO date
  readonly narration?: string;
  readonly reference?: string;
  readonly transactionTimestamp?: string;
  readonly balance?: number | string;
  readonly currentBalance?: number | string;
}

export interface ReconcileOptions {
  /** Amount slack in paise. AA amounts are canonical — default 0. */
  readonly amountTolerancePaise?: number;
  /**
   * |valueDate − documentDate| slack in days. PDF statements and AA
   * feeds can legitimately differ by one day (value vs posting date).
   * Default 1.
   */
  readonly dateWindowDays?: number;
  /**
   * When false, narration drift on matched rows is ignored entirely.
   * Default true — narrations drift across channels, so they're warnings.
   */
  readonly compareNarrations?: boolean;
}

export type ReconcileField = 'amount' | 'direction' | 'date' | 'balance' | 'narration';

export interface ReconcileMismatch {
  /** Index into the statement's transactions; null when row exists only in AA. */
  readonly documentRow: number | null;
  /** Index into the AA feed; null when row exists only in the document. */
  readonly aaRow: number | null;
  readonly field: ReconcileField;
  readonly documentValue: string;
  readonly aaValue: string;
  /** 'hard' mismatches are fabrication evidence; 'soft' are warnings. */
  readonly severity: 'hard' | 'soft';
}

export type ReconcileVerdict = 'consistent' | 'partial' | 'fabrication_evidence' | 'incomparable';

export interface ReconciliationReport {
  readonly verdict: ReconcileVerdict;
  /** Document rows confirmed present in the AA feed. */
  readonly matchedRows: number;
  /** Document rows inside the AA coverage window with no AA counterpart. */
  readonly documentOnlyRows: readonly number[];
  /** AA rows inside the document period with no document counterpart. */
  readonly aaOnlyRows: readonly number[];
  /** Document rows outside the AA window — cannot be confirmed or refuted. */
  readonly unverifiableRows: readonly number[];
  readonly mismatches: readonly ReconcileMismatch[];
  readonly summary: string;
}

const DAY_MS = 86_400_000;

function rupeesToPaise(v: number | string): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function dateMs(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function normNarration(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface CanonRow {
  readonly index: number;
  readonly dateMs: number | null;
  readonly amountPaise: number | null;
  readonly direction: string | null;
  readonly narration: string;
  readonly balancePaise: number | null;
}

function canonDoc(statement: ExtractedStatement): CanonRow[] {
  return statement.transactions.map((t, index) => ({
    index,
    dateMs: dateMs(t.date),
    amountPaise: t.amountPaise,
    direction: t.direction,
    narration: t.narration,
    balancePaise: t.balancePaise,
  }));
}

function canonAa(txns: readonly AaTransaction[]): CanonRow[] {
  return txns.map((t, index) => ({
    index,
    dateMs: dateMs(t.valueDate),
    amountPaise: rupeesToPaise(t.amount),
    direction: t.type === 'DEBIT' || t.type === 'CREDIT' ? t.type : 'OTHERS',
    narration: t.narration ?? '',
    balancePaise: rupeesToPaise(t.currentBalance ?? t.balance ?? NaN),
  }));
}

/**
 * Diff a claimed statement against the AA ground truth. Deterministic:
 * same inputs → same report. Never throws — unusable inputs return
 * 'incomparable'.
 */
export function reconcileWithAa(
  statement: ExtractedStatement,
  aaTransactions: readonly AaTransaction[],
  options: ReconcileOptions = {},
): ReconciliationReport {
  const amountTol = options.amountTolerancePaise ?? 0;
  const dateTolMs = (options.dateWindowDays ?? 1) * DAY_MS;
  const compareNarr = options.compareNarrations ?? true;

  const doc = canonDoc(statement);
  const aa = canonAa(aaTransactions);
  if (doc.length === 0 || aa.length === 0) {
    return {
      verdict: 'incomparable',
      matchedRows: 0,
      documentOnlyRows: [],
      aaOnlyRows: [],
      unverifiableRows: [],
      mismatches: [],
      summary:
        doc.length === 0
          ? 'document carries no transactions to reconcile'
          : 'AA feed carries no transactions to reconcile against',
    };
  }

  // AA coverage window — document rows outside it are unverifiable, not suspect.
  const aaDates = aa.map((r) => r.dateMs).filter((d): d is number => d !== null);
  const aaMin = aaDates.length > 0 ? Math.min(...aaDates) : null;
  const aaMax = aaDates.length > 0 ? Math.max(...aaDates) : null;
  const inAaWindow = (d: number | null): boolean =>
    d !== null &&
    aaMin !== null &&
    aaMax !== null &&
    d >= aaMin - dateTolMs &&
    d <= aaMax + dateTolMs;

  // Document period for the omission check.
  const docDates = doc.map((r) => r.dateMs).filter((d): d is number => d !== null);
  const docMin = docDates.length > 0 ? Math.min(...docDates) : null;
  const docMax = docDates.length > 0 ? Math.max(...docDates) : null;
  const inDocWindow = (d: number | null): boolean =>
    d !== null &&
    docMin !== null &&
    docMax !== null &&
    d >= docMin - dateTolMs &&
    d <= docMax + dateTolMs;

  // Deterministic multiset join: sort AA candidates by (date, amount),
  // greedily consume the first eligible candidate per document row.
  const pool = [...aa].sort(
    (a, b) =>
      (a.dateMs ?? 0) - (b.dateMs ?? 0) ||
      (a.amountPaise ?? 0) - (b.amountPaise ?? 0) ||
      a.index - b.index,
  );
  const used = new Set<number>();

  const mismatches: ReconcileMismatch[] = [];
  const documentOnly: number[] = [];
  const unverifiable: number[] = [];
  let matched = 0;

  const keyMatch = (d: CanonRow, a: CanonRow): boolean =>
    d.direction === a.direction &&
    d.amountPaise !== null &&
    a.amountPaise !== null &&
    Math.abs(d.amountPaise - a.amountPaise) <= amountTol &&
    (d.dateMs === null || a.dateMs === null || Math.abs(d.dateMs - a.dateMs) <= dateTolMs);

  for (const d of doc) {
    const hit = pool.find((a) => !used.has(a.index) && keyMatch(d, a));
    if (hit === undefined) {
      if (inAaWindow(d.dateMs)) documentOnly.push(d.index);
      else unverifiable.push(d.index);
      continue;
    }
    used.add(hit.index);
    matched++;

    // Soft-field comparison on confirmed pairs.
    if (
      d.balancePaise !== null &&
      hit.balancePaise !== null &&
      d.balancePaise !== hit.balancePaise
    ) {
      mismatches.push({
        documentRow: d.index,
        aaRow: hit.index,
        field: 'balance',
        documentValue: `₹${(d.balancePaise / 100).toFixed(2)}`,
        aaValue: `₹${(hit.balancePaise / 100).toFixed(2)}`,
        severity: 'soft',
      });
    }
    if (compareNarr && normNarration(d.narration) !== normNarration(hit.narration)) {
      mismatches.push({
        documentRow: d.index,
        aaRow: hit.index,
        field: 'narration',
        documentValue: d.narration.slice(0, 80),
        aaValue: hit.narration.slice(0, 80),
        severity: 'soft',
      });
    }
  }

  // AA rows inside the document period that the document omits.
  const aaOnly = pool
    .filter((a) => !used.has(a.index) && inDocWindow(a.dateMs))
    .map((a) => a.index)
    .sort((a, b) => a - b);

  // Hard evidence: rows claimed inside the AA window that the bank
  // doesn't know (fabricated credits) or rows the bank knows that the
  // document hides inside its own period (hidden debits).
  const hardCount = documentOnly.length + aaOnly.length;
  const softCount = mismatches.length;

  const verdict: ReconcileVerdict =
    hardCount > 0 ? 'fabrication_evidence' : softCount > 0 ? 'partial' : 'consistent';

  const parts = [`${matched}/${doc.length} document rows confirmed against AA feed`];
  if (documentOnly.length > 0)
    parts.push(`${documentOnly.length} document rows unknown to the bank feed`);
  if (aaOnly.length > 0) parts.push(`${aaOnly.length} bank transactions omitted from the document`);
  if (softCount > 0) parts.push(`${softCount} soft-field mismatches`);
  if (unverifiable.length > 0)
    parts.push(`${unverifiable.length} rows outside AA coverage (unverifiable)`);

  return {
    verdict,
    matchedRows: matched,
    documentOnlyRows: documentOnly,
    aaOnlyRows: aaOnly,
    unverifiableRows: unverifiable,
    mismatches,
    summary: parts.join('; '),
  };
}

/**
 * Tolerant extractor: finds the transaction array inside an AA FI data
 * payload. Handles the ReBIT shape ({Account:{Transactions:{Transaction:[…]}}})
 * plus any nested object whose values eventually yield a transaction-like
 * array. Deterministic depth-first search; returns [] when nothing fits.
 */
export function transactionsFromAaData(fiData: unknown): AaTransaction[] {
  const looksLikeTxn = (o: unknown): boolean =>
    typeof o === 'object' &&
    o !== null &&
    ('amount' in o || 'valueDate' in o || 'type' in o) &&
    ('valueDate' in o || 'transactionTimestamp' in o || 'amount' in o);

  const seen = new Set<unknown>();
  const walk = (node: unknown): AaTransaction[] | null => {
    if (typeof node !== 'object' || node === null || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every(looksLikeTxn)) return node as AaTransaction[];
      for (const item of node) {
        const found = walk(item);
        if (found !== null) return found;
      }
      return null;
    }
    for (const key of Object.keys(node)) {
      const found = walk((node as Record<string, unknown>)[key]);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(fiData) ?? [];
}
