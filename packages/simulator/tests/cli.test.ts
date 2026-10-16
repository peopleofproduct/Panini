/**
 * Copyright 2026 Project Panini Contributors
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

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliArgs, runCli } from '../src/cli';

function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

describe('parseCliArgs', () => {
  it('applies defaults', () => {
    const result = parseCliArgs([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.count).toBe(10);
      expect(result.args.seed).toBe(42);
      expect(result.args.anomalyRate).toBeCloseTo(0.15);
    }
  });

  it('accepts --key=value and --key value forms', () => {
    const inline = parseCliArgs(['--count=50', '--seed=7']);
    const spaced = parseCliArgs(['--count', '50', '--seed', '7']);
    expect(inline.ok && inline.args.count).toBe(50);
    expect(spaced.ok && spaced.args.count).toBe(50);
    expect(inline.ok && inline.args.seed).toBe(7);
  });

  it('rejects unknown flags and bad values', () => {
    expect(parseCliArgs(['--bogus']).ok).toBe(false);
    expect(parseCliArgs(['--count=abc']).ok).toBe(false);
    expect(parseCliArgs(['--count=-3']).ok).toBe(false);
    expect(parseCliArgs(['--anomaly-rate=2']).ok).toBe(false);
    expect(parseCliArgs(['--count']).ok).toBe(false);
  });
});

describe('runCli', () => {
  it('streams a JSON array of the requested count to stdout', () => {
    const io = capture();
    const code = runCli(
      ['--count=50'],
      (s) => io.out.push(s),
      (s) => io.err.push(s),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out.join('')) as unknown[];
    expect(parsed).toHaveLength(50);
  });

  it('writes the output file when --output is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'panini-sim-'));
    try {
      const target = join(dir, 'mocks.json');
      const io = capture();
      const code = runCli(
        ['--count=5', '--output', target, '--pretty'],
        (s) => io.out.push(s),
        (s) => io.err.push(s),
      );
      expect(code).toBe(0);
      expect(io.out.join('')).toBe('');
      const parsed = JSON.parse(readFileSync(target, 'utf8')) as unknown[];
      expect(parsed).toHaveLength(5);
      expect(readFileSync(target, 'utf8')).toContain('\n  ');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is deterministic across runs for a fixed seed', () => {
    const a = capture();
    const b = capture();
    runCli(
      ['--count=10', '--seed=123'],
      (s) => a.out.push(s),
      (s) => a.err.push(s),
    );
    runCli(
      ['--count=10', '--seed=123'],
      (s) => b.out.push(s),
      (s) => b.err.push(s),
    );
    expect(a.out.join('')).toBe(b.out.join(''));
  });

  it('prints usage on --help and fails on bad args', () => {
    const io = capture();
    expect(
      runCli(
        ['--help'],
        (s) => io.out.push(s),
        (s) => io.err.push(s),
      ),
    ).toBe(0);
    expect(io.out.join('')).toContain('Usage:');

    const bad = capture();
    expect(
      runCli(
        ['--count=NaN-x'],
        (s) => bad.out.push(s),
        (s) => bad.err.push(s),
      ),
    ).toBe(1);
    expect(bad.err.join('')).toContain('invalid number');
  });
});
