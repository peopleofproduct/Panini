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

/**
 * A deliberately small, dependency-free subset of JSON Schema sufficient for
 * validating financial payloads. Supported keywords: `type`, `properties`,
 * `required`, `additionalProperties`, `items`, `enum`, `const`, `pattern`,
 * `format` ('date' | 'date-time'), `minimum`, `maximum`, `minLength`,
 * `maxLength`, `minItems`, `maxItems`.
 */
export interface SchemaNode {
  readonly type?: string | readonly string[];
  readonly properties?: Record<string, SchemaNode>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: SchemaNode;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly pattern?: string;
  readonly format?: 'date' | 'date-time';
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ValidationError {
  /** JSON pointer-style path to the offending value, e.g. `/items/2/amount`. */
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

function matchesType(expected: string, actual: string): boolean {
  // 'integer' values also satisfy 'number'.
  if (expected === 'number' && actual === 'integer') return true;
  return expected === actual;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function validateNode(
  schema: SchemaNode,
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  const actual = typeOf(value);

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((t) => matchesType(t, actual))) {
      errors.push({ path, message: `expected type ${allowed.join('|')}, got ${actual}` });
      return; // deeper checks are meaningless on a type mismatch
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ path, message: `expected constant ${JSON.stringify(schema.const)}` });
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push({ path, message: `value ${JSON.stringify(value)} not in enum` });
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `string shorter than minLength ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `string longer than maxLength ${schema.maxLength}` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `string does not match pattern ${schema.pattern}` });
    }
    if (schema.format === 'date' && !DATE_RE.test(value)) {
      errors.push({ path, message: `expected ISO date (YYYY-MM-DD), got '${value}'` });
    }
    if (schema.format === 'date-time' && !DATETIME_RE.test(value)) {
      errors.push({ path, message: `expected ISO date-time, got '${value}'` });
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `number below minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `number above maximum ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path, message: `array shorter than minItems ${schema.minItems}` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path, message: `array longer than maxItems ${schema.maxItems}` });
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => validateNode(schema.items!, item, `${path}/${i}`, errors));
    }
  }

  if (isRecord(value)) {
    if (schema.required !== undefined) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push({ path, message: `missing required property '${key}'` });
        }
      }
    }
    if (schema.properties !== undefined) {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (key in value) validateNode(child, value[key], `${path}/${key}`, errors);
      }
    }
    if (schema.additionalProperties === false && schema.properties !== undefined) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) {
          errors.push({ path, message: `unexpected property '${key}'` });
        }
      }
    }
  }
}

/** Validates `value` against `schema`, collecting all violations. */
export function validate(schema: SchemaNode, value: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  validateNode(schema, value, '', errors);
  return { valid: errors.length === 0, errors };
}
