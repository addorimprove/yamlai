# Workflow Loops + Condition Resource Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `loop:` step kind to the YAML Agent Builder that codegens Mastra's `.dountil` / `.dowhile` / `.foreach`, with **single-leaf OR multi-step bodies**, plus a new author-as-code **`condition/<id>.ts`** predicate resource backing `until:`/`while:` loops. Next increment after sequential/parallel/agent-attachment (Phases A–D, shipped) and the custom `step/` resource (S1–S6, shipped).

**Architecture:** Mirror the `step/` resource. A loop is a top-level step (`kind:'loop'`) with one driver (`until`/`while`/`foreach`/`max_iterations`-only) and a body that is **either** a single leaf (`agent`/`tool`/`step`, schemas inferred) **or** a `steps:` sequence (requires `input:`/`output:`, emitted as an **inline nested `createWorkflow(...).then(...).commit()`** — `Workflow implements Step`, so a nested workflow is a valid loop-body step). `until:`/`while:` reference a `condition/<id>.ts` file resolved by existence (like `step/`), copied verbatim into `src/mastra/workflows/condition/<id>.ts`, imported as `./condition/<id>`. The condition file exports a bare `async ({ inputData, iterationCount }) => boolean` matching Mastra's `LoopConditionFunction`. `max_iterations:` compiles into an inline wrapper around the imported predicate (or, alone, into a pure iteration guard).

**Tech Stack:** TypeScript (ESM), Zod v4, `yaml`, `@mastra/core` (`^1.43`, generated project; verified vs installed `1.42`), `node:test`. All commands run from `builder/`.

---

## Decisions locked (this session, 2026-06-17 — reconfirmed with user)

- **Multi-step loop bodies ARE in scope.** Body is **either** a single leaf (`agent`/`tool`/`step`)
  **or** a `steps:` list of leaves. A multi-step body is emitted as an **inline nested workflow**
  passed as the loop step. **Confirmed by spike** (see Verified API facts): `Workflow implements Step`,
  and `.dountil(createWorkflow({...}).then(refine).then(tag).commit(), cond)` typechecks under full
  strict mode against the installed core, with `cond`'s `inputData`/`iterationCount` correctly typed.
  - A multi-step body **requires** `input:`/`output:` (YAML→Zod primitives, reusing `compileZodObject`)
    — these become the nested workflow's `inputSchema`/`outputSchema` (Mastra can't infer them across
    verbatim tool/step files). A single-leaf body must **not** declare `input`/`output` (inferred).
  - Body sub-steps are **leaves only** (no nested `parallel`/`loop` in a body) for this increment.
- **Keyword picks the method:** `until:` → `.dountil` (repeat **until** predicate true),
  `while:` → `.dowhile` (repeat **while** predicate true), `foreach: true` → `.foreach`.
- **Conditions are a verbatim `.ts` resource at the project ROOT: `condition/<id>.ts`** (sibling to
  `agent/`, `tools/`, `step/`, `workflow/`), resolved by file existence. **[Changed from the first
  draft's `workflow/condition/` — user chose root for consistency with `step/`.]** Generated to
  `src/mastra/workflows/condition/<id>.ts` (symmetric with `step/` → `workflows/steps/`). Inline
  `when: "<js string>"` is **rejected**. Only `until:`/`while:` use a condition; `foreach` has none.
- **`max_iterations: N`** (optional positive int) is an iteration guard, valid with `until:`/`while:`
  **and on its own** (pure-count loop). Compiled as: dountil → `(await cond(args)) || args.iterationCount >= N`;
  dowhile → `(await cond(args)) && args.iterationCount < N`; **pure-count** (no driver) →
  `.dountil(body, async (args) => args.iterationCount >= N)`. Invalid with `foreach` (no `iterationCount`).
- **`concurrency: N`** (optional positive int) valid **only** with `foreach` → `.foreach(body, { concurrency: N })`.
- **`foreach` array-precondition is unchecked at parse time** — surfaces at the generated project's
  `tsc` (Mastra types the step arg as the literal string `'Previous step must return an array type'`
  when the prev schema isn't an array). Part of the broader **gen-time condition/chain checking
  deferred** to a later increment (recorded in memory `[[workflow-gentime-checking-deferred]]`).
- **Loops are top-level steps only** — not `parallel` children (a `loop` under `parallel` is a parse error).

## Verified API facts (against installed `@mastra/core@1.42`, `dist/workflows/`)

- `dowhile(step, condition)` / `dountil(step, condition)` (`workflow.d.ts:211-212`) — take **one**
  `Step` + a `LoopConditionFunction`; return the `Workflow` (chainable).
- `foreach(step, opts?)` (`workflow.d.ts:213-215`) — `opts = { concurrency: number }`. `step` arg
  type is `'Previous step must return an array type'` unless `TPrevSchema` is an array. Output → `TSchemaOut[]`.
- `LoopConditionFunction = (params: ConditionFunctionParams & { iterationCount: number }) => Promise<boolean>`
  (`step.d.ts:56-58`). `ConditionFunctionParams` = `ExecuteFunctionParams` minus `setState`/`suspend`
  → includes `inputData` (the **body's output**), `mastra`, `getStepResult`, `getInitData`, etc. So a
  condition file is `export const <id> = async ({ inputData, iterationCount }) => <boolean>`.
- **`class Workflow ... implements Step`** (`workflow.d.ts:127`) → a nested `createWorkflow(...).commit()`
  is itself a `Step`, usable directly as the loop-body arg. **Spike-confirmed** to typecheck under
  `--strict` against installed core (multi-step body + `dountil` + iteration guard).
- `createStep(agent)` / `createStep(tool)` produce a `Step`; an authored `step/` `createStep({...})`
  **is** a `Step` (used directly). Same `renderLeaf` rule already in the emitter.

## File Structure

| File | Responsibility |
|---|---|
| `builder/src/schemas.ts` (modify) | add `LoopSchema` (+ nested `steps`/`input`/`output`); add `loop?` to `WorkflowStepSchema` |
| `builder/src/types.ts` (modify) | `ResolvedWorkflowStep.kind` += `'loop'`; add `ResolvedLoop` + `ResolvedLoopBody`; `ResolvedWorkflow.conditionFiles` |
| `builder/src/parser.ts` (modify) | resolve `loop` (driver + body[leaf|sequence] + condition ref), validations, `conditionFiles`, collisions |
| `builder/src/codegen/emit-workflow.ts` (modify) | import conditions; emit `.dountil`/`.dowhile`/`.foreach`; render single-leaf or inline nested-workflow body; `max_iterations` wrapper; `concurrency` opt |
| `builder/src/codegen/generate.ts` (modify) | copy condition files → `src/mastra/workflows/condition/<id>.ts`, deduped |
| `examples/condition/*.ts`, `examples/step/*.ts`, `examples/workflow/*.yaml` (create), `examples/config.yaml` (modify) | demo single-leaf AND multi-step loops |
| `builder/test/example-workflows.test.ts` (modify) | assert loop examples emit + register |
| `website/docs/reference/condition.md` (create), `website/docs/reference/workflow.md`, `website/sidebars.ts` (modify) | document `loop:` + `condition/` resource |
| `.planning/superpowers/specs/2026-06-14-workflows-design.md` (modify) | move loops/conditions out of Deferred when this lands |

---

## Phase L — loops + the `condition/<id>.ts` resource

Ships: `loop:` is a valid top-level step with single-leaf or multi-step bodies; `until:`/`while:` reference verbatim condition files copied into `workflows/condition/`; `foreach: true` loops over an array-producing previous step; `max_iterations` (incl. alone) and `concurrency` map to the right engine call; examples demonstrate both body forms and typecheck under strict `tsc`.

### Task L0: SPIKE — already confirmed; re-verify on the generated project (1.43)

**Not TDD — de-risks L4's nested-workflow emission.** The multi-step body shape was confirmed against
installed `@mastra/core@1.42` (see Verified API facts). When L6 generates `/tmp/wf-loops` (pinned `^1.43`),
the `tsc --noEmit` there is the real gate — it re-confirms the nested-workflow body + condition typing
on the shipped core. No separate spike file needed; **if L6's `tsc` flags the nested-workflow shape**
(not just an example data mismatch), STOP and escalate with the error before changing the emitter.

---

### Task L1: Schema — `LoopSchema` + `loop` step

**Files:**
- Modify: `builder/src/schemas.ts`
- Test: `builder/test/workflows-schema.test.ts`

- [ ] **Step 1: Add failing tests** (append to `workflows-schema.test.ts`)

```ts
test('WorkflowSchema accepts a single-leaf loop (until + body + max_iterations)', () => {
  const wf = WorkflowSchema.parse({
    steps: [
      { agent: 'drafter' },
      { loop: { until: 'good-enough', step: 'refiner', max_iterations: 5 } },
    ],
  });
  assert.equal(wf.steps[1].loop?.until, 'good-enough');
  assert.equal(wf.steps[1].loop?.step, 'refiner');
  assert.equal(wf.steps[1].loop?.max_iterations, 5);
});

test('WorkflowSchema accepts a multi-step loop body with input/output', () => {
  const wf = WorkflowSchema.parse({
    steps: [{ loop: {
      while: 'keep',
      input: { text: 'string', score: 'number' },
      output: { text: 'string', score: 'number' },
      steps: [{ agent: 'drafter' }, { step: 'refine' }],
    } }],
  });
  assert.equal(wf.steps[0].loop?.while, 'keep');
  assert.equal(wf.steps[0].loop?.steps?.length, 2);
});

test('WorkflowSchema accepts a foreach loop and a pure-count loop', () => {
  assert.equal(WorkflowSchema.safeParse({ steps: [{ loop: { foreach: true, step: 'p', concurrency: 3 } }] }).success, true);
  assert.equal(WorkflowSchema.safeParse({ steps: [{ loop: { step: 'poll', max_iterations: 10 } }] }).success, true);
});

test('WorkflowSchema rejects non-positive/non-int max_iterations and concurrency', () => {
  assert.equal(WorkflowSchema.safeParse({ steps: [{ loop: { until: 'c', step: 's', max_iterations: 0 } }] }).success, false);
  assert.equal(WorkflowSchema.safeParse({ steps: [{ loop: { foreach: true, step: 's', concurrency: 1.5 } }] }).success, false);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --import tsx --test test/workflows-schema.test.ts`

- [ ] **Step 3: Implement** in `schemas.ts` — add `LoopSchema` above `WorkflowStepSchema` (cross-field exclusivity enforced in the parser), and a `loop` field on `WorkflowStepSchema`:

```ts
// A loop wraps a body (single leaf OR a `steps:` sequence) with a driver
// (until/while/foreach/max_iterations). Exactly-one-of rules enforced in the parser.
const LoopSchema = z.object({
  until: z.string().min(1).optional(),
  while: z.string().min(1).optional(),
  foreach: z.boolean().optional(),
  // single-leaf body:
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  // multi-step body (requires input/output):
  steps: z.array(WorkflowLeafSchema).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  // guards:
  max_iterations: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
});
```

Add to `WorkflowStepSchema`:

```ts
  loop: LoopSchema.optional(),
```

> `WorkflowLeafSchema` (agent/tool/step) is reused for `steps:` children. Do **not** add `loop` to
> `WorkflowLeafSchema` — loops can't be parallel children, and a loop body can't nest a loop.

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/workflows-schema.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(workflow-loops): accept loop step in WorkflowSchema"`

---

### Task L2: Resolved types

**Files:**
- Modify: `builder/src/types.ts`

No test of its own; verified by `tsc` in L3.

- [ ] **Step 1: Add `ResolvedLoopBody` + `ResolvedLoop`** in `types.ts`:

```ts
/** A loop body: one leaf, or an inline nested-workflow sequence. */
export type ResolvedLoopBody =
  | { kind: 'leaf'; ref: ResolvedStepRef }
  | {
      kind: 'sequence';
      /** Synthetic nested-workflow id, e.g. "refine-loop-loop-2". */
      id: string;
      /** `z.object({...})` source for the nested workflow's input/output. */
      inputZod: string;
      outputZod: string;
      steps: ResolvedStepRef[];
    };

/** A resolved loop step: a body driven by dountil/dowhile/foreach. */
export interface ResolvedLoop {
  loopKind: 'dountil' | 'dowhile' | 'foreach';
  body: ResolvedLoopBody;
  /** Predicate file for dountil/dowhile; absent for foreach and pure-count loops. */
  condition?: ResolvedTool;
  /** Iteration guard for dountil/dowhile/pure-count. */
  maxIterations?: number;
  /** Parallelism for foreach. */
  concurrency?: number;
}
```

Widen `ResolvedWorkflowStep`:

```ts
export interface ResolvedWorkflowStep {
  kind: 'agent' | 'tool' | 'step' | 'parallel' | 'loop';
  ref?: ResolvedStepRef;        // agent | tool | step
  children?: ResolvedStepRef[]; // parallel (>= 2)
  loop?: ResolvedLoop;          // loop
}
```

- [ ] **Step 2: Add `conditionFiles` to `ResolvedWorkflow`** (reuses `ResolvedTool`):

```ts
  /** Distinct condition predicates referenced by loops, first-seen order (imports + verbatim copy). */
  conditionFiles: ResolvedTool[];
```

- [ ] **Step 3: Commit** — `git commit -m "feat(workflow-loops): resolved loop + condition types"`

---

### Task L3: Parser resolves `loop` blocks + condition refs

**Files:**
- Modify: `builder/src/parser.ts`
- Test: `builder/test/workflows-parser.test.ts`

The workflow loop already has `agentRefs`/`toolRefs`/`stepFileRefs` and `resolveLeaf(node, where)`.
Add a `conditionFileRefs` collector and a `loop` branch. Reuse `resolveLeaf` for body leaves (so
agents/tools/steps inside a loop body are auto-added to the import/copy sets). Reuse `compileZodObject`
for a multi-step body's `input`/`output`.

- [ ] **Step 1: Add failing tests** (append to `workflows-parser.test.ts`):

```ts
test('resolves a single-leaf until loop: body + condition file', () => {
  const dir = makeProject({
    ...base('flow'),
    'condition/good-enough.ts': 'export const goodEnough = async () => true;\n',
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
    'condition/keep.ts': 'export const keep = async () => false;\n',
    'step/refine.ts': "import { createStep } from '@mastra/core/workflows';\nexport const refine = {};\n",
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
    'step/process.ts': "export const process = {};\n",
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
    'condition/c.ts': 'export const c = async () => true;\n',
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
    'condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n' });
  assert.throws(() => parseProject(dir1), /loop must have exactly one body/);
  const dir2 = makeProject({ ...base('bad2'),
    'condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad2.yaml': 'steps:\n  - loop:\n      until: c\n      agent: research-agent\n      steps:\n        - agent: support-agent\n' });
  assert.throws(() => parseProject(dir2), /loop must have exactly one body/);
});

test('errors when a multi-step body omits input/output', () => {
  const dir = makeProject({ ...base('bad'),
    'condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n      steps:\n        - agent: research-agent\n' });
  assert.throws(() => parseProject(dir), /multi-step loop body requires `input:` and `output:`/);
});

test('errors when a single-leaf body declares input/output', () => {
  const dir = makeProject({ ...base('bad'),
    'condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n      agent: research-agent\n      input: { prompt: string }\n' });
  assert.throws(() => parseProject(dir), /`input:`\/`output:` are only for a multi-step `steps:` body/);
});

test('errors on an unresolved condition file', () => {
  const dir = makeProject({ ...base('bad'),
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: ghost\n      agent: research-agent\n' });
  assert.throws(() => parseProject(dir), /condition not found: condition\/ghost\.ts/);
});

test('errors when max_iterations is used with foreach', () => {
  const dir = makeProject({ ...base('bad'),
    'step/process.ts': 'export const process = {};\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      foreach: true\n      step: process\n      max_iterations: 3\n' });
  assert.throws(() => parseProject(dir), /`max_iterations` is not valid with `foreach:`/);
});

test('errors when concurrency is used without foreach', () => {
  const dir = makeProject({ ...base('bad'),
    'condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n      agent: research-agent\n      concurrency: 2\n' });
  assert.throws(() => parseProject(dir), /`concurrency` is only valid with `foreach:`/);
});

test('errors when a loop is used as a parallel child', () => {
  const dir = makeProject({ ...base('bad'),
    'workflow/bad.yaml':
      'steps:\n  - parallel:\n      - agent: research-agent\n      - loop:\n          foreach: true\n          agent: support-agent\n' });
  // WorkflowLeafSchema has no `loop` key → the loop child resolves to neither agent/tool/step.
  assert.throws(() => parseProject(dir), /must have exactly one of/);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --import tsx --test test/workflows-parser.test.ts`

- [ ] **Step 3: Implement in `parser.ts`.**

Add the collector near `stepFileRefs`:

```ts
    const conditionFileRefs: ResolvedTool[] = [];
```

Include `loop` in the top-level "exactly one of" count, and restructure the branch as
`if (hasParallel) {...} else if (hasLoop) {...} else {...}`:

```ts
      const hasLoop = step.loop !== undefined && step.loop !== null;
      if ((hasParallel?1:0)+(hasAgent?1:0)+(hasTool?1:0)+(hasStep?1:0)+(hasLoop?1:0) !== 1) {
        addIssue(wfPath, `step ${i + 1} must have exactly one of \`agent:\`, \`tool:\`, \`step:\`, \`parallel:\`, or \`loop:\``);
        ok = false; continue;
      }
```

The `loop` branch (resolve condition like a step file; resolve body via `resolveLeaf`; compile
multi-step `input`/`output` via `compileZodObject`):

```ts
      else if (hasLoop) {
        const lp = step.loop as {
          until?: string; while?: string; foreach?: boolean;
          agent?: string; tool?: string; step?: string;
          steps?: { agent?: string; tool?: string; step?: string }[];
          input?: Record<string, unknown>; output?: Record<string, unknown>;
          max_iterations?: number; concurrency?: number;
        };

        // --- driver ---
        const drivers = [lp.until !== undefined ? 'until' : null,
                         lp.while !== undefined ? 'while' : null,
                         lp.foreach !== undefined ? 'foreach' : null].filter(Boolean);
        if (drivers.length > 1) {
          addIssue(wfPath, `step ${i + 1}: loop has more than one of \`until:\`, \`while:\`, \`foreach:\``);
          ok = false; continue;
        }
        if (drivers.length === 0 && lp.max_iterations === undefined) {
          addIssue(wfPath, `step ${i + 1}: loop needs one of \`until:\`, \`while:\`, \`foreach:\`, or \`max_iterations:\``);
          ok = false; continue;
        }
        if (lp.foreach !== undefined && lp.foreach !== true) {
          addIssue(wfPath, `step ${i + 1}: \`foreach\` must be \`true\``); ok = false; continue;
        }
        if (lp.foreach && lp.max_iterations !== undefined) {
          addIssue(wfPath, `step ${i + 1}: \`max_iterations\` is not valid with \`foreach:\``); ok = false; continue;
        }
        if (lp.concurrency !== undefined && !lp.foreach) {
          addIssue(wfPath, `step ${i + 1}: \`concurrency\` is only valid with \`foreach:\``); ok = false; continue;
        }

        // --- body (exactly one of: single leaf | steps sequence) ---
        const hasLeaf = lp.agent !== undefined || lp.tool !== undefined || lp.step !== undefined;
        const hasSeq = Array.isArray(lp.steps) && lp.steps.length > 0;
        if (hasLeaf === hasSeq) {
          addIssue(wfPath, `step ${i + 1}: loop must have exactly one body — a single \`agent:\`/\`tool:\`/\`step:\` or a \`steps:\` list`);
          ok = false; continue;
        }

        let body: ResolvedLoopBody | undefined;
        if (hasLeaf) {
          if (lp.input !== undefined || lp.output !== undefined) {
            addIssue(wfPath, `step ${i + 1}: \`input:\`/\`output:\` are only for a multi-step \`steps:\` body`);
            ok = false; continue;
          }
          const ref = resolveLeaf({ agent: lp.agent, tool: lp.tool, step: lp.step }, `step ${i + 1} loop body`);
          if (!ref) { ok = false; continue; }
          body = { kind: 'leaf', ref };
        } else {
          if (lp.input === undefined || lp.output === undefined) {
            addIssue(wfPath, `step ${i + 1}: a multi-step loop body requires \`input:\` and \`output:\``);
            ok = false; continue;
          }
          const inC = compileZodObject(lp.input);
          const outC = compileZodObject(lp.output);
          for (const e of inC.errors) addIssue(wfPath, `step ${i + 1} loop input.${e}`);
          for (const e of outC.errors) addIssue(wfPath, `step ${i + 1} loop output.${e}`);
          const refs: ResolvedStepRef[] = [];
          let bodyOk = true;
          for (const [j, kid] of lp.steps!.entries()) {
            const r = resolveLeaf(kid, `step ${i + 1} loop body step ${j + 1}`);
            if (!r) bodyOk = false; else refs.push(r);
          }
          if (!bodyOk || inC.errors.length || outC.errors.length) { ok = false; continue; }
          body = { kind: 'sequence', id: `${wfId}-loop-${i + 1}`, inputZod: inC.expr, outputZod: outC.expr, steps: refs };
        }

        // --- condition (until/while only) ---
        let condition: ResolvedTool | undefined;
        if (lp.until !== undefined || lp.while !== undefined) {
          const condId = (lp.until ?? lp.while) as string;
          const condPath = `condition/${condId}.ts`;
          if (!existsSync(join(rootDir, condPath))) {
            addIssue(wfPath, `condition not found: ${condPath}`); ok = false; continue;
          }
          const exportName = toExportName(condId);
          if (!conditionFileRefs.some((c) => c.id === condId)) {
            conditionFileRefs.push({ id: condId, filePath: condPath, exportName });
          }
          condition = { id: condId, filePath: condPath, exportName };
        }

        const loopKind: 'dountil' | 'dowhile' | 'foreach' =
          lp.foreach ? 'foreach' : lp.while !== undefined ? 'dowhile' : 'dountil';

        resolvedSteps.push({ kind: 'loop', loop: { loopKind, body, condition, maxIterations: lp.max_iterations, concurrency: lp.concurrency } });
        continue;
      }
```

Add `conditionFiles: conditionFileRefs` to the `workflows.push({...})` object. Extend the
**module-scope** collision check with condition exports:

```ts
      ...wf.conditionFiles.map((c) => ({ name: c.exportName, key: `condition:${c.id}` })),
```

> Import `ResolvedLoopBody` (+ existing `ResolvedStepRef`) in the parser's type imports.

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/workflows-parser.test.ts`

- [ ] **Step 5: Full suite + build.** Run: `pnpm build && pnpm test`

- [ ] **Step 6: Commit** — `git commit -m "feat(workflow-loops): resolve loop blocks + condition refs"`

---

### Task L4: emit-workflow emits loop methods

**Files:**
- Modify: `builder/src/codegen/emit-workflow.ts`
- Test: `builder/test/emit-workflow.test.ts`

`renderLeaf(ref)` already exists (`step` → bare export, else `createStep(...)`).

- [ ] **Step 1: Update the shared `SEQ` fixture** to add `conditionFiles: []`.

- [ ] **Step 2: Add failing tests** (append to `emit-workflow.test.ts`):

```ts
test('emits .dountil with a single-leaf body, imported condition, and max_iterations wrapper', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [{ kind: 'loop', loop: {
      loopKind: 'dountil',
      body: { kind: 'leaf', ref: { kind: 'agent', id: 'support-agent', exportName: 'supportAgent' } },
      condition: { id: 'good-enough', filePath: 'condition/good-enough.ts', exportName: 'goodEnough' },
      maxIterations: 5,
    } }],
    agents: [{ id: 'support-agent', exportName: 'supportAgent' }], tools: [], stepFiles: [],
    conditionFiles: [{ id: 'good-enough', filePath: 'condition/good-enough.ts', exportName: 'goodEnough' }],
  });
  assert.match(out, /import \{ goodEnough \} from '\.\/condition\/good-enough';/);
  assert.match(out, /\.dountil\(createStep\(supportAgent\), async \(args\) => \(await goodEnough\(args\)\) \|\| args\.iterationCount >= 5\)/);
});

test('emits .dowhile with a bare condition (no max_iterations)', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [{ kind: 'loop', loop: {
      loopKind: 'dowhile',
      body: { kind: 'leaf', ref: { kind: 'step', id: 'refiner', exportName: 'refiner' } },
      condition: { id: 'keep', filePath: 'condition/keep.ts', exportName: 'keep' },
    } }],
    agents: [], tools: [],
    stepFiles: [{ id: 'refiner', filePath: 'step/refiner.ts', exportName: 'refiner' }],
    conditionFiles: [{ id: 'keep', filePath: 'condition/keep.ts', exportName: 'keep' }],
  });
  assert.match(out, /\.dowhile\(refiner, keep\)/);
});

test('emits .foreach with concurrency and no condition import', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [{ kind: 'loop', loop: {
      loopKind: 'foreach',
      body: { kind: 'leaf', ref: { kind: 'step', id: 'process', exportName: 'process' } },
      concurrency: 3,
    } }],
    agents: [], tools: [],
    stepFiles: [{ id: 'process', filePath: 'step/process.ts', exportName: 'process' }],
    conditionFiles: [],
  });
  assert.match(out, /\.foreach\(process, \{ concurrency: 3 \}\)/);
  assert.doesNotMatch(out, /\.\/condition\//);
});

test('emits a multi-step loop body as an inline nested workflow', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [{ kind: 'loop', loop: {
      loopKind: 'dountil',
      body: { kind: 'sequence', id: 'flow-loop-1',
        inputZod: 'z.object({ prompt: z.string() })', outputZod: 'z.object({ text: z.string() })',
        steps: [
          { kind: 'agent', id: 'research-agent', exportName: 'researchAgent' },
          { kind: 'step', id: 'refine', exportName: 'refine' },
        ] },
      maxIterations: 3,
    } }],
    agents: [{ id: 'research-agent', exportName: 'researchAgent' }], tools: [],
    stepFiles: [{ id: 'refine', filePath: 'step/refine.ts', exportName: 'refine' }],
    conditionFiles: [],
  });
  assert.match(out, /createWorkflow\(\{ id: "flow-loop-1", inputSchema: z\.object\(\{ prompt: z\.string\(\) \}\), outputSchema: z\.object\(\{ text: z\.string\(\) \}\) \}\)/);
  assert.match(out, /\.then\(createStep\(researchAgent\)\)/);
  assert.match(out, /\.then\(refine\)/);
  assert.match(out, /\.commit\(\),\s*async \(args\) => args\.iterationCount >= 3\)/); // pure-count guard (no condition)
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `node --import tsx --test test/emit-workflow.test.ts`

- [ ] **Step 4: Implement in `emit-workflow.ts`.**

Condition imports after the step imports:

```ts
  for (const c of wf.conditionFiles) {
    lines.push(`import { ${c.exportName} } from './condition/${c.id}';`);
  }
```

A body renderer (single leaf or inline nested workflow):

```ts
  const renderLoopBody = (b: ResolvedLoopBody): string => {
    if (b.kind === 'leaf') return renderLeaf(b.ref);
    const inner = b.steps.map((s) => `      .then(${renderLeaf(s)})`).join('\n');
    return (
      `createWorkflow({ id: ${JSON.stringify(b.id)}, inputSchema: ${b.inputZod}, outputSchema: ${b.outputZod} })\n` +
      `${inner}\n` +
      `      .commit()`
    );
  };
```

The condition argument (predicate + optional `max_iterations` guard, or pure-count guard):

```ts
  const renderLoopCondition = (lp: ResolvedLoop): string => {
    const N = lp.maxIterations;
    if (!lp.condition) return `async (args) => args.iterationCount >= ${N}`; // pure-count
    const c = lp.condition.exportName;
    if (N === undefined) return c;
    return lp.loopKind === 'dountil'
      ? `async (args) => (await ${c}(args)) || args.iterationCount >= ${N}`
      : `async (args) => (await ${c}(args)) && args.iterationCount < ${N}`;
  };
```

The `loop` arm in the chain loop (insert as `else if` before the plain-leaf `else`):

```ts
    } else if (step.kind === 'loop') {
      const lp = step.loop!;
      const body = renderLoopBody(lp.body);
      if (lp.loopKind === 'foreach') {
        const opts = lp.concurrency !== undefined ? `, { concurrency: ${lp.concurrency} }` : '';
        lines.push(`  .foreach(${body}${opts})`);
      } else {
        lines.push(`  .${lp.loopKind}(${body}, ${renderLoopCondition(lp)})`);
      }
    }
```

> Import `ResolvedLoop`, `ResolvedLoopBody` from `../types.js`. The multi-step body string contains
> newlines; that's fine inside `.dountil(<body>, <cond>)` — it produces valid (if multi-line) TS,
> validated by the example `tsc` in L6.

- [ ] **Step 5: Run to verify it passes.** Run: `node --import tsx --test test/emit-workflow.test.ts`

- [ ] **Step 6: Commit** — `git commit -m "feat(workflow-loops): emit dountil/dowhile/foreach (single + nested bodies)"`

---

### Task L5: generate.ts copies condition files

**Files:**
- Modify: `builder/src/codegen/generate.ts`
- Test: `builder/test/workflows-integration.test.ts`

- [ ] **Step 1: Add failing test** (append to `workflows-integration.test.ts`):

```ts
test('copies a referenced condition verbatim into workflows/condition/', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nworkflows: [w]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
    'condition/good-enough.ts': 'export const goodEnough = async () => true;\n',
    'workflow/w.yaml': 'steps:\n  - loop:\n      until: good-enough\n      agent: a\n',
  });
  const files = generateProject(parseProject(dir), dir);
  assert.ok(files['src/mastra/workflows/condition/good-enough.ts'], 'condition copied');
  assert.match(files['src/mastra/workflows/w.ts'], /import \{ goodEnough \} from '\.\/condition\/good-enough';/);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --import tsx --test test/workflows-integration.test.ts`

- [ ] **Step 3: Implement in `generate.ts`** — inside `for (const wf of project.workflows)`, after copying `wf.stepFiles`:

```ts
    for (const c of wf.conditionFiles) {
      const dest = `src/mastra/workflows/condition/${c.id}.ts`;
      if (files[dest]) continue;
      files[dest] = readFileSync(join(rootDir, c.filePath), 'utf8');
    }
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/workflows-integration.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(workflow-loops): copy condition files into workflows/condition/"`

---

### Task L6: Examples (single + multi-step) + docs + end-to-end typecheck + spec update

The generated project's `tsc` is the real proof: it checks the loop body↔condition data flow and the
nested-workflow shape on the shipped core (`^1.43`).

**Files:**
- Create: `examples/step/refine.ts`, `examples/condition/good-enough.ts`, `examples/workflow/refine-loop.yaml` (single-leaf), `examples/workflow/draft-loop.yaml` (multi-step body)
- Modify: `examples/config.yaml`, `builder/test/example-workflows.test.ts`
- Create: `website/docs/reference/condition.md`; Modify: `website/docs/reference/workflow.md`, `website/sidebars.ts`
- Modify: `.planning/superpowers/specs/2026-06-14-workflows-design.md`

- [ ] **Step 1: Body step** — `examples/step/refine.ts`:
  ```ts
  import { createStep } from '@mastra/core/workflows';
  import { z } from 'zod';
  export const refine = createStep({
    id: 'refine',
    inputSchema: z.object({ text: z.string(), score: z.number() }),
    outputSchema: z.object({ text: z.string(), score: z.number() }),
    execute: async ({ inputData }) => ({ text: inputData.text + '.', score: inputData.score + 1 }),
  });
  ```

- [ ] **Step 2: Condition** — `examples/condition/good-enough.ts` (typed `inputData` = body output, + `iterationCount`):
  ```ts
  export const goodEnough = async ({ inputData }: { inputData: { text: string; score: number }; iterationCount: number }) =>
    inputData.score >= 3;
  ```
  > Authored by hand (copied verbatim). Match `LoopConditionFunction`. If `tsc` complains about the
  > param type, widen it — fix the **example**, not the emitter.

- [ ] **Step 3: Single-leaf loop** — `examples/workflow/refine-loop.yaml`:
  ```yaml
  description: Refine a draft until it scores well enough (or 5 tries).
  input:  { text: string, score: number }
  output: { text: string, score: number }
  steps:
    - loop:
        until: good-enough
        step: refine
        max_iterations: 5
  ```

- [ ] **Step 4: Multi-step loop** — `examples/workflow/draft-loop.yaml` (nested-workflow body). Use a
  body whose first/last shapes chain (both `refine` here → identical IO, so a 2× `refine` body
  typechecks; swap one for another typed step if you add one):
  ```yaml
  description: Run a two-stage refine body in a loop until good enough.
  input:  { text: string, score: number }
  output: { text: string, score: number }
  steps:
    - loop:
        until: good-enough
        input:  { text: string, score: number }
        output: { text: string, score: number }
        steps:
          - step: refine
          - step: refine
        max_iterations: 4
  ```
  > NOTE: `steps: [refine, refine]` is two iterations of the same `Step` in the nested workflow — its
  > id namespace may reject a duplicate at runtime; if `tsc`/generation flags it, add a second typed
  > step (e.g. `examples/step/score.ts` with matching IO) and use `[refine, score]`. This is an
  > **example** fix, not an emitter change.

- [ ] **Step 5: Register** `refine-loop` and `draft-loop` in `examples/config.yaml` `workflows:`.

- [ ] **Step 6: Update `example-workflows.test.ts`** — assert both loop workflows emit, register
  (`refineLoop`, `draftLoop`), import `./condition/good-enough` and `./steps/refine`, the condition is
  copied to `src/mastra/workflows/condition/good-enough.ts`, and `draft-loop.ts` contains a nested
  `createWorkflow({ id: "draft-loop-loop-1"` ... `.commit()`.

- [ ] **Step 7: Regenerate + typecheck end-to-end.**
  ```bash
  pnpm gen:example /tmp/wf-loops
  cd /tmp/wf-loops && pnpm install && pnpm exec tsc --noEmit
  ```
  Expected: `tsc` exits 0. (Install failures = network/registry, not codegen bugs.) Data-flow
  mismatches → fix the example YAML/step/condition, **not** the emitter. **Nested-workflow shape
  errors → STOP and escalate (per L0).**

- [ ] **Step 8: Docs.**
  - Create `website/docs/reference/condition.md` (mirror `reference/step.md`): a `.ts` module exporting
    `export const <camelCaseId> = async ({ inputData, iterationCount }) => boolean` (`LoopConditionFunction`);
    `inputData` = the loop body's output; referenced via `until:`/`while:`; copied to `src/mastra/workflows/condition/`.
  - In `reference/workflow.md`: add a `loop:` row to the Steps table (sub-keys
    `until`/`while`/`foreach`, body `agent`/`tool`/`step` **or** `steps:` + `input`/`output`,
    `max_iterations`, `concurrency`); worked examples for both body forms; mapping
    (`until`→`.dountil`, `while`→`.dowhile`, `foreach: true`→`.foreach`, `max_iterations`-alone→count loop);
    note multi-step bodies emit a nested workflow and `foreach`'s array precondition is checked at the
    generated project's `tsc`. Remove `loop`/`foreach`/conditions/custom-step from "Not in this version".
  - Add `reference/condition` to `sidebars.ts`.

- [ ] **Step 9: Spec update.** In `.planning/superpowers/specs/2026-06-14-workflows-design.md`: move
  loops + the `condition/` resource out of **Deferred** into implemented scope (mirror the `step/`
  SHIPPED note). Update `Status:`. Note gen-time chain/condition checking remains deferred.

- [ ] **Step 10: Full suite + build.** Run: `pnpm build && pnpm test`

- [ ] **Step 11: Commit** — `git commit -m "feat(workflow-loops): example loops (single + multi-step) + condition docs"`

---

## Out of scope (still deferred)

- **Gen-time condition/chain checking** (incl. `foreach`'s array-precondition, loop body↔condition
  shape verification at parse time). Stays runtime/`tsc`-validated. Recorded in memory
  `[[workflow-gentime-checking-deferred]]`.
- **`parallel`/nested `loop` inside a loop body** — body sub-steps are sequential leaves only this increment.
- **`branch` / `when_step:` (condition-on-`.then`)** — engine-verified: `.branch()` runs **all** truthy
  arms (not first-match). The `condition/` file is the natural building block for branch arms when pursued.
- **`schema/` escape hatch** and **human-in-the-loop** (suspend/resume) — see the spec's Deferred section.

## When this lands

- Move loops + `condition/` out of the spec's **Deferred** section (Task L6 Step 9).
- Update `[[workflows-feature-handoff]]` memory: loops shipped; remaining deferred = gen-time checking,
  branch/when_step, schema escape hatch, human-in-the-loop, loop-body parallel/nesting.
