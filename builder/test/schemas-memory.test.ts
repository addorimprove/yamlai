import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemorySchema, AgentSchema, ConfigSchema } from '../src/schemas.js';

test('MemorySchema fills semantic_recall defaults when block present', () => {
  const parsed = MemorySchema.parse({
    semantic_recall: { embedder: 'openai/text-embedding-3-small' },
  });
  assert.equal(parsed.semantic_recall?.top_k, 4);
  assert.deepEqual(parsed.semantic_recall?.message_range, { before: 1, after: 1 });
});

test('MemorySchema accepts message_range shorthand number', () => {
  const parsed = MemorySchema.parse({
    semantic_recall: { embedder: 'x', message_range: 2 },
  });
  assert.equal(parsed.semantic_recall?.message_range, 2);
});

test('MemorySchema rejects semantic_recall without embedder', () => {
  assert.throws(() => MemorySchema.parse({ semantic_recall: { top_k: 2 } }));
});

test('MemorySchema treats bare working_memory (null) as enabled block', () => {
  const parsed = MemorySchema.parse({ working_memory: null });
  assert.deepEqual(parsed.working_memory, {});
});

test('AgentSchema defaults memory to false', () => {
  const parsed = AgentSchema.parse({ name: 'A', instructions: 'p', model: 'm' });
  assert.equal(parsed.memory, false);
});

test('ConfigSchema accepts optional memory block', () => {
  const parsed = ConfigSchema.parse({
    name: 'x',
    agents: ['a'],
    storage: { type: 'libsql', url: 'file:./m.db' },
    memory: { last_messages: 10 },
  });
  assert.equal(parsed.memory?.last_messages, 10);
});
