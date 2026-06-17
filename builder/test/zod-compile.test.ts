// builder/test/zod-compile.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileZodObject } from '../src/zod-compile.js';

test('compiles each supported primitive form', () => {
  const { expr, errors } = compileZodObject({
    prompt: 'string',
    count: 'number',
    done: 'boolean',
    mode: ['fast', 'deep'],
    tags: 'string[]',
    note: 'string?',
    nums: 'number[]?',
  });
  assert.deepEqual(errors, []);
  assert.equal(
    expr,
    "z.object({ prompt: z.string(), count: z.number(), done: z.boolean(), " +
      "mode: z.enum([\"fast\", \"deep\"]), tags: z.array(z.string()), " +
      "note: z.string().optional(), nums: z.array(z.number()).optional() })",
  );
});

test('empty object compiles to z.object({})', () => {
  assert.equal(compileZodObject({}).expr, 'z.object({})');
});

test('quotes keys that are not valid JS identifiers', () => {
  assert.equal(compileZodObject({ 'a-b': 'string' }).expr, 'z.object({ "a-b": z.string() })');
});

test('reports unknown primitive and non-string field, keeps other fields', () => {
  const { expr, errors } = compileZodObject({ ok: 'string', bad: 'date', nope: 42 });
  assert.equal(expr, 'z.object({ ok: z.string() })');
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /bad: unknown primitive `date`/);
  assert.match(errors.join('\n'), /nope: unsupported field type/);
});

test('reports empty and non-string enums', () => {
  assert.match(compileZodObject({ e: [] }).errors[0], /enum must have at least one value/);
  assert.match(compileZodObject({ e: [1, 2] }).errors[0], /enum values must be strings/);
});
