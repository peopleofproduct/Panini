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
  consensusCompare,
  consensusWithVerification,
  createHttpQueueProvider,
  createOpenAiVisionProvider,
  extractWithRouter,
  verifyStatement,
} from '../src/index';
import type {
  ExtractedStatement,
  ExtractedTransaction,
  FetchLike,
  VisionPage,
  VisionProvider,
} from '../src/index';
import type { OcrProvider } from '../src/ocr';
import type { QueueOcrProvider } from '../src/queue';

const PAGE: VisionPage = { image: new Uint8Array([1, 2, 3]), pageNumber: 1 };

function txn(
  date: string,
  narration: string,
  direction: 'DEBIT' | 'CREDIT',
  amountPaise: number,
  balancePaise: number,
): ExtractedTransaction {
  return {
    date,
    narration,
    refNumber: null,
    direction,
    amountPaise,
    balancePaise,
    raw: '',
    warnings: [],
  };
}

function statement(transactions: readonly ExtractedTransaction[]): ExtractedStatement {
  return {
    format: 'image',
    bank: null,
    layoutId: null,
    accountMask: null,
    transactions,
    warnings: [],
    metadata: {},
  };
}

describe('verifyStatement', () => {
  it('passes a balanced chain', () => {
    const st = statement([
      txn('2026-10-15', 'UPI/SWIGGY', 'DEBIT', 10000, 90000),
      txn('2026-10-16', 'UPI/REFUND', 'CREDIT', 20000, 110000),
    ]);
    const v = verifyStatement(st);
    expect(v.pass).toBe(true);
    expect(v.score).toBe(1);
  });

  it('flags a row that breaks the balance chain', () => {
    const st = statement([
      txn('2026-10-15', 'UPI/SWIGGY', 'DEBIT', 10000, 90000),
      txn('2026-10-16', 'UPI/REFUND', 'CREDIT', 20000, 115000), // should be 110000
    ]);
    const v = verifyStatement(st);
    expect(v.pass).toBe(false);
    expect(v.issues.some((i) => i.ruleId === 'verify.balance_chain')).toBe(true);
  });

  it('flags unparseable dates', () => {
    const st = statement([txn('not-a-date', 'X', 'DEBIT', 100, 0)]);
    const v = verifyStatement(st);
    expect(v.pass).toBe(false);
    expect(v.issues.some((i) => i.ruleId === 'verify.bad_date')).toBe(true);
  });

  it('flags opening→closing reconciliation failure', () => {
    const st = statement([txn('2026-10-15', 'X', 'DEBIT', 10000, 90000)]);
    st.metadata['openingBalancePaise'] = '100000';
    st.metadata['closingBalancePaise'] = '80000'; // expected 90000
    const v = verifyStatement(st);
    expect(v.issues.some((i) => i.ruleId === 'verify.reconciliation')).toBe(true);
  });

  it('is deterministic — same input, same result', () => {
    const st = statement([txn('2026-10-15', 'X', 'DEBIT', 10000, 90000)]);
    expect(verifyStatement(st)).toEqual(verifyStatement(st));
  });
});

describe('extractWithRouter', () => {
  // Rows that parse through the generic table layout AND verify: the
  // balance column carries a consistent running chain.
  const GOOD_TEXT =
    'Date  Narration  Debit  Credit  Balance\n' +
    '15/10/2026  UPI/SWIGGY  100.00    900.00\n' +
    '16/10/2026  UPI/REFUND    200.00  1100.00\n' +
    '17/10/2026  UPI/AMAZON  300.00    800.00';

  const goodOcr: OcrProvider = {
    name: 'good-ocr',
    async recognize() {
      return { text: GOOD_TEXT, confidence: 0.95 };
    },
  };

  const badOcr: OcrProvider = {
    name: 'bad-ocr',
    async recognize() {
      return { text: 'garbage no table here\nrandom words', confidence: 0.4 };
    },
  };

  const throwingOcr: OcrProvider = {
    name: 'throwing-ocr',
    async recognize() {
      throw new Error('engine exploded');
    },
  };

  const goodVision: VisionProvider = {
    name: 'vision:fake',
    async extractTable() {
      return {
        rows: [
          ['Date', 'Narration', 'Debit', 'Credit', 'Balance'],
          ['15/10/2026', 'UPI/SWIGGY', '100.00', '', '900.00'],
          ['16/10/2026', 'UPI/REFUND', '', '200.00', '1100.00'],
          ['17/10/2026', 'UPI/AMAZON', '300.00', '', '800.00'],
        ],
        model: 'fake-vl-7b',
      };
    },
  };

  it('accepts the first tier that passes verification', async () => {
    const out = await extractWithRouter([PAGE], {
      tiers: [
        { kind: 'ocr', provider: badOcr },
        { kind: 'ocr', provider: goodOcr },
      ],
    });
    expect(out.verdict).toBe('verified');
    expect(out.engine).toBe('good-ocr');
    expect(out.attempts.map((a) => a.engine)).toEqual(['bad-ocr', 'good-ocr']);
  });

  it('isolates engine failure and falls through to the next tier', async () => {
    const out = await extractWithRouter([PAGE], {
      tiers: [
        { kind: 'ocr', provider: throwingOcr },
        { kind: 'vision', provider: goodVision },
      ],
    });
    expect(out.verdict).toBe('verified');
    expect(out.engine).toBe('vision:fake');
    expect(out.statement.metadata['visionModel']).toBe('fake-vl-7b');
    expect(out.attempts[0]!.issues[0]).toContain('engine exploded');
  });

  it('marks the result degraded when every tier fails the gate', async () => {
    const out = await extractWithRouter([PAGE], {
      tiers: [{ kind: 'ocr', provider: badOcr }],
    });
    expect(out.verdict).not.toBe('verified');
    expect(out.engine).toBeNull();
    expect(out.statement.warnings.some((w) => w.includes('extraction'))).toBe(true);
  });

  it('enforces the provider-confidence floor', async () => {
    const out = await extractWithRouter([PAGE], {
      tiers: [
        { kind: 'ocr', provider: badOcr }, // confidence 0.4 < floor
        { kind: 'ocr', provider: goodOcr },
      ],
      minProviderConfidence: 0.7,
    });
    expect(out.attempts[0]!.issues[0]).toContain('below floor');
    expect(out.engine).toBe('good-ocr');
  });

  it('runs a queue tier to completion within the poll budget', async () => {
    let polls = 0;
    const queue: QueueOcrProvider = {
      name: 'queue:test',
      async submit() {
        return 'job-1';
      },
      async poll() {
        polls++;
        if (polls < 3) return { status: 'pending' };
        return { status: 'done', result: { text: GOOD_TEXT } };
      },
    };
    const out = await extractWithRouter([PAGE], {
      tiers: [{ kind: 'queue', provider: queue }],
      pollIntervalMs: 0,
    });
    expect(out.verdict).toBe('verified');
    expect(polls).toBe(3);
  });

  it('fails a queue tier that exceeds the poll budget', async () => {
    let polls = 0;
    const queue: QueueOcrProvider = {
      name: 'queue:slow',
      async submit() {
        return 'job-2';
      },
      async poll() {
        polls++;
        return { status: 'pending' };
      },
    };
    const out = await extractWithRouter([PAGE], {
      tiers: [
        { kind: 'queue', provider: queue },
        { kind: 'ocr', provider: goodOcr },
      ],
      pollIntervalMs: 0,
      maxPolls: 3,
    });
    expect(polls).toBe(3);
    expect(out.engine).toBe('good-ocr');
  });
});

describe('consensus', () => {
  const base = () =>
    statement([
      txn('2026-10-15', 'UPI/SWIGGY', 'DEBIT', 10000, 90000),
      txn('2026-10-16', 'UPI/REFUND', 'CREDIT', 20000, 110000),
    ]);

  it('reports agree when engines produce identical rows', () => {
    const r = consensusCompare(base(), base(), 'engine-b');
    expect(r.verdict).toBe('agree');
    expect(r.disagreements).toEqual([]);
    expect(r.statement.metadata['consensusVerdict']).toBe('agree');
  });

  it('flags the exact cells that disagree', () => {
    const other = base();
    other.transactions[1] = txn('2026-10-16', 'UPI/REFUND', 'CREDIT', 20000, 115000);
    const r = consensusCompare(base(), other, 'engine-b');
    expect(r.verdict).toBe('partial');
    expect(r.disagreements).toContainEqual({
      row: 1,
      field: 'balancePaise',
      primary: '110000',
      secondary: '115000',
    });
    expect(r.statement.warnings.some((w) => w.includes('115000'))).toBe(true);
  });

  it('is incomparable when a side has no rows', () => {
    const r = consensusCompare(base(), statement([]), 'engine-b');
    expect(r.verdict).toBe('incomparable');
  });

  it('combines consensus with the verify gate', () => {
    const r = consensusWithVerification(base(), base(), 'engine-b');
    expect(r.verified).toBe(true);
    expect(r.verdict).toBe('agree');
  });
});

describe('adapters', () => {
  it('createOpenAiVisionProvider posts to the caller-supplied endpoint', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: '[["15/10/2026","UPI/SWIGGY","100.00","","900.00"]]',
                },
              },
            ],
          };
        },
      };
    };
    const p = createOpenAiVisionProvider({
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5-vl:7b',
      fetchImpl,
    });
    const res = await p.extractTable(PAGE);
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect((calls[0]!.body as { temperature: number }).temperature).toBe(0);
    expect(res.rows[0]).toEqual(['15/10/2026', 'UPI/SWIGGY', '100.00', '', '900.00']);
    expect(res.model).toBe('qwen2.5-vl:7b');
    expect(res.rawResponse).toBeUndefined(); // PII not retained by default
  });

  it('rejects malformed vision output', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: 'I cannot read this' } }] };
      },
    });
    const p = createOpenAiVisionProvider({
      baseUrl: 'http://x',
      model: 'm',
      fetchImpl,
    });
    await expect(p.extractTable(PAGE)).rejects.toThrow();
  });

  it('createHttpQueueProvider submits and polls the caller endpoints', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(url);
      if (url.includes('/submit')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { jobId: 'j9' };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: 'done', result: { text: 'rows' } };
        },
      };
    };
    const q = createHttpQueueProvider({
      fetchImpl,
      submitUrl: 'https://tsp.example/submit',
      pollUrl: 'https://tsp.example/jobs',
    });
    const jobId = await q.submit([PAGE.image]);
    expect(jobId).toBe('j9');
    const job = await q.poll(jobId);
    expect(job.status).toBe('done');
    expect(job.result?.text).toBe('rows');
    expect(seen[1]).toBe('https://tsp.example/jobs/j9');
    expect(q.name).toBe('queue:tsp.example');
  });
});
