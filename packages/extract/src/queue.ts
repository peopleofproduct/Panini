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

import type { OcrResult } from './ocr';

/**
 * Seam for asynchronous, queue-priced OCR/document-extraction services
 * (AWS Textract async, Azure Document Intelligence, vendor batch APIs).
 *
 * Queue-priced batch extraction is typically 5–10× cheaper than
 * synchronous calls — the cost-arbitrage path for NBFCs running
 * overnight underwriting batches. The trade-off is latency and (for
 * hosted services) PII egress — callers choose this tier knowingly.
 *
 * Job lifecycle is submit → poll until done. Results return as an
 * {@link OcrResult} so they re-enter the same deterministic pipeline
 * (line grouping, table reconstruction, verification) as every other
 * tier.
 */
export interface QueueOcrProvider {
  readonly name: string;
  /** Submit page images for batch extraction; returns a job id. */
  submit(pages: readonly Uint8Array[]): Promise<string>;
  /** Poll a submitted job. */
  poll(jobId: string): Promise<QueueJob>;
}

export interface QueueJob {
  readonly status: 'pending' | 'done' | 'failed';
  /** Present when status is 'done'. */
  readonly result?: OcrResult;
  /** Provider error detail when status is 'failed'. */
  readonly error?: string;
}
