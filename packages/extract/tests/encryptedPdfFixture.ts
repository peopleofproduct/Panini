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
 * Test-side PDF encryptor — an independent implementation of the PDF
 * Standard security handler (Algorithms 2, 3.4, 1), written to the spec
 * rather than mirroring src/pdf/encryption.ts, so the round-trip is a
 * real verification of the decryptor.
 */

import { createCipheriv, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function md5(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

function rc4enc(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256).map((_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + (s[i] ?? 0) + (key[i % key.length] ?? 0)) & 0xff;
    [s[i], s[j]] = [s[j] ?? 0, s[i] ?? 0];
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + 1) & 0xff;
    b = (b + (s[a] ?? 0)) & 0xff;
    [s[a], s[b]] = [s[b] ?? 0, s[a] ?? 0];
    out[i] = (data[i] ?? 0) ^ (s[((s[a] ?? 0) + (s[b] ?? 0)) & 0xff] ?? 0);
  }
  return out;
}

export interface EncryptOptions {
  readonly password: string;
  readonly ownerPassword?: string;
  readonly cipher?: 'rc4' | 'aesv2';
  readonly r?: 3 | 4;
}

/**
 * Builds a single-page statement PDF encrypted with the Standard
 * handler (V2 RC4-128 or V4 AESV2), exactly as bank e-statement
 * generators produce them: Flate-compress → encrypt → store.
 */
export function makeEncryptedPdf(
  fragments: readonly { x: number; y: number; text: string }[],
  opts: EncryptOptions,
): Uint8Array {
  const r = opts.r ?? 3;
  const cipher = opts.cipher ?? 'rc4';
  const v = cipher === 'aesv2' ? 4 : 2;
  const lengthBits = 128;
  const p = -3904;

  // content stream (plaintext side)
  const escape = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const ops = ['BT /F1 10 Tf'];
  for (const f of fragments) {
    ops.push(`1 0 0 1 ${f.x.toFixed(2)} ${f.y.toFixed(2)} Tm (${escape(f.text)}) Tj`);
  }
  ops.push('ET');
  const content = Buffer.from(ops.join('\n'), 'latin1');

  // owner key O = RC4/MD5 chain over owner password (Algorithm 3)
  const ownerPad = (pw: string) => {
    const out = new Uint8Array(32);
    out.set(PADDING);
    out.set(new Uint8Array(Buffer.from(pw, 'latin1')).subarray(0, 32));
    return out;
  };
  let ownerKey = md5(ownerPad(opts.ownerPassword ?? 'owner')).subarray(0, 5);
  for (let i = 0; i < 50; i += 1) ownerKey = md5(ownerKey);
  let oVal = rc4enc(ownerKey, ownerPad(opts.password));
  for (let i = 1; i < 20; i += 1) {
    oVal = rc4enc(new Uint8Array(ownerKey.map((b) => b ^ i)), oVal);
  }

  const fileId = new Uint8Array([
    0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81, 0x92, 0xa3, 0xb4, 0xc5, 0xd6, 0xe7, 0xf8, 0x09,
  ]);
  const pLe = new Uint8Array(4);
  new DataView(pLe.buffer).setInt32(0, p, true);

  // file key (Algorithm 2)
  let digest = md5(ownerPad(opts.password), oVal, pLe, fileId);
  for (let i = 0; i < 50; i += 1) digest = md5(digest.subarray(0, 16));
  const fileKey = digest.subarray(0, lengthBits / 8);

  // user password U (Algorithm 3.4)
  let uCheck = md5(PADDING, fileId);
  for (let i = 0; i < 20; i += 1) {
    uCheck = rc4enc(new Uint8Array(fileKey.map((b) => b ^ i)), uCheck);
  }
  const uVal = Buffer.concat([
    Buffer.from(uCheck),
    Buffer.from([
      0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99,
      0x00,
    ]),
  ]);

  // per-object stream key (Algorithm 1)
  const objKey = (obj: number, gen: number, aes: boolean) => {
    const suffix = new Uint8Array([
      obj & 0xff,
      (obj >> 8) & 0xff,
      (obj >> 16) & 0xff,
      gen & 0xff,
      (gen >> 8) & 0xff,
    ]);
    const parts = aes
      ? [fileKey, suffix, new Uint8Array(Buffer.from('sAlT', 'latin1'))]
      : [fileKey, suffix];
    return md5(...parts).subarray(0, 16);
  };

  const flate = deflateSync(content);
  let body: Uint8Array;
  if (cipher === 'aesv2') {
    const iv = Buffer.from([
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32,
      0x10,
    ]);
    const c = createCipheriv('aes-128-cbc', Buffer.from(objKey(1, 0, true)), iv);
    const enc = Buffer.concat([c.update(flate), c.final()]);
    body = new Uint8Array(Buffer.concat([iv, enc]));
  } else {
    body = rc4enc(objKey(1, 0, false), new Uint8Array(flate));
  }

  const cfDict =
    cipher === 'aesv2'
      ? ' /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF'
      : '';
  const encObj = `2 0 obj << /Filter /Standard /V ${v} /R ${r} /Length ${lengthBits} /P ${p} /O <${Buffer.from(oVal).toString('hex')}> /U <${uVal.toString('hex')}>${cfDict} >> endobj\n`;

  const head = Buffer.from(
    `%PDF-1.4\n1 0 obj << /Length ${body.length} /Filter /FlateDecode >> stream\n`,
    'latin1',
  );
  const mid = Buffer.from(`\nendstream\nendobj\n${encObj}`, 'latin1');
  const idHex = Buffer.from(fileId).toString('hex');
  const trailer = Buffer.from(
    `trailer << /Encrypt 2 0 R /ID [<${idHex}> <${idHex}>] >>\n%%EOF`,
    'latin1',
  );
  return new Uint8Array(Buffer.concat([head, Buffer.from(body), mid, trailer]));
}
