#!/usr/bin/env node
/**
 * Panini public benchmark suite — reproducible accuracy receipts.
 *
 *   node benchmarks/run.mjs          # run + write results/latest.json & BENCHMARKS.md
 *   node benchmarks/run.mjs --ci     # run + exit 1 on any threshold regression
 *
 * Requires compiled dist: `npm run build` first.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CI = process.argv.includes('--ci');

const CLEAN_SEEDS = [11, 22, 33, 44, 55];
const ANOMALY_SEEDS = [101, 202, 303];
const TXNS_PER_STATEMENT = 40;
const ANOMALY_RATE = 0.15;

function load(pkg) {
  const p = path.join(ROOT, 'packages', pkg, 'dist', 'index.js');
  if (!fs.existsSync(p)) {
    console.error(`benchmarks: dist missing for @paniniapi/${pkg} — run \`npm run build\` first`);
    process.exit(2);
  }
  return require(p);
}

const { generateCsvStatement, STATEMENT_SPECS } = load('simulator');
const { extractCsvStatement, loadCsvLayouts } = load('extract');
const LAYOUTS = loadCsvLayouts();
const { loadCorpus, checkSample, coverageReport, parseBankNarration } = load('rules-engine');
const { analyzeTransactions } = load('insights');

// ---------- section 1: extraction accuracy (clean rows) ----------
// Threshold: 100% exact field match — generated rows carry ground truth,
// so anything less is a real parser regression.

const extraction = [];
let extractionFailures = 0;

for (const spec of STATEMENT_SPECS) {
  let expected = 0;
  let extracted = 0;
  let exactRows = 0;
  let amountOk = 0;
  let dateOk = 0;
  let dirOk = 0;
  let balOk = 0;
  let refOk = 0;
  let refExpected = 0;
  let layoutHits = 0;

  for (const seed of CLEAN_SEEDS) {
    const stmt = generateCsvStatement(spec, { seed, transactions: TXNS_PER_STATEMENT });
    const res = extractCsvStatement(stmt.text, LAYOUTS);
    if (res.layoutId === spec.layoutId) layoutHits++;
    expected += stmt.rows.length;
    extracted += res.transactions.length;

    for (const [i, row] of stmt.rows.entries()) {
      const txn = res.transactions[i];
      if (!txn) break;
      const okAmount = txn.amountPaise === row.amountPaise;
      const okDate = txn.date === row.date;
      const okDir = txn.direction === row.direction;
      const okBal = txn.balancePaise === row.balancePaise;
      if (okAmount) amountOk++;
      if (okDate) dateOk++;
      if (okDir) dirOk++;
      if (okBal) balOk++;
      if (row.refNo !== null) {
        refExpected++;
        if (txn.refNo === row.refNo) refOk++;
      }
      if (okAmount && okDate && okDir && okBal) exactRows++;
    }
  }

  const pct = (n) => (expected === 0 ? 0 : +((n / expected) * 100).toFixed(2));
  const row = {
    layout: spec.layoutId,
    bank: spec.bank,
    statements: CLEAN_SEEDS.length,
    rows_expected: expected,
    rows_extracted: extracted,
    exact_rows_pct: pct(exactRows),
    amount_pct: pct(amountOk),
    date_pct: pct(dateOk),
    direction_pct: pct(dirOk),
    balance_pct: pct(balOk),
    refno_pct: refExpected === 0 ? null : +((refOk / refExpected) * 100).toFixed(2),
    layout_detect_pct: +((layoutHits / CLEAN_SEEDS.length) * 100).toFixed(2),
  };
  if (row.rows_extracted !== expected || row.exact_rows_pct !== 100) extractionFailures++;
  extraction.push(row);
}

// ---------- section 2: anomaly safety ----------
// Threshold: zero crashes, never over-extract past clean row count.

let anomalyStatements = 0;
let anomalyCrashes = 0;
let overExtracted = 0;
let anomalyWarnings = 0;

for (const spec of STATEMENT_SPECS) {
  for (const seed of ANOMALY_SEEDS) {
    const stmt = generateCsvStatement(spec, {
      seed,
      transactions: TXNS_PER_STATEMENT,
      anomalyRate: ANOMALY_RATE,
    });
    anomalyStatements++;
    let res;
    try {
      res = extractCsvStatement(stmt.text, LAYOUTS);
    } catch {
      anomalyCrashes++;
      continue;
    }
    if (res.transactions.length > stmt.rows.length) overExtracted++;
    if (res.warnings.length > 0) anomalyWarnings++;
  }
}

const anomalies = {
  statements: anomalyStatements,
  crashes: anomalyCrashes,
  over_extraction: overExtracted,
  statements_with_warnings: anomalyWarnings,
};

// ---------- section 3: narration intelligence ----------
// Threshold: zero checkSample failures against the shipped corpus.

const corpus = loadCorpus();
let samplesTotal = 0;
let samplesFailed = 0;
let enriched = 0;
let categorized = 0;

for (const file of corpus) {
  for (const sample of file.samples) {
    samplesTotal++;
    if (checkSample(sample).length > 0) samplesFailed++;
    const parsed = parseBankNarration(sample.input, file.bank);
    if (parsed.counterparty !== null || parsed.merchant !== null) enriched++;
    if (parsed.category !== 'Uncategorized') categorized++;
  }
}

const narration = {
  corpus_files: corpus.length,
  samples: samplesTotal,
  sample_pass_pct: +(((samplesTotal - samplesFailed) / samplesTotal) * 100).toFixed(2),
  counterparty_or_merchant_pct: +((enriched / samplesTotal) * 100).toFixed(2),
  categorized_pct: +((categorized / samplesTotal) * 100).toFixed(2),
  per_bank: coverageReport().map((r) => ({
    bank: r.bank,
    samples: r.total,
    matched: r.ruleMatched,
    passed: r.passed,
    avg_confidence: +r.avgConfidence.toFixed(3),
  })),
};

// ---------- section 4: insights determinism ----------

const detStmt = generateCsvStatement(STATEMENT_SPECS[0], { seed: 7, transactions: 60 });
const insightInput = detStmt.rows.map((r) => ({
  date: r.date,
  direction: r.direction,
  amountPaise: r.amountPaise,
  balancePaise: r.balancePaise,
  narration: r.narration,
  refNo: r.refNo,
}));
const t0 = performance.now();
const reportA = analyzeTransactions(insightInput);
const reportB = analyzeTransactions(insightInput);
const insightsMs = +(performance.now() - t0).toFixed(1);
const insights = {
  transactions: insightInput.length,
  deterministic: JSON.stringify(reportA) === JSON.stringify(reportB),
  rule_hits: reportA.signals.length + reportA.income.sources.length,
  runtime_ms: insightsMs,
};

// ---------- report ----------

const meta = {
  generated_at: new Date().toISOString(),
  git_sha: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(),
  node: process.version,
  packages: Object.fromEntries(
    ['core', 'rules-engine', 'standards-schema', 'extract', 'insights', 'simulator'].map((p) => [
      p,
      JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', p, 'package.json'), 'utf8')).version,
    ]),
  ),
};

const results = { meta, extraction, anomalies, narration, insights };

// console table
const line = '-'.repeat(96);
console.log(`\nPANINI BENCHMARKS — ${meta.git_sha} — ${meta.generated_at}\n`);
console.log('layout        rows  extracted  exact%  amount%  date%  dir%  bal%  ref%  layout%');
console.log(line);
for (const r of extraction) {
  console.log(
    `${r.layout.padEnd(12)} ${String(r.rows_expected).padStart(5)} ${String(r.rows_extracted).padStart(9)}` +
      ` ${String(r.exact_rows_pct).padStart(7)} ${String(r.amount_pct).padStart(8)} ${String(r.date_pct).padStart(6)}` +
      ` ${String(r.direction_pct).padStart(5)} ${String(r.balance_pct).padStart(5)} ${String(r.refno_pct ?? '—').padStart(5)} ${String(r.layout_detect_pct).padStart(8)}`,
  );
}
console.log(line);
console.log(
  `anomalies: ${anomalies.statements} stmts · ${anomalies.crashes} crashes · ${anomalies.over_extraction} over-extractions\n` +
    `narration: ${narration.samples} samples · ${narration.sample_pass_pct}% corpus pass · ` +
    `${narration.counterparty_or_merchant_pct}% counterparty/merchant · ${narration.categorized_pct}% categorized\n` +
    `insights: deterministic=${insights.deterministic} · ${insights.transactions} txns in ${insights.runtime_ms}ms`,
);

// persist
if (!CI) {
  const resultsDir = path.join(HERE, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'latest.json'), JSON.stringify(results, null, 2) + '\n');

  const docPath = path.join(HERE, 'BENCHMARKS.md');
  const BEGIN = '<!-- BEGIN RESULTS -->';
  const END = '<!-- END RESULTS -->';
  const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
  const block =
    `${BEGIN}\n_Generated ${meta.generated_at} · commit ${meta.git_sha} · node ${meta.node}_\n\n` +
    '| Layout | Rows | Exact % | Amount % | Date % | Dir % | Balance % | Layout detect % |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    extraction
      .map(
        (r) =>
          `| ${r.layout} | ${r.rows_expected} | ${r.exact_rows_pct} | ${r.amount_pct} | ${r.date_pct} | ${r.direction_pct} | ${r.balance_pct} | ${r.layout_detect_pct} |`,
      )
      .join('\n') +
    `\n\nNarration corpus: **${narration.sample_pass_pct}%** of ${narration.samples} samples pass field-level checks; ` +
    `${narration.counterparty_or_merchant_pct}% resolve a counterparty/merchant; ${narration.categorized_pct}% categorize. ` +
    `Anomaly safety: ${anomalies.crashes} crashes, ${anomalies.over_extraction} over-extractions across ${anomalies.statements} corrupted statements. ` +
    `Insights: deterministic=${insights.deterministic}.\n${END}`;
  if (doc.includes(BEGIN)) {
    fs.writeFileSync(docPath, doc.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), block));
  } else {
    fs.writeFileSync(docPath, `${doc.trimEnd()}\n\n${block}\n`);
  }
  console.log('\nwrote benchmarks/results/latest.json + BENCHMARKS.md results block');
}

// ---------- ci gate ----------
const gate = [
  ['extraction: every layout parses all clean rows exactly', extractionFailures === 0],
  ['anomalies: zero crashes', anomalies.crashes === 0],
  ['anomalies: zero over-extractions', anomalies.over_extraction === 0],
  ['narration: zero corpus sample failures', samplesFailed === 0],
  ['insights: deterministic', insights.deterministic],
];
if (CI) {
  let fail = false;
  for (const [name, ok] of gate) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) fail = true;
  }
  process.exit(fail ? 1 : 0);
}
