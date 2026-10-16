/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { validate, type SchemaNode } from '../src/validator';

const personSchema: SchemaNode = {
  type: 'object',
  required: ['name', 'age'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
    role: { type: 'string', enum: ['admin', 'user'] },
    dob: { type: 'string', format: 'date' },
  },
};

describe('validate', () => {
  it('accepts a conforming object', () => {
    const result = validate(personSchema, {
      name: 'Priya',
      age: 34,
      tags: ['a'],
      role: 'admin',
      dob: '1992-01-01',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing required properties', () => {
    const result = validate(personSchema, { name: 'Priya' });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([{ path: '', message: "missing required property 'age'" }]);
  });

  it('reports type mismatches with paths', () => {
    const result = validate(personSchema, { name: 'Priya', age: 'old' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe('/age');
  });

  it('treats integers as valid numbers', () => {
    const result = validate({ type: 'number' }, 5);
    expect(result.valid).toBe(true);
  });

  it('rejects non-integers where integer is required', () => {
    const result = validate({ type: 'integer' }, 5.5);
    expect(result.valid).toBe(false);
  });

  it('enforces enums', () => {
    const result = validate(personSchema, { name: 'P', age: 1, role: 'root' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('not in enum');
  });

  it('enforces additionalProperties=false', () => {
    const result = validate(personSchema, { name: 'P', age: 1, extra: true });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('extra');
  });

  it('validates nested array items with indexed paths', () => {
    const result = validate(personSchema, { name: 'P', age: 1, tags: ['ok', 5] });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe('/tags/1');
  });

  it('supports union types (string|null)', () => {
    const schema: SchemaNode = { type: ['string', 'null'] };
    expect(validate(schema, 'x').valid).toBe(true);
    expect(validate(schema, null).valid).toBe(true);
    expect(validate(schema, 3).valid).toBe(false);
  });

  it('validates date format', () => {
    const schema: SchemaNode = { type: 'string', format: 'date' };
    expect(validate(schema, '2026-10-15').valid).toBe(true);
    expect(validate(schema, '15-10-2026').valid).toBe(false);
  });

  it('enforces string patterns', () => {
    const schema: SchemaNode = { type: 'string', pattern: '^\\d{4}$' };
    expect(validate(schema, '1234').valid).toBe(true);
    expect(validate(schema, '12').valid).toBe(false);
  });
});
