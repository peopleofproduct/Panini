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
 * PDF digital-signature validation (ISO 32000 / RFC 5652 CMS).
 *
 * For every `/ByteRange`+`/Contents` signature field:
 *   1. bytes outside the signed ranges → post-sign modification;
 *   2. hash the signed byte ranges → compare to the CMS `messageDigest`
 *      signed attribute → proves the exact bytes the signer saw;
 *   3. verify the signerInfo signature over signedAttrs with the
 *      signer's certificate public key (node:crypto, PKCS#1 v1.5 RSA or
 *      ECDSA-DER);
 *   4. walk the embedded certificate chain to a caller-supplied trust
 *      anchor (CCA-India roots or a bank CA loaded by the integrator).
 */

import * as crypto from 'node:crypto';
import {
  Asn1Error,
  oidValue,
  parseDerPadded,
  stringValue,
  universal,
  type Asn1Node,
} from '../asn1';
import type { SignatureCheck } from '../types';

const LATIN1 = 'latin1';

const OID = {
  signedData: '1.2.840.113549.1.2.1',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
} as const;

const DIGEST_OID_TO_NODE: Readonly<Record<string, string>> = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
  '2.16.840.1.101.3.4.2.4': 'sha224',
};

const SIG_OID: Readonly<Record<string, { hash: string; kind: 'rsa' | 'ecdsa' }>> = {
  '1.2.840.113549.1.1.5': { hash: 'sha1', kind: 'rsa' },
  '1.2.840.113549.1.1.11': { hash: 'sha256', kind: 'rsa' },
  '1.2.840.113549.1.1.12': { hash: 'sha384', kind: 'rsa' },
  '1.2.840.113549.1.1.13': { hash: 'sha512', kind: 'rsa' },
  '1.2.840.10045.4.3.2': { hash: 'sha256', kind: 'ecdsa' },
  '1.2.840.10045.4.3.3': { hash: 'sha384', kind: 'ecdsa' },
  '1.2.840.10045.4.3.4': { hash: 'sha512', kind: 'ecdsa' },
};

interface SigField {
  readonly byteRange: readonly [number, number, number, number];
  readonly contents: Buffer;
  readonly name: string | null;
}

function findSigFields(latin: string): SigField[] {
  const out: SigField[] = [];
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    // /Contents is the nearest hex string after ByteRange within the sig
    // dict. CMS blobs are zero-padded — the hex span can be tens of KB.
    const after = latin.slice(m.index, m.index + (1 << 18));
    const cm = /\/Contents\s*<([0-9a-fA-F\s]*)>/.exec(after);
    if (cm === null) continue;
    const contents = Buffer.from(cm[1]!.replace(/\s/g, ''), 'hex');
    const nm = /\/Name\s*\(([^)]*)\)/.exec(after);
    out.push({
      byteRange: [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])],
      contents,
      name: nm !== null ? nm[1]! : null,
    });
  }
  return out;
}

/** SET OF header (universal 17, constructed) wrapping signedAttrs content —
 * CMS signs the attrs re-tagged as SET OF, not the [0] context form. */
function setOfWrap(content: Uint8Array): Buffer {
  const len = content.length;
  let header: Buffer;
  if (len < 0x80) header = Buffer.from([0x31, len]);
  else if (len < 0x100) header = Buffer.from([0x31, 0x81, len]);
  else header = Buffer.from([0x31, 0x82, len >> 8, len & 0xff]);
  return Buffer.concat([header, Buffer.from(content)]);
}

interface SignerInfo {
  readonly digestAlg: string;
  readonly sigAlgOid: string;
  readonly signature: Buffer;
  readonly signedAttrsRaw: Buffer; // re-tagged SET OF — what was signed
  readonly messageDigest: Buffer | null;
  readonly signingTime: string | null;
  readonly issuerName: string | null;
  readonly serial: bigint | null;
}

function parseSignerInfo(si: Asn1Node): SignerInfo {
  let cursor = 1; // skip version
  const sid = si.children[cursor]!;
  let issuerName: string | null = null;
  let serial: bigint | null = null;
  if (sid.tagClass === 0 && sid.tagNumber === 16) {
    // issuerAndSerialNumber
    issuerName = stringValue(sid.children[0] ?? sid).slice(0, 200);
    const serialNode = universal(sid, 2);
    serial = serialNode ? intLike(serialNode) : null;
  }
  cursor++;
  const digestOid = oidValue(universal(si.children[cursor]!, 6) ?? si.children[cursor]!);
  const digestAlg = DIGEST_OID_TO_NODE[digestOid] ?? digestOid;
  cursor++;
  // optional signedAttrs [0]
  let signedAttrsRaw: Buffer | null = null;
  let messageDigest: Buffer | null = null;
  let signingTime: string | null = null;
  if (si.children[cursor]!.tagClass === 2 && si.children[cursor]!.tagNumber === 0) {
    const attrs = si.children[cursor]!;
    signedAttrsRaw = setOfWrap(attrs.content);
    for (const attr of attrs.children) {
      const oid = attr.children[0] ? oidValue(attr.children[0]) : '';
      const valSet = attr.children[1];
      const first = valSet?.children[0];
      if (oid === OID.messageDigest && first !== undefined)
        messageDigest = Buffer.from(first.content);
      if (oid === OID.signingTime && first !== undefined) signingTime = stringValue(first);
    }
    cursor++;
  }
  const sigAlgOid = oidValue(universal(si.children[cursor]!, 6) ?? si.children[cursor]!);
  cursor++;
  const signature = Buffer.from(si.children[cursor]!.content);
  if (signedAttrsRaw === null) throw new Asn1Error('signerInfo has no signedAttrs — non-CMS form');
  return {
    digestAlg,
    sigAlgOid,
    signature,
    signedAttrsRaw,
    messageDigest,
    signingTime,
    issuerName,
    serial,
  };
}

function intLike(node: Asn1Node): bigint {
  let v = 0n;
  for (const b of node.content) v = (v << 8n) | BigInt(b);
  return v;
}

interface ParsedCms {
  readonly signer: SignerInfo;
  readonly certs: crypto.X509Certificate[];
}

function parseCms(der: Uint8Array): ParsedCms {
  const contentInfo = parseDerPadded(der);
  const typeOid = oidValue(contentInfo.children[0]!);
  if (typeOid !== OID.signedData) {
    throw new Asn1Error(`content type ${typeOid} — not signedData (timestamp-only or enveloped)`);
  }
  const signedData = contentInfo.children[1]!.children[0]!; // [0] EXPLICIT
  const certs: crypto.X509Certificate[] = [];
  let signerInfos: Asn1Node | undefined;
  for (const c of signedData.children) {
    if (c.tagClass === 2 && c.tagNumber === 0) {
      // certificates [0] IMPLICIT SET — children are cert SEQUENCES
      for (const certNode of c.children) {
        try {
          certs.push(new crypto.X509Certificate(Buffer.from(certNode.tlv)));
        } catch {
          /* attribute certs / non-X509 entries — skip */
        }
      }
    }
    if (c.tagClass === 0 && c.tagNumber === 17) signerInfos = c; // SET OF SignerInfo
  }
  if (signerInfos === undefined || signerInfos.children.length === 0) {
    throw new Asn1Error('CMS signedData carries no signerInfos');
  }
  return { signer: parseSignerInfo(signerInfos.children[0]!), certs };
}

export interface SignatureOptions {
  /** Trust anchors as PEM strings or X509Certificate objects. */
  readonly trustStore?: readonly (string | crypto.X509Certificate)[];
}

/**
 * Validate every signature in the PDF. Never throws — errors land in
 * `check.errors` and the check's validity fields stay null.
 */
export function verifyPdfSignatures(
  pdf: Uint8Array,
  opts: SignatureOptions = {},
): readonly SignatureCheck[] {
  const latin = Buffer.from(pdf).toString(LATIN1);
  const fields = findSigFields(latin);
  return fields.map((f) => checkOne(pdf, f, opts));
}

function checkOne(pdf: Uint8Array, f: SigField, opts: SignatureOptions): SignatureCheck {
  const errors: string[] = [];
  let postSignBytes = false;
  let digestValid: boolean | null = null;
  let signatureValid: boolean | null = null;
  let chainTrusted: boolean | null = null;

  const [o1, l1, o2, l2] = f.byteRange;
  if (o2 + l2 < pdf.length) {
    postSignBytes = true;
    errors.push(`${pdf.length - (o2 + l2)} byte(s) after the signed ByteRange`);
  }

  let cms: ParsedCms;
  try {
    cms = parseCms(new Uint8Array(f.contents));
  } catch (e) {
    errors.push(`CMS parse failed: ${e instanceof Error ? e.message : String(e)}`);
    return {
      present: true,
      fieldName: f.name,
      signer: null,
      signTime: null,
      digestValid,
      signatureValid,
      chainTrusted,
      postSignBytes,
      errors,
    };
  }
  const { signer, certs } = cms;
  const signTime = signer.signingTime;

  const signerCert = pickSignerCert(certs, signer);
  const signerName = signerCert?.subject?.match(/CN=([^\n]+)/)?.[1]?.trim() ?? null;

  // (b) byte-range digest vs messageDigest signed attribute.
  const nodeHash = DIGEST_OID_TO_NODE[signer.digestAlg] ?? signer.digestAlg;
  try {
    const h = crypto.createHash(nodeHash);
    h.update(pdf.subarray(o1, o1 + l1));
    h.update(pdf.subarray(o2, o2 + l2));
    const computed = h.digest();
    if (signer.messageDigest === null) {
      errors.push('signedAttrs carry no messageDigest — cannot bind signature to bytes');
    } else {
      digestValid = computed.equals(signer.messageDigest);
      if (!digestValid) errors.push('messageDigest mismatch — signed bytes were altered');
    }
  } catch (e) {
    errors.push(`digest failed (${nodeHash}): ${e instanceof Error ? e.message : String(e)}`);
  }

  // (c) cryptographic signature over signedAttrs.
  if (signerCert === null) {
    errors.push('no signer certificate embedded');
  } else {
    const alg = SIG_OID[signer.sigAlgOid];
    if (alg === undefined) {
      errors.push(`unsupported signature algorithm ${signer.sigAlgOid} (e.g. RSA-PSS)`);
    } else {
      try {
        const key: crypto.VerifyKeyObjectInput =
          alg.kind === 'ecdsa'
            ? { key: signerCert.publicKey, dsaEncoding: 'der' }
            : { key: signerCert.publicKey };
        signatureValid = crypto.verify(alg.hash, signer.signedAttrsRaw, key, signer.signature);
        if (!signatureValid) errors.push('signature does not verify over signedAttrs');
      } catch (e) {
        errors.push(`verify failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // (d) chain to caller trust anchor.
  if (opts.trustStore !== undefined && opts.trustStore.length > 0 && signerCert !== null) {
    chainTrusted = chainToAnchor(signerCert, certs, opts.trustStore, errors);
  }
  return {
    present: true,
    fieldName: f.name,
    signer: signerName,
    signTime,
    digestValid,
    signatureValid,
    chainTrusted,
    postSignBytes,
    errors,
  };
}

function pickSignerCert(
  certs: readonly crypto.X509Certificate[],
  signer: SignerInfo,
): crypto.X509Certificate | null {
  if (certs.length === 0) return null;
  // Match issuerAndSerialNumber when present; else the only leaf.
  if (signer.serial !== null) {
    const hit = certs.find(
      (c) => c.serialNumber !== '' && BigInt(`0x${c.serialNumber}`) === signer.serial,
    );
    if (hit !== undefined) return hit;
  }
  return certs[0] ?? null;
}

/** Walk issuer links among embedded certs; anchor must be in trustStore. */
function chainToAnchor(
  leaf: crypto.X509Certificate,
  pool: readonly crypto.X509Certificate[],
  trustStore: readonly (string | crypto.X509Certificate)[],
  errors: string[],
): boolean {
  const anchors: crypto.X509Certificate[] = [];
  for (const t of trustStore) {
    try {
      anchors.push(typeof t === 'string' ? new crypto.X509Certificate(t) : t);
    } catch {
      errors.push('unparsable trust anchor skipped');
    }
  }
  const trustedFp = new Set(anchors.map((a) => a.fingerprint256));
  let cur = leaf;
  for (let depth = 0; depth < 8; depth++) {
    if (trustedFp.has(cur.fingerprint256)) return true;
    const issuer = pool.find((c) => c.subject === cur.issuer && c !== cur) ?? cur;
    if (issuer === cur) break; // self-signed, not trusted
    try {
      if (!cur.verify(issuer.publicKey)) {
        errors.push(`chain link failed: ${cur.subject.slice(0, 60)} not signed by issuer`);
        return false;
      }
    } catch (e) {
      errors.push(`chain verify error: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    cur = issuer;
  }
  return false;
}
