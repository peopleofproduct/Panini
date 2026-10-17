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

import {
  checkUserPassword,
  decryptPdf,
  deriveFileKey,
  detectEncryption,
  passwordCandidates,
  rc4,
} from '../src/pdf/encryption';
import { extractPdfStatement } from '../src/pdf/pdfStatement';
import { extractStatement } from '../src/extract';
import { loadCsvLayouts } from '../src/formatsLoader';
import { makeEncryptedPdf } from './encryptedPdfFixture';

const ROWS = [
  { x: 50, y: 760, text: 'Account No : XXXXXX1234' },
  { x: 50, y: 700, text: 'Date' },
  { x: 140, y: 700, text: 'Narration' },
  { x: 300, y: 700, text: 'Debit' },
  { x: 380, y: 700, text: 'Credit' },
  { x: 460, y: 700, text: 'Balance' },
  { x: 50, y: 680, text: '15/10/26' },
  { x: 140, y: 680, text: 'UPI/999/DR/SWIGGY@okaxis/' },
  { x: 300, y: 680, text: '500.00' },
  { x: 460, y: 680, text: '9500.00' },
];

const layouts = loadCsvLayouts();

describe('rc4 primitive', () => {
  it('matches the RFC 6229 known-answer vector', () => {
    // Key "Key", plaintext "Plaintext" → BBF316E8D940AF0AD3 (RFC 6229 §A.1)
    const out = rc4(
      new Uint8Array(Buffer.from('Key', 'latin1')),
      new Uint8Array(Buffer.from('Plaintext', 'latin1')),
    );
    expect(Buffer.from(out).toString('hex')).toBe('bbf316e8d940af0ad3');
  });
});

describe('detectEncryption', () => {
  it('finds the Encrypt dictionary in a protected document', () => {
    const pdf = makeEncryptedPdf(ROWS, { password: 'secret' });
    const info = detectEncryption(pdf);
    expect(info).not.toBeNull();
    expect(info?.r).toBe(3);
    expect(info?.o.length).toBe(32);
    expect(info?.u.length).toBe(32);
    expect(info?.fileId.length).toBe(16);
    expect(info?.streamCipher).toBe('rc4');
  });

  it('returns null for unencrypted documents', () => {
    const pdf = new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF', 'latin1'));
    expect(detectEncryption(pdf)).toBeNull();
  });
});

describe('key derivation', () => {
  it('derives a key that validates against U for the right password', () => {
    const pdf = makeEncryptedPdf(ROWS, { password: 'hdfc1234' });
    const info = detectEncryption(pdf);
    if (!info) throw new Error('not encrypted');
    expect(checkUserPassword(deriveFileKey('hdfc1234', info), info)).toBe(true);
    expect(checkUserPassword(deriveFileKey('wrong-pw', info), info)).toBe(false);
  });
});

describe('passwordCandidates', () => {
  it('expands per-bank templates from credentials', () => {
    const out = passwordCandidates(
      { dob: '15-04-1990', name: 'Kapil Sharma', passwords: ['manual1'] },
      {
        maxCandidates: 64,
        patterns: [
          { id: 'a', template: '{name4lower}{dob:ddmmyyyy}' },
          { id: 'b', template: '{dob:ddmmyy}' },
        ],
      },
    );
    expect(out[0]).toBe('manual1');
    expect(out).toContain('kapi15041990');
    expect(out).toContain('150490');
  });
});

describe('decryptPdf + extractPdfStatement', () => {
  it('unlocks an RC4-128 encrypted statement and extracts rows', () => {
    const pdf = makeEncryptedPdf(ROWS, { password: 'stmt-pass' });
    const result = extractPdfStatement(pdf, layouts, {
      credentials: { passwords: ['stmt-pass'] },
    });
    expect(result.transactions.length).toBe(1);
    expect(result.transactions[0]?.amountPaise).toBe(50000);
    expect(result.transactions[0]?.direction).toBe('DEBIT');
  });

  it('unlocks an AESV2 (V4) encrypted statement', () => {
    const pdf = makeEncryptedPdf(ROWS, { password: 'aes-pass', cipher: 'aesv2', r: 4 });
    const result = extractPdfStatement(pdf, layouts, {
      credentials: { passwords: ['aes-pass'] },
    });
    expect(result.transactions.length).toBe(1);
    expect(result.transactions[0]?.amountPaise).toBe(50000);
  });

  it('warns without credentials instead of throwing', () => {
    const pdf = makeEncryptedPdf(ROWS, { password: 'locked' });
    const result = extractPdfStatement(pdf, layouts);
    expect(result.transactions).toEqual([]);
    expect(result.metadata['encrypted']).toBe('true');
    expect(result.warnings.join(' ')).toMatch(/password-protected|credentials/);
  });

  it('warns when no candidate matches', () => {
    const pdf = makeEncryptedPdf(ROWS, { password: 'real-pass' });
    const result = extractPdfStatement(pdf, layouts, {
      credentials: { passwords: ['nope', 'alsono'] },
    });
    expect(result.transactions).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/did not unlock/);
  });

  it('reports R6 (AES-256) as unsupported rather than garbling', () => {
    const fake = new Uint8Array(
      Buffer.from(
        '%PDF-1.4\n2 0 obj << /Filter /Standard /V 5 /R 6 /Length 256 /P -4 /O <00> /U <00> >> endobj\ntrailer << /Encrypt 2 0 R >>\n%%EOF',
        'latin1',
      ),
    );
    const result = decryptPdf(fake, { passwords: ['x'] });
    expect(result.status).toBe('encrypted');
    expect(result.warnings.join(' ')).toMatch(/revision 6/);
  });

  it('works end-to-end through the extractStatement facade', async () => {
    const pdf = makeEncryptedPdf(ROWS, { password: 'kapi15041990' });
    const result = await extractStatement(pdf, {
      credentials: { dob: '15-04-1990', name: 'Kapil' },
    });
    expect(result.format).toBe('pdf');
    expect(result.transactions.length).toBe(1);
  });
});
