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
 * Seam for vision-language models on scanned/degraded statement pages.
 *
 * Unlike {@link OcrProvider} (word boxes → Panini's column-anchored
 * reconstruction), a VLM can emit *structured rows directly* — its edge
 * on badly degraded inputs. The trade-off is hallucination: a VLM can
 * invent plausible-looking rows. That is why every VisionResult must pass
 * the deterministic {@link verifyStatement} gate (and optionally a
 * second engine via consensus) before it reaches underwriting.
 *
 * Provenance is mandatory: the model id is recorded so consumers know
 * the extraction is model-derived, not deterministic.
 */
export interface VisionProvider {
  readonly name: string;
  /** Extract structured table rows from one rendered page image. */
  extractTable(page: VisionPage): Promise<VisionResult>;
}

export interface VisionPage {
  /** Rendered page image bytes. Panini does not rasterize — the caller
   *  supplies rendered pages (pdf.js / mupdf / poppler). */
  readonly image: Uint8Array;
  /** 1-based page number. */
  readonly pageNumber: number;
  readonly mediaType?: 'png' | 'jpeg' | 'webp';
}

export interface VisionResult {
  /** Extracted table rows as raw string cells (header row excluded). */
  readonly rows: readonly (readonly string[])[];
  /** Provider self-reported confidence in [0, 1] when available. */
  readonly confidence?: number;
  /** Model id recorded for provenance (e.g. 'qwen2.5-vl:7b'). */
  readonly model?: string;
  /** Raw model response retained as audit evidence. */
  readonly rawResponse?: string;
}
