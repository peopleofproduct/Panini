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
 * PDF Standard security handler, revisions R2–R4 (PDF spec §7.6.3–7.6.4).
 *
 * Indian bank e-statements are overwhelmingly passworded with these
 * revisions — RC4-40/128 and AES-128 — keyed to user data like DOB or
 * the first four letters of the account-holder name. R5/R6 (AES-256,
 * ISO 32000-2) is detected but reported as unsupported rather than
 * silently mis-decrypted.
 *
 * Decryption is stream-level: the Encrypt dictionary and object
 * structure are plaintext, so stream bytes are located as usual and
 * decrypted with the per-object key before any /FlateDecode pass.
 */

import { createDecipheriv, createHash } from 'node:crypto';

// ── primitives ─────────────────────────────────────────────────────────────

const PASSWORD_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + (s[i] ?? 0) + (key[i % key.length] ?? 0)) & 0xff;
    const t = s[i] ?? 0;
    s[i] = s[j] ?? 0;
    s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + 1) & 0xff;
    b = (b + (s[a] ?? 0)) & 0xff;
    const t = s[a] ?? 0;
    s[a] = s[b] ?? 0;
    s[b] = t;
    out[i] = (data[i] ?? 0) ^ (s[((s[a] ?? 0) + (s[b] ?? 0)) & 0xff] ?? 0);
  }
  return out;
}

function md5(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

// ── encrypt-dictionary parsing ─────────────────────────────────────────────

export type StreamCipher = 'rc4' | 'aesv2' | 'identity';

export interface EncryptionInfo {
  readonly v: number;
  readonly r: number;
  readonly lengthBits: number;
  readonly p: number;
  readonly o: Uint8Array;
  readonly u: Uint8Array;
  readonly fileId: Uint8Array;
  readonly encryptMetadata: boolean;
  readonly streamCipher: StreamCipher;
  readonly stringCipher: StreamCipher;
}

const ENCRYPT_REF_RE = /\/Encrypt\s+(\d+)\s+(\d+)\s+R/;
const FILE_ID_RE = /\/ID\s*\[\s*<([0-9a-fA-F]+)\s*>/;

/** Reads a literal `(…)` string out of a dictionary at `start`. */
function readLiteral(text: string, start: number): { bytes: Uint8Array; end: number } | null {
  if (text[start] !== '(') return null;
  const bytes: number[] = [];
  let depth = 1;
  let i = start + 1;
  while (i < text.length && depth > 0) {
    const c = text.charCodeAt(i);
    if (c === 0x5c) {
      const e = text.charCodeAt(i + 1);
      i += 1;
      if (e === 0x6e) bytes.push(0x0a);
      else if (e === 0x72) bytes.push(0x0d);
      else if (e === 0x74) bytes.push(0x09);
      else if (e >= 0x30 && e <= 0x37) {
        let oct = e - 0x30;
        for (let k = 0; k < 2; k += 1) {
          const o = text.charCodeAt(i + 1);
          if (o >= 0x30 && o <= 0x37) {
            oct = oct * 8 + (o - 0x30);
            i += 1;
          } else break;
        }
        bytes.push(oct & 0xff);
      } else bytes.push(e);
      i += 1;
      continue;
    }
    if (c === 0x28) depth += 1;
    if (c === 0x29) {
      depth -= 1;
      if (depth === 0) return { bytes: new Uint8Array(bytes), end: i + 1 };
    }
    if (depth > 0) bytes.push(c);
    i += 1;
  }
  return null;
}

function dictValue(text: string, key: string): { bytes: Uint8Array; end: number } | null {
  const re = new RegExp(`/${key}\\s*`);
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const ch = text[start];
  if (ch === '(') return readLiteral(text, start);
  if (ch === '<' && text[start + 1] !== '<') {
    let hex = '';
    let i = start + 1;
    while (i < text.length && text[i] !== '>') {
      if (!/\s/.test(text[i] ?? '')) hex += text[i];
      i += 1;
    }
    if (hex.length % 2 === 1) hex += '0';
    const bytes = new Uint8Array(hex.length / 2);
    for (let k = 0; k + 1 < hex.length; k += 2) {
      bytes[k / 2] = parseInt(hex.slice(k, k + 2), 16);
    }
    return { bytes, end: i + 1 };
  }
  return null;
}

function dictNumber(text: string, key: string, fallback: number): number {
  const re = new RegExp(`/${key}\\s+(-?\\d+)`);
  const m = re.exec(text);
  return m ? Number(m[1]) : fallback;
}

function dictName(text: string, key: string): string | null {
  const re = new RegExp(`/${key}\\s*/(\\w+)`);
  const m = re.exec(text);
  return m?.[1] ?? null;
}

/** Locates the /Encrypt indirect object and returns its dictionary text. */
function findEncryptDict(latin: string): string | null {
  const ref = ENCRYPT_REF_RE.exec(latin);
  if (!ref) return null;
  const objRe = new RegExp(`${ref[1]}\\s+${ref[2]}\\s+obj`);
  const obj = objRe.exec(latin);
  if (!obj) return null;
  const dictStart = latin.indexOf('<<', obj.index);
  const end = latin.indexOf('endobj', dictStart);
  if (dictStart < 0 || end < 0) return null;
  return latin.slice(dictStart, end);
}

function cipherFor(dictText: string, key: 'StmF' | 'StrF', cfBlock: string): StreamCipher {
  const name = dictName(dictText, key);
  if (name === 'Identity') return 'identity';
  if (!name) return 'rc4';
  const cfRe = new RegExp(`/${name}\\s*<<([^>]*)>>`);
  const cf = cfRe.exec(cfBlock) ?? cfRe.exec(dictText);
  const cfm = cf ? dictName(cf[1] ?? '', 'CFM') : null;
  if (cfm === 'AESV2') return 'aesv2';
  if (cfm === 'V2') return 'rc4';
  return 'rc4';
}

/** Parses the /Encrypt dictionary from raw PDF bytes; null if unencrypted. */
export function detectEncryption(pdf: Uint8Array): EncryptionInfo | null {
  const latin = Buffer.from(pdf).toString('latin1');
  const dict = findEncryptDict(latin);
  if (!dict) return null;
  const o = dictValue(dict, 'O');
  const u = dictValue(dict, 'U');
  if (!o || !u) return null;
  const idMatch = FILE_ID_RE.exec(latin);
  const cfBlock = dict;

  return {
    v: dictNumber(dict, 'V', 0),
    r: dictNumber(dict, 'R', 0),
    lengthBits: dictNumber(dict, 'Length', 40),
    p: dictNumber(dict, 'P', 0),
    o: o.bytes,
    u: u.bytes,
    fileId: idMatch ? new Uint8Array(Buffer.from(idMatch[1] ?? '', 'hex')) : new Uint8Array(0),
    encryptMetadata: !/\/EncryptMetadata\s+false/.test(dict),
    streamCipher: cipherFor(dict, 'StmF', cfBlock),
    stringCipher: cipherFor(dict, 'StrF', cfBlock),
  };
}

// ── algorithms 2 / 3.4–3.5 / 1 ─────────────────────────────────────────────

function padPassword(password: string): Uint8Array {
  const raw = new Uint8Array(Buffer.from(password, 'latin1')).subarray(0, 32);
  const out = new Uint8Array(32);
  out.set(PASSWORD_PADDING);
  out.set(raw);
  return out;
}

/** Algorithm 2: password + Encrypt dict → file encryption key. */
export function deriveFileKey(password: string, info: EncryptionInfo): Uint8Array {
  const padded = padPassword(password);
  const pLe = new Uint8Array(4);
  new DataView(pLe.buffer).setInt32(0, info.p, true);

  const parts = [padded, info.o, pLe, info.fileId];
  if (info.r >= 4 && !info.encryptMetadata) {
    parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  }
  let digest = md5(...parts);
  const keyLen = info.r >= 3 ? Math.max(5, Math.floor(info.lengthBits / 8)) : 5;
  if (info.r >= 3) {
    for (let i = 0; i < 50; i += 1) {
      digest = md5(digest.subarray(0, keyLen));
    }
  }
  return digest.subarray(0, keyLen);
}

/** Algorithms 3.4/3.5 (R≥3) and 3.2 (R2): does the key produce U? */
export function checkUserPassword(fileKey: Uint8Array, info: EncryptionInfo): boolean {
  if (info.r === 2) {
    const expected = rc4(fileKey, PASSWORD_PADDING);
    return info.u.length >= 32 && expected.every((b, i) => info.u[i] === b);
  }
  let check = md5(PASSWORD_PADDING, info.fileId);
  for (let i = 0; i < 20; i += 1) {
    const k = new Uint8Array(fileKey.map((b) => b ^ i));
    check = rc4(k, check);
  }
  // first 16 bytes of U must match; trailing 16 are arbitrary
  for (let i = 0; i < 16; i += 1) {
    if (info.u[i] !== check[i]) return false;
  }
  return true;
}

function objectKey(fileKey: Uint8Array, obj: number, gen: number, aes: boolean): Uint8Array {
  const suffix = new Uint8Array(5);
  suffix[0] = obj & 0xff;
  suffix[1] = (obj >> 8) & 0xff;
  suffix[2] = (obj >> 16) & 0xff;
  suffix[3] = gen & 0xff;
  suffix[4] = (gen >> 8) & 0xff;
  const parts = aes
    ? [fileKey, suffix, new Uint8Array(Buffer.from('sAlT', 'latin1'))]
    : [fileKey, suffix];
  const digest = md5(...parts);
  return digest.subarray(0, Math.min(fileKey.length + 5, 16));
}

/** Decrypts one stream's raw bytes with the per-object key. */
export function decryptObject(
  data: Uint8Array,
  fileKey: Uint8Array,
  obj: number,
  gen: number,
  cipher: StreamCipher,
): Uint8Array | null {
  try {
    if (cipher === 'identity') return data;
    if (cipher === 'rc4') {
      return rc4(objectKey(fileKey, obj, gen, false), data);
    }
    // AES-128-CBC: first 16 bytes are the IV.
    if (data.length < 32) return null;
    const key = objectKey(fileKey, obj, gen, true);
    const iv = Buffer.from(data.subarray(0, 16));
    const d = createDecipheriv('aes-128-cbc', Buffer.from(key.subarray(0, 16)), iv);
    d.setAutoPadding(true);
    return new Uint8Array(Buffer.concat([d.update(Buffer.from(data.subarray(16))), d.final()]));
  } catch {
    return null;
  }
}

// ── password candidates ────────────────────────────────────────────────────

/** User-supplied details used to generate unlock candidates. */
export interface PdfCredentials {
  /** Try these verbatim first. */
  readonly passwords?: readonly string[];
  readonly dob?: string;
  readonly pan?: string;
  readonly name?: string;
  readonly customerId?: string;
  readonly accountNumber?: string;
  readonly mobile?: string;
}

/** One password template; `{placeholder[:format]}` tokens expanded. */
export interface PasswordPattern {
  readonly id: string;
  readonly bank?: string;
  readonly template: string;
}

export interface PasswordPatternsFile {
  readonly patterns: readonly PasswordPattern[];
  readonly maxCandidates: number;
}

const DOB_FORMATS: Readonly<Record<string, (d: DateParts) => string>> = {
  ddmmyyyy: (d) => `${d.dd}${d.mm}${d.yyyy}`,
  ddmmyy: (d) => `${d.dd}${d.mm}${d.yy}`,
  ddmm: (d) => `${d.dd}${d.mm}`,
  yyyymmdd: (d) => `${d.yyyy}${d.mm}${d.dd}`,
};

interface DateParts {
  readonly dd: string;
  readonly mm: string;
  readonly yyyy: string;
  readonly yy: string;
}

function parseDob(dob: string): DateParts | null {
  const m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/.exec(dob.trim());
  if (!m) return null;
  const year = m[3] ?? '';
  const yyyy = year.length === 2 ? (Number(year) > 40 ? `19${year}` : `20${year}`) : year;
  return {
    dd: (m[1] ?? '').padStart(2, '0'),
    mm: (m[2] ?? '').padStart(2, '0'),
    yyyy,
    yy: yyyy.slice(-2),
  };
}

const MAX_CANDIDATES_DEFAULT = 64;

/** Expands credentials + templates into an ordered candidate list. */
export function passwordCandidates(
  credentials: PdfCredentials,
  file?: PasswordPatternsFile,
): string[] {
  const out: string[] = [...(credentials.passwords ?? [])];
  const dob = credentials.dob ? parseDob(credentials.dob) : null;
  const name = (credentials.name ?? '').replace(/[^a-zA-Z]/g, '');
  const values: Record<string, string> = {
    name4lower: name.slice(0, 4).toLowerCase(),
    name4upper: name.slice(0, 4).toUpperCase(),
    name: name.toLowerCase(),
    pan: (credentials.pan ?? '').toUpperCase(),
    customerid: credentials.customerId ?? '',
    accountnumber: credentials.accountNumber ?? '',
    mobile: credentials.mobile ?? '',
    mobile4: (credentials.mobile ?? '').slice(-4),
  };

  const cap = file?.maxCandidates ?? MAX_CANDIDATES_DEFAULT;
  const patterns = file?.patterns ?? [];
  for (const pattern of patterns) {
    const rendered = pattern.template.replace(
      /\{(\w+)(?::(\w+))?\}/g,
      (_match, key: string, fmt?: string) => {
        if (key === 'dob') {
          if (!dob) return '';
          const f = DOB_FORMATS[fmt ?? 'ddmmyyyy'];
          return f ? f(dob) : '';
        }
        return values[key.toLowerCase()] ?? '';
      },
    );
    if (rendered !== '' && !out.includes(rendered)) out.push(rendered);
    if (out.length >= cap) break;
  }
  return out.slice(0, cap);
}

// ── public entry ───────────────────────────────────────────────────────────

export interface PdfUnlock {
  readonly status: 'plain' | 'unlocked' | 'encrypted';
  readonly warnings: readonly string[];
  /** Per-stream decryptor; present only when status === 'unlocked'. */
  readonly decryptStream?: (data: Uint8Array, obj: number, gen: number) => Uint8Array | null;
}

/**
 * Detects Standard-handler encryption and, when credentials are given,
 * attempts to unlock. Returns a per-stream decryptor on success; the
 * caller decrypts each stream's bytes before decompression. Never
 * throws — a locked or unsupported document is a status + warning.
 */
export function decryptPdf(
  pdf: Uint8Array,
  credentials?: PdfCredentials,
  patterns?: PasswordPatternsFile,
): PdfUnlock {
  const info = detectEncryption(pdf);
  if (!info) return { status: 'plain', warnings: [] };

  if (info.r >= 5) {
    return {
      status: 'encrypted',
      warnings: [
        `PDF uses encryption revision ${info.r} (AES-256) — not yet supported; supply an already-decrypted copy`,
      ],
    };
  }

  const candidates = credentials ? passwordCandidates(credentials, patterns) : [];
  if (candidates.length === 0) {
    return {
      status: 'encrypted',
      warnings: [
        'document is password-protected — supply options.credentials (passwords or dob/name/pan to generate per-bank candidates)',
      ],
    };
  }

  for (const candidate of candidates) {
    const fileKey = deriveFileKey(candidate, info);
    if (!checkUserPassword(fileKey, info)) continue;
    return {
      status: 'unlocked',
      warnings: [],
      decryptStream: (data, obj, gen) => decryptObject(data, fileKey, obj, gen, info.streamCipher),
    };
  }

  return {
    status: 'encrypted',
    warnings: [
      `${candidates.length} password candidate(s) did not unlock the document — check credentials or supply the exact password`,
    ],
  };
}
