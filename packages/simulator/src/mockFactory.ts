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

import type {
  AAProfile,
  AATransaction,
  AATransactionMode,
  AATransactionType,
} from '@panini/standards-schema';

/**
 * A generated transaction may be deliberately malformed (anomaly
 * injection), so it is typed as a partial record rather than the strict
 * `AATransaction` contract.
 */
export type MockAATransaction = Partial<AATransaction>;

/** ReBIT v2.0-shaped FI profile; `Transaction` items may carry anomalies. */
export type MockAAProfile = Omit<AAProfile, 'Transaction'> & {
  readonly Transaction: readonly MockAATransaction[];
};

export interface SimulationOptions {
  /** Deterministic seed for the PRNG. Defaults to 42. */
  readonly seed?: number;
  /**
   * Fraction of transactions corrupted with anomalies (0–1).
   * Defaults to 0.15.
   */
  readonly anomalyRate?: number;
  /** Transactions per generated profile. Defaults to a random 5–15. */
  readonly transactionsPerProfile?: number;
}

const DEFAULT_SEED = 42;
const DEFAULT_ANOMALY_RATE = 0.15;

/** Deterministic PRNG (mulberry32) — same seed, same stream. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function digits(rng: Rng, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randInt(rng, 0, 9));
  return out;
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function alnum(rng: Rng, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += pick(rng, ALNUM.split(''));
  return out;
}

const UPI_MERCHANTS = [
  'ZOMATO',
  'SWIGGY',
  'AMAZON PAY',
  'ZEPTO',
  'BLINKIT',
  'IRCTC',
  'DMART',
  'UBER',
  'NETFLIX',
  'MYNTRA',
  'FLIPKART',
  'BIGBASKET',
  'BOOKMYSHOW',
  'PHONEPE',
] as const;

const VPA_HANDLES = ['okhdfcbank', 'okicici', 'okaxis', 'ybl', 'paytm', 'oksbi', 'okbob'] as const;

const UPI_MEMOS = ['Food', 'Groceries', 'Ride', 'Shopping', 'Bills', 'Fuel', 'Dinner'] as const;

const IMPS_BANKS = ['HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK', 'PUNB'] as const;

const EMPLOYERS = [
  'TCS LTD',
  'INFOSYS LIMITED',
  'WIPRO LIMITED',
  'HCL TECHNOLOGIES',
  'HDFC BANK',
  'ACCENTURE',
  'TECH MAHINDRA',
  'RELIANCE RETAIL',
] as const;

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
] as const;

const FIPS = [
  'fip-sbi-001',
  'fip-hdfc-002',
  'fip-icici-003',
  'fip-axis-004',
  'fip-kotak-005',
] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface GeneratedDate {
  /** Compact form embedded in narrations: yyyymmdd. */
  readonly compact: string;
  /** YYYY-MM-DD for `valueDate`. */
  readonly iso: string;
  /** ISO-8601 with IST offset for `transactionTimestamp`. */
  readonly timestamp: string;
}

function randomDate(rng: Rng): GeneratedDate {
  const year = pick(rng, [2025, 2026]);
  const month = randInt(rng, 1, 12);
  const day = randInt(rng, 1, 28);
  return {
    compact: `${year}${pad(month)}${pad(day)}`,
    iso: `${year}-${pad(month)}-${pad(day)}`,
    timestamp: `${year}-${pad(month)}-${pad(day)}T${pad(randInt(rng, 0, 23))}:${pad(
      randInt(rng, 0, 59),
    )}:${pad(randInt(rng, 0, 59))}+05:30`,
  };
}

interface RawTxn {
  readonly narration: string;
  readonly mode: AATransactionMode;
  readonly type: AATransactionType;
  readonly ref: string;
  readonly amount: number;
}

function genUpi(rng: Rng): RawTxn {
  const date = randomDate(rng);
  const direction = pick(rng, ['DR', 'CR'] as const);
  const ref = digits(rng, 12);
  const merchant = pick(rng, UPI_MERCHANTS);
  const vpa = pick(rng, VPA_HANDLES);
  const memo = rng() < 0.7 ? `/${pick(rng, UPI_MEMOS)}` : '';
  return {
    narration: `UPI/${date.compact}/${direction}/${ref}/${merchant}/${vpa}${memo}/`,
    mode: 'UPI',
    type: direction === 'DR' ? 'DEBIT' : 'CREDIT',
    ref,
    amount: randInt(rng, 20, 25000),
  };
}

function genImps(rng: Rng): RawTxn {
  const ref = digits(rng, randInt(rng, 7, 12));
  const direction = pick(rng, ['INBOUND', 'OUTBOUND', 'INWARD', 'OUTWARD'] as const);
  return {
    narration: `IMPS-${ref}-${pick(rng, UPI_MERCHANTS)}-${pick(rng, IMPS_BANKS)}-${direction}`,
    mode: 'IMPS',
    type: direction === 'INBOUND' || direction === 'INWARD' ? 'CREDIT' : 'DEBIT',
    ref,
    amount: randInt(rng, 100, 90000),
  };
}

function genSalary(rng: Rng): RawTxn {
  const month = pick(rng, MONTHS);
  const year = pick(rng, [2025, 2026]);
  const ref = `N${digits(rng, 10)}`;
  return {
    narration: `NEFT-${ref}-SALARY-${month} ${year}-${pick(rng, EMPLOYERS)}`,
    mode: 'NEFT',
    type: 'CREDIT',
    ref,
    amount: randInt(rng, 25000, 250000),
  };
}

function genNeftRtgs(rng: Rng): RawTxn {
  const channel = pick(rng, ['NEFT', 'RTGS'] as const);
  const ref = alnum(rng, randInt(rng, 8, 14));
  return {
    narration: `${channel}-${ref}-${pick(rng, EMPLOYERS)}`,
    mode: channel,
    type: pick(rng, ['DEBIT', 'CREDIT'] as const),
    ref,
    amount: randInt(rng, 5000, 500000),
  };
}

function genAch(rng: Rng): RawTxn {
  const direction = pick(rng, ['CR', 'DR'] as const);
  const ref = alnum(rng, randInt(rng, 6, 12));
  return {
    narration: `${pick(rng, ['ACH', 'ECS'] as const)}-${direction}-${ref}-${pick(rng, EMPLOYERS)}`,
    mode: 'ACH',
    type: direction === 'CR' ? 'CREDIT' : 'DEBIT',
    ref,
    amount: randInt(rng, 500, 40000),
  };
}

const GENERATORS: ReadonlyArray<readonly [generator: (rng: Rng) => RawTxn, weight: number]> = [
  [genUpi, 0.5],
  [genImps, 0.2],
  [genSalary, 0.15],
  [genNeftRtgs, 0.1],
  [genAch, 0.05],
];

function pickGenerator(rng: Rng): (rng: Rng) => RawTxn {
  let roll = rng();
  for (const [generator, weight] of GENERATORS) {
    if (roll < weight) return generator;
    roll -= weight;
  }
  return genUpi;
}

const ANOMALY_KINDS = [
  'truncated_narration',
  'bad_timestamp',
  'malformed_reference',
  'dropped_field',
  'scrambled_narration',
] as const;

const BAD_TIMESTAMPS = ['2026-13-45T99:99:99+05:30', '15/10/2026 10:30', 'NOT_A_DATE', ''] as const;
const BAD_REFERENCES = ['', '###', 'REF-??', 'null'] as const;
const DROPPABLE_FIELDS = ['amount', 'txnId', 'narration', 'type', 'mode'] as const;

/** Applies a random corruption to a clean transaction record. */
function injectAnomaly(rng: Rng, txn: AATransaction): MockAATransaction {
  const broken: Record<string, unknown> = { ...txn };
  switch (pick(rng, ANOMALY_KINDS)) {
    case 'truncated_narration':
      broken['narration'] = txn.narration.slice(
        0,
        randInt(rng, 4, Math.max(4, txn.narration.length - 5)),
      );
      break;
    case 'bad_timestamp':
      broken['transactionTimestamp'] = pick(rng, BAD_TIMESTAMPS);
      break;
    case 'malformed_reference':
      broken['txnId'] = pick(rng, BAD_REFERENCES);
      break;
    case 'dropped_field':
      delete broken[pick(rng, DROPPABLE_FIELDS)];
      break;
    case 'scrambled_narration':
      broken['narration'] = txn.narration.replace(/[A-Z]{4}/, '####');
      break;
  }
  return broken;
}

function generateProfile(rng: Rng, anomalyRate: number, txnCount: number): MockAAProfile {
  const anchor = randomDate(rng);
  let balance = randInt(rng, 10000, 200000);
  const transactions: MockAATransaction[] = [];
  for (let i = 0; i < txnCount; i++) {
    const raw = pickGenerator(rng)(rng);
    const date = randomDate(rng);
    balance += raw.type === 'CREDIT' ? raw.amount : -raw.amount;
    const txn: AATransaction = {
      txnId: raw.ref,
      amount: raw.amount.toFixed(2),
      narration: raw.narration,
      type: raw.type,
      mode: raw.mode,
      valueDate: date.iso,
      transactionTimestamp: date.timestamp,
      reference: `UTR-${alnum(rng, 10)}`,
      currentBalance: balance.toFixed(2),
    };
    transactions.push(rng() < anomalyRate ? injectAnomaly(rng, txn) : txn);
  }
  return {
    FIPId: pick(rng, FIPS),
    FIUTimestamp: anchor.timestamp,
    maskedAccountNumber: `${'X'.repeat(randInt(rng, 4, 8))}${digits(rng, 4)}`,
    consentId: `consent-${alnum(rng, 12).toLowerCase()}`,
    fiType: 'DEPOSIT',
    Transaction: transactions,
  };
}

/** Generates a single ReBIT v2.0-shaped FI profile. */
export function generateMockProfile(options?: SimulationOptions): MockAAProfile {
  const rng = mulberry32(options?.seed ?? DEFAULT_SEED);
  return generateProfile(
    rng,
    options?.anomalyRate ?? DEFAULT_ANOMALY_RATE,
    options?.transactionsPerProfile ?? randInt(rng, 5, 15),
  );
}

/**
 * Generates `count` mock FI profiles sharing one deterministic stream —
 * identical `(count, seed)` pairs always produce identical output.
 */
export function generateMockProfiles(count: number, options?: SimulationOptions): MockAAProfile[] {
  const rng = mulberry32(options?.seed ?? DEFAULT_SEED);
  const anomalyRate = options?.anomalyRate ?? DEFAULT_ANOMALY_RATE;
  const profiles: MockAAProfile[] = [];
  for (let i = 0; i < count; i++) {
    const txnCount = options?.transactionsPerProfile ?? randInt(rng, 5, 15);
    profiles.push(generateProfile(rng, anomalyRate, txnCount));
  }
  return profiles;
}
