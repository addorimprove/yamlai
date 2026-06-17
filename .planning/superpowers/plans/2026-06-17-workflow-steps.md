# Workflow Steps (`step/<id>.ts`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `step/<id>.ts` resource to the YAML Agent Builder. A step is author-as-code `createStep({ id, inputSchema, outputSchema, execute })`, referenced in a workflow via `step: <id>` (a new leaf kind alongside `agent:`/`tool:`), and copied verbatim into the generated project. This gives a **typed** glue/logic mechanism — a step's `execute` input is inferred from its `inputSchema` — replacing the loose-`any` tool `execute` that silently breaks at runtime (failure-scenario #06).

**Architecture:** Mirror how tools are handled. A step is referenced (not declared in `config.yaml`) and resolved by file existence (`step/<id>.ts`), like `tools/<id>.ts`. The parser adds a `step` leaf kind; `emit-workflow.ts` imports steps from `./steps/<id>` and drops them straight into the chain (`.then(stepExport)`) — **no** `createStep()` wrapper, because a step is already a `Step` (agents/tools still get wrapped). `generate.ts` copies each referenced step file verbatim into `src/mastra/workflows/steps/<id>.ts`, deduped.

**Tech Stack:** TypeScript (ESM), Zod v4, `yaml`, `@mastra/core@1.42`, `node:test`. All commands run from `builder/`.

---

## Decisions locked (this session, 2026-06-17)

- **Step format = verbatim `.ts`, copied like tools.** The user authors the full `createStep({...})` call and `export const <camelCaseId>`. The builder only checks the file exists (it does **not** parse the step's schemas). Full type inference happens in the user's own file.
- **No YAML manifest for steps.** Steps are not listed in `config.yaml`; they are resolved by `step:` references in workflows (parallel to tools).
- **No gen-time chain shape check.** Step-to-step IO mismatches (failure-scenarios #01/#02/#04) stay **runtime-validated** by Mastra; the reference docs already state this. Out of scope here.
- **Source layout:** `step/<id>.ts` at the project root (sibling to `agent/`, `tools/`, `workflow/`).
- **Generated layout:** `src/mastra/workflows/steps/<id>.ts` — a `steps/` dir nested inside `workflows/`. The workflow file (`src/mastra/workflows/<id>.ts`) imports `./steps/<id>`.
- **Chain emission:** a `step` ref is used **directly** (`.then(rephrase)` / inside `.parallel([..., rephrase])`); only `agent`/`tool` refs are wrapped in `createStep(...)`.

## Verified API facts (against `@mastra/core@1.42`)

- `createStep(params: StepParams)` where `StepParams = { id, description?, inputSchema, outputSchema, execute, … }` (`workflows/types.d.ts:504`). `execute` is `ExecuteFunction<…>` and its params are **typed** — `execute: async ({ inputData, mastra, getStepResult, … }) => TOutput`, with `inputData` inferred from `inputSchema` (`workflows/step.d.ts`, `ExecuteFunctionParams.inputData: TStepInput`). **Contrast:** a tool's `execute` is typed `(params: any, …)` (`tools/types.d.ts:326`) — the source of failure-scenario #06.
- `.then(step)` and `.parallel([step, …])` accept a `Step` directly. `createStep(agent)` / `createStep(tool)` *produce* a `Step`; an authored `createStep({...})` *is* a `Step`, so it needs no wrapping.
- A step result is keyed by the step's `id` in `.parallel(...)` output — same rule as agents/tools, so the Stage-1 duplicate-parallel check (already shipped) covers `step:` children too once they share the same id namespace.

## File Structure

| File | Responsibility |
|---|---|
| `builder/src/schemas.ts` (modify) | add `step?` to `WorkflowLeafSchema` + `WorkflowStepSchema` |
| `builder/src/types.ts` (modify) | `ResolvedStepRef.kind` += `'step'`; `ResolvedWorkflowStep.kind` += `'step'`; add `ResolvedWorkflow.stepFiles` |
| `builder/src/parser.ts` (modify) | `resolveLeaf` handles `step:`; update "exactly one of" checks; collisions; populate `stepFiles` |
| `builder/src/codegen/emit-workflow.ts` (modify) | import steps from `./steps/<id>`; emit bare `stepExport` (no `createStep`) in the chain |
| `builder/src/codegen/generate.ts` (modify) | copy referenced step files verbatim → `src/mastra/workflows/steps/<id>.ts`, deduped |
| `examples/step/rephrase.ts` (create), `examples/tools/rephrase.ts` (delete), `examples/workflow/research-flow.yaml` (modify) | migrate the `rephrase` glue tool to a step to demo the resource |
| `website/docs/reference/step.md` (create), `website/docs/reference/workflow.md`, `website/sidebars.ts` (modify) | document the `step/` resource |

---

## Phase S — the `step/<id>.ts` resource

Ships: `step:` is a valid workflow leaf; referenced step files are copied verbatim and used directly in the chain; the example migrates `rephrase` from a tool to a step.

### Task S1: Schema — add `step` leaf

**Files:**
- Modify: `builder/src/schemas.ts`
- Test: `builder/test/workflows-schema.test.ts`

- [ ] **Step 1: Add the failing test** (append to `workflows-schema.test.ts`)

```ts
test('WorkflowSchema accepts a step leaf (plain and parallel child)', () => {
  const wf = WorkflowSchema.parse({
    steps: [
      { step: 'rephrase' },
      { parallel: [{ step: 'a' }, { tool: 'b' }] },
    ],
  });
  assert.equal(wf.steps.length, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test test/workflows-schema.test.ts`
Expected: FAIL — `step` is stripped (unknown key) so the parallel child has neither agent/tool.

- [ ] **Step 3: Implement** — add `step` to both schemas in `schemas.ts`:

```ts
const WorkflowLeafSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
});

const WorkflowStepSchema = z.object({
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  parallel: z.array(WorkflowLeafSchema).optional(),
});
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/workflows-schema.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(workflow-steps): accept step leaf in WorkflowSchema"`

---

### Task S2: Resolved types

**Files:**
- Modify: `builder/src/types.ts`

No test of its own; verified by `tsc` in S3.

- [ ] **Step 1: Widen the leaf/step kinds** in `types.ts`:

```ts
/** A leaf step target inside a workflow (an agent, a tool, or a custom step). */
export interface ResolvedStepRef {
  kind: 'agent' | 'tool' | 'step';
  id: string;
  exportName: string;
}

/** One workflow step: a single agent/tool/step, or a parallel block of leaf steps. */
export interface ResolvedWorkflowStep {
  kind: 'agent' | 'tool' | 'step' | 'parallel';
  ref?: ResolvedStepRef;
  children?: ResolvedStepRef[];
}
```

- [ ] **Step 2: Add `stepFiles` to `ResolvedWorkflow`** (reuses the `ResolvedTool` shape: `id`, `filePath`, `exportName`):

```ts
  /** Distinct custom steps referenced in this workflow, first-seen order (for imports + verbatim copy). */
  stepFiles: ResolvedTool[];
```

- [ ] **Step 3: Commit** — `git commit -m "feat(workflow-steps): resolved step types"`

---

### Task S3: Parser resolves `step:` refs

**Files:**
- Modify: `builder/src/parser.ts`
- Test: `builder/test/workflows-parser.test.ts`

- [ ] **Step 1: Add failing tests** (append to `workflows-parser.test.ts`; note `base()` already provides the agents/tools — add a `step/rephrase.ts`):

```ts
test('resolves a step leaf and records it for copy', () => {
  const dir = makeProject({
    ...base('flow'),
    'step/rephrase.ts': "import { createStep } from '@mastra/core/workflows';\nexport const rephrase = {};\n",
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
  assert.throws(() => parseProject(dir), /step not found: step\/ghost\.ts/);
});

test('errors when a leaf has more than one of agent/tool/step', () => {
  const dir = makeProject({
    ...base('bad'),
    'step/rephrase.ts': 'export const rephrase = {};\n',
    'workflow/bad.yaml': 'steps:\n  - tool: rephrase\n    step: rephrase\n',
  });
  assert.throws(() => parseProject(dir), /must have exactly one of/);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --import tsx --test test/workflows-parser.test.ts`

- [ ] **Step 3: Implement in `parser.ts`.**

In the workflow loop, add a `stepFiles` collector beside `agentRefs`/`toolRefs`:

```ts
    const stepFileRefs: ResolvedTool[] = [];
```

Rewrite `resolveLeaf` to handle three exclusive kinds (`agent`/`tool`/`step`):

```ts
    const resolveLeaf = (
      node: { agent?: string; tool?: string; step?: string },
      where: string,
    ): ResolvedStepRef | undefined => {
      const kinds = [
        node.agent !== undefined ? 'agent' : null,
        node.tool !== undefined ? 'tool' : null,
        node.step !== undefined ? 'step' : null,
      ].filter(Boolean);
      if (kinds.length !== 1) {
        addIssue(wfPath, `${where} must have exactly one of \`agent:\`, \`tool:\`, or \`step:\``);
        return undefined;
      }
      if (node.agent !== undefined) {
        const id = node.agent;
        if (!configAgentSet.has(id)) {
          addIssue(wfPath, `agent not found: ${id} (must be listed in config.yaml agents)`);
          return undefined;
        }
        const exportName = toExportName(id);
        if (!agentRefs.some((a) => a.id === id)) agentRefs.push({ id, exportName });
        return { kind: 'agent', id, exportName };
      }
      if (node.tool !== undefined) {
        const id = node.tool;
        const toolPath = `tools/${id}.ts`;
        if (!existsSync(join(rootDir, toolPath))) {
          addIssue(wfPath, `tool not found: ${toolPath}`);
          return undefined;
        }
        const exportName = toExportName(id);
        if (!toolRefs.some((t) => t.id === id)) toolRefs.push({ id, filePath: toolPath, exportName });
        return { kind: 'tool', id, exportName };
      }
      const id = node.step!;
      const stepPath = `step/${id}.ts`;
      if (!existsSync(join(rootDir, stepPath))) {
        addIssue(wfPath, `step not found: ${stepPath}`);
        return undefined;
      }
      const exportName = toExportName(id);
      if (!stepFileRefs.some((s) => s.id === id)) stepFileRefs.push({ id, filePath: stepPath, exportName });
      return { kind: 'step', id, exportName };
    };
```

Update the per-step `exactly one of` count to include `step` (the top-level step may be `agent`/`tool`/`step`/`parallel`):

```ts
      const hasParallel = Array.isArray(step.parallel);
      const hasAgent = typeof step.agent === 'string';
      const hasTool = typeof step.tool === 'string';
      const hasStep = typeof step.step === 'string';
      if ((hasParallel ? 1 : 0) + (hasAgent ? 1 : 0) + (hasTool ? 1 : 0) + (hasStep ? 1 : 0) !== 1) {
        addIssue(wfPath, `step ${i + 1} must have exactly one of \`agent:\`, \`tool:\`, \`step:\`, or \`parallel:\``);
        ok = false;
        continue;
      }
```

> The Stage-1 duplicate-parallel check already dedupes by `ResolvedStepRef.id`, so two identical `step:` children are rejected with no change.

Add `stepFiles: stepFileRefs` to the `workflows.push({...})` object.

Extend the **workflow module-scope** collision check to include step exports:

```ts
      ...wf.tools.map((t) => ({ name: t.exportName, key: `tool:${t.id}` })),
      ...wf.stepFiles.map((s) => ({ name: s.exportName, key: `step:${s.id}` })),
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/workflows-parser.test.ts`

- [ ] **Step 5: Full suite + build.** Run: `pnpm build && pnpm test` (existing suites unaffected).

- [ ] **Step 6: Commit** — `git commit -m "feat(workflow-steps): resolve step/<id>.ts references"`

---

### Task S4: emit-workflow uses steps directly

**Files:**
- Modify: `builder/src/codegen/emit-workflow.ts`
- Test: `builder/test/emit-workflow.test.ts`

- [ ] **Step 1: Add failing test** (append to `emit-workflow.test.ts`):

```ts
test('imports steps from ./steps and uses them without createStep', () => {
  const out = emitWorkflow({
    ...SEQ,
    steps: [
      { kind: 'agent', ref: { kind: 'agent', id: 'research-agent', exportName: 'researchAgent' } },
      { kind: 'step', ref: { kind: 'step', id: 'rephrase', exportName: 'rephrase' } },
    ],
    stepFiles: [{ id: 'rephrase', filePath: 'step/rephrase.ts', exportName: 'rephrase' }],
    tools: [],
  });
  assert.match(out, /import \{ rephrase \} from '\.\/steps\/rephrase';/);
  assert.match(out, /\.then\(createStep\(researchAgent\)\)/);   // agent still wrapped
  assert.match(out, /\.then\(rephrase\)/);                       // step used directly
  assert.doesNotMatch(out, /createStep\(rephrase\)/);            // step NOT wrapped
});
```

> Update the shared `SEQ` fixture to include `stepFiles: []` so existing tests still type-check.

- [ ] **Step 2: Run to verify it fails.** Run: `node --import tsx --test test/emit-workflow.test.ts`

- [ ] **Step 3: Implement in `emit-workflow.ts`.**

Add step imports after the tool imports:

```ts
  for (const s of wf.stepFiles) {
    lines.push(`import { ${s.exportName} } from './steps/${s.id}';`);
  }
```

Emit a step ref directly (a `Step` needs no `createStep`); keep agents/tools wrapped. Replace the chain-building block:

```ts
  const renderLeaf = (ref: { kind: string; exportName: string }) =>
    ref.kind === 'step' ? ref.exportName : `createStep(${ref.exportName})`;

  for (const step of wf.steps) {
    if (step.kind === 'parallel') {
      const inner = step.children!.map(renderLeaf).join(', ');
      lines.push(`  .parallel([${inner}])`);
    } else {
      lines.push(`  .then(${renderLeaf(step.ref!)})`);
    }
  }
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/emit-workflow.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(workflow-steps): emit step refs directly in the chain"`

---

### Task S5: generate.ts copies step files

**Files:**
- Modify: `builder/src/codegen/generate.ts`
- Test: `builder/test/workflows-integration.test.ts`

- [ ] **Step 1: Add failing test** (append to `workflows-integration.test.ts`):

```ts
test('copies a referenced step verbatim into workflows/steps/', () => {
  const dir = makeProject({
    'config.yaml': 'name: x\nagents: [a]\nworkflows: [w]\n',
    'agent/a.yaml': 'name: A\ninstructions: p\nmodel: m\n',
    'prompt/p.md': 'hi\n',
    'model/m.yaml': 'provider: openai\nmodel: gpt-5-mini\n',
    'step/rephrase.ts': "import { createStep } from '@mastra/core/workflows';\nexport const rephrase = {};\n",
    'workflow/w.yaml': 'input: { prompt: string }\noutput: { text: string }\nsteps:\n  - agent: a\n  - step: rephrase\n',
  });
  const files = generateProject(parseProject(dir), dir);
  assert.ok(files['src/mastra/workflows/steps/rephrase.ts'], 'step copied');
  assert.match(files['src/mastra/workflows/w.ts'], /import \{ rephrase \} from '\.\/steps\/rephrase';/);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --import tsx --test test/workflows-integration.test.ts`

- [ ] **Step 3: Implement in `generate.ts`** — inside the existing `for (const wf of project.workflows)` loop, after copying `wf.tools`, copy step files into the nested dir:

```ts
    for (const s of wf.stepFiles) {
      const dest = `src/mastra/workflows/steps/${s.id}.ts`;
      if (files[dest]) continue; // copy each step once even if shared across workflows
      files[dest] = readFileSync(join(rootDir, s.filePath), 'utf8');
    }
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --import tsx --test test/workflows-integration.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(workflow-steps): copy step files into workflows/steps/"`

---

### Task S6: Migrate the example + docs

Demonstrates the resource end-to-end by turning the `rephrase` glue **tool** into a glue **step** (a step's `execute` is type-checked; the tool's was not — exactly the #06 win).

**Files:**
- Create: `examples/step/rephrase.ts`
- Delete: `examples/tools/rephrase.ts`
- Modify: `examples/workflow/research-flow.yaml`
- Modify: `builder/test/example-workflows.test.ts`
- Create: `website/docs/reference/step.md`; Modify: `website/docs/reference/workflow.md`, `website/sidebars.ts`

- [ ] **Step 1: Create `examples/step/rephrase.ts`** (note the **typed** `inputData`):

```ts
import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// Glue step: reshape a research agent's { text } into the { prompt } the support agent reads.
// Authored as a step (not a tool) so `execute`'s input is type-checked against inputSchema.
export const rephrase = createStep({
  id: 'rephrase',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ prompt: z.string() }),
  execute: async ({ inputData }) => ({
    prompt: `Using these research notes, answer the user clearly:\n\n${inputData.text}`,
  }),
});
```

- [ ] **Step 2: Delete `examples/tools/rephrase.ts`** and change `research-flow.yaml`'s middle step from `tool: rephrase` to `step: rephrase`.

- [ ] **Step 3: Update `example-workflows.test.ts`** — `rephrase` now lands at `src/mastra/workflows/steps/rephrase.ts` (not `src/mastra/tools/rephrase.ts`), and `research-flow.ts` imports `./steps/rephrase` and uses `.then(rephrase)`.

- [ ] **Step 4: Regenerate + typecheck the example end-to-end.**

```bash
pnpm gen:example /tmp/wf-steps
cd /tmp/wf-steps && pnpm install && pnpm exec tsc --noEmit
```
Expected: `tsc` exits 0; `src/mastra/workflows/steps/rephrase.ts` exists; `research-flow.ts` uses `.then(rephrase)`. (Install failures are network/registry issues, not codegen bugs.)

- [ ] **Step 5: Docs.** Create `website/docs/reference/step.md` (mirror `reference/tools.md`: id = filename, `export const <camelCaseId> = createStep({...})`, `execute: async ({ inputData }) => …` is typed, referenced via `step:` in a workflow, copied to `src/mastra/workflows/steps/`). In `reference/workflow.md`, add a `step: <id>` row to the Steps table (`.then(<stepExport>)` — used directly, not wrapped) and note when to choose a step over a glue tool (typed `execute`). Add `reference/step` to `sidebars.ts`.

- [ ] **Step 6: Full suite + build.** Run: `pnpm build && pnpm test`

- [ ] **Step 7: Commit** — `git commit -m "feat(workflow-steps): migrate rephrase to a step + docs"`

---

## Out of scope (still deferred)

- **Compile-time chain shape checking** (failure-scenarios #01/#02/#04). Step IO mismatches remain caught at **runtime** by Mastra's per-step input validation; the reference docs already say so. A gen-time check would require the builder to know every boundary's shape (hard for verbatim `.ts` tools/steps whose schemas live in code).
- **YAML-manifest steps** (declared `input:`/`output:` in YAML). Rejected this stage in favour of verbatim `.ts`. Revisit only if/when gen-time chain checking is pursued.
- **Loops / `branch` / conditions / `schema/` escape hatch / human-in-the-loop** — see the "Deferred" section of `specs/2026-06-14-workflows-design.md` (all researched + engine-verified).

## When this lands

Update `specs/2026-06-14-workflows-design.md`: move **Custom `step/` resource** out of "Deferred" into the implemented scope, and delete the matching ⏳ row from `wf-failure-scenarios/README.md` (#06 fixed structurally).
