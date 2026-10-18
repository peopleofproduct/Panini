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
 * Content-layer forensics: anomalies in the rendered text itself —
 * the classic "typed Salary over the real narration" attack leaves
 * stacked fragments at the same page position, and invisible-text
 * rendering modes smuggle content past a visual review.
 */

import { extractPdfFragments, type PdfFragment } from '@paniniapi/extract';
import type { IntegritySignal } from '../types';

const X_TOL = 2;
const Y_TOL = 3;

function overlappingPairs(fragments: readonly PdfFragment[]): [PdfFragment, PdfFragment][] {
  const hits: [PdfFragment, PdfFragment][] = [];
  for (let i = 0; i < fragments.length; i++) {
    for (let j = i + 1; j < fragments.length; j++) {
      const a = fragments[i]!;
      const b = fragments[j]!;
      if (a.page !== b.page) continue;
      if (Math.abs(a.y - b.y) > Y_TOL || Math.abs(a.x - b.x) > X_TOL) continue;
      if (a.text === b.text) continue; // identical duplicate draw — harmless
      hits.push([a, b]);
    }
  }
  return hits;
}

/**
 * Text-content anomaly signals. Never throws — an unreadable content
 * stream yields a `content_unreadable` warning signal.
 */
export function inspectPdfContent(pdf: Uint8Array): IntegritySignal[] {
  const signals: IntegritySignal[] = [];
  const latin = Buffer.from(pdf).toString('latin1');

  // Invisible-text rendering modes: `3 Tr` (invisible), `7 Tr` (invisible
  // +clip). Legit statements never hide text.
  const invisible = (latin.match(/\b[37]\s+Tr\b/g) ?? []).length;
  if (invisible > 0) {
    signals.push({
      ruleId: 'pdf.invisible_text',
      severity: 'critical',
      message: `${invisible} text run(s) render invisibly — content a reviewer cannot see is present in the document`,
      evidence: `Tr-mode-3/7 operators ×${invisible}`,
    });
  }

  let fragments: readonly PdfFragment[];
  try {
    fragments = extractPdfFragments(pdf);
  } catch {
    signals.push({
      ruleId: 'pdf.content_unreadable',
      severity: 'info',
      message: 'content stream could not be decomposed for overlay analysis',
      evidence: 'fragment extraction failed',
    });
    return signals;
  }

  const hits = overlappingPairs(fragments);
  if (hits.length > 0) {
    const sample = hits
      .slice(0, 3)
      .map(([a, b]) => `p${a.page} ("${a.text.slice(0, 24)}" vs "${b.text.slice(0, 24)}")`)
      .join('; ');
    signals.push({
      ruleId: 'pdf.overlapping_text',
      severity: 'critical',
      message: `${hits.length} stacked text fragments at identical positions — overtyped content`,
      evidence: sample,
    });
  }
  return signals;
}
