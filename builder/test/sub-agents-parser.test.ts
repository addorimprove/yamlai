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

test('errors when a sub-agent is not listed in config.yaml', () => {
  const dir = makeProject(twoAgents('agents: [ghost-agent]\n'));
  assert.throws(() => parseProject(dir), /sub-agent not found: ghost-agent/);
});

test('errors on a self-reference', () => {
  const dir = makeProject(twoAgents('agents: [parent]\n'));
  assert.throws(() => parseProject(dir), /circular sub-agent reference: parent -> parent/);
});

test('errors on a two-node cycle', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a, b]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nagents: [b]\n',
    'agent/b.yaml': 'name: B\ninstructions: p\nmodel: m\nagents: [a]\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /circular sub-agent reference: a -> b -> a/);
});

test('detects a cycle in a graph with multiple independent components', () => {
  // Two disjoint sub-graphs: a -> b (acyclic) and c -> d -> c (cyclic). The DFS
  // must keep scanning past the acyclic component and report the c/d cycle.
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a, b, c, d]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nagents: [b]\n',
    'agent/b.yaml': 'name: B\ninstructions: p\nmodel: m\n',
    'agent/c.yaml': 'name: C\ninstructions: p\nmodel: m\nagents: [d]\n',
    'agent/d.yaml': 'name: D\ninstructions: p\nmodel: m\nagents: [c]\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /circular sub-agent reference: c -> d -> c/);
});

test('a reference to a declared-but-broken agent reports the load failure, not a false cycle', () => {
  // `b` is declared in config (so it passes the "must be in config" check) but its
  // file is missing — so it never gets a ref-list. The cycle detector must skip the
  // a -> b edge (partial graph) rather than crash or misreport, and the missing file
  // is surfaced as the failure.
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a, b]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\nagents: [b]\n',
    // agent/b.yaml intentionally omitted.
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), (err) => {
    const msg = String(err);
    assert.match(msg, /agent\/b\.yaml/);
    assert.doesNotMatch(msg, /circular sub-agent reference/);
    return true;
  });
});
