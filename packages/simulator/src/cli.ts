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

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateMockProfiles, type MockAAProfile } from './mockFactory';

export interface CliArgs {
  readonly count: number;
  readonly seed: number;
  readonly anomalyRate: number;
  readonly transactionsPerProfile: number | undefined;
  readonly output: string | undefined;
  readonly pretty: boolean;
  readonly help: boolean;
}

export type ParseArgsResult =
  { readonly ok: true; readonly args: CliArgs } | { readonly ok: false; readonly error: string };

const USAGE = `panini-simulate — generative sandbox for Panini

Usage: npm run simulate -- [options]

Options:
  --count=<n>         Number of mock FI profiles to emit (default: 10)
  --seed=<n>          Deterministic PRNG seed (default: 42)
  --anomaly-rate=<f>  Fraction of transactions to corrupt, 0-1 (default: 0.15)
  --txns=<n>          Transactions per profile (default: random 5-15)
  --output=<path>     Write the JSON array to a file instead of stdout
  -o <path>           Alias for --output
  --pretty            Pretty-print JSON with 2-space indent
  --help              Show this message
`;

const NUMERIC_FLAGS = new Set(['count', 'seed', 'anomaly-rate', 'txns']);

/** Parses `--key=value` / `--key value` / boolean flags from argv. */
export function parseCliArgs(argv: readonly string[]): ParseArgsResult {
  const args: CliArgs = {
    count: 10,
    seed: 42,
    anomalyRate: 0.15,
    transactionsPerProfile: undefined,
    output: undefined,
    pretty: false,
    help: false,
  };
  const mutable = { ...args } as { -readonly [K in keyof CliArgs]: CliArgs[K] };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--help' || token === '-h') {
      mutable.help = true;
      continue;
    }
    if (token === '--pretty') {
      mutable.pretty = true;
      continue;
    }
    if (token === '-o') {
      const value = argv[++i];
      if (value === undefined) return { ok: false, error: 'missing value for -o' };
      mutable.output = value;
      continue;
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(token);
    if (!match) return { ok: false, error: `unrecognized argument: ${token}` };
    const key = match[1]!;
    const inlineValue = match[2];
    if (key === 'output') {
      const value = inlineValue ?? argv[++i];
      if (value === undefined) return { ok: false, error: 'missing value for --output' };
      mutable.output = value;
      continue;
    }
    if (!NUMERIC_FLAGS.has(key)) return { ok: false, error: `unknown flag: --${key}` };
    const raw = inlineValue ?? argv[++i];
    if (raw === undefined) return { ok: false, error: `missing value for --${key}` };
    const num = Number(raw);
    if (!Number.isFinite(num)) return { ok: false, error: `invalid number for --${key}: ${raw}` };
    switch (key) {
      case 'count':
        mutable.count = num;
        break;
      case 'seed':
        mutable.seed = num;
        break;
      case 'anomaly-rate':
        mutable.anomalyRate = num;
        break;
      case 'txns':
        mutable.transactionsPerProfile = num;
        break;
    }
  }

  if (!Number.isInteger(mutable.count) || mutable.count < 0)
    return { ok: false, error: '--count must be a non-negative integer' };
  if (mutable.anomalyRate < 0 || mutable.anomalyRate > 1)
    return { ok: false, error: '--anomaly-rate must be between 0 and 1' };
  return { ok: true, args: mutable };
}

/**
 * Runs the simulator. Returns the process exit code; output goes through
 * the injected writers so tests never touch real stdio.
 */
export function runCli(
  argv: readonly string[],
  write: (chunk: string) => void,
  error: (chunk: string) => void,
): number {
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) {
    error(`${parsed.error}\n\n${USAGE}`);
    return 1;
  }
  if (parsed.args.help) {
    write(USAGE);
    return 0;
  }

  const profiles: readonly MockAAProfile[] = generateMockProfiles(parsed.args.count, {
    seed: parsed.args.seed,
    anomalyRate: parsed.args.anomalyRate,
    ...(parsed.args.transactionsPerProfile !== undefined
      ? { transactionsPerProfile: parsed.args.transactionsPerProfile }
      : {}),
  });
  const json = `${JSON.stringify(profiles, null, parsed.args.pretty ? 2 : 0)}\n`;

  if (parsed.args.output !== undefined) {
    const target = resolve(parsed.args.output);
    writeFileSync(target, json, 'utf8');
    error(`wrote ${profiles.length} profiles to ${target}\n`);
    return 0;
  }
  write(json);
  return 0;
}

if (require.main === module) {
  process.exitCode = runCli(
    process.argv.slice(2),
    (chunk) => process.stdout.write(chunk),
    (chunk) => process.stderr.write(chunk),
  );
}
