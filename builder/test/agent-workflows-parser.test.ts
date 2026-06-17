// builder/test/agent-workflows-parser.test.ts
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

const COMMON = {
  'prompt/p.md': 'hi\n',
  'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
};

test('resolves agent.workflows into ResolvedWorkflowRef and marks acyclic as not lazy', () => {
  // worker attaches flow; flow uses ONLY support-agent (not worker) -> no cycle.
  const dir = makeProject({
    ...COMMON,
    'config.yaml': 'name: x\nagents: [worker, support-agent]\nworkflows: [flow]\n',
    'agent/worker.yaml': 'name: W\ninstructions: p\nmodel: m\nworkflows: [flow]\n',
    'agent/support-agent.yaml': 'name: S\ninstructions: p\nmodel: m\n',
    'workflow/flow.yaml': 'name: F\nsteps:\n  - agent: support-agent\n',
  });
  const worker = parseProject(dir).agents.find((a) => a.id === 'worker')!;
  assert.deepEqual(worker.workflows, [{ id: 'flow', exportName: 'flow' }]);
  assert.equal(worker.lazyWorkflows, false);
});

test('flags an agent on an agent->workflow->agent cycle as lazyWorkflows', () => {
  // worker attaches flow; flow steps back into worker -> cycle.
  const dir = makeProject({
    ...COMMON,
    'config.yaml': 'name: x\nagents: [worker]\nworkflows: [flow]\n',
    'agent/worker.yaml': 'name: W\ninstructions: p\nmodel: m\nworkflows: [flow]\n',
    'workflow/flow.yaml': 'name: F\nsteps:\n  - agent: worker\n',
  });
  const worker = parseProject(dir).agents.find((a) => a.id === 'worker')!;
  assert.equal(worker.lazyWorkflows, true);
});

test('errors when an attached workflow is not declared in config.workflows', () => {
  const dir = makeProject({
    ...COMMON,
    'config.yaml': 'name: x\nagents: [worker]\nworkflows: []\n',
    'agent/worker.yaml': 'name: W\ninstructions: p\nmodel: m\nworkflows: [ghost]\n',
  });
  assert.throws(() => parseProject(dir), /workflow not found: ghost/);
});

test('rejects an attached-workflow import colliding with a tool import in the agent module', () => {
  // tool `loop_flow` and workflow `loop-flow` both -> loopFlow in worker's module.
  const dir = makeProject({
    ...COMMON,
    'config.yaml': 'name: x\nagents: [worker, support-agent]\nworkflows: [loop-flow]\n',
    'agent/worker.yaml': 'name: W\ninstructions: p\nmodel: m\ntools: [loop_flow]\nworkflows: [loop-flow]\n',
    'agent/support-agent.yaml': 'name: S\ninstructions: p\nmodel: m\n',
    'tools/loop_flow.ts': 'export const loopFlow = {};\n',
    'workflow/loop-flow.yaml': 'name: F\nsteps:\n  - agent: support-agent\n',
  });
  assert.throws(() => parseProject(dir), /export name `loopFlow` is produced by multiple bindings/);
});
