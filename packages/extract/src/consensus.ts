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
 * Dual-engine consensus for degraded scans.
 *
 * The property that makes this worth running: two independent engines
 * cannot hallucinate the *same* wrong number. Where Tesseract and a VLM
 * agree, confidence is earned rather than assumed; where they disagree,
 * the exact cells are flagged for human review instead of silently
 * picked.
 */

import type { ExtractedStatement } from './types';
import { verifyStatement } from './verify';

export type ConsensusVerdict = 'agree' | 'partial' | 'disagree' | 'incomparable';

export interface ConsensusDisagreement {
  /** Index into the primary statement's transactions. */
  readonly row: number;
  readonly field: 'amountPaise' | 'balancePaise' | 'date' | 'direction' | 'narration';
  readonly primary: string;
  readonly secondary: string;
}

export interface ConsensusResult {
  readonly verdict: ConsensusVerdict;
  /** Rows aligned and compared on both sides. */
  readonly comparedRows: number;
  readonly disagreements: readonly ConsensusDisagreement[];
  /** The accepted statement — the primary, annotated. */
  readonly statement: ExtractedStatement;
}

function cmpField(
  out: ConsensusDisagreement[],
  row: number,
  field: ConsensusDisagreement['field'],
  a: unknown,
  b: unknown,
): void {
  if (String(a ?? '') !== String(b ?? '')) {
    out.push({ row, field, primary: String(a ?? ''), secondary: String(b ?? '') });
  }
}

/**
 * Align two extracted statements row-by-row (index order — engines see
 * the same pages, so row order is comparable) and field-compare.
 * Deterministic; never throws.
 */
export function consensusCompare(
  primary: ExtractedStatement,
  secondary: ExtractedStatement,
  secondaryEngine: string,
): ConsensusResult {
  const a = primary.transactions;
  const b = secondary.transactions;
  const n = Math.min(a.length, b.length);
  if (n === 0) {
    return {
      verdict: 'incomparable',
      comparedRows: 0,
      disagreements: [],
      statement: {
        ...primary,
        warnings: [...primary.warnings, `consensus: no comparable rows vs ${secondaryEngine}`],
      },
    };
  }

  const disagreements: ConsensusDisagreement[] = [];
  for (let i = 0; i < n; i++) {
    const ta = a[i]!;
    const tb = b[i]!;
    cmpField(disagreements, i, 'date', ta.date, tb.date);
    cmpField(disagreements, i, 'amountPaise', ta.amountPaise, tb.amountPaise);
    cmpField(disagreements, i, 'direction', ta.direction, tb.direction);
    cmpField(disagreements, i, 'balancePaise', ta.balancePaise, tb.balancePaise);
    if (ta.narration.trim().toLowerCase() !== tb.narration.trim().toLowerCase()) {
      disagreements.push({
        row: i,
        field: 'narration',
        primary: ta.narration,
        secondary: tb.narration,
      });
    }
  }
  // Row-count mismatch is itself a disagreement signal.
  if (a.length !== b.length) {
    disagreements.push({
      row: -1,
      field: 'narration',
      primary: `${a.length} rows`,
      secondary: `${b.length} rows`,
    });
  }

  const verdict: ConsensusVerdict =
    disagreements.length === 0 ? 'agree' : disagreements.length <= n ? 'partial' : 'disagree';

  const notes: string[] = [
    `consensus vs ${secondaryEngine}: ${verdict} (${disagreements.length} differing fields over ${n} rows)`,
  ];
  for (const d of disagreements.slice(0, 10)) {
    notes.push(
      `consensus disagreement row ${d.row} ${d.field}: primary='${d.primary}' vs ${secondaryEngine}='${d.secondary}'`,
    );
  }
  return {
    verdict,
    comparedRows: n,
    disagreements,
    statement: {
      ...primary,
      warnings: verdict === 'agree' ? primary.warnings : [...primary.warnings, ...notes],
      metadata: {
        ...primary.metadata,
        consensusEngine: secondaryEngine,
        consensusVerdict: verdict,
      },
    },
  };
}

/** Convenience: consensus verdict + verification of the primary, together. */
export function consensusWithVerification(
  primary: ExtractedStatement,
  secondary: ExtractedStatement,
  secondaryEngine: string,
): ConsensusResult & { readonly verified: boolean } {
  const consensus = consensusCompare(primary, secondary, secondaryEngine);
  const v = verifyStatement(consensus.statement);
  return { ...consensus, verified: v.pass };
}
