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

import type { OcrFragment, OcrProvider, OcrResult } from './ocr';
import type { QueueJob, QueueOcrProvider } from './queue';
import type { SpreadsheetProvider } from './spreadsheet';
import type { VisionProvider, VisionResult } from './vision';
import { readXlsxSheet } from './xlsx/xlsx';

/**
 * Ready-made provider adapters. The heavy libraries stay caller-owned —
 * these factories only require a duck-typed handle on the library the
 * consumer already installed, so this package remains zero-dependency.
 *
 *   import * as XLSX from 'xlsx';
 *   extractStatement(bytes, { spreadsheet: createSheetJsProvider(XLSX) });
 *
 *   import { createWorker } from 'tesseract.js';
 *   const worker = await createWorker('eng');
 *   extractStatement(png, { ocr: createTesseractProvider(worker) });
 */

/** Minimal structural shape of a SheetJS-compatible module. */
export interface SheetJsLike {
  readonly SheetNames?: readonly string[];
  read(
    data: Uint8Array | ArrayBuffer,
    options?: { type?: string },
  ): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json(worksheet: unknown, options?: { header?: number; raw?: boolean }): unknown;
  };
}

/** Adapts SheetJS (or any compatible spreadsheet reader) to the seam. */
export function createSheetJsProvider(xlsx: SheetJsLike, sheetIndex = 0): SpreadsheetProvider {
  return {
    name: 'sheetjs',
    readSheet(data) {
      const workbook = xlsx.read(data, { type: 'array' });
      const name = workbook.SheetNames[sheetIndex] ?? workbook.SheetNames[0];
      if (name === undefined) return [];
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
        raw: false,
      });
      if (!Array.isArray(rows)) return [];
      return (rows as unknown[]).map((row) =>
        Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [],
      );
    },
  };
}

/**
 * The bundled zero-dependency XLSX reader — ZIP + sharedStrings + styles
 * (date-formatted serials render as ISO dates). `extractStatement` uses
 * this automatically when `options.spreadsheet` is not supplied; this
 * factory exists for callers who want to pass it explicitly.
 */
export function createNativeXlsxProvider(): SpreadsheetProvider {
  return { name: 'panini-native-xlsx', readSheet: readXlsxSheet };
}

/** Minimal structural shape of a tesseract.js worker. */
export interface TesseractLike {
  recognize(image: Uint8Array | Buffer | string): Promise<{
    data: {
      text: string;
      confidence?: number;
      words?: readonly {
        text: string;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }[];
    };
  }>;
}

/**
 * Adapts a tesseract.js worker (or compatible engine) to the OCR seam.
 * Word boxes become OcrFragments so column anchoring survives OCR —
 * far more accurate than whitespace-splitting flat text on bank tables.
 */
export function createTesseractProvider(worker: TesseractLike): OcrProvider {
  return {
    name: 'tesseract',
    async recognize(image) {
      const { data } = await worker.recognize(image);
      const fragments: OcrFragment[] = (data.words ?? [])
        .filter((w) => w.text.trim() !== '')
        .map((w) => ({ text: w.text, x: w.bbox.x0, y: w.bbox.y0 }));
      const out: { text: string; fragments?: OcrFragment[]; confidence?: number } = {
        text: data.text,
      };
      if (fragments.length > 0) out.fragments = fragments;
      if (data.confidence !== undefined) out.confidence = data.confidence / 100;
      return out;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Vision (VLM) + queue-priced TSP adapters                             */
/* ------------------------------------------------------------------ */

/** Minimal structural shape of the fetch API the caller owns. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Deterministic base64 encoder — works in Node and browsers alike. */
function bytesToBase64(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += table[a >> 2]! + table[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : table[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : table[c & 63]!;
  }
  return out;
}

export interface OpenAiVisionOptions {
  /** e.g. 'http://localhost:11434' (Ollama) or a vLLM server — never a
   *  hardcoded vendor; the caller picks where inference runs. */
  readonly baseUrl: string;
  /** Model id served at baseUrl, e.g. 'qwen2.5-vl:7b'. */
  readonly model: string;
  /** Caller-owned fetch (globalThis.fetch, undici, a wrapped client...). */
  readonly fetchImpl: FetchLike;
  /** Bearer token when the serving layer requires one. */
  readonly apiKey?: string;
  /** Override the extraction instruction prompt. */
  readonly prompt?: string;
  /** Keep the raw model response in results for audit. Default false —
   *  raw responses may carry narration PII. */
  readonly retainRawResponse?: boolean;
}

const DEFAULT_VISION_PROMPT =
  'Extract the bank statement transaction table from this page image. ' +
  'Return ONLY a JSON array of row arrays, in reading order, columns ' +
  '[Date, Narration, Reference, Debit, Credit, Balance]. ' +
  'Use empty strings for missing cells. No prose, no code fences.';

/**
 * Adapts an OpenAI-compatible chat/completions endpoint to the vision
 * seam — the on-prem open-weight path (Ollama, vLLM, llama.cpp) for
 * degraded scans. Sends one rendered page per request with the image
 * inline as base64; requests temperature 0 so output is as deterministic
 * as the model allows.
 *
 * The model's JSON rows return through the deterministic verify gate —
 * a VLM can hallucinate rows, and {@link verifyStatement} is what turns
 * its output from "the model said so" into "it survived the math".
 */
export function createOpenAiVisionProvider(opts: OpenAiVisionOptions): VisionProvider {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.apiKey !== undefined) headers['authorization'] = `Bearer ${opts.apiKey}`;
  const prompt = opts.prompt ?? DEFAULT_VISION_PROMPT;
  return {
    name: `vision:${opts.model}`,
    async extractTable(page): Promise<VisionResult> {
      const media = page.mediaType ?? 'png';
      const res = await opts.fetchImpl(`${opts.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: opts.model,
          temperature: 0,
          messages: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:image/${media};base64,${bytesToBase64(page.image)}` },
                },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`vision endpoint ${res.status}`);
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content ?? '';
      const rows = parseRowJson(content);
      const out: { rows: readonly string[][]; model: string; rawResponse?: string } = {
        rows,
        model: opts.model,
      };
      if (opts.retainRawResponse === true) out.rawResponse = content;
      return out;
    },
  };
}

/** Accepts `[[...], ...]`, tolerating code fences and a wrapping object. */
function parseRowJson(content: string): string[][] {
  let text = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(text);
  if (fence) text = fence[1]!.trim();
  const parsed: unknown = JSON.parse(text);
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { rows?: unknown[] }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;
  if (arr === null) throw new Error('vision response is not a row array');
  return arr.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [String(row ?? '')],
  );
}

export interface HttpQueueOptions {
  /** Caller-owned fetch — same rules as {@link OpenAiVisionOptions}. */
  readonly fetchImpl: FetchLike;
  /** POST endpoint that accepts { pages: base64[] } and returns a job id. */
  readonly submitUrl: string;
  /** GET endpoint polled with `/{jobId}` appended until done/failed. */
  readonly pollUrl: string;
  readonly headers?: Record<string, string>;
  /** JSON field carrying the job id in the submit response. Default 'jobId'. */
  readonly jobIdField?: string;
  /** JSON field carrying status in poll responses. Default 'status'. */
  readonly statusField?: string;
  /** Status strings the provider uses for terminal states. */
  readonly doneStatus?: string;
  readonly failedStatus?: string;
}

/**
 * Adapts a generic submit/poll HTTP service to the queue-priced TSP seam
 * (batch OCR endpoints — Textract-style async APIs, vendor batch tiers).
 * Results come back as an {@link OcrResult} so they re-enter the same
 * deterministic pipeline; all transport stays caller-owned.
 */
export function createHttpQueueProvider(opts: HttpQueueOptions): QueueOcrProvider {
  const jobField = opts.jobIdField ?? 'jobId';
  const statusField = opts.statusField ?? 'status';
  const done = opts.doneStatus ?? 'done';
  const failed = opts.failedStatus ?? 'failed';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(opts.headers ?? {}),
  };
  return {
    name: `queue:${new URL(opts.pollUrl).host}`,
    async submit(pages) {
      const res = await opts.fetchImpl(opts.submitUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pages: pages.map(bytesToBase64) }),
      });
      if (!res.ok) throw new Error(`queue submit ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      const jobId = body[jobField];
      if (typeof jobId !== 'string') throw new Error('queue submit returned no job id');
      return jobId;
    },
    async poll(jobId): Promise<QueueJob> {
      const res = await opts.fetchImpl(`${opts.pollUrl}/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers,
        body: '',
      });
      if (!res.ok) throw new Error(`queue poll ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      const status = body[statusField];
      if (status === done) {
        const result = body['result'] as OcrResult | undefined;
        return { status: 'done', ...(result !== undefined ? { result } : {}) };
      }
      if (status === failed) {
        return { status: 'failed', error: String(body['error'] ?? 'provider reported failure') };
      }
      return { status: 'pending' };
    },
  };
}
