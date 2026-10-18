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

import { inflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP reader — just enough for OOXML containers (.xlsx).
 * Supports STORED and DEFLATE entries, validates CRC32, and rejects
 * zip64/encrypted/multi-disk archives with descriptive errors. Not a
 * general-purpose unzipper: maximum sanity, minimum surface.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_ENTRIES = 4096;
const MAX_UNCOMPRESSED = 64 * 1024 * 1024;

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
  readonly crc32: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, off: number): number {
  return view.getUint16(off, true);
}
function u32(view: DataView, off: number): number {
  return view.getUint32(off, true);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Reads the central directory. Throws `zip: …` errors — callers convert
 * them to warnings.
 */
export function listEntries(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 22) throw new Error('zip: file too small for an archive');

  // EOCD lives in the last 22 bytes + up to 65535 bytes of comment.
  let eocd = -1;
  const scanFrom = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= scanFrom; i--) {
    if (u32(view, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: end-of-central-directory not found (truncated?)');

  const diskNo = u16(view, eocd + 4);
  const cdDisk = u16(view, eocd + 6);
  if (diskNo !== 0 || cdDisk !== 0) {
    throw new Error('zip: multi-disk archives are not supported');
  }
  const count = u16(view, eocd + 10);
  let offset = u32(view, eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    throw new Error('zip: zip64 archives are not supported');
  }
  if (count > MAX_ENTRIES) throw new Error(`zip: ${count} entries exceeds sanity limit`);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || u32(view, offset) !== CENTRAL_SIG) {
      throw new Error(`zip: bad central directory at entry ${i}`);
    }
    const flags = u16(view, offset + 8);
    const method = u16(view, offset + 10);
    const crc = u32(view, offset + 16);
    const compressedSize = u32(view, offset + 20);
    const size = u32(view, offset + 24);
    const nameLen = u16(view, offset + 28);
    const extraLen = u16(view, offset + 30);
    const commentLen = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const name = decodeUtf8(data.subarray(offset + 46, offset + 46 + nameLen));
    if ((flags & 0x01) !== 0) throw new Error(`zip: '${name}' is encrypted — unsupported`);
    entries.push({ name, method, compressedSize, size, localOffset, crc32: crc });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extracts and CRC-verifies one entry. */
export function extractEntry(data: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const off = entry.localOffset;
  if (off + 30 > data.length || u32(view, off) !== LOCAL_SIG) {
    throw new Error(`zip: bad local header for '${entry.name}'`);
  }
  const nameLen = u16(view, off + 26);
  const extraLen = u16(view, off + 28);
  const start = off + 30 + nameLen + extraLen;
  if (start + entry.compressedSize > data.length) {
    throw new Error(`zip: '${entry.name}' payload extends past end of file`);
  }
  const payload = data.subarray(start, start + entry.compressedSize);

  let out: Uint8Array;
  if (entry.method === 0) {
    out = payload;
  } else if (entry.method === 8) {
    if (entry.size > MAX_UNCOMPRESSED) {
      throw new Error(`zip: '${entry.name}' expands past ${MAX_UNCOMPRESSED} bytes`);
    }
    out = inflateRawSync(Buffer.from(payload));
  } else {
    throw new Error(`zip: '${entry.name}' uses unsupported compression method ${entry.method}`);
  }
  if (out.length !== entry.size) {
    throw new Error(`zip: '${entry.name}' size mismatch (${out.length} ≠ ${entry.size})`);
  }
  if (crc32(out) !== entry.crc32) {
    throw new Error(`zip: '${entry.name}' failed CRC32 check`);
  }
  return out;
}

/** Extracts a named member, or null when absent. */
export function readMember(data: Uint8Array, name: string): string | null {
  const entry = listEntries(data).find((e) => e.name === name);
  if (entry === undefined) return null;
  return decodeUtf8(extractEntry(data, entry));
}
