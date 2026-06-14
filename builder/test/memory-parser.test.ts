import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseProject } from '../src/parser.js';

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yamlai-'));
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return dir;
}

const MODEL = 'provider: openai\nmodel: gpt-5-mini\n';
const PROMPT = 'You are a test agent.\n';

test('resolves config memory and sets agent flag', () => {
  const dir = makeProject({
    'config.yaml':
      'name: x\nagents: [a]\nstorage: { type: libsql, url: "file:./m.db" }\n' +
      'memory:\n  last_messages: 20\n  semantic_recall:\n    embedder: openai/text-embedding-3-small\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nmemory: true\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  const project = parseProject(dir);
  assert.equal(project.memory?.lastMessages, 20);
  assert.equal(project.memory?.semanticRecall?.embedder, 'openai/text-embedding-3-small');
  assert.equal(project.memory?.semanticRecall?.topK, 4);
  assert.deepEqual(project.memory?.semanticRecall?.messageRange, { before: 1, after: 1 });
  assert.equal(project.agents[0].memory, true);
});

test('config memory defined but unused → project.memory undefined', () => {
  const dir = makeProject({
    'config.yaml':
      'name: x\nagents: [a]\nstorage: { type: libsql, url: "file:./m.db" }\n' +
      'memory:\n  last_messages: 5\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  const project = parseProject(dir);
  assert.equal(project.memory, undefined);
  assert.equal(project.agents[0].memory, false);
});

test('memory: true without config memory block errors', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nstorage: { type: libsql, url: "file:./m.db" }\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nmemory: true\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /no `memory:` block/);
});

test('memory used but no storage errors', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nmemory:\n  last_messages: 5\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nmemory: true\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /requires a `storage` block/);
});
