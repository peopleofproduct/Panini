#!/usr/bin/env node
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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { analyzeNarrationBatch, suggestGrammarRule } from '@paniniapi/rules-engine';
import { analyzeStatementFiles } from './pipeline';
import { renderMarkdown } from './render';

const HELP = `panini-bsa — Bank Statement Analysis in a box

Usage:
  panini-bsa <files...> [options]
  panini-bsa doctor <files...> [--bank <id>]   Drift check + rule suggestions

Options:
  -o, --out <dir>       Output directory (default: ./bsa-report)
  --bank <id>           Bank hint applied to all files
  --password <pw>       Password applied to protected PDFs
  --no-enrich           Skip narration enrichment (faster, coarser report)
  --no-forensics        Skip document-integrity checks (tamper signals)
  --aa <file>           Decrypted AA FI payload (JSON) — reconciles every
                        statement against the bank's own feed. Exit 4 on
                        fabrication_evidence.
  --no-fraud            Skip the fraud-indicator suite
  --fail-on-fraud       Exit 5 when any HIGH-severity fraud indicator fires
  -h, --help            Show this help

Outputs: bsa-report.json + bsa-report.md. All analysis is local —
no data leaves this process.

doctor: feed it statement files or one-narration-per-line .txt dumps to
measure grammar match-rate against the corpus baseline and draft rule
suggestions for whatever isn't matching. Exit 1 on drift.`;

/** Narrations from a file: one per line for .txt; the narration column for statement files. */
async function narrationsFrom(path: string, bank?: string): Promise<string[]> {
  const data = new Uint8Array(readFileSync(path));
  if (path.endsWith('.txt')) {
    return Buffer.from(data)
      .toString('utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '');
  }
  const { extractStatement } = await import('@paniniapi/extract');
  const st = await extractStatement(data, bank === undefined ? {} : { bankHint: bank });
  return st.transactions.map((t) => t.narration);
}

async function doctor(paths: readonly string[], bank?: string): Promise<number> {
  const all: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      console.error(`doctor: no such file '${p}'`);
      return 1;
    }
    all.push(...(await narrationsFrom(p, bank)));
  }
  if (all.length === 0) {
    console.error('doctor: no narrations found in input');
    return 1;
  }
  const report = analyzeNarrationBatch(all, bank === undefined ? {} : { bankHint: bank });
  console.log(`narrations: ${report.total}`);
  console.log(`rule-matched: ${report.matched} (${(report.matchRate * 100).toFixed(1)}%)`);
  if (report.baselineMatchRate !== null) {
    console.log(`corpus baseline: ${(report.baselineMatchRate * 100).toFixed(1)}%`);
  }
  for (const w of report.warnings) console.warn(`⚠ ${w}`);
  if (report.unmatchedClusters.length === 0) {
    console.log('no unmatched narrations — grammar covers this batch');
    return 0;
  }
  console.log(`\nunmatched clusters (${report.unmatchedClusters.length}):`);
  for (const c of report.unmatchedClusters) {
    console.log(`\n  ${c.skeleton}  ×${c.count}`);
    for (const s of c.samples) console.log(`    ${s}`);
    const suggestion = suggestGrammarRule(c.samples);
    if (suggestion !== null) {
      console.log(`    → draft rule: ${JSON.stringify(suggestion.pattern.regex)}`);
      console.log(`    → ${suggestion.note}`);
    } else {
      console.log('    → no safe draft (samples too heterogeneous)');
    }
  }
  return report.drift ? 1 : 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === 'doctor') {
    const rest = args.slice(1);
    const paths: string[] = [];
    let bank: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--bank') bank = rest[++i];
      else paths.push(rest[i]!);
    }
    return doctor(paths, bank);
  }
  if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    console.log(HELP);
    return args.length === 0 ? 1 : 0;
  }

  const files: { name: string; data: Uint8Array }[] = [];
  let outDir = './bsa-report';
  let failOnFraud = false;
  const opts: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-o' || a === '--out') {
      outDir = args[++i] ?? outDir;
    } else if (a === '--bank') {
      opts['bankHint'] = args[++i];
    } else if (a === '--password') {
      opts['credentials'] = { password: args[++i] };
    } else if (a === '--no-enrich') {
      opts['enrich'] = false;
    } else if (a === '--no-forensics') {
      opts['forensics'] = false;
    } else if (a === '--no-fraud') {
      opts['fraud'] = false;
    } else if (a === '--fail-on-fraud') {
      failOnFraud = true;
    } else if (a === '--aa') {
      const p = args[++i];
      if (p === undefined) {
        console.error('--aa requires a file path');
        return 1;
      }
      opts['aaData'] = JSON.parse(readFileSync(p, 'utf8'));
    } else {
      files.push({ name: basename(a), data: new Uint8Array(readFileSync(a)) });
    }
  }

  if (files.length === 0) {
    console.error('no input files');
    return 1;
  }

  const report = await analyzeStatementFiles(files, opts);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'bsa-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'bsa-report.md'), renderMarkdown(report));

  console.log(
    `analysed ${report.summary.totalTransactions} transactions across ` +
      `${report.summary.filesProcessed} file(s) → ${outDir}/bsa-report.{json,md}`,
  );
  let tampered = false;
  let fabricated = false;
  for (const s of report.statements) {
    if (s.warnings.length > 0) console.warn(`⚠ ${s.name}: ${s.warnings.length} warning(s)`);
    if (s.integrity?.verdict === 'tamper_evidence') {
      tampered = true;
      console.error(`✗ ${s.name}: TAMPER EVIDENCE — ${s.integrity.topSignals.join('; ')}`);
    }
    if (s.reconciliation?.verdict === 'fabrication_evidence') {
      fabricated = true;
      console.error(`✗ ${s.name}: FABRICATION EVIDENCE vs AA feed — ${s.reconciliation.summary}`);
    }
  }
  const fraudHigh = report.fraud?.indicators.filter((s) => s.severity === 'high') ?? [];
  for (const s of fraudHigh) {
    console.error(`⚠ fraud indicator: ${s.ruleId} — ${s.note}`);
  }
  if (fabricated) return 4;
  if (tampered) return 3;
  if (failOnFraud && fraudHigh.length > 0) return 5;
  return report.summary.totalTransactions === 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
