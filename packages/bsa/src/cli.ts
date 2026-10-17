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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { analyzeStatementFiles } from './pipeline';
import { renderMarkdown } from './render';

const HELP = `panini-bsa — Bank Statement Analysis in a box

Usage:
  panini-bsa <files...> [options]

Options:
  -o, --out <dir>       Output directory (default: ./bsa-report)
  --bank <id>           Bank hint applied to all files
  --password <pw>       Password applied to protected PDFs
  --no-enrich           Skip narration enrichment (faster, coarser report)
  -h, --help            Show this help

Outputs: bsa-report.json + bsa-report.md. All analysis is local —
no data leaves this process.`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    console.log(HELP);
    return args.length === 0 ? 1 : 0;
  }

  const files: { name: string; data: Uint8Array }[] = [];
  let outDir = './bsa-report';
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
  for (const s of report.statements) {
    if (s.warnings.length > 0) console.warn(`⚠ ${s.name}: ${s.warnings.length} warning(s)`);
  }
  return report.summary.totalTransactions === 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
