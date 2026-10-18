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
 * Document-integrity orchestrator — one call runs every applicable
 * forensic layer and returns an explainable verdict.
 */

import { extractStatement, sniffFormat, type ExtractedStatement } from '@paniniapi/extract';
import { checkConsistency } from './consistency';
import { inspectPdfContent } from './pdf/content';
import { verifyPdfSignatures, type SignatureOptions } from './pdf/signature';
import { inspectPdfStructure } from './pdf/structure';
import type {
  ConsistencyCheck,
  IntegrityReport,
  IntegritySignal,
  IntegrityVerdict,
  SignatureCheck,
} from './types';
import type { ExtractOptions } from '@paniniapi/extract';

export interface InspectOptions extends SignatureOptions {
  /** Passed through to extractStatement (formatsDir, credentials, …). */
  readonly extract?: ExtractOptions;
}

function rollup(
  signals: readonly IntegritySignal[],
  sigs: readonly SignatureCheck[],
): IntegrityVerdict {
  if (signals.some((s) => s.severity === 'critical')) return 'tamper_evidence';
  if (signals.some((s) => s.severity === 'warning')) return 'warnings';
  if (sigs.some((s) => s.present)) return 'clean';
  return signals.length === 0 ? 'inconclusive' : 'clean';
}

function signalizeSignatures(checks: readonly SignatureCheck[]): IntegritySignal[] {
  const out: IntegritySignal[] = [];
  for (const c of checks) {
    if (c.digestValid === false) {
      out.push({
        ruleId: 'sig.digest_mismatch',
        severity: 'critical',
        message: 'signed-byte-range digest does not match — the signed content was altered',
        evidence: `field ${c.fieldName ?? '?'} signer ${c.signer ?? '?'}`,
      });
    }
    if (c.signatureValid === false) {
      out.push({
        ruleId: 'sig.invalid',
        severity: 'critical',
        message: 'embedded signature fails cryptographic verification',
        evidence: `field ${c.fieldName ?? '?'} signer ${c.signer ?? '?'}`,
      });
    }
    if (c.postSignBytes) {
      out.push({
        ruleId: 'sig.post_sign_append',
        severity: 'warning',
        message: 'bytes exist after the signed range — content was appended post-signature',
        evidence: `field ${c.fieldName ?? '?'}`,
      });
    }
    if (c.signatureValid === true && c.digestValid === true) {
      out.push({
        ruleId: 'sig.verified',
        severity: 'info',
        message: `signature by ${c.signer ?? 'unknown'} verifies — signed bytes are provably unaltered`,
        evidence: c.chainTrusted === true ? 'chain trusted' : 'chain untrusted or not evaluated',
      });
    }
    if (c.chainTrusted === false) {
      out.push({
        ruleId: 'sig.chain_untrusted',
        severity: 'warning',
        message:
          'signature is cryptographically valid but the signer chain does not reach a trust anchor',
        evidence: `signer ${c.signer ?? '?'}`,
      });
    }
    for (const e of c.errors) {
      out.push({
        ruleId: 'sig.check_error',
        severity: 'warning',
        message: `signature check incomplete: ${e}`,
        evidence: `field ${c.fieldName ?? '?'}`,
      });
    }
  }
  return out;
}

/**
 * Full integrity inspection: container forensics (PDF only), signature
 * validation, then extraction + arithmetic consistency. Never throws —
 * malformed input produces warning signals, not exceptions.
 */
export async function inspectStatement(
  input: Uint8Array | string,
  opts: InspectOptions = {},
): Promise<IntegrityReport> {
  const signals: IntegritySignal[] = [];
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const format = sniffFormat(bytes);

  let signatures: readonly SignatureCheck[] = [];
  if (format === 'pdf') {
    // extraction first so the statement period can inform structure checks
    let statement: ExtractedStatement | null = null;
    try {
      statement = await extractStatement(bytes, opts.extract);
    } catch {
      /* handled below */
    }
    signals.push(
      ...inspectPdfStructure(bytes, {
        statementPeriodEnd: statement?.metadata['statementTo'] ?? null,
      }),
      ...inspectPdfContent(bytes),
    );
    signatures = verifyPdfSignatures(
      bytes,
      opts.trustStore === undefined ? {} : { trustStore: opts.trustStore },
    );
    return finalize(format, signals, signatures, statement);
  }

  if (format !== 'unknown') {
    signals.push({
      ruleId: 'container.no_integrity_layer',
      severity: 'info',
      message: `${format} carries no tamper-evident container — integrity verdict rests on arithmetic consistency only`,
      evidence: `format=${format}`,
    });
  }

  let statement: ExtractedStatement | null = null;
  try {
    statement = await extractStatement(bytes, opts.extract);
  } catch {
    signals.push({
      ruleId: 'container.unreadable',
      severity: 'warning',
      message: 'input could not be extracted for consistency checks',
      evidence: `format=${format}`,
    });
  }
  return finalize(format, signals, signatures, statement);
}

function finalize(
  format: string,
  signals: IntegritySignal[],
  sigs: readonly SignatureCheck[],
  statement: ExtractedStatement | null,
): IntegrityReport {
  let consistency: ConsistencyCheck | null = null;
  const all = [...signals];
  if (statement !== null && statement.transactions.length > 0) {
    const c = checkConsistency(statement);
    consistency = c.check;
    all.push(...c.signals);
  }
  all.push(...signalizeSignatures(sigs));
  const critical = all.filter((s) => s.severity === 'critical').length;
  const warningCount = all.filter((s) => s.severity === 'warning').length;
  return {
    verdict: rollup(all, sigs),
    format,
    signals: all,
    signatures: sigs,
    consistency,
    critical,
    warningCount,
  };
}
