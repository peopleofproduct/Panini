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
  isAAConsentArtefact,
  isAAConsentRequest,
  listSchemas,
  validateAAConsentArtefact,
  validateAAConsentRequest,
  validateFiData,
  type AAFIType,
} from '../src';

const envelope = {
  FIPId: 'fip-demo-001',
  FIUTimestamp: '2026-10-15T10:30:00+05:30',
  maskedAccountNumber: 'XXXXXX1234',
};

describe('validateFiData — FI-type dispatch', () => {
  it('routes DEPOSIT to the Transaction-array schema', () => {
    const payload = {
      ...envelope,
      fiType: 'DEPOSIT',
      Transaction: [
        {
          txnId: 'T1',
          amount: '100.00',
          narration: 'UPI-TEST',
          type: 'DEBIT',
          mode: 'UPI',
          valueDate: '2026-10-15',
          transactionTimestamp: '2026-10-15T10:30:00+05:30',
          reference: 'R1',
          currentBalance: '900.00',
        },
      ],
    };
    expect(validateFiData('DEPOSIT', payload).valid).toBe(true);
    // Missing Transaction array → fails the DEPOSIT schema.
    const bad = { ...envelope, fiType: 'DEPOSIT' };
    expect(validateFiData('DEPOSIT', bad).valid).toBe(false);
  });

  it('routes TERM-DEPOSIT/RECURRING_DEPOSIT to the deposit-summary shape', () => {
    const fd = {
      ...envelope,
      fiType: 'TERM-DEPOSIT',
      Summary: {
        accountType: 'FIXED',
        principalAmount: '100000.00',
        maturityValue: '107500.00',
        interestRatePct: '7.5',
        maturityDate: '2027-10-15',
        tenureMonths: 12,
      },
    };
    expect(validateFiData('TERM-DEPOSIT', fd).valid).toBe(true);
    expect(validateFiData('RECURRING_DEPOSIT', fd).valid).toBe(true);
    // Missing Summary → fail.
    expect(validateFiData('TERM-DEPOSIT', envelope).valid).toBe(false);
    // Bad maturity date format → fail.
    const badDate = { ...fd, Summary: { ...fd.Summary, maturityDate: '15-10-2027' } };
    expect(validateFiData('TERM-DEPOSIT', badDate).valid).toBe(false);
  });

  it.each(['EQUITIES', 'MUTUAL_FUNDS', 'ETF', 'BONDS', 'SIP', 'AIF', 'REIT'] as AAFIType[])(
    'routes %s to the Holdings shape',
    (fiType) => {
      const payload = {
        ...envelope,
        fiType,
        Holdings: [
          {
            instrumentName: 'HDFC Flexi Cap',
            isin: 'INF179K01YV8',
            units: '100.5',
            nav: '1100.25',
            currentValue: '110575.13',
          },
        ],
      };
      expect(validateFiData(fiType, payload).valid).toBe(true);
      expect(validateFiData(fiType, { ...envelope, fiType }).valid).toBe(false);
      // Bad ISIN shape → fail.
      const badIsin = {
        ...payload,
        Holdings: [{ ...payload.Holdings[0], isin: 'XX' }],
      };
      expect(validateFiData(fiType, badIsin).valid).toBe(false);
    },
  );

  it('routes INSURANCE_POLICIES to the Policies shape', () => {
    const payload = {
      ...envelope,
      fiType: 'INSURANCE_POLICIES',
      Policies: [
        {
          policyNumber: 'LIC-123456789',
          insurer: 'LIC of India',
          policyType: 'TERM',
          sumAssured: '5000000.00',
          premiumAmount: '12000.00',
          premiumFrequency: 'YEARLY',
          status: 'ACTIVE',
        },
      ],
    };
    expect(validateFiData('INSURANCE_POLICIES', payload).valid).toBe(true);
    const bad = {
      ...payload,
      Policies: [{ policyNumber: 'X1', insurer: '', policyType: 'NOPE' }],
    };
    expect(validateFiData('INSURANCE_POLICIES', bad).valid).toBe(false);
  });

  it('routes NPS to the PRAN-keyed shape', () => {
    const payload = {
      ...envelope,
      fiType: 'NPS',
      Summary: { pran: '110012345678', tier: 'I', totalCorpus: '250000.00' },
    };
    expect(validateFiData('NPS', payload).valid).toBe(true);
    // PRAN must be 12 digits starting with 1.
    const bad = { ...payload, Summary: { pran: '123', tier: 'I' } };
    expect(validateFiData('NPS', bad).valid).toBe(false);
  });
});

describe('AA consent schemas', () => {
  const consentDetail = {
    consentStart: '2026-10-15T10:30:00+05:30',
    consentExpiry: '2027-10-15T10:30:00+05:30',
    consentMode: 'STORE',
    fetchType: 'PERIODIC',
    consentTypes: ['TRANSACTIONS', 'SUMMARY'],
    fiTypes: ['DEPOSIT', 'MUTUAL_FUNDS'],
    DataConsumer: { id: 'fiu-demo-01', type: 'FIU' },
    Customer: { id: '9876543210@onemoney' },
    Purpose: { code: '101', text: 'Loan underwriting' },
    FIDataRange: { from: '2025-10-15T00:00:00+05:30', to: '2026-10-15T00:00:00+05:30' },
    DataLife: { unit: 'MONTH', value: 6 },
    Frequency: { unit: 'MONTH', value: 1 },
  };

  const consentRequest = {
    ver: '2.0.0',
    timestamp: '2026-10-15T10:30:00+05:30',
    txnid: 'txn-abc-001',
    ConsentDetail: consentDetail,
  };

  it('accepts a well-formed consent request', () => {
    expect(validateAAConsentRequest(consentRequest).valid).toBe(true);
    expect(isAAConsentRequest(consentRequest)).toBe(true);
  });

  it('rejects malformed consent requests', () => {
    expect(validateAAConsentRequest({}).valid).toBe(false);
    // Unknown consentMode
    const bad = structuredClone(consentRequest) as { ConsentDetail: { consentMode: string } };
    bad.ConsentDetail.consentMode = 'STREAM_ALL';
    expect(validateAAConsentRequest(bad).valid).toBe(false);
    // Purpose code must be 3 digits
    const badPurpose = structuredClone(consentRequest) as {
      ConsentDetail: { Purpose: { code: string } };
    };
    badPurpose.ConsentDetail.Purpose.code = '1';
    expect(validateAAConsentRequest(badPurpose).valid).toBe(false);
    // Unknown fiType
    const badFi = structuredClone(consentRequest) as {
      ConsentDetail: { fiTypes: string[] };
    };
    badFi.ConsentDetail.fiTypes = ['CRYPTO'];
    expect(validateAAConsentRequest(badFi).valid).toBe(false);
  });

  it('accepts a signed consent artefact with ConsentUse', () => {
    const artefact = {
      ver: '2.0.0',
      txnid: 'txn-abc-001',
      timestamp: '2026-10-15T10:35:00+05:30',
      consentId: 'consent-654e21',
      status: 'ACTIVE',
      createTimestamp: '2026-10-15T10:34:00+05:30',
      signedConsent: 'eyJhbGciOiJSUzI1NiJ9.payload.signature',
      ConsentUse: {
        count: 0,
        lastUseDateTime: '2026-10-15T10:34:00+05:30',
        logUri: 'https://aa.example.com/log/1',
      },
      ConsentDetail: consentDetail,
    };
    expect(validateAAConsentArtefact(artefact).valid).toBe(true);
    expect(isAAConsentArtefact(artefact)).toBe(true);
  });

  it('rejects artefacts with bad status or missing signedConsent', () => {
    const artefact = {
      ver: '2.0.0',
      txnid: 't',
      timestamp: '2026-10-15T10:35:00+05:30',
      consentId: 'consent-654e21',
      status: 'ACTIVE',
      createTimestamp: '2026-10-15T10:34:00+05:30',
      signedConsent: 'sig',
      ConsentUse: { count: 0, lastUseDateTime: '2026-10-15T10:34:00+05:30' },
      ConsentDetail: {},
    };
    const r = validateAAConsentArtefact(artefact);
    expect(r.valid).toBe(false); // ConsentDetail missing required fields
    const badStatus = { ...artefact, status: 'APPROVED' };
    expect(validateAAConsentArtefact(badStatus).valid).toBe(false);
  });
});

describe('schema registry', () => {
  it('bundles the full FI matrix + consent lifecycle schemas', () => {
    const names = listSchemas();
    for (const expected of [
      'aa-profile',
      'aa-fi-deposit',
      'aa-fi-investment',
      'aa-fi-insurance',
      'aa-fi-nps',
      'aa-consent-request',
      'aa-consent-artefact',
      'ocen-loan',
    ]) {
      expect(names).toContain(expected);
    }
  });
});
