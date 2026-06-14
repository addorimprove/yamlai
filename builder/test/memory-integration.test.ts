import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseProject } from '../src/parser.js';
import { generateProject } from '../src/codegen/generate.js';

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yamlai-'));
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return dir;
}

test('generates utils/memory.ts and wires the agent + dependency', () => {
  const dir = makeProject({
    'config.yaml':
      'name: x\nagents: [support-agent]\nstorage: { type: libsql, url: "file:./mastra.db" }\n' +
      'memory:\n  last_messages: 20\n  semantic_recall:\n    embedder: openai/text-embedding-3-small\n',
    'agent/support-agent.yaml': 'name: Support\ninstructions: p\nmodel: m\nmemory: true\n',
    'prompt/p.md': 'You are support.\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
  });
  const project = parseProject(dir);
  const files = generateProject(project, dir);

  assert.ok(files['src/mastra/utils/memory.ts'], 'memory module emitted');
  assert.match(files['src/mastra/utils/memory.ts'], /export const memory = new Memory\(\{/);
  assert.match(files['src/mastra/agents/support-agent.ts'], /import \{ memory \} from '\.\.\/utils\/memory';/);
  assert.match(files['package.json'], /"@mastra\/memory":/);
});

test('no memory module or dependency when unused', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nstorage: { type: libsql, url: "file:./mastra.db" }\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
  });
  const files = generateProject(parseProject(dir), dir);
  assert.equal(files['src/mastra/utils/memory.ts'], undefined);
  assert.doesNotMatch(files['package.json'], /@mastra\/memory/);
});
