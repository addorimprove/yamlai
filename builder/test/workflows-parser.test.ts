// builder/test/workflows-parser.test.ts
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
const TOOL = "import { createTool } from '@mastra/core/tools';\nexport const x = {};\n";

// Two agents + the two tools, with a `workflows:` config list the caller supplies.
function base(workflows: string): Record<string, string> {
  return {
    'config.yaml': `name: x\nagents: [research-agent, support-agent]\nworkflows: [${workflows}]\n`,
    'agent/research-agent.yaml': 'name: R\ninstructions: p\nmodel: m\n',
    'agent/support-agent.yaml': 'name: S\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
    'tools/rephrase.ts': TOOL,
    'tools/merge-answers.ts': TOOL,
  };
}

test('resolves a sequential workflow with agent + tool steps', () => {
  const dir = makeProject({
    ...base('research-flow'),
    'workflow/research-flow.yaml':
      'name: Research Flow\ninput: { prompt: string }\noutput: { text: string }\n' +
      'steps:\n  - agent: research-agent\n  - tool: rephrase\n  - agent: support-agent\n',
  });
  const project = parseProject(dir);
  assert.equal(project.workflows.length, 1);
  const wf = project.workflows[0];
  assert.equal(wf.exportName, 'researchFlow');
  assert.equal(wf.inputZod, 'z.object({ prompt: z.string() })');
  assert.deepEqual(wf.steps.map((s) => s.kind), ['agent', 'tool', 'agent']);
  assert.deepEqual(wf.agents.map((a) => a.id).sort(), ['research-agent', 'support-agent']);
  assert.deepEqual(wf.tools.map((t) => t.id), ['rephrase']);
});

test('resolves a parallel workflow and dedupes referenced agents/tools', () => {
  const dir = makeProject({
    ...base('compare-answers'),
    'workflow/compare-answers.yaml':
      'name: Compare\ninput: { prompt: string }\noutput: { comparison: string }\n' +
      'steps:\n  - parallel:\n      - agent: research-agent\n      - agent: support-agent\n  - tool: merge-answers\n',
  });
  const wf = parseProject(dir).workflows[0];
  assert.equal(wf.steps[0].kind, 'parallel');
  assert.equal(wf.steps[0].children?.length, 2);
  assert.deepEqual(wf.tools.map((t) => t.id), ['merge-answers']);
});

test('errors when a workflow file is missing', () => {
  const dir = makeProject(base('ghost-flow'));
  assert.throws(() => parseProject(dir), /workflow\/ghost-flow\.yaml/);
});

test('errors on an unresolved agent ref', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'name: B\nsteps:\n  - agent: nobody\n',
  });
  assert.throws(() => parseProject(dir), /agent not found: nobody/);
});

test('errors on an unresolved tool ref', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'name: B\nsteps:\n  - tool: nope\n',
  });
  assert.throws(() => parseProject(dir), /tool not found: tools\/nope\.ts/);
});

test('errors when a step has neither agent/tool/parallel or more than one', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'name: B\nsteps:\n  - agent: research-agent\n    tool: rephrase\n',
  });
  assert.throws(() => parseProject(dir), /step 1 must have exactly one of/);
});

test('errors when a parallel block has fewer than 2 children', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'name: B\nsteps:\n  - parallel:\n      - agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /needs at least 2 steps/);
});

test('errors when a parallel block lists the same agent/tool twice', () => {
  // Mastra keys parallel results by step id (the agent/tool id), so two children
  // with the same id silently overwrite each other — reject it at parse time.
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml':
      'steps:\n  - parallel:\n      - agent: research-agent\n      - agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /duplicate step `research-agent`/);
});

test('errors on an unsupported input field type', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'name: B\ninput: { when: date }\nsteps:\n  - agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /input\.when: unknown primitive `date`/);
});

test('rejects a workflow id colliding with an agent id at registry scope', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [research-agent]\nworkflows: [research_agent]\n',
    'agent/research-agent.yaml': 'name: R\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
    'workflow/research_agent.yaml': 'name: W\nsteps:\n  - agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /export name `researchAgent` is produced by multiple bindings/);
});

test('a non-workflow project still parses (empty workflows list)', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [research-agent]\n',
    'agent/research-agent.yaml': 'name: R\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.deepEqual(parseProject(dir).workflows, []);
});
