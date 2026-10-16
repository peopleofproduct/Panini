/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { parseBankNarration } from '../src';

describe('parseBankNarration — Archetype 1: UPI', () => {
  it('extracts all fields from the full-pipeline UPI narration', () => {
    const txn = parseBankNarration('UPI/20261015/DR/826384910234/SWIGGY/okaxis/Cooking/');
    expect(txn.type).toBe('DEBIT');
    expect(txn.ref_no).toBe('826384910234');
    expect(txn.merchant).toBe('Swiggy');
    expect(txn.vpa).toBe('okaxis');
    expect(txn.channel).toBe('UPI');
    expect(txn.date).toBe('2026-10-15');
    expect(txn.category).toBe('Food & Dining');
    expect(txn.is_salary).toBe(false);
    expect(txn.warnings).toEqual([]);
  });

  it('handles a credit leg of the same pipeline', () => {
    const txn = parseBankNarration('UPI/20261015/CR/826384910235/ACME CORP/ybl/Salary/');
    expect(txn.type).toBe('CREDIT');
    expect(txn.merchant).toBe('ACME Corp');
    expect(txn.vpa).toBe('ybl');
    expect(txn.channel).toBe('UPI');
  });
});

describe('parseBankNarration — Archetype 2: IMPS directional', () => {
  it('maps INBOUND IMPS to a CREDIT', () => {
    const txn = parseBankNarration('IMPS-628491047-ZEPTO-HDFC-INBOUND');
    expect(txn.type).toBe('CREDIT');
    expect(txn.ref_no).toBe('628491047');
    expect(txn.merchant).toBe('Zepto');
    expect(txn.channel).toBe('IMPS');
  });

  it('maps OUTBOUND IMPS to a DEBIT', () => {
    const txn = parseBankNarration('IMPS-628491048-JOHN DOE-ICIC-OUTBOUND');
    expect(txn.type).toBe('DEBIT');
    // \b[A-Z]{2,5}\b preservation: abbreviations keep uppercase casing
    expect(txn.merchant).toBe('JOHN DOE');
  });
});

describe('parseBankNarration — Archetype 3: salary credits', () => {
  it('detects salary credits with alphanumeric refs', () => {
    const txn = parseBankNarration('NEFT-N3452618902-SALARY-OCTOBER 2026-TCS LTD');
    expect(txn.type).toBe('CREDIT');
    expect(txn.ref_no).toBe('N3452618902');
    expect(txn.is_salary).toBe(true);
    expect(txn.counterparty).toBe('TCS Ltd');
    expect(txn.channel).toBe('NEFT');
    expect(txn.category).toBe('Income');
    expect(txn.matched_rule).toBe('bank-narration-archetypes:neft_salary_credit');
  });
});

describe('parseBankNarration — anomalies', () => {
  it('tolerates trailing whitespace', () => {
    const txn = parseBankNarration('UPI/20261015/DR/826384910234/SWIGGY/okaxis/Cooking/   ');
    expect(txn.ref_no).toBe('826384910234');
    expect(txn.merchant).toBe('Swiggy');
  });

  it('handles mixed capitalization', () => {
    const txn = parseBankNarration('imps-628491047-zepto-hdfc-inbound');
    expect(txn.type).toBe('CREDIT');
    expect(txn.merchant).toBe('Zepto');
    expect(txn.channel).toBe('IMPS');
  });

  it('does not crash on missing fields', () => {
    const txn = parseBankNarration('IMPS-628491047');
    expect(txn.channel).toBe('IMPS');
    expect(txn.ref_no).toBe('628491047');
    expect(txn.warnings.length).toBeGreaterThan(0);
  });

  it('does not crash on empty or garbage input', () => {
    expect(() => parseBankNarration('')).not.toThrow();
    expect(parseBankNarration('').channel).toBe('UNKNOWN');
    expect(() => parseBankNarration('@@@!!!###')).not.toThrow();
  });
});
