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
 * Raw-byte structural forensics for PDF statement files. Everything here
 * works on the container — no content trust required. Each check emits
 * explainable signals; none of them auto-proves fraud alone.
 */

import type { IntegritySignal } from '../types';

const LATIN1 = 'latin1';

/** Producer/Creator strings strongly associated with interactive PDF editors. */
const EDITOR_SIGNATURES: readonly RegExp[] = [
  /ilovepdf/i,
  /pdfescape/i,
  /smallpdf/i,
  /sejda/i,
  /pdf-xchange/i,
  /foxit\s+(?:phantompdf|editor)/i,
  /nitro/i,
  /wkhtmltopdf/i, // HTML→PDF — statements must not be regenerated
  /weasyprint/i,
  /cairosvg/i,
  /reportlab/i,
  /fpdf/i,
  /tcpdf/i,
  /dompdf/i,
  /itext(?!.*(?:bank|rbi))/i, // iText is also a legit bank generator — warning only
];

/** /Info dictionary entries we mine. */
interface InfoMeta {
  producer: string | undefined;
  creator: string | undefined;
  creationDate: string | undefined;
  modDate: string | undefined;
}

const PDF_DATE_RE = /D:?(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/;

function pdfDateToIso(raw: string): string | null {
  const m = PDF_DATE_RE.exec(raw);
  if (m === null) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function infoString(dict: string, key: string): string | undefined {
  // /Key (literal) or /Key <hex>
  const lit = new RegExp(`/${key}\\s*\\(([^)]*)\\)`).exec(dict);
  if (lit !== null) return lit[1];
  const hex = new RegExp(`/${key}\\s*<([0-9a-fA-F]*)>`).exec(dict);
  if (hex !== null) {
    const raw = Buffer.from(hex[1] ?? '', 'hex');
    if (raw.length % 2 === 1) return raw.toString('latin1');
    return Buffer.from(raw).swap16().toString('utf16le');
  }
  return undefined;
}

function findInfoDict(latin: string): string | null {
  const ref = /\/Info\s+(\d+)\s+(\d+)\s+R/.exec(latin);
  if (ref === null) return null;
  const objRe = new RegExp(`${ref[1]}\\s+${ref[2]}\\s+obj\\s*<<([\\s\\S]*?)>>`, 'm');
  const m = objRe.exec(latin);
  return m ? `<<${m[1]}>>` : null;
}

export interface StructureOptions {
  /** Statement period end (YYYY-MM-DD) when known — dates after it on ModDate are suspicious. */
  readonly statementPeriodEnd?: string | null;
}

/**
 * Structural signals from raw PDF bytes. Never throws — malformed input
 * yields a `structure_unreadable` warning signal, not an exception.
 */
export function inspectPdfStructure(
  pdf: Uint8Array,
  opts: StructureOptions = {},
): IntegritySignal[] {
  const signals: IntegritySignal[] = [];
  const latin = Buffer.from(pdf).toString(LATIN1);

  // ── Incremental updates ──────────────────────────────────────────────
  const eofCount = (latin.match(/%%EOF/g) ?? []).length;
  const xrefCount = (latin.match(/startxref/g) ?? []).length;
  if (eofCount > 1 || xrefCount > 1) {
    signals.push({
      ruleId: 'pdf.incremental_update',
      severity: 'warning',
      message: `document carries ${Math.max(eofCount, xrefCount)} revision(s) — content was appended after generation`,
      evidence: `%%EOF×${eofCount} startxref×${xrefCount}`,
    });
  }

  // ── Producer / Creator / dates ───────────────────────────────────────
  const infoDict = findInfoDict(latin);
  const info: InfoMeta = {
    producer: undefined,
    creator: undefined,
    creationDate: undefined,
    modDate: undefined,
  };
  if (infoDict !== null) {
    info.producer = infoString(infoDict, 'Producer');
    info.creator = infoString(infoDict, 'Creator');
    info.creationDate = infoString(infoDict, 'CreationDate');
    info.modDate = infoString(infoDict, 'ModDate');
  }
  for (const [key, value] of [
    ['Producer', info.producer],
    ['Creator', info.creator],
  ] as const) {
    if (value === undefined) continue;
    const editor = EDITOR_SIGNATURES.find((re) => re.test(value));
    if (editor !== undefined) {
      signals.push({
        ruleId: 'pdf.editor_producer',
        severity: 'critical',
        message: `/${key} '${value}' is a consumer PDF editor — bank-generated statements do not carry this`,
        evidence: `/${key} (${value})`,
      });
    }
  }

  // ModDate implies a post-generation save.
  const createdIso = info.creationDate !== undefined ? pdfDateToIso(info.creationDate) : null;
  const modifiedIso = info.modDate !== undefined ? pdfDateToIso(info.modDate) : null;
  if (modifiedIso !== null && createdIso !== null && modifiedIso > createdIso) {
    signals.push({
      ruleId: 'pdf.modified_after_creation',
      severity: 'warning',
      message: `ModDate ${modifiedIso} is after CreationDate ${createdIso} — file was re-saved after generation`,
      evidence: `CreationDate=${createdIso} ModDate=${modifiedIso}`,
    });
  }
  if (
    opts.statementPeriodEnd != null &&
    modifiedIso !== null &&
    modifiedIso > opts.statementPeriodEnd &&
    createdIso !== null &&
    modifiedIso > createdIso
  ) {
    signals.push({
      ruleId: 'pdf.modified_after_period',
      severity: 'critical',
      message: `file modified ${modifiedIso}, after the statement period ended ${opts.statementPeriodEnd}`,
      evidence: `ModDate=${modifiedIso} periodEnd=${opts.statementPeriodEnd}`,
    });
  }

  // ── Interactive overlays ─────────────────────────────────────────────
  // AcroForm + signature fields are the normal carrier for signed
  // statements — only suspicious when interactive fields exist with NO
  // signature dict at all (fill-in overlays without signer evidence).
  const sigFieldCount = (latin.match(/\/FT\s*\/Sig\b/g) ?? []).length;
  const hasAcroForm = /\/AcroForm\b/.test(latin) || /\/SigFlags\s*\d/.test(latin);
  if (hasAcroForm && sigFieldCount === 0 && !/\/Type\s*\/Sig\b/.test(latin)) {
    signals.push({
      ruleId: 'pdf.acroform_overlay',
      severity: 'warning',
      message:
        'document carries interactive form fields but no signature — values can overlay or replace rendered text',
      evidence: '/AcroForm present, /FT /Sig absent',
    });
  }
  const annotCount = (
    latin.match(/\/Subtype\s*\/(?:FreeText|Stamp|Highlight|Squiggly|StrikeOut)/g) ?? []
  ).length;
  if (annotCount > 0) {
    signals.push({
      ruleId: 'pdf.covering_annotations',
      severity: 'warning',
      message: `${annotCount} markup annotation(s) can visually cover underlying statement text`,
      evidence: `annotation subtypes ×${annotCount}`,
    });
  }

  // ── Header sanity ────────────────────────────────────────────────────
  if (!latin.startsWith('%PDF-')) {
    signals.push({
      ruleId: 'pdf.bad_header',
      severity: 'warning',
      message: 'file does not open with a %PDF- header',
      evidence: `first bytes: ${latin.slice(0, 8)}`,
    });
  }
  return signals;
}
