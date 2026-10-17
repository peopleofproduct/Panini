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

import { deflateSync } from 'node:zlib';

/** Deterministically builds a minimal single-content-stream PDF. */
export function makePdf(
  fragments: readonly { x: number; y: number; text: string }[],
  options?: { compress?: boolean },
): Uint8Array {
  const escape = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const ops = ['BT /F1 10 Tf'];
  for (const f of fragments) {
    ops.push(`1 0 0 1 ${f.x.toFixed(2)} ${f.y.toFixed(2)} Tm (${escape(f.text)}) Tj`);
  }
  ops.push('ET');
  const content = Buffer.from(ops.join('\n'), 'latin1');
  const body = options?.compress === false ? content : deflateSync(content);
  const dict =
    options?.compress === false
      ? `<< /Length ${body.length} >>`
      : `<< /Length ${body.length} /Filter /FlateDecode >>`;
  const head = Buffer.from(`%PDF-1.4\n1 0 obj ${dict} stream\n`, 'latin1');
  const tail = Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1');
  return new Uint8Array(Buffer.concat([head, body, tail]));
}

/** A realistic two-column-grouped statement page: header + txn rows. */
export function makeStatementPdf(rows: readonly string[][]): Uint8Array {
  const cols = [50, 140, 300, 380, 460, 540];
  const header = ['Date', 'Narration', 'Ref No.', 'Debit', 'Credit', 'Balance'];
  const fragments: { x: number; y: number; text: string }[] = [
    { x: 50, y: 760, text: 'Account No : XXXXXX1234' },
    { x: 50, y: 740, text: 'Statement 01/10/26 to 31/10/26' },
  ];
  header.forEach((h, i) => fragments.push({ x: cols[i] ?? 0, y: 700, text: h }));
  rows.forEach((row, r) => {
    row.forEach((cell, i) => {
      if (cell !== '') fragments.push({ x: cols[i] ?? 0, y: 680 - r * 20, text: cell });
    });
  });
  return makePdf(fragments);
}
