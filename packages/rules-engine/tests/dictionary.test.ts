/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  loadIfscBanks,
  loadMerchants,
  loadVpaHandles,
  lookupIfscBank,
  lookupMerchant,
  lookupVpaHandle,
  parseBankNarration,
} from '../src';

describe('lookupMerchant', () => {
  it('resolves exact aliases to canonical names', () => {
    expect(lookupMerchant('SWIGGY')?.canonical).toBe('Swiggy');
    expect(lookupMerchant('ZOMATO LTD')?.canonical).toBe('Zomato');
    expect(lookupMerchant('BUNDL TECHNOLOGIES')?.canonical).toBe('Swiggy');
  });

  it('resolves alias-prefixed strings', () => {
    expect(lookupMerchant('SWIGGY BUNDL TECH')?.canonical).toBe('Swiggy');
    expect(lookupMerchant('AMAZON PAY INDIA')?.canonical).toBe('Amazon');
  });

  it('returns null for unknown merchants and empty input', () => {
    expect(lookupMerchant('LOCAL KIRANA STORE')).toBeNull();
    expect(lookupMerchant('')).toBeNull();
    expect(lookupMerchant(null)).toBeNull();
  });
});

describe('lookupVpaHandle', () => {
  it('resolves bank and app handles', () => {
    expect(lookupVpaHandle('okaxis')).toEqual({ app: 'Google Pay', bank: 'Axis Bank' });
    expect(lookupVpaHandle('ybl')).toEqual({ app: 'PhonePe', bank: 'YES Bank' });
    expect(lookupVpaHandle('paytm')).toEqual({ app: 'Paytm', bank: 'Paytm Payments Bank' });
  });

  it('covers the top UPI apps by market share', () => {
    expect(lookupVpaHandle('axisb')).toEqual({ app: 'CRED', bank: 'Axis Bank' });
    expect(lookupVpaHandle('yescred')).toEqual({ app: 'CRED', bank: 'YES Bank' });
    expect(lookupVpaHandle('wasbi')).toEqual({ app: 'WhatsApp Pay', bank: 'State Bank of India' });
    expect(lookupVpaHandle('waicici')).toEqual({ app: 'WhatsApp Pay', bank: 'ICICI Bank' });
    expect(lookupVpaHandle('wahdfcbank')).toEqual({ app: 'WhatsApp Pay', bank: 'HDFC Bank' });
    expect(lookupVpaHandle('waaxis')).toEqual({ app: 'WhatsApp Pay', bank: 'Axis Bank' });
    expect(lookupVpaHandle('naviaxis')).toEqual({ app: 'Navi', bank: 'Axis Bank' });
    expect(lookupVpaHandle('ikwik')).toEqual({ app: 'MobiKwik', bank: 'HDFC Bank' });
    expect(lookupVpaHandle('fkaxis')).toEqual({ app: 'Flipkart UPI', bank: 'Axis Bank' });
    expect(lookupVpaHandle('rapl')).toEqual({ app: 'Amazon Pay', bank: 'RBL Bank' });
    expect(lookupVpaHandle('upi')).toEqual({ app: 'BHIM', bank: null });
  });

  it('is case-insensitive and null-safe', () => {
    expect(lookupVpaHandle('OKAXIS')?.bank).toBe('Axis Bank');
    expect(lookupVpaHandle('nohandle')).toBeNull();
    expect(lookupVpaHandle(null)).toBeNull();
  });
});

describe('lookupIfscBank', () => {
  it('resolves full IFSC codes and bare prefixes', () => {
    expect(lookupIfscBank('HDFC0001234')?.name).toBe('HDFC Bank');
    expect(lookupIfscBank('SBIN')?.name).toBe('State Bank of India');
    expect(lookupIfscBank('UTIB0000098')?.code).toBe('AXIS');
  });

  it('extracts IFSC-shaped tokens embedded in longer strings', () => {
    expect(lookupIfscBank('transfer to ICIC0000456 branch')?.name).toBe('ICICI Bank');
  });

  it('returns null for unknown prefixes and non-IFSC strings', () => {
    expect(lookupIfscBank('XXXX0000000')).toBeNull();
    expect(lookupIfscBank('swiggy order')).toBeNull();
    expect(lookupIfscBank(null)).toBeNull();
  });
});

describe('parseBankNarration — enrichment', () => {
  it('canonicalizes the merchant and upgrades Uncategorized categories', () => {
    const txn = parseBankNarration('IMPS-628491047-KIRANAKART-HDFC-INBOUND');
    expect(txn.merchant_canonical).toBe('Zepto');
    expect(txn.merchant).toBe('Zepto');
    expect(txn.category).toBe('Groceries');
  });

  it('resolves VPA handles to app and bank', () => {
    const txn = parseBankNarration('UPI/20261015/DR/826384910234/SWIGGY/ybl/Cooking/');
    expect(txn.vpa).toBe('ybl');
    expect(txn.vpa_app).toBe('PhonePe');
    expect(txn.vpa_bank).toBe('YES Bank');
  });

  it('resolves embedded IFSC fragments to banks', () => {
    const txn = parseBankNarration('BY TRANSFER-NEFT*HDFC0000240*ACME CORP-SALARY');
    expect(txn.ifsc_bank).toBe('HDFC Bank');
  });

  it('returns null enrichment fields with enrich: false', () => {
    const txn = parseBankNarration('UPI/20261015/DR/826384910234/SWIGGY/okaxis/Cooking/', {
      enrich: false,
    });
    expect(txn.merchant_canonical).toBeNull();
    expect(txn.vpa_app).toBeNull();
    expect(txn.vpa_bank).toBeNull();
    expect(txn.ifsc_bank).toBeNull();
    expect(txn.merchant).toBe('Swiggy');
  });
});

describe('dictionary loaders', () => {
  it('loads populated datasets', () => {
    expect(loadMerchants().length).toBeGreaterThan(50);
    expect(Object.keys(loadVpaHandles()).length).toBeGreaterThan(30);
    expect(Object.keys(loadIfscBanks()).length).toBeGreaterThan(30);
  });
});
