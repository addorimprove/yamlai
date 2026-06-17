// builder/test/schemas-strict.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigSchema,
  AgentSchema,
  ModelSchema,
  WorkflowSchema,
  MemorySchema,
} from '../src/schemas.js';

function unknownKeyIssue(result: { success: boolean; error?: any }): boolean {
  return (
    result.success === false &&
    result.error.issues.some((i: any) => i.code === 'unrecognized_keys')
  );
}

test('ConfigSchema rejects an unknown top-level key', () => {
  const r = ConfigSchema.safeParse({ name: 'x', agents: ['a'], agnets: ['typo'] });
  assert.ok(unknownKeyIssue(r), 'expected unrecognized_keys issue');
});

test('AgentSchema rejects an unknown key', () => {
  const r = AgentSchema.safeParse({
    name: 'A',
    instructions: 'p',
    model: 'm',
    instuctions: 'typo',
  });
  assert.ok(unknownKeyIssue(r));
});

test('ModelSchema rejects an unknown key', () => {
  const r = ModelSchema.safeParse({ provider: 'openai', model: 'gpt', temprature: 1 });
  assert.ok(unknownKeyIssue(r));
});

test('WorkflowSchema rejects a stray `name` key', () => {
  const r = WorkflowSchema.safeParse({ name: 'W', steps: [{ agent: 'a' }] });
  assert.ok(unknownKeyIssue(r));
});

test('WorkflowSchema rejects an unknown key inside a step', () => {
  const r = WorkflowSchema.safeParse({ steps: [{ agent: 'a', tul: 'typo' }] });
  assert.ok(unknownKeyIssue(r));
});

test('MemorySchema rejects an unknown key (strict through preprocess)', () => {
  const r = MemorySchema.safeParse({ last_messages: 5, last_mesages: 9 });
  assert.ok(unknownKeyIssue(r));
});

test('MemorySchema rejects an unknown key inside semantic_recall (nested strict)', () => {
  const r = MemorySchema.safeParse({ semantic_recall: { embedder: 'e', tpo_k: 5 } });
  assert.ok(unknownKeyIssue(r));
});
