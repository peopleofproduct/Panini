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
  loadMccCodes,
  loadMerchants,
  loadVpaHandles,
  lookupIfscBank,
  lookupMcc,
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

describe('lookupMcc', () => {
  it('resolves bare codes and embedded tokens', () => {
    expect(lookupMcc('5411')?.category).toBe('Groceries');
    expect(lookupMcc('POS PURCHASE MCC-5812')?.category).toBe('Food & Dining');
    expect(lookupMcc('mcc 6011')?.category).toBe('Cash Withdrawal');
    expect(lookupMcc('MCC:8999')?.category).toBe('Professional Services');
  });

  it('returns null for unknown codes and non-MCC strings', () => {
    expect(lookupMcc('0000')).toBeNull();
    expect(lookupMcc('swiggy order')).toBeNull();
    expect(lookupMcc('123')).toBeNull();
    expect(lookupMcc(null)).toBeNull();
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

  it('extracts MCC tokens from narrations and categorizes via the dictionary', () => {
    const txn = parseBankNarration('POS 420123456789 PURCHASE MCC-5411');
    expect(txn.mcc).toBe('5411');
    expect(txn.mcc_description).toBe('Grocery stores and supermarkets');
    expect(txn.category).toBe('Groceries');
  });

  it('surfaces merchant-dictionary MCC when the narration has none', () => {
    const txn = parseBankNarration('UPI/20261015/DR/826384910234/SWIGGY/ybl/Cooking/');
    expect(txn.mcc).toBe('5814');
    expect(txn.mcc_description).toBe('Fast food restaurants');
  });

  it('keeps narration MCC over merchant dictionary when both exist', () => {
    const txn = parseBankNarration('UPI/20261015/DR/826384910234/SWIGGY/ybl/Cooking/ MCC-5411');
    expect(txn.mcc).toBe('5411');
  });

  it('returns null mcc fields when no code is present', () => {
    const txn = parseBankNarration('CASH WDL SELF');
    expect(txn.mcc).toBeNull();
    expect(txn.mcc_description).toBeNull();
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
    expect(Object.keys(loadMccCodes()).length).toBeGreaterThan(50);
  });
});
