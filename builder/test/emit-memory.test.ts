import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitMemory } from '../src/codegen/emit-memory.js';
import type { ResolvedMemory } from '../src/types.js';

test('emits history + working memory (no semantic recall)', () => {
  const memory: ResolvedMemory = {
    lastMessages: 10,
    workingMemory: { template: '# Notes\n-' },
  };
  const expected = `import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

export const memory = new Memory({
  storage: new LibSQLStore({ id: 'memory-storage', url: "file:./mastra.db" }),
  options: {
    lastMessages: 10,
    workingMemory: { enabled: true, template: \`# Notes
-\` },
  },
});
`;
  assert.equal(emitMemory(memory, 'file:./mastra.db'), expected);
});

test('emits full memory with semantic recall', () => {
  const memory: ResolvedMemory = {
    lastMessages: 20,
    semanticRecall: {
      embedder: 'openai/text-embedding-3-small',
      topK: 3,
      messageRange: { before: 2, after: 1 },
      scope: 'resource',
    },
    workingMemory: { scope: 'resource', template: '# User Profile\n- Name:' },
  };
  const expected = `import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';

export const memory = new Memory({
  storage: new LibSQLStore({ id: 'memory-storage', url: "file:./mastra.db" }),
  vector: new LibSQLVector({ id: 'memory-vector', url: "file:./mastra.db" }),
  embedder: "openai/text-embedding-3-small",
  options: {
    lastMessages: 20,
    semanticRecall: { topK: 3, messageRange: { before: 2, after: 1 }, scope: "resource" },
    workingMemory: { enabled: true, scope: "resource", template: \`# User Profile
- Name:\` },
  },
});
`;
  assert.equal(emitMemory(memory, 'file:./mastra.db'), expected);
});

test('emits semantic recall with shorthand messageRange number', () => {
  const memory: ResolvedMemory = {
    semanticRecall: { embedder: 'openai/text-embedding-3-small', topK: 4, messageRange: 2 },
  };
  const out = emitMemory(memory, 'file:./mastra.db');
  assert.match(out, /semanticRecall: \{ topK: 4, messageRange: 2 \},/);
});
