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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate, type SchemaNode, type ValidationResult } from './validator';

function resolveSchemasDir(): string {
  // Covers: src/ under ts-jest, dist/ if schemas are copied during build,
  // and the published layout where src/schemas ships alongside dist/.
  const candidates = [
    join(__dirname, 'schemas'),
    join(__dirname, '..', 'src', 'schemas'),
    join(__dirname, '..', 'schemas'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    `@panini/standards-schema: could not locate bundled schemas directory. Checked: ${candidates.join(', ')}`,
  );
}

/** Loads a bundled schema by name (without the `.schema.json` suffix). */
export function loadSchema(name: string): SchemaNode {
  const file = join(resolveSchemasDir(), `${name}.schema.json`);
  if (!existsSync(file)) {
    throw new Error(`@panini/standards-schema: unknown schema '${name}'`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as SchemaNode;
}

/** Lists the names of all bundled schemas. */
export function listSchemas(): readonly string[] {
  return readdirSync(resolveSchemasDir())
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => f.replace(/\.schema\.json$/, ''))
    .sort();
}

/** Validates a payload against a bundled schema by name. */
export function validateAgainst(name: string, value: unknown): ValidationResult {
  return validate(loadSchema(name), value);
}
