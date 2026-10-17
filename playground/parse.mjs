#!/usr/bin/env node
/**
 * Copyright 2026 Kapil — Project Panini Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Terminal playground: `npm run parse -- "UPI/20261015/DR/123456/SWIGGY/okaxis/"`
 * With --repl it reads narrations from stdin, one JSON result per line.
 */
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);
const { parseBankNarration } = require('../packages/rules-engine/dist/index.js');

const args = process.argv.slice(2);

if (args[0] === '--repl') {
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (line.trim().length === 0) return;
    try {
      console.log(JSON.stringify(parseBankNarration(line.trim())));
    } catch (err) {
      console.log(JSON.stringify({ error: String(err) }));
    }
  });
} else {
  const text = args.join(' ');
  if (text.length === 0) {
    console.error(
      'usage: npm run parse -- "<narration or sms>"  |  npm run parse -- --repl < input.txt',
    );
    process.exit(1);
  }
  console.log(JSON.stringify(parseBankNarration(text), null, 2));
}
