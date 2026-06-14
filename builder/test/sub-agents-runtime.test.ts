import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseProject } from '../src/parser.js';
import { generateProject } from '../src/codegen/generate.js';

const MODEL = 'provider: openai\nmodel: gpt-5-mini\n';
const PROMPT = 'hi\n';

function write(dir: string, rel: string, content: string): void {
  const dest = join(dir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}

/** Generate a project to disk and stub `@mastra/core/agent` so the emitted agent
 *  modules can actually be imported. We only need `Agent` to exist; the thunk it
 *  receives is not called at construction — so loading exercises ESM evaluation
 *  order (the TDZ / duplicate-identifier hazards), not Mastra behavior. */
function generateToDisk(files: Record<string, string>): string {
  const input = mkdtempSync(join(tmpdir(), 'yamlai-rt-in-'));
  for (const [rel, content] of Object.entries(files)) write(input, rel, content);

  const project = parseProject(input);
  const out = mkdtempSync(join(tmpdir(), 'yamlai-rt-out-'));
  for (const [rel, content] of Object.entries(generateProject(project, input))) {
    if (rel.startsWith('src/mastra/agents/')) write(out, rel, content);
  }
  // Stub package: `import { Agent } from '@mastra/core/agent'` records its config
  // and exposes it so the test can invoke the lazy `agents` thunk.
  write(
    out,
    'node_modules/@mastra/core/package.json',
    JSON.stringify({ name: '@mastra/core', version: '0.0.0', exports: { './agent': './agent.js' } }),
  );
  write(
    out,
    'node_modules/@mastra/core/agent.js',
    'export class Agent { constructor(config) { this.id = config?.id; this.config = config; } }\n',
  );
  return out;
}

const importAgent = (out: string, id: string) =>
  import(pathToFileURL(join(out, `src/mastra/agents/${id}.ts`)).href);

test('a self-referencing agent loads at runtime and its thunk resolves itself', async () => {
  const out = generateToDisk({
    'config.yaml': 'name: x\nagents: [solo]\n',
    'agent/solo.yaml': 'name: Solo\ninstructions: p\nmodel: m\nagents: [solo]\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  const mod = await importAgent(out, 'solo'); // would throw on TDZ / duplicate id
  assert.equal(mod.solo.id, 'solo');
  // The lazy thunk, called after init, returns the real (initialized) binding.
  const delegated = mod.solo.config.agents();
  assert.equal(delegated.solo.id, 'solo');
  assert.equal(delegated.solo, mod.solo);
});

test('a mixed self+cross cyclic agent and its acyclic caller all load at runtime', async () => {
  // a -> [a, b] (self + cross), b -> a (back-edge), lonely -> a (acyclic into the cycle).
  const out = generateToDisk({
    'config.yaml': 'name: x\nagents: [a, b, lonely]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nagents: [a, b]\n',
    'agent/b.yaml': 'name: B\ninstructions: p\nmodel: m\nagents: [a]\n',
    'agent/lonely.yaml': 'name: L\ninstructions: p\nmodel: m\nagents: [a]\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  const a = await importAgent(out, 'a');
  const lonely = await importAgent(out, 'lonely');
  assert.equal(a.a.id, 'a');
  assert.equal(lonely.lonely.id, 'lonely');

  // a's thunk resolves both the self-reference and the cross-edge to live agents.
  const aDelegates = a.a.config.agents();
  assert.equal(aDelegates.a.id, 'a');
  assert.equal(aDelegates.b.id, 'b');
  // lonely delegates statically into the cycle; its target is the same `a` instance.
  assert.equal(lonely.lonely.config.agents.a, a.a);
});
