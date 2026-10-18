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
 * Tiered extraction router for scanned/degraded inputs — "any eyes,
 * proven numbers".
 *
 * Each tier is a caller-plugged engine: a cheap local OCR, an on-prem
 * open-weight VLM, a queue-priced batch TSP. Tiers run cheapest→costliest;
 * every result re-enters the deterministic row pipeline and must pass the
 * {@link verifyStatement} arithmetic gate before it is accepted. The
 * first tier to pass wins; failures accumulate into warnings so nothing
 * silently mis-parses.
 */

import {
  loadBankNames,
  loadCsvLayouts,
  maybeLoadFormats,
  mergeBankNames,
  mergeCsvLayouts,
  type BankNamesFile,
  type CsvLayoutsFile,
} from './formatsLoader';
import { statementFromRows } from './csv/csvStatement';
import { statementFromOcr } from './extract';
import type { OcrProvider, OcrResult } from './ocr';
import type { QueueOcrProvider } from './queue';
import type { ExtractedStatement } from './types';
import { verifyStatement } from './verify';
import type { VisionPage, VisionProvider } from './vision';

export interface RouterTier {
  readonly kind: 'ocr' | 'vision' | 'queue';
  readonly provider: OcrProvider | VisionProvider | QueueOcrProvider;
}

export interface ExtractionRouterOptions {
  /** Engine tiers, cheapest first. */
  readonly tiers: readonly RouterTier[];
  /** Minimum verifyStatement score to accept a tier. Default 0.85. */
  readonly minVerifyScore?: number;
  /** Optional provider-confidence floor below which a tier is skipped. */
  readonly minProviderConfidence?: number;
  /** Queue tier: poll interval and attempt cap. */
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  /** Layout resolution — same semantics as extractStatement. */
  readonly formatsDir?: string;
  readonly extraFormatsDir?: string;
  readonly bankHint?: string;
  readonly layoutId?: string;
}

export interface ExtractionAttempt {
  readonly engine: string;
  readonly kind: RouterTier['kind'];
  readonly verifyScore: number;
  readonly issues: readonly string[];
}

export interface RoutedExtraction {
  readonly statement: ExtractedStatement;
  /** Engine that produced the accepted statement; null when none passed. */
  readonly engine: string | null;
  readonly verdict: 'verified' | 'degraded' | 'failed';
  readonly attempts: readonly ExtractionAttempt[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runTier(
  tier: RouterTier,
  pages: readonly VisionPage[],
  layouts: ReturnType<typeof loadCsvLayouts>,
  options: { bankHint?: string; layoutId?: string; bankNames?: BankNamesFile },
  router: ExtractionRouterOptions,
): Promise<ExtractedStatement> {
  const format = 'image';
  if (tier.kind === 'vision') {
    const p = tier.provider as VisionProvider;
    const rows: string[][] = [];
    let model: string | undefined;
    for (const page of pages) {
      const res = await p.extractTable(page);
      rows.push(...res.rows.map((r) => [...r]));
      model ??= res.model;
    }
    const mined = statementFromRows(rows, layouts, format, options);
    return {
      ...mined,
      metadata: {
        ...mined.metadata,
        ocrProvider: p.name,
        ...(model !== undefined ? { visionModel: model } : {}),
      },
    };
  }
  let ocr: OcrResult;
  if (tier.kind === 'queue') {
    const q = tier.provider as QueueOcrProvider;
    const jobId = await q.submit(pages.map((pg) => pg.image));
    const maxPolls = router.maxPolls ?? 60;
    const interval = router.pollIntervalMs ?? 1000;
    let job = await q.poll(jobId);
    let tries = 1;
    while (job.status === 'pending' && tries < maxPolls) {
      await sleep(interval);
      job = await q.poll(jobId);
      tries++;
    }
    if (job.status === 'failed') throw new Error(`queue job failed: ${job.error ?? 'unknown'}`);
    if (job.status !== 'done' || job.result === undefined)
      throw new Error(`queue job did not finish within ${maxPolls} polls`);
    ocr = job.result;
  } else {
    const p = tier.provider as OcrProvider;
    const texts: string[] = [];
    const fragments: {
      text: string;
      x: number;
      y: number;
      page?: number;
    }[] = [];
    let confidence: number | undefined;
    for (const page of pages) {
      const res = await p.recognize(page.image);
      texts.push(res.text);
      confidence = res.confidence ?? confidence;
      for (const f of res.fragments ?? []) fragments.push({ ...f, page: page.pageNumber });
    }
    ocr = {
      text: texts.join('\n'),
      ...(fragments.length > 0 ? { fragments } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }
  const st = statementFromOcr(ocr, layouts, format, (tier.provider as OcrProvider).name, options);
  return st;
}

/**
 * Route page images through engine tiers until one produces a statement
 * that passes the verification gate. Never throws: every failure becomes
 * an attempt record + warning on the final statement.
 */
export async function extractWithRouter(
  pages: readonly VisionPage[],
  router: ExtractionRouterOptions,
): Promise<RoutedExtraction> {
  const layouts = mergeCsvLayouts(
    loadCsvLayouts(router.formatsDir),
    router.extraFormatsDir !== undefined
      ? maybeLoadFormats<CsvLayoutsFile>('csv-layouts.json', router.extraFormatsDir)
      : undefined,
  );
  const bankNames = mergeBankNames(
    loadBankNames(router.formatsDir),
    router.extraFormatsDir !== undefined
      ? maybeLoadFormats<BankNamesFile>('bank-names.json', router.extraFormatsDir)
      : undefined,
  );
  const minScore = router.minVerifyScore ?? 0.85;
  const withLayout = {
    bankNames,
    ...(router.bankHint !== undefined ? { bankHint: router.bankHint } : {}),
    ...(router.layoutId !== undefined ? { layoutId: router.layoutId } : {}),
  };
  const attempts: ExtractionAttempt[] = [];
  let last: ExtractedStatement | null = null;
  let lastVerdict: VerificationSummary | null = null;

  for (const tier of router.tiers) {
    const engine = tier.provider.name;
    try {
      const st = await runTier(tier, pages, layouts, withLayout, router);
      const providerConf = Number(st.metadata['ocrConfidence'] ?? NaN);
      if (
        router.minProviderConfidence !== undefined &&
        !Number.isNaN(providerConf) &&
        providerConf < router.minProviderConfidence
      ) {
        attempts.push({
          engine,
          kind: tier.kind,
          verifyScore: 0,
          issues: [
            `provider confidence ${providerConf.toFixed(2)} below floor ` +
              `${router.minProviderConfidence}`,
          ],
        });
        last = st;
        continue;
      }
      const v = verifyStatement(st);
      attempts.push({
        engine,
        kind: tier.kind,
        verifyScore: v.score,
        issues: v.issues.map((i) => i.message),
      });
      if (v.score >= minScore && st.transactions.length > 0) {
        return {
          statement: {
            ...st,
            metadata: {
              ...st.metadata,
              extractionEngine: engine,
              extractionVerdict: 'verified',
              extractionVerifyScore: v.score.toFixed(3),
            },
          },
          engine,
          verdict: 'verified',
          attempts,
        };
      }
      last = st;
      lastVerdict = v;
    } catch (err) {
      attempts.push({
        engine,
        kind: tier.kind,
        verifyScore: 0,
        issues: [`engine failed: ${err instanceof Error ? err.message : String(err)}`],
      });
    }
  }

  // No tier passed — return the best-scoring attempt marked degraded.
  const statement: ExtractedStatement = last ?? {
    format: 'image',
    bank: null,
    layoutId: null,
    accountMask: null,
    transactions: [],
    warnings: [],
    metadata: {},
  };
  const verdict = statement.transactions.length > 0 ? 'degraded' : 'failed';
  return {
    statement: {
      ...statement,
      warnings: [
        ...statement.warnings,
        `extraction ${verdict}: no engine tier passed the verification gate ` +
          `(${attempts.map((a) => `${a.engine}=${a.verifyScore.toFixed(2)}`).join(', ')})`,
      ],
      metadata: {
        ...statement.metadata,
        extractionVerdict: verdict,
        ...(lastVerdict !== null ? { extractionVerifyScore: lastVerdict.score.toFixed(3) } : {}),
      },
    },
    engine: null,
    verdict,
    attempts,
  };
}

type VerificationSummary = ReturnType<typeof verifyStatement>;
