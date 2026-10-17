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
 * Seam for scanned documents (image bytes or text-less PDFs). OCR is the
 * heaviest vendor moat and inherently model-dependent — the caller plugs
 * in Tesseract, a cloud OCR, or an on-device model via this interface.
 * Panini owns the deterministic half: whatever text the provider returns
 * is re-run through the same line-grouping and table reconstruction as a
 * real text layer.
 */
export interface OcrProvider {
  readonly name: string;
  /** Extracts plain text lines from image bytes. */
  recognize(image: Uint8Array): Promise<OcrResult>;
}

export interface OcrResult {
  readonly text: string;
  /** Optional provider-reported confidence in [0, 1]. */
  readonly confidence?: number;
}
