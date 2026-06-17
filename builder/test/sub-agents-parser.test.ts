import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseProject } from '../src/parser.js';
import { ParseError } from '../src/errors.js';

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

// A reusable two-agent project where `parent` may reference sub-agents.
function twoAgents(parentAgents: string): Record<string, string> {
  return {
    'config.yaml': 'name: x\nagents: [parent, research-agent]\n',
    'agent/parent.yaml': `name: Parent\ninstructions: p\nmodel: m\n${parentAgents}`,
    'agent/research-agent.yaml': 'name: Research\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  };
}

test('resolves sub-agent references into subAgents with camelCase export names', () => {
  const dir = makeProject(twoAgents('agents: [research-agent]\n'));
  const project = parseProject(dir);
  const parent = project.agents.find((a) => a.id === 'parent');
  assert.ok(parent);
  assert.deepEqual(parent.subAgents, [{ id: 'research-agent', exportName: 'researchAgent' }]);
  // A non-referencing agent gets an empty list.
  const research = project.agents.find((a) => a.id === 'research-agent');
  assert.deepEqual(research?.subAgents, []);
});

test('dedupes repeated sub-agent references by id', () => {
  const dir = makeProject(twoAgents('agents: [research-agent, research-agent]\n'));
  const project = parseProject(dir);
  const parent = project.agents.find((a) => a.id === 'parent');
  assert.deepEqual(parent?.subAgents, [{ id: 'research-agent', exportName: 'researchAgent' }]);
});

test('errors when a sub-agent is not listed in config.yaml', () => {
  const dir = makeProject(twoAgents('agents: [ghost-agent]\n'));
  assert.throws(() => parseProject(dir), /sub-agent not found: ghost-agent/);
});

test('a repeated undeclared sub-agent ref is reported only once', () => {
  const dir = makeProject(twoAgents('agents: [ghost-agent, ghost-agent]\n'));
  assert.throws(
    () => parseProject(dir),
    (err: unknown) => {
      assert.ok(err instanceof ParseError);
      const ghostIssues = err.issues.filter((i) => i.message.includes('sub-agent not found: ghost-agent'));
      assert.equal(ghostIssues.length, 1);
      return true;
    },
  );
});

test('two distinct undeclared sub-agent refs are each reported', () => {
  const dir = makeProject(twoAgents('agents: [ghost-a, ghost-b]\n'));
  assert.throws(
    () => parseProject(dir),
    (err: unknown) => {
      assert.ok(err instanceof ParseError);
      const missing = err.issues.filter((i) => i.message.includes('sub-agent not found'));
      assert.equal(missing.length, 2);
      return true;
    },
  );
});

test('allows a self-reference and flags the agent as lazy', () => {
  const dir = makeProject(twoAgents('agents: [parent]\n'));
  const project = parseProject(dir);
  const parent = project.agents.find((a) => a.id === 'parent');
  assert.ok(parent);
  assert.deepEqual(parent.subAgents, [{ id: 'parent', exportName: 'parent' }]);
  assert.equal(parent.lazyAgents, true);
});

test('allows a two-node cycle and flags both agents as lazy', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a, b]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nagents: [b]\n',
    'agent/b.yaml': 'name: B\ninstructions: p\nmodel: m\nagents: [a]\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  const project = parseProject(dir);
  assert.equal(project.agents.find((x) => x.id === 'a')?.lazyAgents, true);
  assert.equal(project.agents.find((x) => x.id === 'b')?.lazyAgents, true);
});

test('flags only the cyclic component, not acyclic agents that point into it', () => {
  // c -> a -> b -> a : a and b are on the cycle; c merely delegates into it.
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a, b, c]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nagents: [b]\n',
    'agent/b.yaml': 'name: B\ninstructions: p\nmodel: m\nagents: [a]\n',
    'agent/c.yaml': 'name: C\ninstructions: p\nmodel: m\nagents: [a]\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  const project = parseProject(dir);
  assert.equal(project.agents.find((x) => x.id === 'a')?.lazyAgents, true);
  assert.equal(project.agents.find((x) => x.id === 'b')?.lazyAgents, true);
  assert.equal(project.agents.find((x) => x.id === 'c')?.lazyAgents, false);
});

test('a reference to a declared-but-broken agent reports the load failure', () => {
  // `b` is declared in config (so it passes the "must be in config" check) but its
  // file is missing — so it never gets a ref-list. The graph walk must skip the
  // a -> b edge (partial graph) rather than crash, and the missing file is surfaced.
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a, b]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nagents: [b]\n',
    // agent/b.yaml intentionally omitted.
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /agent\/b\.yaml/);
});

test('rejects two agent ids that collapse to the same export name', () => {
  // `research-agent` and `research_agent` both normalise to `researchAgent`,
  // which would emit duplicate imports/identifiers in index.ts.
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [research-agent, research_agent]\n',
    'agent/research-agent.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'agent/research_agent.yaml': 'name: B\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /export name `researchAgent`/);
});

test('rejects a tool id colliding with a sub-agent id within one agent module', () => {
  // tool `research_agent` and sub-agent `research-agent` both -> `researchAgent`,
  // which collide as two imports in the same generated module.
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [parent, research-agent]\n',
    'agent/parent.yaml':
      'name: P\ninstructions: p\nmodel: m\ntools: [research_agent]\nagents: [research-agent]\n',
    'agent/research-agent.yaml': 'name: R\ninstructions: p\nmodel: m\n',
    'tools/research_agent.ts': 'export const researchAgent = {};\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /agent\/parent\.yaml/);
});

test('a self-reference does not trip the module collision check', () => {
  // The self-ref reuses the agent's own export (no import), so `parent` + a
  // `parent` sub-agent is one binding, not a collision.
  const dir = makeProject(twoAgents('agents: [parent]\n'));
  assert.doesNotThrow(() => parseProject(dir));
});

test('rejects a tool id colliding with the reserved `memory` import', () => {
  // A memory-enabled agent emits `import { memory } from '../utils/memory'`; a
  // tool id `memory` would emit a second `memory` binding in the same module.
  const dir = makeProject({
    'config.yaml':
      'name: x\nagents: [parent]\nstorage:\n  type: libsql\n  url: file:./m.db\nmemory:\n  last_messages: 5\n',
    'agent/parent.yaml': 'name: P\ninstructions: p\nmodel: m\nmemory: true\ntools: [memory]\n',
    'tools/memory.ts': 'export const memory = {};\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /export name `memory` is produced by multiple bindings/);
});

test('rejects an agent id colliding with the reserved `Agent` import', () => {
  // An agent id `Agent` collides with `import { Agent } from '@mastra/core/agent'`.
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [Agent]\n',
    'agent/Agent.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /export name `Agent` is produced by multiple bindings/);
});
