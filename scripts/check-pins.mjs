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

/**
 * Pin-consistency gate. Catches the drift class that has repeatedly bitten
 * releases: inter-package @paniniapi/* deps left pointing at older versions
 * after a bump, floating ranges, private packages referenced as publish
 * deps, and lockfile resolutions that disagree with package.json.
 *
 * Exits non-zero and prints every violation found.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PACKAGES_DIR = join(ROOT, 'packages');
const SEMVER = /^\d+\.\d+\.\d+$/;

const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

// ── load workspace manifests ────────────────────────────────────────────

const manifests = new Map();
for (const dir of readdirSync(PACKAGES_DIR)) {
  const pkgPath = join(PACKAGES_DIR, dir, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (typeof pkg.name === 'string' && pkg.name.startsWith('@paniniapi/')) {
      manifests.set(pkg.name, { pkg, dir });
    }
  } catch {
    // not a package dir
  }
}
if (manifests.size === 0) fail('check-pins', 'no @paniniapi/* manifests found');

const versionOf = (name) => manifests.get(name)?.pkg.version;

for (const [_name, { pkg, dir }] of manifests) {
  const where = `packages/${dir}`;

  if (!SEMVER.test(pkg.version ?? '')) fail(where, `version '${pkg.version}' is not semver`);
  if (pkg.private === true) fail(where, `private:true blocks publishing`);

  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [dep, range] of Object.entries(pkg[section] ?? {})) {
      if (!dep.startsWith('@paniniapi/')) continue;
      if (!manifests.has(dep)) {
        fail(where, `${section}.${dep} is not a workspace package`);
        continue;
      }
      if (range !== versionOf(dep)) {
        fail(where, `${section}.${dep}@${range} is stale — workspace version is ${versionOf(dep)}`);
      }
      if (!SEMVER.test(range)) fail(where, `${section}.${dep} uses floating range '${range}'`);
    }
  }
}

// ── lockfile agreement ──────────────────────────────────────────────────

try {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const lockPkgs = lock.packages ?? {};

  for (const [name, { dir }] of manifests) {
    const entry = lockPkgs[`packages/${dir}`];
    if (!entry) {
      fail('package-lock.json', `missing workspace entry packages/${dir} — run npm install`);
      continue;
    }
    if (entry.version !== versionOf(name)) {
      fail(
        'package-lock.json',
        `packages/${dir} version ${entry.version} ≠ manifest ${versionOf(name)}`,
      );
    }
    for (const section of ['dependencies', 'devDependencies']) {
      for (const [dep, range] of Object.entries(entry[section] ?? {})) {
        if (!dep.startsWith('@paniniapi/')) continue;
        const want = versionOf(dep);
        if (want !== undefined && range !== want) {
          fail('package-lock.json', `packages/${dir} ${section}.${dep}@${range} ≠ ${want}`);
        }
      }
    }
  }

  // Resolved internal dep copies must match workspace versions too.
  for (const [path, entry] of Object.entries(lockPkgs)) {
    const m = /node_modules\/@paniniapi\/[^/]+$/.exec(path);
    if (!m || entry.link === true) continue;
    const name = `@paniniapi/${path.split('/').pop()}`;
    const want = versionOf(name);
    if (want !== undefined && entry.version !== want) {
      fail('package-lock.json', `${path} resolves ${entry.version} ≠ workspace ${want}`);
    }
  }
} catch {
  fail('package-lock.json', 'unreadable — run npm install');
}

// ── python package version sanity ───────────────────────────────────────

try {
  const pyproject = readFileSync(join(ROOT, 'panini-py', 'pyproject.toml'), 'utf8');
  const m = /^version\s*=\s*"([^"]+)"/m.exec(pyproject);
  if (!m || !SEMVER.test(m[1])) fail('panini-py/pyproject.toml', 'version missing or not semver');
} catch {
  fail('panini-py/pyproject.toml', 'unreadable');
}

// ── verdict ─────────────────────────────────────────────────────────────

if (problems.length > 0) {
  console.error(`check-pins: ${problems.length} violation(s)`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`check-pins: ${manifests.size} packages consistent`);
