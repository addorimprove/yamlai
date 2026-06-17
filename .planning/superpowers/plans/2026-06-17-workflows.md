# Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `workflow/<id>.yaml` resource to the YAML Agent Builder that codegens runnable Mastra workflows (sequential + parallel) and lets agents attach workflows, with agent⇄workflow cycles allowed.

**Architecture:** Mirror the existing parser→codegen pipeline. A new `WorkflowSchema` + a YAML→Zod primitive compiler resolve `workflow/<id>.yaml` into a `ResolvedWorkflow`; `emit-workflow.ts` emits `createWorkflow().then()/.parallel().commit()`. Tools remain the glue (reshape + parallel-merge). Agents may attach workflows via `agent.workflows: [<id>]`; cycles are allowed by emitting attached workflows lazily off the `mastra` instance (`mastra.getWorkflow(id)`), which structurally prevents an agent⇄workflow import cycle.

**Tech Stack:** TypeScript (ESM), Zod v4, `yaml`, `@mastra/core@1.42`, `node:test`. All commands run from `builder/`.

---

## Decisions locked (this session, 2026-06-17)

- **Scope = Phases A–D: sequential + parallel + agent attachment.** No loops, no conditions, no
  `branch`/`foreach`. Control flow beyond `.then`/`.parallel` stays deferred (see spec "Deferred").
- **Agent attachment is IN**, with **cycles allowed** (Mastra's native behaviour). This pulls the
  spec's deferred "Agent attachment" item into scope — see Phase C. Update the spec's scope section
  when this plan lands (Task D4).

## Verified API facts (against `sample-mastra/node_modules/@mastra/core@1.42`)

- `Agent` option `workflows?: DynamicArgument<Record<string, Workflow<…>>>` (`agent/types.d.ts:388`) —
  `DynamicArgument<T> = T | (({ requestContext, mastra }) => T | Promise<T>)` (`types/dynamic-argument.d.ts:3`).
  So `workflows` accepts either a plain object **or** a thunk receiving `{ mastra }`.
- `mastra.getWorkflow(id)` exists (`mastra/index.d.ts:932`) → returns the registered workflow.
- `createStep(agent)` → input `{ prompt }` → output `{ text }`, step id = agent id. `createStep(tool)`
  uses the tool's own schemas. `.then(step)` sequential; `.parallel([steps])` runs all on the same
  input, output **keyed by step id**; `.commit()` finalizes.

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `builder/src/schemas.ts` (modify) | add `WorkflowSchema`; add `workflows` to `ConfigSchema` (B) and `AgentSchema` (C) | A,C |
| `builder/src/zod-compile.ts` (create) | YAML→Zod primitive compiler → `z.object({…})` source string | A |
| `builder/src/types.ts` (modify) | `ResolvedWorkflow`, `ResolvedWorkflowStep`, `ResolvedStepRef`, `ResolvedWorkflowRef`; `ParsedProject.workflows`; `ResolvedAgent.workflows`/`lazyWorkflows` | A,C |
| `builder/src/parser.ts` (modify) | resolve `workflow/<id>.yaml`, validate refs, collisions; (C) attach + cycle detect | A,C |
| `builder/src/codegen/emit-workflow.ts` (create) | emit `src/mastra/workflows/<id>.ts` | B |
| `builder/src/codegen/emit-mastra.ts` (modify) | import + register `workflows: { … }` | B |
| `builder/src/codegen/generate.ts` (modify) | emit workflow files + copy workflow-referenced tools (deduped) | B |
| `builder/src/codegen/emit-agent.ts` (modify) | emit attached-workflow imports + `workflows` field (object or `mastra` thunk) | C |
| `builder/src/index.ts` (modify) | re-export new `Resolved*` workflow types | A |
| `builder/test/*.test.ts` (create) | unit + parser + integration tests per task | all |
| `examples/agent/support-agent.yaml`, `website/docs/**` (modify) | demo attachment + docs | D |

---

## Phase A — Schema, Zod compiler, parser resolution (no attachment yet)

Ships: `parseProject` recognises `config.yaml → workflows: [...]`, resolves each `workflow/<id>.yaml` into a `ResolvedWorkflow`, validates refs, aggregates errors. No emit yet.

### Task A1: YAML→Zod primitive compiler

**Files:**
- Create: `builder/src/zod-compile.ts`
- Test: `builder/test/zod-compile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// builder/test/zod-compile.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileZodObject } from '../src/zod-compile.js';

test('compiles each supported primitive form', () => {
  const { expr, errors } = compileZodObject({
    prompt: 'string',
    count: 'number',
    done: 'boolean',
    mode: ['fast', 'deep'],
    tags: 'string[]',
    note: 'string?',
    nums: 'number[]?',
  });
  assert.deepEqual(errors, []);
  assert.equal(
    expr,
    "z.object({ prompt: z.string(), count: z.number(), done: z.boolean(), " +
      "mode: z.enum([\"fast\", \"deep\"]), tags: z.array(z.string()), " +
      "note: z.string().optional(), nums: z.array(z.number()).optional() })",
  );
});

test('empty object compiles to z.object({})', () => {
  assert.equal(compileZodObject({}).expr, 'z.object({})');
});

test('quotes keys that are not valid JS identifiers', () => {
  assert.equal(compileZodObject({ 'a-b': 'string' }).expr, 'z.object({ "a-b": z.string() })');
});

test('reports unknown primitive and non-string field, keeps other fields', () => {
  const { expr, errors } = compileZodObject({ ok: 'string', bad: 'date', nope: 42 });
  assert.equal(expr, 'z.object({ ok: z.string() })');
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /bad: unknown primitive `date`/);
  assert.match(errors.join('\n'), /nope: unsupported field type/);
});

test('reports empty and non-string enums', () => {
  assert.match(compileZodObject({ e: [] }).errors[0], /enum must have at least one value/);
  assert.match(compileZodObject({ e: [1, 2] }).errors[0], /enum values must be strings/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/zod-compile.test.ts`
Expected: FAIL — `Cannot find module '../src/zod-compile.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// builder/src/zod-compile.ts
/** Compile a flat YAML object of primitive field specs into a `z.object({...})`
 *  source-code expression (a string the emitter drops verbatim). Returns the
 *  expression plus a per-field error list (aggregated by the caller into ParseError).
 *
 *  Supported field forms (spec "Schemas — YAML→Zod" table):
 *    string | number | boolean        -> z.string() / z.number() / z.boolean()
 *    string[] | number[] | boolean[]  -> z.array(z.<base>())
 *    [a, b, ...]                       -> z.enum(['a','b',...])
 *    any scalar/array string form may end with `?` -> .optional()
 *  Nested objects / other types are rejected (use a glue tool to shape complex IO). */
export function compileZodObject(obj: Record<string, unknown>): { expr: string; errors: string[] } {
  const errors: string[] = [];
  const entries: string[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    const r = compileField(raw);
    if (r.error) {
      errors.push(`${key}: ${r.error}`);
      continue;
    }
    entries.push(`${zodKey(key)}: ${r.expr}`);
  }
  const expr = entries.length ? `z.object({ ${entries.join(', ')} })` : 'z.object({})';
  return { expr, errors };
}

const BASES: Record<string, string> = {
  string: 'z.string()',
  number: 'z.number()',
  boolean: 'z.boolean()',
};

function compileField(raw: unknown): { expr?: string; error?: string } {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return { error: 'enum must have at least one value' };
    if (!raw.every((v) => typeof v === 'string')) return { error: 'enum values must be strings' };
    return { expr: `z.enum([${raw.map((v) => JSON.stringify(v)).join(', ')}])` };
  }
  if (typeof raw !== 'string') {
    return { error: 'unsupported field type (use string/number/boolean, a [] suffix, ? for optional, or a [..] enum)' };
  }
  let spec = raw.trim();
  let optional = false;
  if (spec.endsWith('?')) {
    optional = true;
    spec = spec.slice(0, -1).trim();
  }
  let array = false;
  if (spec.endsWith('[]')) {
    array = true;
    spec = spec.slice(0, -2).trim();
  }
  const base = BASES[spec];
  if (!base) return { error: `unknown primitive \`${spec}\` (expected string, number, or boolean)` };
  let expr = array ? `z.array(${base})` : base;
  if (optional) expr += '.optional()';
  return { expr };
}

/** Quote object keys that aren't bare JS identifiers so the emitted z.object is valid TS. */
function zodKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/zod-compile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add builder/src/zod-compile.ts builder/test/zod-compile.test.ts
git commit -m "feat(workflows): YAML->Zod primitive compiler"
```

---

### Task A2: WorkflowSchema + ConfigSchema.workflows

**Files:**
- Modify: `builder/src/schemas.ts`
- Test: `builder/test/workflows-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// builder/test/workflows-schema.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowSchema, ConfigSchema } from '../src/schemas.js';

test('ConfigSchema defaults workflows to an empty array', () => {
  const cfg = ConfigSchema.parse({ name: 'x', agents: ['a'] });
  assert.deepEqual(cfg.workflows, []);
});

test('WorkflowSchema accepts agent/tool/parallel steps and defaults description/io', () => {
  const wf = WorkflowSchema.parse({
    name: 'Research Flow',
    input: { prompt: 'string' },
    output: { text: 'string' },
    steps: [
      { agent: 'research-agent' },
      { tool: 'rephrase' },
      { parallel: [{ agent: 'research-agent' }, { agent: 'support-agent' }] },
    ],
  });
  assert.equal(wf.description, '');
  assert.deepEqual(wf.input, { prompt: 'string' });
  assert.equal(wf.steps.length, 3);
});

test('WorkflowSchema requires a name and at least one step', () => {
  assert.equal(WorkflowSchema.safeParse({ name: 'x', steps: [] }).success, false);
  assert.equal(WorkflowSchema.safeParse({ steps: [{ agent: 'a' }] }).success, false);
});

test('WorkflowSchema defaults input/output to empty objects', () => {
  const wf = WorkflowSchema.parse({ name: 'x', steps: [{ agent: 'a' }] });
  assert.deepEqual(wf.input, {});
  assert.deepEqual(wf.output, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/workflows-schema.test.ts`
Expected: FAIL — `WorkflowSchema` is not exported.

- [ ] **Step 3: Implement — add to `builder/src/schemas.ts`**

Add `workflows` to `ConfigSchema` (insert after the `agents:` line at `schemas.ts:41`):

```ts
  workflows: z.array(z.string().min(1)).default([]),
```

Append the workflow schemas at the end of the file (before the `export type` block at `schemas.ts:72`):

```ts
// A single workflow step: exactly one of agent/tool/parallel — enforced in the
// parser (so the message is aggregated into ParseError, not a raw Zod union error).
// `input`/`output` are raw primitive-field maps compiled by zod-compile.ts.
const WorkflowLeafSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
});

const WorkflowStepSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  parallel: z.array(WorkflowLeafSchema).optional(),
});

export const WorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(WorkflowStepSchema).min(1),
});
```

Add the inferred type to the `export type` block:

```ts
export type WorkflowInput = z.infer<typeof WorkflowSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/workflows-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add builder/src/schemas.ts builder/test/workflows-schema.test.ts
git commit -m "feat(workflows): WorkflowSchema + config.workflows"
```

---

### Task A3: Resolved types + barrel exports

**Files:**
- Modify: `builder/src/types.ts`
- Modify: `builder/src/index.ts`

No test of its own (types only); compilation is verified by `tsc` in Task A4's run.

- [ ] **Step 1: Add types to `builder/src/types.ts`**

Insert after `ResolvedSubAgent` (after `types.ts:44`):

```ts
/** A reference to an attached workflow (agent.workflows) or a step target. */
export interface ResolvedWorkflowRef {
  id: string;
  /** camelCase export variable name, e.g. "researchFlow". */
  exportName: string;
}

/** A leaf step target inside a workflow (an agent or a tool). */
export interface ResolvedStepRef {
  kind: 'agent' | 'tool';
  id: string;
  exportName: string;
}

/** One workflow step: a single agent/tool, or a parallel block of leaf steps. */
export interface ResolvedWorkflowStep {
  kind: 'agent' | 'tool' | 'parallel';
  /** Set when kind is 'agent' | 'tool'. */
  ref?: ResolvedStepRef;
  /** Set when kind is 'parallel' (always length >= 2). */
  children?: ResolvedStepRef[];
}

export interface ResolvedWorkflow {
  id: string;
  name: string;
  description: string;
  /** camelCase export variable name, e.g. "researchFlow". */
  exportName: string;
  /** `z.object({...})` source expression for the workflow input/output. */
  inputZod: string;
  outputZod: string;
  steps: ResolvedWorkflowStep[];
  /** Distinct agents referenced anywhere in this workflow, in first-seen order (for imports). */
  agents: ResolvedWorkflowRef[];
  /** Distinct tools referenced anywhere in this workflow, in first-seen order (for imports + copy). */
  tools: ResolvedTool[];
}
```

Extend `ResolvedAgent` (add two fields after `lazyAgents` / before `memory`, around `types.ts:58`):

```ts
  /** Workflows attached to this agent (from its `workflows:` list). */
  workflows: ResolvedWorkflowRef[];
  /** True when an attached workflow lies on an agent⇄workflow cycle back to this
   *  agent. Such agents reference their workflows off the `mastra` instance
   *  (`mastra.getWorkflow(id)`) instead of importing them, so no import cycle forms. */
  lazyWorkflows: boolean;
```

Add to `ParsedProject` (after `agents: ResolvedAgent[];` at `types.ts:69`):

```ts
  workflows: ResolvedWorkflow[];
```

- [ ] **Step 2: Re-export from `builder/src/index.ts`**

Add to the `export type { … }` block:

```ts
  ResolvedWorkflow,
  ResolvedWorkflowStep,
  ResolvedStepRef,
  ResolvedWorkflowRef,
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm build`
Expected: FAIL — `parser.ts` does not yet populate `workflows`, `ResolvedAgent.workflows`, `lazyWorkflows`. (This is expected; Task A4 fixes the parser. If you prefer a green build between tasks, do A3 + A4 in one commit.)

- [ ] **Step 4: Commit**

```bash
git add builder/src/types.ts builder/src/index.ts
git commit -m "feat(workflows): resolved workflow types"
```

---

### Task A4: Parser resolves workflows + validates refs + collisions

**Files:**
- Modify: `builder/src/parser.ts`
- Test: `builder/test/workflows-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/workflows-parser.test.ts`
Expected: FAIL — `project.workflows` is undefined / not implemented.

- [ ] **Step 3: Implement in `builder/src/parser.ts`**

Update imports at the top (`parser.ts:5-15`):

```ts
import { AgentSchema, ConfigSchema, ModelSchema, WorkflowSchema } from './schemas.js';
import { compileZodObject } from './zod-compile.js';
import type {
  ParsedProject,
  ResolvedAgent,
  ResolvedMemory,
  ResolvedModel,
  ResolvedStepRef,
  ResolvedTool,
  ResolvedWorkflow,
  ResolvedWorkflowRef,
  ResolvedWorkflowStep,
} from './types.js';
```

In the agent-resolution loop, the pushed agent object (`parser.ts:194-204`) gains two fields so `ResolvedAgent` is fully populated (attachment is wired in Phase C; default to empty/false now):

```ts
    agents.push({
      id: agentId,
      name: agent.name,
      description: agent.description,
      instructions,
      model: resolvedModel,
      tools,
      subAgents: agent.agents.map((id) => ({ id, exportName: toExportName(id) })),
      lazyAgents: false, // set below once the full sub-agent graph is known
      workflows: [], // populated in Phase C
      lazyWorkflows: false, // set in Phase C
      memory: agent.memory,
    });
```

Insert the workflow-resolution block **after** the sub-agent cycle flagging (`parser.ts:229`, after the `for (const agent of agents) { if (cyclicNodes...) }` loop) and **before** the collision-check section (`parser.ts:237`):

```ts
  // Workflows ---------------------------------------------------------------
  // Resolve each declared workflow; collect every problem (don't stop at first).
  const configWorkflowSet = new Set(config.workflows);
  const workflows: ResolvedWorkflow[] = [];

  for (const wfId of config.workflows) {
    const wfPath = `workflow/${wfId}.yaml`;
    const rawWf = readYaml(wfPath);
    if (rawWf === undefined) continue;

    const wfResult = WorkflowSchema.safeParse(rawWf);
    if (!wfResult.success) {
      addIssue(wfPath, formatZodError(wfResult.error));
      continue;
    }
    const wf = wfResult.data;

    const agentRefs: ResolvedWorkflowRef[] = [];
    const toolRefs: ResolvedTool[] = [];
    let ok = true;

    // Resolve one leaf (agent | tool), recording refs for imports. Returns
    // undefined and records an issue on any problem.
    const resolveLeaf = (
      node: { agent?: string; tool?: string },
      where: string,
    ): ResolvedStepRef | undefined => {
      const hasAgent = typeof node.agent === 'string';
      const hasTool = typeof node.tool === 'string';
      if (hasAgent === hasTool) {
        addIssue(wfPath, `${where} must have exactly one of \`agent:\` or \`tool:\``);
        return undefined;
      }
      if (hasAgent) {
        const id = node.agent as string;
        if (!configAgentSet.has(id)) {
          addIssue(wfPath, `agent not found: ${id} (must be listed in config.yaml agents)`);
          return undefined;
        }
        const exportName = toExportName(id);
        if (!agentRefs.some((a) => a.id === id)) agentRefs.push({ id, exportName });
        return { kind: 'agent', id, exportName };
      }
      const id = node.tool as string;
      const toolPath = `tools/${id}.ts`;
      if (!existsSync(join(rootDir, toolPath))) {
        addIssue(wfPath, `tool not found: ${toolPath}`);
        return undefined;
      }
      const exportName = toExportName(id);
      if (!toolRefs.some((t) => t.id === id)) {
        toolRefs.push({ id, filePath: toolPath, exportName });
      }
      return { kind: 'tool', id, exportName };
    };

    const resolvedSteps: ResolvedWorkflowStep[] = [];
    for (const [i, step] of wf.steps.entries()) {
      const hasParallel = Array.isArray(step.parallel);
      const hasAgent = typeof step.agent === 'string';
      const hasTool = typeof step.tool === 'string';
      if ((hasParallel ? 1 : 0) + (hasAgent ? 1 : 0) + (hasTool ? 1 : 0) !== 1) {
        addIssue(wfPath, `step ${i + 1} must have exactly one of \`agent:\`, \`tool:\`, or \`parallel:\``);
        ok = false;
        continue;
      }
      if (hasParallel) {
        const kids = step.parallel as { agent?: string; tool?: string }[];
        if (kids.length < 2) {
          addIssue(wfPath, `step ${i + 1}: \`parallel\` needs at least 2 steps (use a plain step otherwise)`);
          ok = false;
          continue;
        }
        const resolvedKids: ResolvedStepRef[] = [];
        for (const [j, kid] of kids.entries()) {
          const c = resolveLeaf(kid, `step ${i + 1} parallel child ${j + 1}`);
          if (!c) ok = false;
          else resolvedKids.push(c);
        }
        if (resolvedKids.length === kids.length) {
          resolvedSteps.push({ kind: 'parallel', children: resolvedKids });
        }
      } else {
        const ref = resolveLeaf(step, `step ${i + 1}`);
        if (!ref) ok = false;
        else resolvedSteps.push({ kind: ref.kind, ref });
      }
    }

    const inCompiled = compileZodObject(wf.input as Record<string, unknown>);
    const outCompiled = compileZodObject(wf.output as Record<string, unknown>);
    for (const e of inCompiled.errors) addIssue(wfPath, `input.${e}`);
    for (const e of outCompiled.errors) addIssue(wfPath, `output.${e}`);

    if (!ok || inCompiled.errors.length || outCompiled.errors.length) continue;

    workflows.push({
      id: wfId,
      name: wf.name,
      description: wf.description,
      exportName: toExportName(wfId),
      inputZod: inCompiled.expr,
      outputZod: outCompiled.expr,
      steps: resolvedSteps,
      agents: agentRefs,
      tools: toolRefs,
    });
  }
```

Extend the **project-scope** collision check (`parser.ts:256-260`) to include workflow ids — index.ts imports agents and workflows into one module namespace:

```ts
  // Project scope: every declared agent AND workflow is a top-level import in index.ts.
  reportCollisions('config.yaml', [
    ...config.agents.map((id) => ({ name: toExportName(id), key: `agent:${id}` })),
    ...config.workflows.map((id) => ({ name: toExportName(id), key: `workflow:${id}` })),
  ]);
```

Add a **workflow module-scope** collision check (insert after the agent module-scope loop, `parser.ts:276`):

```ts
  // Module scope for each workflow file: its own export, its agent/tool imports,
  // and the reserved imports the emitter always adds.
  for (const wf of workflows) {
    reportCollisions(`workflow/${wf.id}.yaml`, [
      { name: 'createWorkflow', key: 'reserved:createWorkflow' },
      { name: 'createStep', key: 'reserved:createStep' },
      { name: 'z', key: 'reserved:z' },
      { name: wf.exportName, key: `workflow:${wf.id}` },
      ...wf.agents.map((a) => ({ name: a.exportName, key: `agent:${a.id}` })),
      ...wf.tools.map((t) => ({ name: t.exportName, key: `tool:${t.id}` })),
    ]);
  }
```

Finally, add `workflows` to the returned `ParsedProject` (`parser.ts:285-291`):

```ts
  return {
    name: config.name,
    logger: { level: config.logger.level },
    storage: config.storage,
    memory,
    agents,
    workflows,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/workflows-parser.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Run the full suite + build to confirm no regressions**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all tests pass (existing agent/memory/sub-agent suites unaffected).

- [ ] **Step 6: Commit**

```bash
git add builder/src/parser.ts builder/test/workflows-parser.test.ts
git commit -m "feat(workflows): resolve workflow/<id>.yaml + validate refs"
```

---

## Phase B — Emit + register (sequential + parallel)

Ships: generated projects contain `src/mastra/workflows/<id>.ts`, the Mastra instance registers them, and workflow-only tools are copied.

### Task B1: emit-workflow.ts

**Files:**
- Create: `builder/src/codegen/emit-workflow.ts`
- Test: `builder/test/emit-workflow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// builder/test/emit-workflow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitWorkflow } from '../src/codegen/emit-workflow.js';
import type { ResolvedWorkflow } from '../src/types.js';

const SEQ: ResolvedWorkflow = {
  id: 'research-flow',
  name: 'Research Flow',
  description: '',
  exportName: 'researchFlow',
  inputZod: 'z.object({ prompt: z.string() })',
  outputZod: 'z.object({ text: z.string() })',
  steps: [
    { kind: 'agent', ref: { kind: 'agent', id: 'research-agent', exportName: 'researchAgent' } },
    { kind: 'tool', ref: { kind: 'tool', id: 'rephrase', exportName: 'rephrase' } },
    { kind: 'agent', ref: { kind: 'agent', id: 'support-agent', exportName: 'supportAgent' } },
  ],
  agents: [
    { id: 'research-agent', exportName: 'researchAgent' },
    { id: 'support-agent', exportName: 'supportAgent' },
  ],
  tools: [{ id: 'rephrase', filePath: 'tools/rephrase.ts', exportName: 'rephrase' }],
};

test('emits imports, createWorkflow, sequential .then chain, and .commit', () => {
  const out = emitWorkflow(SEQ);
  assert.match(out, /import \{ createWorkflow, createStep \} from '@mastra\/core\/workflows';/);
  assert.match(out, /import \{ z \} from 'zod';/);
  assert.match(out, /import \{ researchAgent \} from '\.\.\/agents\/research-agent';/);
  assert.match(out, /import \{ rephrase \} from '\.\.\/tools\/rephrase';/);
  assert.match(out, /export const researchFlow = createWorkflow\(\{/);
  assert.match(out, /id: "research-flow",/);
  assert.match(out, /inputSchema: z\.object\(\{ prompt: z\.string\(\) \}\),/);
  assert.match(out, /\.then\(createStep\(researchAgent\)\)/);
  assert.match(out, /\.then\(createStep\(rephrase\)\)/);
  assert.match(out, /\.commit\(\);/);
});

test('emits a .parallel block for a parallel step', () => {
  const out = emitWorkflow({
    ...SEQ,
    id: 'compare-answers',
    exportName: 'compareAnswers',
    steps: [
      {
        kind: 'parallel',
        children: [
          { kind: 'agent', id: 'research-agent', exportName: 'researchAgent' },
          { kind: 'agent', id: 'support-agent', exportName: 'supportAgent' },
        ],
      },
      { kind: 'tool', ref: { kind: 'tool', id: 'merge-answers', exportName: 'mergeAnswers' } },
    ],
    tools: [{ id: 'merge-answers', filePath: 'tools/merge-answers.ts', exportName: 'mergeAnswers' }],
  });
  assert.match(out, /\.parallel\(\[createStep\(researchAgent\), createStep\(supportAgent\)\]\)/);
  assert.match(out, /\.then\(createStep\(mergeAnswers\)\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/emit-workflow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `builder/src/codegen/emit-workflow.ts`**

```ts
import type { ResolvedWorkflow } from '../types.js';

/** Generate the source for src/mastra/workflows/<id>.ts. */
export function emitWorkflow(wf: ResolvedWorkflow): string {
  const lines: string[] = [];
  lines.push(`import { createWorkflow, createStep } from '@mastra/core/workflows';`);
  lines.push(`import { z } from 'zod';`);
  // Distinct agent/tool imports, in first-seen order (already deduped in the parser).
  for (const a of wf.agents) {
    lines.push(`import { ${a.exportName} } from '../agents/${a.id}';`);
  }
  for (const t of wf.tools) {
    lines.push(`import { ${t.exportName} } from '../tools/${t.id}';`);
  }
  lines.push('');

  lines.push(`export const ${wf.exportName} = createWorkflow({`);
  lines.push(`  id: ${JSON.stringify(wf.id)},`);
  lines.push(`  inputSchema: ${wf.inputZod},`);
  lines.push(`  outputSchema: ${wf.outputZod},`);
  lines.push(`})`);
  for (const step of wf.steps) {
    if (step.kind === 'parallel') {
      const inner = step.children!.map((c) => `createStep(${c.exportName})`).join(', ');
      lines.push(`  .parallel([${inner}])`);
    } else {
      lines.push(`  .then(createStep(${step.ref!.exportName}))`);
    }
  }
  lines.push(`  .commit();`);
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/emit-workflow.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add builder/src/codegen/emit-workflow.ts builder/test/emit-workflow.test.ts
git commit -m "feat(workflows): emit-workflow codegen"
```

---

### Task B2: Register workflows in emit-mastra.ts

**Files:**
- Modify: `builder/src/codegen/emit-mastra.ts`
- Test: `builder/test/emit-mastra-workflows.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// builder/test/emit-mastra-workflows.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitIndex } from '../src/codegen/emit-mastra.js';
import type { ParsedProject } from '../src/types.js';

const BASE: ParsedProject = {
  name: 'x',
  logger: { level: 'info' },
  agents: [
    { id: 'support-agent', name: 'S', description: '', instructions: 'hi',
      model: { id: 'm', provider: 'openai', model: 'gpt-5-mini', routerString: 'openai/gpt-5-mini' },
      tools: [], subAgents: [], lazyAgents: false, workflows: [], lazyWorkflows: false, memory: false },
  ],
  workflows: [],
};

test('omits the workflows field when there are none', () => {
  assert.doesNotMatch(emitIndex(BASE), /workflows:/);
});

test('imports and registers workflows when present', () => {
  const out = emitIndex({
    ...BASE,
    workflows: [
      { id: 'research-flow', name: 'R', description: '', exportName: 'researchFlow',
        inputZod: 'z.object({})', outputZod: 'z.object({})', steps: [], agents: [], tools: [] },
    ],
  });
  assert.match(out, /import \{ researchFlow \} from '\.\/workflows\/research-flow';/);
  assert.match(out, /workflows: \{ researchFlow \},/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/emit-mastra-workflows.test.ts`
Expected: FAIL — no workflow import/field emitted.

- [ ] **Step 3: Implement in `builder/src/codegen/emit-mastra.ts`**

Add workflow imports after the agent-import loop (`emit-mastra.ts:14`):

```ts
  for (const wf of project.workflows) {
    lines.push(`import { ${wf.exportName} } from './workflows/${wf.id}';`);
  }
```

Add the `workflows` field right after the `agents: { … },` line (`emit-mastra.ts:19`):

```ts
  if (project.workflows.length > 0) {
    const wfVars = project.workflows.map((w) => w.exportName).join(', ');
    lines.push(`  workflows: { ${wfVars} },`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/emit-mastra-workflows.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add builder/src/codegen/emit-mastra.ts builder/test/emit-mastra-workflows.test.ts
git commit -m "feat(workflows): register workflows on the Mastra instance"
```

---

### Task B3: generate.ts emits workflow files + copies workflow tools

**Files:**
- Modify: `builder/src/codegen/generate.ts`
- Test: `builder/test/workflows-integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// builder/test/workflows-integration.test.ts
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

const TOOL = "import { createTool } from '@mastra/core/tools';\nexport const t = {};\n";

function project(): string {
  return makeProject({
    'config.yaml':
      'name: x\nagents: [research-agent, support-agent]\nworkflows: [compare-answers]\n',
    'agent/research-agent.yaml': 'name: R\ninstructions: p\nmodel: m\n',
    'agent/support-agent.yaml': 'name: S\ninstructions: p\nmodel: m\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
    'tools/merge-answers.ts': TOOL,
    'workflow/compare-answers.yaml':
      'name: Compare\ninput: { prompt: string }\noutput: { comparison: string }\n' +
      'steps:\n  - parallel:\n      - agent: research-agent\n      - agent: support-agent\n  - tool: merge-answers\n',
  });
}

test('emits the workflow file and registers it in index.ts', () => {
  const dir = project();
  const files = generateProject(parseProject(dir), dir);
  assert.ok(files['src/mastra/workflows/compare-answers.ts'], 'workflow file emitted');
  assert.match(files['src/mastra/index.ts'], /workflows: \{ compareAnswers \},/);
});

test('copies a workflow-only tool that no agent references', () => {
  const dir = project();
  const files = generateProject(parseProject(dir), dir);
  // merge-answers is referenced only by the workflow, never by an agent — must still be copied.
  assert.ok(files['src/mastra/tools/merge-answers.ts'], 'workflow-only tool copied');
});

test('copies a shared tool exactly once', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nworkflows: [w]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\ntools: [shared]\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
    'tools/shared.ts': TOOL,
    'workflow/w.yaml': 'name: W\nsteps:\n  - agent: a\n  - tool: shared\n',
  });
  const files = generateProject(parseProject(dir), dir);
  assert.ok(files['src/mastra/tools/shared.ts']);
  // (No duplicate-key possibility in a FileMap; this asserts the dedupe path runs without error.)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/workflows-integration.test.ts`
Expected: FAIL — workflow file + workflow-only tool not emitted.

- [ ] **Step 3: Implement in `builder/src/codegen/generate.ts`**

Add the import (`generate.ts:5`):

```ts
import { emitWorkflow } from './emit-workflow.js';
```

Insert the workflow loop after the agents loop (after `generate.ts:38`, before `return files;`):

```ts
  for (const wf of project.workflows) {
    files[`src/mastra/workflows/${wf.id}.ts`] = emitWorkflow(wf);
    for (const tool of wf.tools) {
      const dest = `src/mastra/tools/${tool.id}.ts`;
      if (files[dest]) continue; // already copied by an agent or another workflow
      files[dest] = readFileSync(join(rootDir, tool.filePath), 'utf8');
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/workflows-integration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the example generation end-to-end**

The repo's `examples/` already contains `workflow/research-flow.yaml`, `workflow/compare-answers.yaml`, `tools/rephrase.ts`, `tools/merge-answers.ts`, and `config.yaml` with `workflows: [...]`.

Run: `pnpm gen:example`
Expected: succeeds; file count is higher than the previous 9 (now includes `src/mastra/workflows/research-flow.ts`, `compare-answers.ts`, and the `rephrase` / `merge-answers` tools).

- [ ] **Step 6: Typecheck the generated output (proves the emitted TS compiles + data-flow types line up)**

```bash
pnpm gen:example /tmp/wf-out
cd /tmp/wf-out && pnpm install && pnpm exec tsc --noEmit
```
Expected: `tsc` exits 0. (Per the spec, step-to-step shape mismatches surface here, not at parse time. If `tsc` flags a mismatch in the example, fix the example YAML/tool — not the emitter.) **Note:** `pnpm install` pulls from the npm registry — an install failure is a network/registry problem, **not** a codegen bug; re-run with registry access before judging the output.

- [ ] **Step 7: Commit**

```bash
cd "$OLDPWD" # back to builder/
git add builder/src/codegen/generate.ts builder/test/workflows-integration.test.ts
git commit -m "feat(workflows): emit workflow files + copy workflow tools"
```

**Phase B ships a working registry-only workflows feature.** Phase C adds agent attachment.

---

## Phase C — Agent attachment (`agent.workflows`), cycles allowed

Ships: an agent may list `workflows: [<id>]`; the generated `Agent` gets a `workflows` field. Agent⇄workflow cycles are allowed by emitting the attached workflows lazily off the `mastra` instance.

### Task C1: SPIKE — confirm the cyclic-attachment emission compiles & runs

**This is a research spike, not TDD.** It de-risks the emit shape in Task C3 before you write it. Do not skip.

**Goal:** Empirically confirm, against `@mastra/core@1.42`, that:
1. Non-cyclic attachment `workflows: { researchFlow }` (plain object, static import) compiles and runs.
2. Cyclic attachment emitted as `workflows: ({ mastra }) => ({ researchFlow: mastra.getWorkflow('research-flow') })` (no workflow import) compiles under `tsc` and loads without a TDZ/ReferenceError, when the agent and the workflow import each other.

- [ ] **Step 1: Build a minimal cyclic project by hand**

Create `/tmp/wf-spike/` with these files (mirrors what the emitter will produce for a cycle: agent X attaches workflow W; W has a step `agent: X`).

`/tmp/wf-spike/package.json`:
```json
{ "name": "wf-spike", "type": "module", "private": true,
  "dependencies": { "@mastra/core": "1.42.0", "zod": "^4.4.3" },
  "devDependencies": { "tsx": "^4.19.0" } }
```

> `tsx` is a **dev dependency of the spike** so `node --import tsx` can resolve the loader from the
> spike's own `node_modules` (the generated project has no `tsx`, and a bare `node --import tsx` with
> no local/global tsx fails with `Cannot find package 'tsx'`).

`/tmp/wf-spike/src/agents/looper.ts` (the **lazy** form — this mirrors exactly what `emit-agent.ts` produces for a `lazyWorkflows`-only agent: NO import of the workflow, and **NO `: Agent` annotation**. The `({ mastra }) => …` thunk never references `looper` itself, so there is no self-referential type to break — unlike the sub-agent-cycle case, which is the only thing that triggers the `: Agent` annotation in C3):
```ts
import { Agent } from '@mastra/core/agent';
export const looper = new Agent({
  id: 'looper',
  name: 'Looper',
  instructions: 'loop',
  model: 'openai/gpt-5-mini',
  workflows: ({ mastra }) => ({ loopFlow: mastra.getWorkflow('loop-flow') }),
});
```

`/tmp/wf-spike/src/workflows/loop-flow.ts`:
```ts
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { looper } from '../agents/looper';
export const loopFlow = createWorkflow({
  id: 'loop-flow',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(createStep(looper))
  .commit();
```

`/tmp/wf-spike/src/index.ts`:
```ts
import { Mastra } from '@mastra/core/mastra';
import { looper } from './agents/looper';
import { loopFlow } from './workflows/loop-flow';
export const mastra = new Mastra({ agents: { looper }, workflows: { loopFlow } });
// Force evaluation of both module graphs and the thunk:
console.log('agents:', Object.keys(mastra.getAgents?.() ?? { looper }));
console.log('workflow:', mastra.getWorkflow('loop-flow').id);
```

`/tmp/wf-spike/tsconfig.json`:
```json
{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext",
  "target": "ES2022", "strict": true, "noEmit": true, "skipLibCheck": true } }
```

- [ ] **Step 2: Install, typecheck, and run**

```bash
cd /tmp/wf-spike && pnpm install
pnpm exec tsc --noEmit
node --import tsx src/index.ts
```

- [ ] **Step 3: Record the outcome**

Expected (hypothesis): `tsc` exits 0 and `node` prints `workflow: loop-flow` with no `ReferenceError: Cannot access 'looper' before initialization`.

- **If `tsc` errors only on `mastra.getWorkflow('loop-flow')` typing** (e.g. `'loop-flow'` not assignable to `keyof TWorkflows`): the runtime is fine; in Task C3 emit the id arg through a cast — `(mastra as any).getWorkflow('loop-flow')` — and note it in a code comment. Re-run to confirm `node` still works.
- **If `node` throws a TDZ ReferenceError** even with the lazy form: the `mastra`-thunk is insufficient. Fallback: in Task C3, additionally emit the cyclic workflow's `createStep(agent)` argument lazily by importing the agent with a dynamic `import()` inside the workflow — STOP and escalate to the user with the spike output before proceeding, since this changes `emit-workflow.ts` too.

- [ ] **Step 4: Write down the confirmed shape** in a comment at the top of the Task C3 implementation so the executor uses exactly what the spike proved.

---

### Task C2: Schema + parser — attach workflows to agents + cycle detection

**Files:**
- Modify: `builder/src/schemas.ts`
- Modify: `builder/src/parser.ts`
- Test: `builder/test/agent-workflows-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/agent-workflows-parser.test.ts`
Expected: FAIL — `agent.workflows` not parsed.

- [ ] **Step 3: Implement**

In `builder/src/schemas.ts`, add `workflows` to `AgentSchema` (after the `agents:` line at `schemas.ts:61`):

```ts
  workflows: z.array(z.string().min(1)).default([]),
```

In `builder/src/parser.ts`:

(a) Capture per-agent workflow refs alongside the existing sub-agent capture. After `const subAgentRefs = new Map<string, string[]>();` (`parser.ts:129`):

```ts
  const agentWorkflowRefs = new Map<string, string[]>();
```

After `subAgentRefs.set(agentId, agent.agents);` (`parser.ts:143`):

```ts
    agentWorkflowRefs.set(agentId, agent.workflows);
```

Populate the pushed agent's `workflows` field (replace the `workflows: []` placeholder from Task A4):

```ts
      workflows: agent.workflows.map((id) => ({ id, exportName: toExportName(id) })),
```

(b) After the workflow-resolution block (added in A4) and before the collision checks, validate attached refs and detect agent⇄workflow cycles:

```ts
  // Validate every attached workflow exists in config.workflows.
  for (const [parentId, refs] of agentWorkflowRefs) {
    for (const ref of new Set(refs)) {
      if (!configWorkflowSet.has(ref)) {
        addIssue(
          `agent/${parentId}.yaml`,
          `workflow not found: ${ref} (must be listed in config.yaml workflows)`,
        );
      }
    }
  }

  // Agent⇄workflow cycle detection. Build one graph over both node kinds
  // (namespaced a:/w: so an agent id and workflow id never collide): agents point
  // to their sub-agents AND attached workflows; workflows point to their agent
  // steps. An agent on a cycle here attaches its workflows lazily (off `mastra`)
  // so no agent⇄workflow import cycle forms. (Conservative: any agent on a cycle
  // with attachments is lazified — always safe, occasionally lazier than strictly
  // necessary, mirroring how `lazyAgents` works for sub-agent cycles.)
  const wfGraph = new Map<string, string[]>();
  for (const agent of agents) {
    wfGraph.set(`a:${agent.id}`, [
      ...agent.subAgents.map((s) => `a:${s.id}`),
      ...agent.workflows.map((w) => `w:${w.id}`),
    ]);
  }
  for (const wf of workflows) {
    wfGraph.set(`w:${wf.id}`, wf.agents.map((a) => `a:${a.id}`));
  }
  const wfCyclic = findCyclicNodes(wfGraph);
  for (const agent of agents) {
    if (agent.workflows.length > 0 && wfCyclic.has(`a:${agent.id}`)) {
      agent.lazyWorkflows = true;
    }
  }
```

(c) Extend the agent module-scope collision check (`parser.ts:266-275`) to include attached-workflow imports — only the non-lazy ones produce an import binding (lazy ones reference `mastra.getWorkflow`, no import):

```ts
      ...agent.subAgents
        .filter((s) => s.id !== agent.id)
        .map((s) => ({ name: s.exportName, key: `agent:${s.id}` })),
      ...(agent.lazyWorkflows
        ? []
        : agent.workflows.map((w) => ({ name: w.exportName, key: `workflow:${w.id}` }))),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/agent-workflows-parser.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add builder/src/schemas.ts builder/src/parser.ts builder/test/agent-workflows-parser.test.ts
git commit -m "feat(workflows): attach workflows to agents + cycle detection"
```

---

### Task C3: Emit attached workflows on the Agent

**Files:**
- Modify: `builder/src/codegen/emit-agent.ts`
- Test: `builder/test/emit-agent-workflows.test.ts`

> Use the exact emission shape confirmed by the Task C1 spike. The code below is the
> hypothesis (static-import object for acyclic; `mastra.getWorkflow` thunk for cyclic).
> If the spike required an `as any` cast on the id arg, add it where noted.

- [ ] **Step 1: Write the failing test**

```ts
// builder/test/emit-agent-workflows.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitAgent } from '../src/codegen/emit-agent.js';
import type { ResolvedAgent } from '../src/types.js';

const BASE: ResolvedAgent = {
  id: 'worker', name: 'W', description: '', instructions: 'hi',
  model: { id: 'm', provider: 'openai', model: 'gpt-5-mini', routerString: 'openai/gpt-5-mini' },
  tools: [], subAgents: [], lazyAgents: false, workflows: [], lazyWorkflows: false, memory: false,
};

test('omits the workflows field when none attached', () => {
  assert.doesNotMatch(emitAgent(BASE), /workflows/);
});

test('acyclic attachment: static import + object field', () => {
  const out = emitAgent({ ...BASE, workflows: [{ id: 'research-flow', exportName: 'researchFlow' }] });
  assert.match(out, /import \{ researchFlow \} from '\.\.\/workflows\/research-flow';/);
  assert.match(out, /^\s*workflows: \{ researchFlow \},$/m);
});

test('cyclic attachment: no import, mastra.getWorkflow thunk', () => {
  const out = emitAgent({
    ...BASE,
    workflows: [{ id: 'loop-flow', exportName: 'loopFlow' }],
    lazyWorkflows: true,
  });
  assert.doesNotMatch(out, /import \{ loopFlow \} from/);
  assert.match(out, /workflows: \(\{ mastra \}\) => \(\{ loopFlow: mastra\.getWorkflow\("loop-flow"\) \}\),/);
});

test('dedupes repeated attached-workflow references', () => {
  const out = emitAgent({
    ...BASE,
    workflows: [
      { id: 'research-flow', exportName: 'researchFlow' },
      { id: 'research-flow', exportName: 'researchFlow' },
    ],
  });
  assert.equal((out.match(/from '\.\.\/workflows\/research-flow'/g) ?? []).length, 1);
  assert.match(out, /workflows: \{ researchFlow \},/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/emit-agent-workflows.test.ts`
Expected: FAIL — no workflow emission.

- [ ] **Step 3: Implement in `builder/src/codegen/emit-agent.ts`**

Add workflow imports after the sub-agent import loop (`emit-agent.ts:25`):

```ts
  // Attached-workflow imports. Lazy (cyclic) agents reference workflows off the
  // mastra instance instead, so an agent⇄workflow import cycle never forms.
  if (!agent.lazyWorkflows) {
    const seenWf = new Set<string>();
    for (const wf of agent.workflows) {
      if (seenWf.has(wf.exportName)) continue;
      seenWf.add(wf.exportName);
      lines.push(`import { ${wf.exportName} } from '../workflows/${wf.id}';`);
    }
  }
```

Add the `workflows` field after the `agents` field block (`emit-agent.ts:66`):

```ts
  if (agent.workflows.length > 0) {
    if (agent.lazyWorkflows) {
      // Deduped by export name, in first-seen order. mastra.getWorkflow(id) avoids
      // importing the workflow module (breaks the agent⇄workflow import cycle).
      // NOTE: do NOT extend the `export const … : Agent` annotation (the decl logic
      // above) to cover lazyWorkflows — the thunk doesn't reference the agent's own
      // binding, so there's no self-referential type to break. The annotation stays
      // governed by `lazyAgents` only. (Confirmed by the C1 spike's no-annotation form.)
      const uniq = [...new Map(agent.workflows.map((w) => [w.exportName, w])).values()];
      const entries = uniq
        .map((w) => `${w.exportName}: mastra.getWorkflow(${JSON.stringify(w.id)})`)
        .join(', ');
      fields.push(`  workflows: ({ mastra }) => ({ ${entries} }),`);
    } else {
      const wfVars = [...new Set(agent.workflows.map((w) => w.exportName))].join(', ');
      fields.push(`  workflows: { ${wfVars} },`);
    }
  }
```

> If the C1 spike required a cast, change the lazy entry to:
> `${w.exportName}: (mastra as any).getWorkflow(${JSON.stringify(w.id)})` and add a one-line comment explaining why.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/emit-agent-workflows.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Backfill the new required fields on pre-existing `ResolvedAgent` fixtures**

This step now reads `agent.workflows` (it iterates `for (const wf of agent.workflows)`) and
`agent.lazyWorkflows`. Two **pre-existing** hand-built `ResolvedAgent` literals predate the A3 field
additions and will make `emitAgent` throw `TypeError: agent.workflows is not iterable` once this task
lands — and nothing catches it earlier, because `tsconfig.json` excludes `test/` and `pnpm test` runs
under tsx (no type-check). Add `workflows: [], lazyWorkflows: false` to **both** base literals:

- `builder/test/emit-agent.test.ts` — `const BASE` (≈ line 14; the `lazyAgents: true` fixtures spread `...BASE`, so this one edit covers them).
- `builder/test/emit-memory.test.ts` — `const BASE_AGENT` (≈ line 72).

```ts
  // …
  lazyAgents: false,
  workflows: [],          // NEW (Task A3 made this required on ResolvedAgent)
  lazyWorkflows: false,   // NEW
  memory: false,
};
```

- [ ] **Step 6: Full suite + build**

Run: `pnpm build && pnpm test`
Expected: all pass. (Before Step 5's fixture backfill this would crash the legacy emit-agent /
emit-memory tests with `agent.workflows is not iterable` — confirm green here.)

- [ ] **Step 7: Commit**

```bash
git add builder/src/codegen/emit-agent.ts builder/test/emit-agent-workflows.test.ts \
        builder/test/emit-agent.test.ts builder/test/emit-memory.test.ts
git commit -m "feat(workflows): emit attached workflows on agents (cycles allowed)"
```

---

## Phase D — Example demo, end-to-end runtime check, docs

### Task D1: Make the example demonstrate attachment + a cycle

**Files:**
- Modify: `examples/agent/support-agent.yaml`

- [ ] **Step 1: Read the current file**

Run: `sed -n '1,40p' ../examples/agent/support-agent.yaml`

- [ ] **Step 2: Attach a workflow to the support agent**

Append to `examples/agent/support-agent.yaml` (the support agent attaching `compare-answers`, which itself references `support-agent` → a real agent⇄workflow cycle, exercising the lazy path):

```yaml
# Attach a workflow the agent can invoke. `compare-answers` references
# `support-agent`, so this is an agent⇄workflow cycle — emitted lazily via
# mastra.getWorkflow (see workflows design, "cycles allowed").
workflows:
  - compare-answers
```

- [ ] **Step 3: Regenerate and confirm the lazy thunk is emitted**

```bash
pnpm gen:example /tmp/wf-out
grep -n "workflows:" /tmp/wf-out/src/mastra/agents/support-agent.ts
```
Expected: a `workflows: ({ mastra }) => ({ compareAnswers: mastra.getWorkflow("compare-answers") })` line (no static workflow import in that file).

- [ ] **Step 4: De-stale the `config.yaml` comment**

`examples/config.yaml` introduced `workflows:` with the comment `# preview of roadmap #15 — ignored until the feature lands`. That is now false (the feature ships in this milestone). Update the trailing comment on the `workflows:` line to reflect reality, e.g.:

```yaml
workflows:                 # registered on the Mastra instance (workflow/<id>.yaml)
  - research-flow          # sequential: research-agent -> rephrase(tool) -> support-agent
  - compare-answers        # parallel:   [research-agent | support-agent] -> merge-answers(tool)
```

- [ ] **Step 5: Typecheck + load the generated project end-to-end**

```bash
cd /tmp/wf-out && pnpm install && pnpm exec tsc --noEmit
# The generated project has no `tsx`; run the load check through a throwaway npx tsx
# (proves no agent⇄workflow TDZ ReferenceError at module load — the whole point of the cyclic path).
npx -y tsx -e "import('./src/mastra/index.ts').then(m => console.log('ok', m.mastra.getWorkflow('compare-answers').id))"
cd "$OLDPWD"
```
Expected: `tsc` exits 0; node prints `ok compare-answers` with no TDZ ReferenceError. (If this fails, the C1 spike fallback applies — escalate.) **Note:** `pnpm install` pulls from the npm registry — an install failure here is a network/registry problem, **not** a codegen bug; re-run with registry access before judging the output.

- [ ] **Step 6: Commit**

```bash
git add examples/agent/support-agent.yaml examples/config.yaml
git commit -m "docs(workflows): example agent attaches a workflow (cyclic)"
```

### Task D2: Example-generation regression test in the suite

**Files:**
- Test: `builder/test/example-workflows.test.ts`

- [ ] **Step 1: Write the test (parses the real examples/ dir)**

```ts
// builder/test/example-workflows.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseProject } from '../src/parser.js';
import { generateProject } from '../src/codegen/generate.js';

const examples = resolve(dirname(fileURLToPath(import.meta.url)), '../../examples');

test('the bundled examples generate workflow files + register them', () => {
  const project = parseProject(examples);
  const files = generateProject(project, examples);
  assert.ok(files['src/mastra/workflows/research-flow.ts']);
  assert.ok(files['src/mastra/workflows/compare-answers.ts']);
  assert.ok(files['src/mastra/tools/rephrase.ts']);
  assert.ok(files['src/mastra/tools/merge-answers.ts']);
  assert.match(files['src/mastra/index.ts'], /workflows: \{ researchFlow, compareAnswers \},/);
  // support-agent attaches compare-answers via the lazy (cyclic) thunk.
  assert.match(
    files['src/mastra/agents/support-agent.ts'],
    /workflows: \(\{ mastra \}\) => \(\{ compareAnswers: mastra\.getWorkflow\("compare-answers"\) \}\)/,
  );
});
```

- [ ] **Step 2: Run it**

Run: `node --import tsx --test test/example-workflows.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add builder/test/example-workflows.test.ts
git commit -m "test(workflows): example generation regression"
```

### Task D3: Documentation page

**Files:**
- Create: `website/docs/<section>/workflow.md` (match the existing docs layout — inspect `website/docs/` first)
- Modify: the roadmap/feature page that lists Workflows (#15) — move it to "Available now"
- Modify: `website/docs/examples.md` — flip its existing **"Preview: workflows (roadmap #15)"** section from preview to shipped

- [ ] **Step 1: Inspect docs layout**

Run: `find website/docs -maxdepth 2 -name '*.md' | head -40 && grep -rn "Workflows" website/docs | head`

- [ ] **Step 2: Write `workflow.md`**

Document, per the **docs-single-source-of-truth** rule (link, don't duplicate the agent/model/tool mapping already documented elsewhere):
- `workflow/<id>.yaml` shape: `name`, `description`, `input`/`output` (link to the YAML→Zod primitive table — do not restate it), `steps` (`agent:` / `tool:` / `parallel:`).
- The two worked examples (sequential `research-flow`, parallel `compare-answers`) with the generated TS — reuse the spec's examples by reference/short form, not a full copy.
- Registration via `config.yaml → workflows: [...]`.
- Attachment via `agent.workflows: [...]`, and the one-line note that agent⇄workflow cycles are allowed (emitted lazily off the mastra instance).
- A **"Gotchas"** section capturing the two type-checking caveats (these surface at the generated project's `tsc`, not at parse time — call that out):
  - **Step shapes must chain.** Each step's output feeds the next step's input; the builder does not reshape between steps (use a glue `tool:` for that). Only *adjacent* steps are type-checked — the workflow's declared `output:` is **not** enforced against the last step's actual output, so a wrong `output:` block compiles silently. Keep `output:` in sync with the final step by hand.
  - **`input:` must match the first step.** If the first step is an `agent:` (which always reads `{ prompt: string }`), the workflow's `input:` must provide `{ prompt: string }`. Omitting `input:` yields `z.object({})` and the generated project fails to compile — the error appears in the generated `.ts`, not in your YAML.
- A "Not in this version" line listing deferred control flow (branch/loop/foreach/conditions, custom step, human-in-the-loop) linking to the spec's Deferred section.

- [ ] **Step 3: Move Workflows #15 to "Available now"** on the roadmap/status page found in Step 1.

- [ ] **Step 4: Un-preview the `examples.md` workflows section**

`website/docs/examples.md` currently carries a `## Preview: workflows (roadmap #15)` section wrapped in a `:::note Not generated yet` admonition (the `workflows:` block was also added to its rendered `config.yaml`). Now that the feature ships:
- Remove the `:::note Not generated yet … :::` admonition (and the "preview"/"not a shipped feature" wording).
- Fold the workflow files into the shipped walkthrough: add `tools/rephrase.ts`, `tools/merge-answers.ts`, and `workflow/` to the **Input** tree, and add `src/mastra/workflows/research-flow.ts` + `compare-answers.ts` (and the copied tools) to the **Output** tree, so input→output stays coherent.
- Link to the new `workflow.md` reference page rather than restating its mapping (docs-single-source-of-truth).

- [ ] **Step 5: Commit**

```bash
git add website/docs
git commit -m "docs(workflows): add workflow reference page; mark #15 shipped"
```

### Task D4: Update the spec to reflect the shipped scope

**Files:**
- Modify: `.planning/superpowers/specs/2026-06-14-workflows-design.md`

- [ ] **Step 1: Move agent attachment from "Deferred" into the v1 "In" list**, noting cycles are allowed via the `mastra.getWorkflow` lazy thunk (the cleaner cycle break discovered during planning — not the `findCyclicNodes`+import-thunk approach the deferred note guessed). Keep `branch`/`loop`/`foreach`/conditions/custom-step/human-in-the-loop in Deferred.

- [ ] **Step 2: Update Status line** to `implemented (v1)`.

- [ ] **Step 3: Commit**

```bash
git add .planning/superpowers/specs/2026-06-14-workflows-design.md
git commit -m "docs(workflows): spec reflects shipped v1 (attachment in, cycles allowed)"
```

### Task D5: Final full verification

- [ ] **Step 1: Whole suite + build**

Run (from `builder/`): `pnpm build && pnpm test`
Expected: build clean; every test passes.

- [ ] **Step 2: Example end-to-end**

Run: `pnpm gen:example /tmp/wf-final && cd /tmp/wf-final && pnpm install && pnpm exec tsc --noEmit && cd "$OLDPWD"`
Expected: generation + typecheck both succeed. **Note:** `pnpm install` needs the npm registry — an install failure is a network/registry problem, not a codegen bug.

- [ ] **Step 3: Confirm the docs reflect shipped v1.** The spec status line (Task D4) reads
  `implemented (v1)` and attachment is in the "In" list. (No separate handoff file — the spec + this
  plan are the source of truth.)

---

## Self-Review

**Spec coverage** (against `.planning/superpowers/specs/2026-06-14-workflows-design.md`):
- `workflow/<id>.yaml`, `agent:`/`tool:` steps, sequential/parallel → Tasks A2, A4, B1. ✓
- `input`/`output` YAML→Zod primitives (full table: string/number/boolean/enum/array/optional) → Task A1. ✓
- Registration via `config.yaml → workflows` → Tasks A2, B2. ✓
- Validation list (missing file, bad agent/tool ref, parallel<2, multi/empty step key, collisions, "types checked by tsc not parser") → Task A4 + B3 Step 6. ✓
- Copy workflow-referenced tools (incl. workflow-only tools, deduped) → Task B3. ✓
- Build order parser→emit→examples/docs → Phases A/B/D. ✓
- **Agent attachment (beyond the spec's deferral, per this session's decision), cycles allowed** → Phase C. ✓ (Task D4 updates the spec to match.)
- **Loops, conditions, `branch`/`foreach`, custom `step/`, `schema/`, human-in-the-loop stay deferred** (see spec "Deferred"). This plan ships sequential + parallel + attachment only.

**Placeholder scan:** no TBD/"add error handling"/"similar to Task N"; every code step shows complete code; the one genuinely uncertain piece (cyclic emission shape) is gated behind the C1 spike with an explicit fallback + escalation, not a hand-wave.

**Type consistency:** `ResolvedWorkflow`/`ResolvedWorkflowStep`/`ResolvedStepRef`/`ResolvedWorkflowRef`, `ResolvedAgent.workflows`/`lazyWorkflows`, `ParsedProject.workflows` defined in A3 and used identically in A4/B1/B2/B3/C2/C3. `emitWorkflow`, `compileZodObject`, `findCyclicNodes` signatures match across tasks. `ResolvedAgent` literals in B2/C3 tests include the new fields so they compile. Method name `mastra.getWorkflow` is used consistently and is the verified API (`mastra/index.d.ts:932`).

**One known cross-task ordering note:** Tasks A3 and A4 are split for narrative clarity but A3 alone leaves `tsc` red (parser doesn't yet set the new fields). Either commit A3+A4 together or accept a transient red build between those two commits only.
