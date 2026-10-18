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
 * Minimal DER (X.690) parser — enough surface to walk PKCS#7/CMS
 * SignedData and X.509 certificate wrappers embedded in PDF digital
 * signatures. Zero-dependency; throws `Asn1Error` on malformed input so
 * callers can degrade to a signal rather than crash.
 */

export class Asn1Error extends Error {}

export interface Asn1Node {
  /** Class: 0 universal, 1 application, 2 context-specific, 3 private. */
  readonly tagClass: number;
  readonly constructed: boolean;
  readonly tagNumber: number;
  /** Raw TLV bytes including tag+length — needed to re-sign structures. */
  readonly tlv: Uint8Array;
  /** Content octets (for primitives) or the concatenated children TLVs. */
  readonly content: Uint8Array;
  /** Parsed children for constructed nodes. */
  readonly children: readonly Asn1Node[];
}

const UNIVERSAL = {
  EOC: 0,
  BOOLEAN: 1,
  INTEGER: 2,
  BIT_STRING: 3,
  OCTET_STRING: 4,
  NULL: 5,
  OBJECT_ID: 6,
  UTF8_STRING: 12,
  PRINTABLE_STRING: 19,
  TELETEX_STRING: 20,
  IA5_STRING: 22,
  UTC_TIME: 23,
  GENERALIZED_TIME: 24,
  SEQUENCE: 16,
  SET: 17,
} as const;

export const TAG = UNIVERSAL;

function readLength(buf: Uint8Array, off: number): { len: number; next: number } {
  if (off >= buf.length) throw new Asn1Error('DER: truncated length');
  const first = buf[off]!;
  if (first < 0x80) return { len: first, next: off + 1 };
  const n = first & 0x7f;
  if (n === 0) throw new Asn1Error('DER: indefinite length is not DER');
  if (n > 4 || off + 1 + n > buf.length) throw new Asn1Error('DER: bad long-form length');
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + buf[off + 1 + i]!;
  return { len, next: off + 1 + n };
}

/** Parse one TLV at `off`; returns node and offset past it. */
function readNode(buf: Uint8Array, off: number): { node: Asn1Node; next: number } {
  if (off >= buf.length) throw new Asn1Error('DER: truncated tag');
  const tagByte = buf[off]!;
  const tagClass = (tagByte >> 6) & 0x03;
  const constructed = (tagByte & 0x20) !== 0;
  let tagNumber = tagByte & 0x1f;
  let pos = off + 1;
  if (tagNumber === 0x1f) {
    // high-tag-number form
    tagNumber = 0;
    for (;;) {
      if (pos >= buf.length) throw new Asn1Error('DER: truncated high tag');
      const b = buf[pos++]!;
      tagNumber = tagNumber * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
  }
  const { len, next } = readLength(buf, pos);
  if (next + len > buf.length) throw new Asn1Error('DER: content overruns buffer');
  const content = buf.subarray(next, next + len);
  const tlv = buf.subarray(off, next + len);
  const children: Asn1Node[] = [];
  if (constructed) {
    let c = 0;
    while (c < content.length) {
      const r = readNode(content, c);
      children.push(r.node);
      c = r.next;
    }
  }
  return {
    node: { tagClass, constructed, tagNumber, content, tlv, children },
    next: next + len,
  };
}

/** Parse the single top-level TLV in `buf`. Trailing bytes are an error. */
export function parseDer(buf: Uint8Array): Asn1Node {
  const { node, next } = readNode(buf, 0);
  if (next !== buf.length) throw new Asn1Error('DER: trailing bytes after top-level TLV');
  return node;
}

/**
 * Parse a top-level TLV tolerating trailing 0x00 padding — PDF /Contents
 * hex strings are padded with zeros to a fixed length per ISO 32000.
 */
export function parseDerPadded(buf: Uint8Array): Asn1Node {
  const { node, next } = readNode(buf, 0);
  for (let i = next; i < buf.length; i++) {
    if (buf[i] !== 0) throw new Asn1Error('DER: non-zero trailing bytes after top-level TLV');
  }
  return node;
}

/** Expect a universal tag; throws on mismatch. */
export function expectTag(node: Asn1Node, tag: number, what: string): Asn1Node {
  if (node.tagClass !== 0 || node.tagNumber !== tag) {
    throw new Asn1Error(`DER: expected ${what} (universal ${tag})`);
  }
  return node;
}

/** Integer content → bigint (handles arbitrary size, positive only). */
export function intValue(node: Asn1Node): bigint {
  expectTag(node, UNIVERSAL.INTEGER, 'INTEGER');
  let v = 0n;
  for (const b of node.content) v = (v << 8n) | BigInt(b);
  return v;
}

/** OID content → dotted string. */
export function oidValue(node: Asn1Node): string {
  expectTag(node, UNIVERSAL.OBJECT_ID, 'OBJECT IDENTIFIER');
  const c = node.content;
  if (c.length === 0) throw new Asn1Error('DER: empty OID');
  const parts: number[] = [Math.floor(c[0]! / 40), c[0]! % 40];
  let v = 0;
  for (let i = 1; i < c.length; i++) {
    v = v * 128 + (c[i]! & 0x7f);
    if ((c[i]! & 0x80) === 0) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

/** Any text-ish string content → utf8-ish string. */
export function stringValue(node: Asn1Node): string {
  if (node.tagNumber === UNIVERSAL.UTC_TIME || node.tagNumber === UNIVERSAL.GENERALIZED_TIME) {
    return Buffer.from(node.content).toString('latin1');
  }
  if (node.tagNumber === UNIVERSAL.BIT_STRING || node.tagNumber === UNIVERSAL.OCTET_STRING) {
    return Buffer.from(node.content).toString('latin1');
  }
  return Buffer.from(node.content).toString('utf8');
}

/** Context-specific child with tag `n` (explicit-wrapped or direct). */
export function ctxTag(node: Asn1Node, n: number): Asn1Node | undefined {
  if (node.tagClass === 2 && node.tagNumber === n) return node;
  return undefined;
}

/** Find first direct child matching class/tag. */
export function child(node: Asn1Node, tagClass: number, tagNumber: number): Asn1Node | undefined {
  return node.children.find((c) => c.tagClass === tagClass && c.tagNumber === tagNumber);
}

/** Find first direct child of a universal tag. */
export function universal(node: Asn1Node, tagNumber: number): Asn1Node | undefined {
  return child(node, 0, tagNumber);
}
