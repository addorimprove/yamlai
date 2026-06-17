# Workflow Loops + Condition Resource Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `loop:` step kind to the YAML Agent Builder that codegens Mastra's `.dountil` / `.dowhile` / `.foreach`, plus a new author-as-code **`workflow/condition/<id>.ts`** predicate resource that backs `until:`/`while:` loops. This is the next increment after sequential/parallel/agent-attachment (Phases A–D, shipped) and the custom `step/` resource (S1–S6, shipped).

**Architecture:** Mirror the `step/` resource exactly. A loop is a top-level step (`kind:'loop'`) wrapping **one** body leaf (`agent`/`tool`/`step`) and one driver (`until`/`while`/`foreach`). `until:`/`while:` reference a `workflow/condition/<id>.ts` file resolved by existence (like `step/`), copied verbatim into `src/mastra/workflows/condition/<id>.ts`, and imported by the workflow as `./condition/<id>`. The condition file exports a bare `async ({ inputData, iterationCount }) => boolean` matching Mastra's `LoopConditionFunction`. `emit-workflow.ts` emits `.dountil(body, cond)` / `.dowhile(body, cond)` / `.foreach(body, opts?)`; `max_iterations:` is compiled into an inline wrapper around the imported predicate (using the `iterationCount` the engine passes).

**Tech Stack:** TypeScript (ESM), Zod v4, `yaml`, `@mastra/core` (`^1.43`, generated project; verified against installed `1.42`), `node:test`. All commands run from `builder/`.

---

## Decisions locked (carried from spec Deferred + handoff memory; reconfirm at review)

- **Loop body = a single leaf** (`agent`/`tool`/`step`). Mastra's `.dountil`/`.dowhile`/`.foreach`
  each take exactly **one** `Step`, so a multi-step loop body is out of scope (would need
  workflow-as-step, which YAML can't express yet). Glue a multi-stage body into one `step/`.
- **Keyword picks the method:** `until:` → `.dountil` (repeat **until** predicate true),
  `while:` → `.dowhile` (repeat **while** predicate true), `foreach: true` → `.foreach`.
- **Conditions are a verbatim `.ts` resource**, `workflow/condition/<id>.ts`, resolved by file
  existence (parallel to `step/`/`tools/`). Inline `when: "<js string>"` is **rejected**. Only
  `until:`/`while:` use a condition; `foreach` has none.
- **`max_iterations: N`** (optional, positive int) is an iteration guard, valid **only** with
  `until:`/`while:` (foreach has no `iterationCount`). Compiled as: dountil →
  `(await cond(args)) || args.iterationCount >= N` (stop when either); dowhile →
  `(await cond(args)) && args.iterationCount < N` (continue only while both).
- **`concurrency: N`** (optional, positive int) is valid **only** with `foreach` → `.foreach(body, { concurrency: N })`.
- **`foreach` array-precondition is intentionally unchecked** at parse time — a non-array previous
  step surfaces at the generated project's `tsc` (Mastra types `foreach`'s step arg as the literal
  string `'Previous step must return an array type'` when the prev schema isn't an array).
- **Loops are top-level steps only** — not `parallel` children (v1.1). A `loop` inside `parallel` is a parse error.
- **REVIEW NOTE — source layout:** conditions live at `workflow/condition/<id>.ts` (nested under
  `workflow/`), per the handoff memory, whereas steps live at root `step/<id>.ts`. Flag at review
  whether to instead put them at root `condition/<id>.ts` for consistency. This plan assumes the
  locked `workflow/condition/` location; changing it touches only the parser path + one doc line.
- **Pure-count loop (`max_iterations` with no `until`/`while`/`foreach`) is OUT** of this increment
  (a loop must have exactly one of `until`/`while`/`foreach`). Note as a cheap future add.

## Verified API facts (against installed `@mastra/core@1.42`, `dist/workflows/`)

- `dowhile(step, condition)` / `dountil(step, condition)` (`workflow.d.ts:211-212`) — take **one**
  `Step` + a `LoopConditionFunction`. Return the `Workflow` (chainable).
- `foreach(step, opts?)` (`workflow.d.ts:213-215`) — `opts = { concurrency: number }`. The `step`
  arg type is `'Previous step must return an array type'` unless `TPrevSchema` is an array. Output
  schema becomes `TSchemaOut[]`.
- `LoopConditionFunction = (params: ConditionFunctionParams & { iterationCount: number }) => Promise<boolean>`
  (`step.d.ts:56-58`). `ConditionFunctionParams` = `ExecuteFunctionParams` minus `setState`/`suspend`
  → includes `inputData` (the **body step's output**), `mastra`, `getStepResult`, `getInitData`,
  `runId`, etc. So a condition file is `export const <id> = async ({ inputData, iterationCount }) => <boolean>`.
- `createStep(agent)` / `createStep(tool)` produce a `Step`; an authored `step/` `createStep({...})`
  **is** a `Step` (used directly). Same wrapping rule as the chain (`renderLeaf` already exists).

## File Structure

| File | Responsibility |
|---|---|
| `builder/src/schemas.ts` (modify) | add `LoopSchema`; add `loop?` to `WorkflowStepSchema` |
| `builder/src/types.ts` (modify) | `ResolvedWorkflowStep.kind` += `'loop'`; add `ResolvedLoop` + `ResolvedWorkflowStep.loop?`; add `ResolvedWorkflow.conditionFiles` |
| `builder/src/parser.ts` (modify) | resolve `loop` blocks (driver + body + condition ref), validations, populate `conditionFiles`, collisions |
| `builder/src/codegen/emit-workflow.ts` (modify) | import conditions from `./condition/<id>`; emit `.dountil`/`.dowhile`/`.foreach` (+ `max_iterations` wrapper, `concurrency` opt) |
| `builder/src/codegen/generate.ts` (modify) | copy condition files verbatim → `src/mastra/workflows/condition/<id>.ts`, deduped |
| `examples/workflow/condition/*.ts` (create), `examples/step/*.ts` (maybe), `examples/workflow/*.yaml` (create), `examples/config.yaml` (modify) | demo a loop workflow end-to-end |
| `builder/test/example-workflows.test.ts` (modify) | assert the loop example emits + registers |
| `website/docs/reference/condition.md` (create), `website/docs/reference/workflow.md`, `website/sidebars.ts` (modify) | document the `loop:` step + `workflow/condition/` resource |
| `.planning/superpowers/specs/2026-06-14-workflows-design.md` (modify) | move loops/conditions out of Deferred when this lands |

---

## Phase L — loops + the `workflow/condition/<id>.ts` resource

Ships: `loop:` is a valid top-level workflow step; `until:`/`while:` reference verbatim condition files copied into `workflows/condition/`; `foreach: true` loops over an array-producing previous step; `max_iterations`/`concurrency` map to the right engine call; an example demonstrates a loop end-to-end and typechecks.

### Task L1: Schema — `LoopSchema` + `loop` step

**Files:**
- Modify: `builder/src/schemas.ts`
- Test: `builder/test/workflows-schema.test.ts`

- [ ] **Step 1: Add failing tests** (append to `workflows-schema.test.ts`)

```ts
test('WorkflowSchema accepts a loop step (until + body + max_iterations)', () => {
  const wf = WorkflowSchema.parse({
    steps: [
      { agent: 'drafter' },
      { loop: { until: 'good-enough', step: 'refiner', max_iterations: 5 } },
    ],
  });
  assert.equal(wf.steps.length, 2);
  assert.equal(wf.steps[1].loop?.until, 'good-enough');
  assert.equal(wf.steps[1].loop?.step, 'refiner');
  assert.equal(wf.steps[1].loop?.max_iterations, 5);
});

test('WorkflowSchema accepts a foreach loop with concurrency', () => {
  const wf = WorkflowSchema.parse({
    steps: [{ loop: { foreach: true, step: 'process', concurrency: 3 } }],
  });
  assert.equal(wf.steps[0].loop?.foreach, true);
  assert.equal(wf.steps[0].loop?.concurrency, 3);
});

test('WorkflowSchema rejects non-positive/non-int max_iterations and concurrency', () => {
  assert.equal(WorkflowSchema.safeParse({ steps: [{ loop: { until: 'c', step: 's', max_iterations: 0 } }] }).success, false);
  assert.equal(WorkflowSchema.safeParse({ steps: [{ loop: { foreach: true, step: 's', concurrency: 1.5 } }] }).success, false);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --import tsx --test test/workflows-schema.test.ts`
  Expected: FAIL — `loop` is stripped (unknown key), so `wf.steps[1].loop` is `undefined`.

- [ ] **Step 3: Implement** in `schemas.ts` — add `LoopSchema` above `WorkflowStepSchema`, and a `loop` field on `WorkflowStepSchema` (mutual-exclusion of driver/body is enforced in the parser, like the other step kinds):

```ts
// A loop wraps one body leaf (agent/tool/step) with one driver (until/while/foreach).
// Exactly-one-of rules are enforced in the parser so the message lands in ParseError.
const LoopSchema = z.object({
  until: z.string().min(1).optional(),
  while: z.string().min(1).optional(),
  foreach: z.boolean().optional(),
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  max_iterations: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
});
```

Add to `WorkflowStepSchema`:

```ts
  loop: LoopSchema.optional(),
```

> Do **not** add `loop` to `WorkflowLeafSchema` — loops can't be `parallel` children.

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/workflows-schema.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(workflow-loops): accept loop step in WorkflowSchema"`

---

### Task L2: Resolved types

**Files:**
- Modify: `builder/src/types.ts`

No test of its own; verified by `tsc` in L3.

- [ ] **Step 1: Add `ResolvedLoop` and widen `ResolvedWorkflowStep`** in `types.ts`:

```ts
/** A resolved loop step: one body leaf driven by dountil/dowhile/foreach. */
export interface ResolvedLoop {
  /** Maps to the Mastra method. */
  loopKind: 'dountil' | 'dowhile' | 'foreach';
  /** The single step the loop runs each iteration. */
  body: ResolvedStepRef;
  /** The predicate file for dountil/dowhile (absent for foreach). */
  condition?: ResolvedTool;
  /** Optional iteration guard for dountil/dowhile. */
  maxIterations?: number;
  /** Optional parallelism for foreach. */
  concurrency?: number;
}
```

Widen `ResolvedWorkflowStep`:

```ts
/** One workflow step: a single agent/tool/step, a parallel block, or a loop. */
export interface ResolvedWorkflowStep {
  kind: 'agent' | 'tool' | 'step' | 'parallel' | 'loop';
  /** Set when kind is 'agent' | 'tool' | 'step'. */
  ref?: ResolvedStepRef;
  /** Set when kind is 'parallel' (always length >= 2). */
  children?: ResolvedStepRef[];
  /** Set when kind is 'loop'. */
  loop?: ResolvedLoop;
}
```

- [ ] **Step 2: Add `conditionFiles` to `ResolvedWorkflow`** (reuses the `ResolvedTool` shape):

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

The workflow loop already has `agentRefs`/`toolRefs`/`stepFileRefs` and a `resolveLeaf(node, where)` helper returning a `ResolvedStepRef`. Add a `conditionFileRefs` collector and a `loop` branch in the per-step loop. Reuse `resolveLeaf` for the body.

- [ ] **Step 1: Add failing tests** (append to `workflows-parser.test.ts`; `base()` already supplies agents/tools — add `step/` and `workflow/condition/` files as needed):

```ts
test('resolves an until loop: body leaf + condition file', () => {
  const dir = makeProject({
    ...base('flow'),
    'workflow/condition/good-enough.ts': 'export const goodEnough = async () => true;\n',
    'workflow/flow.yaml':
      'input: { prompt: string }\noutput: { text: string }\n' +
      'steps:\n  - agent: research-agent\n  - loop:\n      until: good-enough\n      agent: support-agent\n      max_iterations: 4\n',
  });
  const wf = parseProject(dir).workflows[0];
  assert.deepEqual(wf.steps.map((s) => s.kind), ['agent', 'loop']);
  const loop = wf.steps[1].loop!;
  assert.equal(loop.loopKind, 'dountil');
  assert.equal(loop.body.id, 'support-agent');
  assert.equal(loop.condition?.id, 'good-enough');
  assert.equal(loop.maxIterations, 4);
  assert.deepEqual(wf.conditionFiles.map((c) => c.id), ['good-enough']);
});

test('resolves a while loop -> dowhile', () => {
  const dir = makeProject({
    ...base('flow'),
    'workflow/condition/keep.ts': 'export const keep = async () => false;\n',
    'workflow/flow.yaml': 'steps:\n  - loop:\n      while: keep\n      agent: research-agent\n',
  });
  const loop = parseProject(dir).workflows[0].steps[0].loop!;
  assert.equal(loop.loopKind, 'dowhile');
  assert.equal(loop.condition?.id, 'keep');
});

test('resolves a foreach loop -> foreach with concurrency, no condition', () => {
  const dir = makeProject({
    ...base('flow'),
    'step/process.ts': "import { createStep } from '@mastra/core/workflows';\nexport const process = {};\n",
    'workflow/flow.yaml': 'steps:\n  - loop:\n      foreach: true\n      step: process\n      concurrency: 2\n',
  });
  const loop = parseProject(dir).workflows[0].steps[0].loop!;
  assert.equal(loop.loopKind, 'foreach');
  assert.equal(loop.body.id, 'process');
  assert.equal(loop.condition, undefined);
  assert.equal(loop.concurrency, 2);
});

test('errors when a loop has no driver or more than one', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'steps:\n  - loop:\n      agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /loop must have exactly one of `until:`, `while:`, or `foreach:`/);
});

test('errors when a loop has no body or more than one', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n',
  });
  assert.throws(() => parseProject(dir), /loop must have exactly one body of `agent:`, `tool:`, or `step:`/);
});

test('errors on an unresolved condition file', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: ghost\n      agent: research-agent\n',
  });
  assert.throws(() => parseProject(dir), /condition not found: workflow\/condition\/ghost\.ts/);
});

test('errors when max_iterations is used with foreach', () => {
  const dir = makeProject({
    ...base('bad'),
    'step/process.ts': 'export const process = {};\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      foreach: true\n      step: process\n      max_iterations: 3\n',
  });
  assert.throws(() => parseProject(dir), /`max_iterations` is only valid with `until:`\/`while:`/);
});

test('errors when concurrency is used with until/while', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/condition/c.ts': 'export const c = async () => true;\n',
    'workflow/bad.yaml': 'steps:\n  - loop:\n      until: c\n      agent: research-agent\n      concurrency: 2\n',
  });
  assert.throws(() => parseProject(dir), /`concurrency` is only valid with `foreach:`/);
});

test('errors when a loop is used as a parallel child', () => {
  const dir = makeProject({
    ...base('bad'),
    'workflow/bad.yaml':
      'steps:\n  - parallel:\n      - agent: research-agent\n      - loop:\n          foreach: true\n          agent: support-agent\n',
  });
  // parallel children are validated by WorkflowLeafSchema (no `loop` key) → the
  // loop child has neither agent/tool/step → "exactly one of" leaf error.
  assert.throws(() => parseProject(dir), /must have exactly one of/);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --import tsx --test test/workflows-parser.test.ts`

- [ ] **Step 3: Implement in `parser.ts`.**

Add a condition collector beside the others (near `stepFileRefs`):

```ts
    const conditionFileRefs: ResolvedTool[] = [];
```

Add a `loop` branch in the per-step loop. The top-level "exactly one of" count must include `loop`:

```ts
      const hasParallel = Array.isArray(step.parallel);
      const hasAgent = typeof step.agent === 'string';
      const hasTool = typeof step.tool === 'string';
      const hasStep = typeof step.step === 'string';
      const hasLoop = step.loop !== undefined && step.loop !== null;
      if ((hasParallel ? 1 : 0) + (hasAgent ? 1 : 0) + (hasTool ? 1 : 0) + (hasStep ? 1 : 0) + (hasLoop ? 1 : 0) !== 1) {
        addIssue(wfPath, `step ${i + 1} must have exactly one of \`agent:\`, \`tool:\`, \`step:\`, \`parallel:\`, or \`loop:\``);
        ok = false;
        continue;
      }
```

Then, after the existing `parallel`/leaf branches, handle `loop` (resolve a condition file like `resolveLeaf` resolves a step file):

```ts
      if (hasLoop) {
        const lp = step.loop as {
          until?: string; while?: string; foreach?: boolean;
          agent?: string; tool?: string; step?: string;
          max_iterations?: number; concurrency?: number;
        };
        const drivers = [
          lp.until !== undefined ? 'until' : null,
          lp.while !== undefined ? 'while' : null,
          lp.foreach !== undefined ? 'foreach' : null,
        ].filter(Boolean);
        if (drivers.length !== 1) {
          addIssue(wfPath, `step ${i + 1}: loop must have exactly one of \`until:\`, \`while:\`, or \`foreach:\``);
          ok = false;
          continue;
        }
        // Body: reuse resolveLeaf (exactly one of agent/tool/step).
        const bodyKinds = [lp.agent, lp.tool, lp.step].filter((v) => v !== undefined);
        if (bodyKinds.length !== 1) {
          addIssue(wfPath, `step ${i + 1}: loop must have exactly one body of \`agent:\`, \`tool:\`, or \`step:\``);
          ok = false;
          continue;
        }
        const body = resolveLeaf({ agent: lp.agent, tool: lp.tool, step: lp.step }, `step ${i + 1} loop body`);
        if (!body) { ok = false; continue; }

        if (lp.foreach !== undefined) {
          if (lp.foreach !== true) {
            addIssue(wfPath, `step ${i + 1}: \`foreach\` must be \`true\``);
            ok = false; continue;
          }
          if (lp.max_iterations !== undefined) {
            addIssue(wfPath, `step ${i + 1}: \`max_iterations\` is only valid with \`until:\`/\`while:\``);
            ok = false; continue;
          }
          resolvedSteps.push({ kind: 'loop', loop: { loopKind: 'foreach', body, concurrency: lp.concurrency } });
        } else {
          if (lp.concurrency !== undefined) {
            addIssue(wfPath, `step ${i + 1}: \`concurrency\` is only valid with \`foreach:\``);
            ok = false; continue;
          }
          const condId = (lp.until ?? lp.while) as string;
          const condPath = `workflow/condition/${condId}.ts`;
          if (!existsSync(join(rootDir, condPath))) {
            addIssue(wfPath, `condition not found: ${condPath}`);
            ok = false; continue;
          }
          const exportName = toExportName(condId);
          if (!conditionFileRefs.some((c) => c.id === condId)) {
            conditionFileRefs.push({ id: condId, filePath: condPath, exportName });
          }
          resolvedSteps.push({
            kind: 'loop',
            loop: {
              loopKind: lp.until !== undefined ? 'dountil' : 'dowhile',
              body,
              condition: { id: condId, filePath: condPath, exportName },
              maxIterations: lp.max_iterations,
            },
          });
        }
        continue;
      }
```

> Place this branch so it doesn't fall through into the plain-leaf `else`. Restructure the
> existing `if (hasParallel) {...} else {...}` into `if (hasParallel) {...} else if (hasLoop) {...} else {...}`.

Add `conditionFiles: conditionFileRefs` to the `workflows.push({...})` object.

Extend the **workflow module-scope** collision check with condition exports:

```ts
      ...wf.stepFiles.map((s) => ({ name: s.exportName, key: `step:${s.id}` })),
      ...wf.conditionFiles.map((c) => ({ name: c.exportName, key: `condition:${c.id}` })),
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/workflows-parser.test.ts`

- [ ] **Step 5: Full suite + build.** Run: `pnpm build && pnpm test`

- [ ] **Step 6: Commit** — `git commit -m "feat(workflow-loops): resolve loop blocks + condition refs"`

---

### Task L4: emit-workflow emits loop methods

**Files:**
- Modify: `builder/src/codegen/emit-workflow.ts`
- Test: `builder/test/emit-workflow.test.ts`

The emitter already has `renderLeaf(ref)` (`step` → bare export, else `createStep(...)`). Reuse it for the loop body.

- [ ] **Step 1: Update the shared `SEQ` fixture** to include `conditionFiles: []` so existing tests type-check.

- [ ] **Step 2: Add failing tests** (append to `emit-workflow.test.ts`):

```ts
test('emits .dountil with an imported condition and max_iterations wrapper', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [
      { kind: 'loop', loop: {
        loopKind: 'dountil',
        body: { kind: 'agent', id: 'support-agent', exportName: 'supportAgent' },
        condition: { id: 'good-enough', filePath: 'workflow/condition/good-enough.ts', exportName: 'goodEnough' },
        maxIterations: 5,
      } },
    ],
    agents: [{ id: 'support-agent', exportName: 'supportAgent' }],
    tools: [], stepFiles: [],
    conditionFiles: [{ id: 'good-enough', filePath: 'workflow/condition/good-enough.ts', exportName: 'goodEnough' }],
  });
  assert.match(out, /import \{ goodEnough \} from '\.\/condition\/good-enough';/);
  // wrapped: stop when predicate true OR iteration cap reached
  assert.match(out, /\.dountil\(createStep\(supportAgent\), async \(args\) => \(await goodEnough\(args\)\) \|\| args\.iterationCount >= 5\)/);
});

test('emits .dowhile with a bare condition (no max_iterations)', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [
      { kind: 'loop', loop: {
        loopKind: 'dowhile',
        body: { kind: 'step', id: 'refiner', exportName: 'refiner' },
        condition: { id: 'keep', filePath: 'workflow/condition/keep.ts', exportName: 'keep' },
      } },
    ],
    agents: [], tools: [],
    stepFiles: [{ id: 'refiner', filePath: 'step/refiner.ts', exportName: 'refiner' }],
    conditionFiles: [{ id: 'keep', filePath: 'workflow/condition/keep.ts', exportName: 'keep' }],
  });
  assert.match(out, /\.dowhile\(refiner, keep\)/); // step body used directly; bare predicate
});

test('emits .foreach with a concurrency option and no condition import', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [
      { kind: 'loop', loop: {
        loopKind: 'foreach',
        body: { kind: 'step', id: 'process', exportName: 'process' },
        concurrency: 3,
      } },
    ],
    agents: [], tools: [],
    stepFiles: [{ id: 'process', filePath: 'step/process.ts', exportName: 'process' }],
    conditionFiles: [],
  });
  assert.match(out, /\.foreach\(process, \{ concurrency: 3 \}\)/);
  assert.doesNotMatch(out, /\.\/condition\//);
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `node --import tsx --test test/emit-workflow.test.ts`

- [ ] **Step 4: Implement in `emit-workflow.ts`.**

Add condition imports after the step imports:

```ts
  for (const c of wf.conditionFiles) {
    lines.push(`import { ${c.exportName} } from './condition/${c.id}';`);
  }
```

In the chain-building loop, add a `loop` arm. `renderLeaf` already renders the body; render the condition with the optional `max_iterations` wrapper:

```ts
    } else if (step.kind === 'loop') {
      const lp = step.loop!;
      const body = renderLeaf(lp.body);
      if (lp.loopKind === 'foreach') {
        const opts = lp.concurrency !== undefined ? `, { concurrency: ${lp.concurrency} }` : '';
        lines.push(`  .foreach(${body}${opts})`);
      } else {
        const cond = lp.condition!.exportName;
        let condArg = cond;
        if (lp.maxIterations !== undefined) {
          // The engine passes { ...args, iterationCount }; wrap the predicate with the guard.
          condArg =
            lp.loopKind === 'dountil'
              ? `async (args) => (await ${cond}(args)) || args.iterationCount >= ${lp.maxIterations}`
              : `async (args) => (await ${cond}(args)) && args.iterationCount < ${lp.maxIterations}`;
        }
        lines.push(`  .${lp.loopKind}(${body}, ${condArg})`);
      }
    }
```

> Keep the existing `if (step.kind === 'parallel') {...} else {...}` and insert this as an
> `else if` before the final plain-leaf `else`.

- [ ] **Step 5: Run to verify it passes.** Run: `node --import tsx --test test/emit-workflow.test.ts`

- [ ] **Step 6: Commit** — `git commit -m "feat(workflow-loops): emit dountil/dowhile/foreach"`

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
    'workflow/condition/good-enough.ts': 'export const goodEnough = async () => true;\n',
    'workflow/w.yaml': 'steps:\n  - loop:\n      until: good-enough\n      agent: a\n',
  });
  const files = generateProject(parseProject(dir), dir);
  assert.ok(files['src/mastra/workflows/condition/good-enough.ts'], 'condition copied');
  assert.match(files['src/mastra/workflows/w.ts'], /import \{ goodEnough \} from '\.\/condition\/good-enough';/);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --import tsx --test test/workflows-integration.test.ts`

- [ ] **Step 3: Implement in `generate.ts`** — inside the `for (const wf of project.workflows)` loop, after copying `wf.stepFiles`, copy condition files:

```ts
    for (const c of wf.conditionFiles) {
      const dest = `src/mastra/workflows/condition/${c.id}.ts`;
      if (files[dest]) continue; // copy each condition once even if shared
      files[dest] = readFileSync(join(rootDir, c.filePath), 'utf8');
    }
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/workflows-integration.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(workflow-loops): copy condition files into workflows/condition/"`

---

### Task L6: Example + docs + end-to-end typecheck + spec update

Demonstrates the resource end-to-end with a loop that **typechecks under the generated project's full strict `tsc`** — the real proof, since loop body/condition data-flow types are only checked there.

**Files:**
- Create: `examples/workflow/refine-loop.yaml`, `examples/workflow/condition/good-enough.ts`, `examples/step/refine.ts` (a typed body step)
- Modify: `examples/config.yaml` (add `refine-loop` to `workflows:`)
- Modify: `builder/test/example-workflows.test.ts`
- Create: `website/docs/reference/condition.md`; Modify: `website/docs/reference/workflow.md`, `website/sidebars.ts`
- Modify: `.planning/superpowers/specs/2026-06-14-workflows-design.md`

- [ ] **Step 1: Author a minimal, type-correct loop example.** A `dountil` loop whose body is a
  typed `step/` (so its output type flows into the condition's `inputData`). Suggested shape — a
  refine step that carries a `{ text, score }` and a condition that stops when `score` is high
  enough or `iterationCount` caps:

  `examples/step/refine.ts`:
  ```ts
  import { createStep } from '@mastra/core/workflows';
  import { z } from 'zod';
  // Body of the refine loop: takes { text, score }, returns an improved { text, score }.
  export const refine = createStep({
    id: 'refine',
    inputSchema: z.object({ text: z.string(), score: z.number() }),
    outputSchema: z.object({ text: z.string(), score: z.number() }),
    execute: async ({ inputData }) => ({ text: inputData.text + '.', score: inputData.score + 1 }),
  });
  ```

  `examples/workflow/condition/good-enough.ts` (typed `inputData` = the body's output, plus `iterationCount`):
  ```ts
  import type { z } from 'zod';
  // Stop refining once the score crosses the threshold.
  export const goodEnough = async ({ inputData }: { inputData: { text: string; score: number }; iterationCount: number }) =>
    inputData.score >= 3;
  ```
  > The condition's param type is authored by hand (the file is copied verbatim; the builder does
  > not generate it). Match Mastra's `LoopConditionFunction` shape. If `tsc` complains about the
  > exact param type, widen it (e.g. accept the full params object) — fix the **example**, not the emitter.

  `examples/workflow/refine-loop.yaml`:
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

  > NOTE: the workflow `input` must match the loop body step's input (`{ text, score }`) since the
  > loop is the first step. If `tsc` on the generated project flags a chain-shape mismatch, adjust
  > the example YAML/step (per the standing rule — emitter stays generic).

- [ ] **Step 2: Register** `refine-loop` in `examples/config.yaml` `workflows:`.

- [ ] **Step 3: Update `example-workflows.test.ts`** — assert `src/mastra/workflows/refine-loop.ts`
  exists, registers as `refineLoop`, imports `./condition/good-enough` and `./steps/refine`, and the
  condition file is copied to `src/mastra/workflows/condition/good-enough.ts`.

- [ ] **Step 4: Regenerate + typecheck end-to-end.**
  ```bash
  pnpm gen:example /tmp/wf-loops
  cd /tmp/wf-loops && pnpm install && pnpm exec tsc --noEmit
  ```
  Expected: `tsc` exits 0. (Install failures are network/registry issues, not codegen bugs.) If a
  data-flow type mismatch appears, fix the example YAML/step/condition — not the emitter.

- [ ] **Step 5: Docs.**
  - Create `website/docs/reference/condition.md` (mirror `reference/step.md`): a `.ts` module
    exporting `export const <camelCaseId> = async ({ inputData, iterationCount }) => boolean`
    matching `LoopConditionFunction`; `inputData` is the loop body's output; referenced via
    `until:`/`while:` in a `loop:`; copied to `src/mastra/workflows/condition/`.
  - In `reference/workflow.md`: add a `loop:` row to the Steps table (with sub-keys
    `until`/`while`/`foreach`, body `agent`/`tool`/`step`, `max_iterations`, `concurrency`), a
    worked loop example, and the mapping (`until`→`.dountil`, `while`→`.dowhile`,
    `foreach: true`→`.foreach`). Note: loop body is a single leaf; `foreach`'s array precondition is
    enforced at the generated project's `tsc`; remove `loop`/`foreach`/conditions from "Not in this version".
  - Add `reference/condition` to `sidebars.ts`.

- [ ] **Step 6: Spec update.** In `.planning/superpowers/specs/2026-06-14-workflows-design.md`:
  move loops + the `workflow/condition/` resource out of **Deferred** into the implemented scope
  (mirror how the custom `step/` resource was marked SHIPPED). Update the `Status:` line.

- [ ] **Step 7: Full suite + build.** Run: `pnpm build && pnpm test`

- [ ] **Step 8: Commit** — `git commit -m "feat(workflow-loops): example loop workflow + condition docs"`

---

## Out of scope (still deferred)

- **Multi-step loop bodies** — Mastra's loop methods take one step; compose a `step/` for a
  multi-stage body. Revisit if/when workflows can be used as steps.
- **Pure-count loop** (`max_iterations` with no `until`/`while`/`foreach`). Cheap future add:
  emit `.dountil(body, async (args) => args.iterationCount >= N)`.
- **`branch` / conditions-on-`.then` (`when_step:`)** — engine-verified note: `.branch()` runs
  **all** truthy arms (not first-match). A `workflow/condition/` file is the natural building block
  for branch arms when this is pursued.
- **`schema/` escape hatch** and **human-in-the-loop** (suspend/resume) — see the spec's Deferred section.

## When this lands

- Move loops + `workflow/condition/` out of the spec's **Deferred** section (Task L6 Step 6).
- Update the `workflows-feature-handoff` memory: Phase E (loops) shipped; remaining deferred =
  branch/conditions-on-then, schema escape hatch, human-in-the-loop.
