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
      'input: { prompt: string }\noutput: { text: string }\n' +
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
      'input: { prompt: string }\noutput: { comparison: string }\n' +
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
    'workflow/bad.yaml': 'steps:\n  - agent: nobody\n',
  });
  assert.throws(() => parseProject(dir), /agent not found: nobody/);
});

test('errors on an unresolved tool ref', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'steps:\n  - tool: nope\n',
  });
  assert.throws(() => parseProject(dir), /tool not found: tools\/nope\.ts/);
});

test('errors when a step has neither agent/tool/parallel or more than one', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'steps:\n  - agent: research-agent\n    tool: rephrase\n',
  });
  assert.throws(() => parseProject(dir), /step 1 must have exactly one of/);
});

test('errors when a parallel block has fewer than 2 children', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'steps:\n  - parallel:\n      - agent: research-agent\n',
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
    'workflow/bad.yaml': 'input: { when: date }\nsteps:\n  - agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /input\.when: unknown primitive `date`/);
});

test('rejects a workflow id colliding with an agent id at registry scope', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [research-agent]\nworkflows: [research_agent]\n',
    'agent/research-agent.yaml': 'name: R\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
    'workflow/research_agent.yaml': 'steps:\n  - agent: research-agent\n',
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

test('resolves a step leaf and records it for copy', () => {
  const dir = makeProject({
    ...base('flow'),
    'workflow/steps/rephrase.ts': "import { createStep } from '@mastra/core/workflows';\nexport const rephrase = {};\n",
    'workflow/flow.yaml':
      'input: { prompt: string }\noutput: { text: string }\n' +
      'steps:\n  - agent: research-agent\n  - step: rephrase\n  - agent: support-agent\n',
  });
  const wf = parseProject(dir).workflows[0];
  assert.deepEqual(wf.steps.map((s) => s.kind), ['agent', 'step', 'agent']);
  assert.deepEqual(wf.stepFiles.map((s) => s.id), ['rephrase']);
});

test('errors on an unresolved step ref', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'steps:\n  - step: ghost\n',
  });
  assert.throws(() => parseProject(dir), /step not found: workflow\/steps\/ghost\.ts/);
});

test('errors when a leaf has more than one of agent/tool/step', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/steps/rephrase.ts': 'export const rephrase = {};\n',
    'workflow/bad.yaml': 'steps:\n  - tool: rephrase\n    step: rephrase\n',
  });
  assert.throws(() => parseProject(dir), /must have exactly one of/);
});

test('resolves a single-leaf until loop: body + condition file', () => {
  const dir = makeProject({
    ...base('flow'),
    'workflow/condition/good-enough.ts': 'export const goodEnough = async () => true;\n',
    'workflow/flow.yaml':
      'steps:\n  - agent: research-agent\n  - loop:\n      until: good-enough\n      agent: support-agent\n      max_iterations: 4\n',
  });
  const wf = parseProject(dir).workflows[0];
  assert.deepEqual(wf.steps.map((s) => s.kind), ['agent', 'loop']);
  const loop = wf.steps[1].loop!;
  assert.equal(loop.loopKind, 'dountil');
  assert.equal(loop.body.kind, 'leaf');
  assert.equal(loop.condition?.id, 'good-enough');
  assert.equal(loop.maxIterations, 4);
  assert.deepEqual(wf.conditionFiles.map((c) => c.id), ['good-enough']);
});

test('resolves a multi-step while loop -> dowhile with a nested sequence', () => {
  const dir = makeProject({
    ...base('flow'),
    'workflow/condition/keep.ts': 'export const keep = async () => false;\n',
    'workflow/steps/refine.ts': "import { createStep } from '@mastra/core/workflows';\nexport const refine = {};\n",
    'workflow/flow.yaml':
      'steps:\n  - loop:\n      while: keep\n      input: { prompt: string }\n      output: { text: string }\n' +
      '      steps:\n        - agent: research-agent\n        - step: refine\n',
  });
  const loop = parseProject(dir).workflows[0].steps[0].loop!;
  assert.equal(loop.loopKind, 'dowhile');
  assert.equal(loop.body.kind, 'sequence');
  if (loop.body.kind === 'sequence') {
    assert.equal(loop.body.id, 'flow-loop-1');
    assert.equal(loop.body.inputZod, 'z.object({ prompt: z.string() })');
    assert.deepEqual(loop.body.steps.map((s) => s.id), ['research-agent', 'refine']);
  }
});

test('resolves a foreach loop -> foreach with concurrency, no condition', () => {
  const dir = makeProject({
    ...base('flow'),
    'workflow/steps/process.ts': "export const process = {};\n",
    'workflow/flow.yaml': 'steps:\n  - loop:\n      foreach: true\n      step: process\n      concurrency: 2\n',
  });
  const loop = parseProject(dir).workflows[0].steps[0].loop!;
  assert.equal(loop.loopKind, 'foreach');
  assert.equal(loop.condition, undefined);
  assert.equal(loop.concurrency, 2);
});

test('resolves a pure-count loop (max_iterations only) -> dountil', () => {
  const dir = makeProject({
    ...base('flow'),
    'workflow/flow.yaml': 'steps:\n  - loop:\n      agent: research-agent\n      max_iterations: 3\n',
  });
  const loop = parseProject(dir).workflows[0].steps[0].loop!;
  assert.equal(loop.loopKind, 'dountil');
  assert.equal(loop.condition, undefined);
  assert.equal(loop.maxIterations, 3);
});

test('errors when a loop has more than one driver', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n      foreach: true\n      agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /loop has more than one of `until:`, `while:`, `foreach:`/);
});

test('errors when a loop has no driver (no until/while/foreach/max_iterations)', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'steps:\n  - loop:\n      agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /loop needs one of `until:`, `while:`, `foreach:`, or `max_iterations:`/);
});

test('errors when a loop has no body or both body forms', () => {
  const dir1 = makeProject({ ...base('bad'),
    'workflow/condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n' });
  assert.throws(() => parseProject(dir1), /loop must have exactly one body/);
  const dir2 = makeProject({ ...base('bad2'),
    'workflow/condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad2.yaml': 'steps:\n  - loop:\n      until: c\n      agent: research-agent\n      steps:\n        - agent: support-agent\n' });
  assert.throws(() => parseProject(dir2), /loop must have exactly one body/);
});

test('errors when a multi-step body omits input/output', () => {
  const dir = makeProject({ ...base('bad'),
    'workflow/condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n      steps:\n        - agent: research-agent\n' });
  assert.throws(() => parseProject(dir), /multi-step loop body requires `input:` and `output:`/);
});

test('errors when a single-leaf body declares input/output', () => {
  const dir = makeProject({ ...base('bad'),
    'workflow/condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n      agent: research-agent\n      input: { prompt: string }\n' });
  assert.throws(() => parseProject(dir), /`input:`\/`output:` are only for a multi-step `steps:` body/);
});

test('errors on an unresolved condition file', () => {
  const dir = makeProject({ ...base('bad'),
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: ghost\n      agent: research-agent\n' });
  assert.throws(() => parseProject(dir), /condition not found: workflow\/condition\/ghost\.ts/);
});

test('errors when max_iterations is used with foreach', () => {
  const dir = makeProject({ ...base('bad'),
    'workflow/steps/process.ts': 'export const process = {};\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      foreach: true\n      step: process\n      max_iterations: 3\n' });
  assert.throws(() => parseProject(dir), /`max_iterations` is not valid with `foreach:`/);
});

test('errors when concurrency is used without foreach', () => {
  const dir = makeProject({ ...base('bad'),
    'workflow/condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n      agent: research-agent\n      concurrency: 2\n' });
  assert.throws(() => parseProject(dir), /`concurrency` is only valid with `foreach:`/);
});

test('errors when a loop is used as a parallel child', () => {
  const dir = makeProject({ ...base('bad'),
    'workflow/bad.yaml':
      'steps:\n  - parallel:\n      - agent: research-agent\n      - loop:\n          foreach: true\n          agent: support-agent\n' });
  // `loop` is not a valid key on a parallel child (WorkflowLeafSchema.strict() catches it first).
  assert.throws(() => parseProject(dir), /loop/);
});

test('rejects a duplicate workflow id in config.workflows', () => {
  // A repeated id would emit duplicate imports + a duplicate object key in the
  // generated index.ts (a `tsc` failure in the generated project) — catch it here.
  const dir = makeProject({
    'config.yaml':
      'name: x\nagents: [research-agent, support-agent]\nworkflows: [research-flow, research-flow]\n',
    'agent/research-agent.yaml': 'name: R\ninstructions: p\nmodel: m\n',
    'agent/support-agent.yaml': 'name: S\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
    'workflow/research-flow.yaml':
      'input: { prompt: string }\noutput: { text: string }\nsteps:\n  - agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /duplicate workflow: `research-flow`/);
});

test('rejects a duplicate agent id in config.agents', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [research-agent, research-agent]\n',
    'agent/research-agent.yaml': 'name: R\ninstructions: p\nmodel: m\n',
    'prompt/p.md': PROMPT,
    'model/m.yaml': MODEL,
  });
  assert.throws(() => parseProject(dir), /duplicate agent: `research-agent`/);
});
