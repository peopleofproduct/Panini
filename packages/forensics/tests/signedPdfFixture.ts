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
 * In-memory signed-PDF builder: a DER encoder, a CMS SignedData emitter,
 * and a minimal statement PDF carrying a real RSA signature — so the
 * forensics pipeline is exercised end-to-end against a genuinely
 * verifiable document. The cert is a self-signed fixture only.
 */

import * as crypto from 'node:crypto';
import { deflateSync } from 'node:zlib';

// ── DER encoder ─────────────────────────────────────────────────────────

function lenBytes(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, n >> 8, n & 0xff]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), lenBytes(content.length), content]);
}

const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const octet = (b: Buffer) => tlv(0x04, b);
const null_ = () => Buffer.from([0x05, 0x00]);
const utcTime = (s: string) => tlv(0x17, Buffer.from(s, 'latin1'));
const ctx = (n: number, inner: Buffer) => tlv(0xa0 + n, inner);

function oidBytes(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const out: number[] = [parts[0]! * 40 + parts[1]!];
  for (const p of parts.slice(2)) {
    let v = p;
    const stack = [v & 0x7f];
    while ((v >>= 7) > 0) stack.unshift((v & 0x7f) | 0x80);
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

function intBytes(v: bigint): Buffer {
  let hex = v.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  let b = Buffer.from(hex, 'hex');
  if (b[0]! & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

// ── minimal DER reader (fixture-side: only used to lift cert issuer) ────

interface DerNode {
  tagClass: number;
  tagNumber: number;
  tlv: Uint8Array;
  children: DerNode[];
}

function readDerNode(buf: Uint8Array, off: number): { node: DerNode; next: number } {
  const tagByte = buf[off]!;
  let pos = off + 1;
  let len = buf[pos++]!;
  if (len >= 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[pos++]!;
  }
  const content = buf.subarray(pos, pos + len);
  const node: DerNode = {
    tagClass: (tagByte >> 6) & 3,
    tagNumber: tagByte & 0x1f,
    tlv: buf.subarray(off, pos + len),
    children: [],
  };
  if (tagByte & 0x20) {
    let c = 0;
    while (c < content.length) {
      const r = readDerNode(content, c);
      node.children.push(r.node);
      c = r.next;
    }
  }
  return { node, next: pos + len };
}

// ── fixture identity ────────────────────────────────────────────────────

/** Self-signed fixture cert — "TEST BANK LTD / Panini Test CA". Not a real CA. */
export const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIC+DCCAeACCQD7c+ucLn4zFDANBgkqhkiG9w0BAQsFADA+MRYwFAYDVQQDDA1U
RVNUIEJBTksgTFREMRcwFQYDVQQKDA5QYW5pbmkgVGVzdCBDQTELMAkGA1UEBhMC
SU4wHhcNMjYxMDE4MDk0OTI1WhcNMzYxMDE1MDk0OTI1WjA+MRYwFAYDVQQDDA1U
RVNUIEJBTksgTFREMRcwFQYDVQQKDA5QYW5pbmkgVGVzdCBDQTELMAkGA1UEBhMC
SU4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDyVzym42WXoOiPWdKL
sIwQfbjm2ERvNUtwPE4oRVh2tZ4elh2Jw9wcUIMsANhWlZh8HDW1C2XkPwlmKZK2
hx4igeib9+mi6YxFuFdIk7nEfo6eF0f0y2ivVzkGzT7jlXt0OPNu9U/cJF6V1/S5
Qe4NlyOTFuZjhbNrnQ2MU7weIDH08LE3zzNGmpQHf3bRYwLCCGBnq7STtUvQOTfV
ISGRc6yAbdXlJyYOpuBRebdu7hQbL3UCbpybX/cPdJmaU7g+4np7o8XpsyjowZxG
ifEfU4WTgat4HyAI9QRR9f/juArTaZQ4uXyDEO36imhOfKNyh+/5wDrWx5l2DQSK
Cc1TAgMBAAEwDQYJKoZIhvcNAQELBQADggEBACzMO8TN98Hc49c0AutZyrgjW6oo
cTT1pnQUc8NBQGsyNj4IJvWkzjJ1ReLUcGCQyhMy0pPpdOmOpL2nRZlyOx4OWxtK
8k871/X/t1qSqPpepc4BDcgeQTOjClmMw3S/Uc7JKdH+yrCVudbCQeaL9AIY53zQ
Yme5zIfEez3FVU61CX1QtJvLZI66RYHQCtSUBsnPpDoLPU8sFgD/qC+M5XYg7BRU
rXCa8NOJyT8cARxQ4Ldlxp0lcul8jS5RCUF2Ax+AwclQjcwmo6V1fpFZgnPSCtDx
FRGd0GSkFZpLjvVoB7fkYt0UycAAxEAbARUjulQItyiIv/bWDNI1Ecx+Yck=
-----END CERTIFICATE-----`;

export const TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDyVzym42WXoOiP
WdKLsIwQfbjm2ERvNUtwPE4oRVh2tZ4elh2Jw9wcUIMsANhWlZh8HDW1C2XkPwlm
KZK2hx4igeib9+mi6YxFuFdIk7nEfo6eF0f0y2ivVzkGzT7jlXt0OPNu9U/cJF6V
1/S5Qe4NlyOTFuZjhbNrnQ2MU7weIDH08LE3zzNGmpQHf3bRYwLCCGBnq7STtUvQ
OTfVISGRc6yAbdXlJyYOpuBRebdu7hQbL3UCbpybX/cPdJmaU7g+4np7o8Xpsyjo
wZxGifEfU4WTgat4HyAI9QRR9f/juArTaZQ4uXyDEO36imhOfKNyh+/5wDrWx5l2
DQSKCc1TAgMBAAECggEATsBcnFsPG4wVpufojK5thbplSNcEviLShgGC4IFQcxsn
7AaaSLeWIrljNvx7UP/CEqrUJSY0EU0Oz904qQoVl98haPXSPbepdsqlypb+6kS6
MdOc9YbYWQp+JKC0DB76hFUxfmBHeGF1Pzpzc3RiWJZB4D2z1qmPGaxqx6w6WIs5
5hzVTuXnbd2BFlDAAAeqzd/hiWV8isFg7OE/yQFkNl0HqQSH58Wz8sw8/zT0Hf2E
JiDRrML7NTkSTzWP4eodc14S4DAcuv3jjCrU7ODorIQrcep0F3tY4U+wMNMeClll
VC+xJJ53KciPCWbFoP3prs/tuCfMs+fpP60b3XBgoQKBgQD+L6hLRLRD7j7AAWMG
VZ7nCujwRRsX644sUtIgQgvWoRLv1M1zYA++YMS8DTfK3YDy8lZtbU53X/Ilotbo
8L7ZMTtYXJByilSlNDefi9lvHbmqC6Z9dHS/BidCfRQKByLjssJyKlYcFop0irBd
IPUHNgznCLTsYamZ/TJKusFSUQKBgQD0EfDJuQghiIyxJ5cOcndY9xNUFoIRYn7B
jwvx4yZAQXcPCLwa3814bgQvpQjxcvVzuG7FYPkOI2u1RNqSmwNDT29CW24wfOVj
xCMUL0cthXGEbee6oW3QweLoOxbKwCk2fqcXz586rTkKZ3/zKe3ZK9xoCNalgFMs
tcgo4mF4YwKBgD69JJzvaE8cDwD1VqvJll8Qok4rwHQ2//CQwKyVoLZpK3Nm4w8H
NtuWpviDirHX2mwcxJhd0nBEjlAb0U/NnE2fiTZWIpEi86GTMed/bTuv6pO+LGnq
xKYhrq8KkFepS0NIbBYhvP9R0PrTAJT7/X66KJUd4Qo3UNVhWXh4gB8BAoGAV2b5
UHPHeqK4p1QjHxRUsvI/5LPuviUEeXItd+C9OPN4nFSncARHQ2I6c4lpK3XceiVI
3bv9VFfQ4WgX0bpbL8aJdDzjt89yIgkB+t93YNDRtvfYrRfUCJb2F+3ZGqA34gD2
+2rpfYy8yYII6t5QA55WXpcTrs7GelNaq3FuMDsCgYBUb0YIyWVMoGApM3l2fTk4
/MeBfjNRaT8UJqxxYe+cuZ0+KwEalIouI4h6prcFbmBVJqyHs3J30j5p4kOICC48
TWc8lEC3s4l2a7b/aNFB8eYErtmlYj2j4AUiBbAFVKLyAkk53xsg33/ojkB93g2s
9TFGiTwrElmJUHvCM5JzkA==
-----END PRIVATE KEY-----`;

const CERT_DER = Buffer.from(new crypto.X509Certificate(TEST_CERT_PEM).raw);

// ── CMS builder ─────────────────────────────────────────────────────────

const OID_SIGNED_DATA = '1.2.840.113549.1.2.1';
const OID_DATA = '1.2.840.113549.1.7.1';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';

/** cert.tbsCertificate.issuer TLV — signer sid needs the issuer Name DER. */
function issuerNameTlv(certDer: Buffer): Buffer {
  const { node: cert } = readDerNode(new Uint8Array(certDer), 0);
  const tbs = cert.children[0]!;
  let idx = 0;
  if (tbs.children[0]!.tagClass === 2 && tbs.children[0]!.tagNumber === 0) idx = 1; // [0] version
  return Buffer.from(tbs.children[idx + 2]!.tlv); // skip serial + sigAlg
}

/**
 * Real CMS SignedData (detached) over `contentDigest`. The signature
 * covers signedAttrs re-tagged as SET OF — exactly what ISO 32000/CM
 * validators reconstruct.
 */
export function buildCms(
  contentDigest: Buffer,
  opts: { keyPem?: string; certDer?: Buffer; badSignature?: boolean; badDigest?: boolean } = {},
): Buffer {
  const attrsContent = Buffer.concat([
    seq(
      oidBytes(OID_MESSAGE_DIGEST),
      set(octet(opts.badDigest === true ? crypto.randomBytes(32) : contentDigest)),
    ),
    seq(oidBytes(OID_SIGNING_TIME), set(utcTime('261018093000Z'))),
  ]);
  const signedContent = Buffer.concat([
    Buffer.from([0x31]),
    lenBytes(attrsContent.length),
    attrsContent,
  ]);

  const key = crypto.createPrivateKey(opts.keyPem ?? TEST_KEY_PEM);
  let signature = crypto.sign('sha256', signedContent, key);
  if (opts.badSignature === true) {
    signature = Buffer.from(signature);
    signature[0]! ^= 0xff;
  }

  const cert = opts.certDer ?? CERT_DER;
  const certObj = new crypto.X509Certificate(cert);
  const serial = BigInt(`0x${certObj.serialNumber}`);

  const signerInfo = seq(
    intBytes(1n),
    seq(issuerNameTlv(cert), intBytes(serial)),
    seq(oidBytes(OID_SHA256), null_()),
    ctx(0, attrsContent),
    seq(oidBytes(OID_SHA256_RSA), null_()),
    octet(signature),
  );

  const signedData = seq(
    intBytes(1n),
    set(seq(oidBytes(OID_SHA256), null_())),
    seq(oidBytes(OID_DATA)),
    ctx(0, cert),
    set(signerInfo),
  );
  return seq(oidBytes(OID_SIGNED_DATA), ctx(0, signedData));
}

// ── signed PDF builder ──────────────────────────────────────────────────

const CONTENTS_PAD = 16384; // hex chars reserved for the CMS blob

export interface SignedPdfOptions {
  /** Append bytes after the signed range (incremental-update fakery). */
  readonly appendAfter?: string;
  /** Sign a wrong digest — signature stays valid but doesn't cover this file. */
  readonly badDigest?: boolean;
  /** Corrupt the signature bytes. */
  readonly badSignature?: boolean;
}

/**
 * Minimal single-page signed statement PDF. Content stream is
 * FlateDecode-compressed statement rows; the signature dict carries a
 * real ByteRange + CMS over the file bytes.
 */
export function buildSignedPdf(rows: readonly string[][], opts: SignedPdfOptions = {}): Uint8Array {
  const cols = [50, 140, 300, 380, 460, 540];
  const header = ['Date', 'Narration', 'Ref No.', 'Debit', 'Credit', 'Balance'];
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const ops = ['BT /F1 10 Tf'];
  const frag = (x: number, y: number, text: string) =>
    ops.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${esc(text)}) Tj`);
  frag(50, 760, 'Account No : XXXXXX1234');
  frag(50, 740, 'Statement 01/10/26 to 31/10/26');
  header.forEach((h, i) => frag(cols[i] ?? 0, 700, h));
  rows.forEach((row, r) =>
    row.forEach((cell, i) => {
      if (cell !== '') frag(cols[i] ?? 0, 680 - r * 20, cell);
    }),
  );
  ops.push('ET');
  const content = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));

  const head =
    '%PDF-1.4\n' +
    '1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >> endobj\n' +
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Annots [5 0 R] /Resources << /Font << /F1 7 0 R >> >> >> endobj\n' +
    '7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n' +
    `4 0 obj << /Length ${content.length} /Filter /FlateDecode >> stream\n`;
  const prefix = Buffer.concat([
    Buffer.from(head, 'latin1'),
    content,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);

  const sigTail = (byteRange: string, hex: string) =>
    '5 0 obj << /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /V 6 0 R /Rect [0 0 0 0] /F 132 >> endobj\n' +
    `6 0 obj << /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ` +
    `/ByteRange [${byteRange}] /Contents <${hex}> /M (D:20261018093000+05'30') >> endobj\n` +
    'trailer << /Size 8 /Root 1 0 R >>\n%%EOF';

  // Pass 1 — the ByteRange text itself lives inside the signed ranges,
  // so its digit widths shift the offsets it encodes. Iterate to a
  // fixpoint (real signers pad the field; iterating is simpler).
  const placeholder = '0'.repeat(CONTENTS_PAD);
  let byteRange = '0 0 0 0';
  let probe = Buffer.alloc(0);
  let contentsStart = 0;
  let r2start = 0;
  let r2len = 0;
  for (let i = 0; i < 4; i++) {
    probe = Buffer.concat([prefix, Buffer.from(sigTail(byteRange, placeholder), 'latin1')]);
    const ltIdx = probe.indexOf(`Contents <${placeholder}>`);
    contentsStart = ltIdx + 'Contents <'.length;
    const contentsEnd = contentsStart + CONTENTS_PAD; // '>' sits at this offset
    r2start = contentsEnd + 1;
    r2len = probe.length - r2start;
    const next = `0 ${contentsStart} ${r2start} ${r2len}`;
    if (next === byteRange) break;
    byteRange = next;
  }

  // Digest the signed ranges, build CMS, patch hex into place.
  const h = crypto.createHash('sha256');
  h.update(probe.subarray(0, contentsStart));
  h.update(probe.subarray(r2start, r2start + r2len));
  const cms = buildCms(h.digest(), { badDigest: opts.badDigest, badSignature: opts.badSignature });
  const cmsHex = cms.toString('hex');
  if (cmsHex.length > CONTENTS_PAD) throw new Error('fixture: CMS larger than pad');
  const hex = cmsHex.padEnd(CONTENTS_PAD, '0');

  const final = Buffer.concat([prefix, Buffer.from(sigTail(byteRange, hex), 'latin1')]);
  if (opts.appendAfter !== undefined) {
    return new Uint8Array(Buffer.concat([final, Buffer.from(opts.appendAfter, 'latin1')]));
  }
  return new Uint8Array(final);
}

/** Tamper helper — flip a byte inside the signed range. */
export function tamperSignedByte(pdf: Uint8Array): Uint8Array {
  const out = Buffer.from(pdf);
  out[120]! ^= 0x41; // inside the first byte range (content area)
  return new Uint8Array(out);
}
