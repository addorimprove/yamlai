---
title: "workflow/<id>.yaml"
---

# workflow/&lt;id&gt;.yaml

One file per workflow — a declarative graph of `agent`/`tool`/`step` steps that run **sequentially** (`.then`), in **parallel** (`.parallel`), and/or in a **loop** (`.dountil`/`.dowhile`/`.foreach`). The id is the filename (`workflow/research-flow.yaml` → id `research-flow`, export `researchFlow`). Also list the id in [config.yaml](./config.md) `workflows:`.

```yaml
description: Research a question, then have the support agent answer from the notes.

input:  { prompt: string }     # → z.object({ prompt: z.string() })
output: { text: string }       # → z.object({ text: z.string() })

steps:
  - agent: research-agent      # { prompt } -> { text }   → agent/research-agent.yaml
  - step:  rephrase            # { text }  -> { prompt }   → workflow/steps/rephrase.ts (typed glue step)
  - agent: support-agent       # { prompt } -> { text }
```

## Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `description` | string | No | `''` | Emitted onto the workflow (`createWorkflow({ description })`) when non-empty. |
| `input` | field map | No | `z.object({})` | Workflow input → Zod. Must match the **first step's** input shape. |
| `output` | field map | No | `z.object({})` | Workflow output → Zod. **Not** enforced against the last step (see Gotchas). |
| `steps` | step[] | Yes | — | The graph, in order (≥1). Each is `agent` / `tool` / `parallel`. |

Mastra workflows are identified by `id` (the filename) — there is no `name` field. A `name:` left in the YAML is ignored.

`agent:`/`tool:`/`step:` reference the project's existing [agent/&lt;id&gt;.yaml](./agent.md) / [tools/&lt;id&gt;.ts](./tools.md) / [workflow/steps/&lt;id&gt;.ts](./step.md) — each must resolve to an existing file (and `agent:` ids must be in [config.yaml](./config.md) `agents:`) or codegen fails.

## `input` / `output` schemas

`input`/`output` are flat maps of **primitive** fields compiled to Zod — the same forms used elsewhere in the builder:

| YAML | Zod |
|---|---|
| `prompt: string` | `z.string()` |
| `count: number` | `z.number()` |
| `done: boolean` | `z.boolean()` |
| `tags: string[]` | `z.array(z.string())` (a `[]` suffix → array) |
| `note: string?` | `z.string().optional()` (a `?` suffix → optional) |
| `mode: [fast, deep]` | `z.enum(['fast', 'deep'])` (an inline list → string enum) |

Nested/complex IO is out of scope for this version — keep workflow IO flat, or shape it with a glue tool.

## Steps

A step is **exactly one** of:

| Step | Compiles to | Notes |
|---|---|---|
| `agent: <id>` | `.then(createStep(agentExport))` | Reads `{ prompt }`, writes `{ text }`. |
| `tool: <id>` | `.then(createStep(toolExport))` | Uses the tool's own `inputSchema`/`outputSchema`. |
| `step: <id>` | `.then(stepExport)` | A custom [workflow/steps/&lt;id&gt;.ts](./step.md) — used **directly** (already a `Step`, so **not** wrapped in `createStep`). Prefer over a glue `tool:` when you want the reshaping's `execute` **type-checked**. |
| `parallel: [ … ]` | `.parallel([createStep(a), b])` | ≥2 **distinct** children (`agent`/`tool`/`step`); all run on the **same** input. After a `parallel`, the next step's input is **one object keyed by each child step's id**. Listing the same id twice is a parse error (the keys would collide). |
| `loop: { … }` | `.dountil` / `.dowhile` / `.foreach` | Repeat a body. See [Loops](#loops) below. Top-level only — a `loop` can't be a `parallel` child. |

Steps run in declaration order; each step's output is the next step's input. The chain is finalized with `.commit()`.

## Worked example — sequential

`input { prompt }` → `agent: research-agent` → `step: rephrase` (typed glue, `{ text }`→`{ prompt }`) → `agent: support-agent` → `output { text }`.

```yaml title="workflow/research-flow.yaml"
input:  { prompt: string }
output: { text: string }
steps:
  - agent: research-agent
  - step:  rephrase
  - agent: support-agent
```

Generates `src/mastra/workflows/research-flow.ts` — note `rephrase` is a [step](./step.md), so it's used **directly** while the agents are wrapped in `createStep(...)`:

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { researchAgent } from '../agents/research-agent';
import { supportAgent } from '../agents/support-agent';
import { rephrase } from './steps/rephrase';

export const researchFlow = createWorkflow({
  id: 'research-flow',
  description: 'Research a question, then have the support agent answer from the notes.',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(createStep(researchAgent))
  .then(rephrase)
  .then(createStep(supportAgent))
  .commit();
```

## Worked example — parallel

`input { prompt }` → `parallel: [agent: research-agent, agent: support-agent]` → `tool: merge-answers` → `output { comparison }`. Because the merge tool runs after `.parallel([...])`, its input is the keyed-by-step-id result. Mastra types that result as a **record** (index signature) keyed by string with the common child-output shape, so the merge tool's `inputSchema` must be `z.record(z.string(), z.object({ text: z.string() }))` — an exact-keys `z.object({ 'research-agent': …, 'support-agent': … })` fails to typecheck under the generated project's strict `tsc`. (This also means all parallel children should share one output shape.)

```yaml title="workflow/compare-answers.yaml"
input:  { prompt: string }
output: { comparison: string }
steps:
  - parallel:
      - agent: research-agent
      - agent: support-agent
  - tool: merge-answers
```

Generates `src/mastra/workflows/compare-answers.ts`:

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { researchAgent } from '../agents/research-agent';
import { supportAgent } from '../agents/support-agent';
import { mergeAnswers } from '../tools/merge-answers';

export const compareAnswers = createWorkflow({
  id: 'compare-answers',
  description: 'Ask the research and support agents the same question in parallel, then merge.',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ comparison: z.string() }),
})
  .parallel([createStep(researchAgent), createStep(supportAgent)])
  .then(createStep(mergeAnswers))
  .commit();
```

## Loops

A `loop:` step repeats a **body** under a **driver**. The body is **either** a single leaf
(`agent`/`tool`/`step`) **or** a `steps:` sequence (emitted as an inline nested workflow). The driver
picks the Mastra method:

| Driver | Method | Repeats… | Needs |
|---|---|---|---|
| `until: <id>` | `.dountil(body, cond)` | **until** the predicate returns `true` | [workflow/condition/&lt;id&gt;.ts](./condition.md) |
| `while: <id>` | `.dowhile(body, cond)` | **while** the predicate returns `true` | [workflow/condition/&lt;id&gt;.ts](./condition.md) |
| `foreach: true` | `.foreach(body, opts?)` | once **per element** of the previous step's array output | — |
| `max_iterations:` alone | `.dountil(body, …count)` | a fixed number of times | — |

Sub-keys:

| Key | Applies to | Meaning |
|---|---|---|
| `until` / `while` / `foreach` | — | the driver (at most one) |
| `agent` / `tool` / `step` | single-leaf body | the one step to repeat |
| `steps` + `input` + `output` | multi-step body | a sequence to repeat; `input`/`output` type the nested workflow (**required** for multi-step) |
| `max_iterations` | `until`/`while`/alone | iteration cap — folded into the condition (dountil → `|| iterationCount >= N`, dowhile → `&& iterationCount < N`); **not** valid with `foreach` |
| `concurrency` | `foreach` | parallelism → `.foreach(body, { concurrency: N })` |

### Worked example — single-leaf loop

```yaml title="workflow/refine-loop.yaml"
input:  { text: string, score: number }
output: { text: string, score: number }
steps:
  - loop:
      until: good-enough     # workflow/condition/good-enough.ts
      step: refine           # workflow/steps/refine.ts
      max_iterations: 5
```

```typescript title="src/mastra/workflows/refine-loop.ts (generated)"
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { refine } from './steps/refine';
import { goodEnough } from './condition/good-enough';

export const refineLoop = createWorkflow({
  id: 'refine-loop',
  inputSchema: z.object({ text: z.string(), score: z.number() }),
  outputSchema: z.object({ text: z.string(), score: z.number() }),
})
  .dountil(refine, async (args) => (await goodEnough(args)) || args.iterationCount >= 5)
  .commit();
```

### Worked example — multi-step body (nested workflow)

A `steps:` body is emitted as an **inline nested workflow** (a Mastra `Workflow` is itself a `Step`,
so it can be the loop body). It needs `input:`/`output:` to type the nested workflow's schemas.

```yaml title="workflow/draft-loop.yaml"
input:  { text: string, score: number }
output: { text: string, score: number }
steps:
  - loop:
      until: good-enough
      input:  { text: string, score: number }
      output: { text: string, score: number }
      steps:
        - step: refine
        - step: score
      max_iterations: 4
```

```typescript title="src/mastra/workflows/draft-loop.ts (generated)"
  .dountil(
    createWorkflow({ id: 'draft-loop-loop-1', inputSchema: …, outputSchema: … })
      .then(refine)
      .then(score)
      .commit(),
    async (args) => (await goodEnough(args)) || args.iterationCount >= 4,
  )
```

### Loop notes

- **Body = one step.** Mastra's loop methods take a single `Step`; a multi-step body becomes one
  nested workflow. Body sub-steps are sequential leaves only (no `parallel`/`loop` nested in a body).
- **`foreach` requires the previous step to output an array.** This is enforced at the generated
  project's strict `tsc` (Mastra types the body arg as the literal string `'Previous step must
  return an array type'` otherwise), not at parse time.
- A `workflow/condition/<id>.ts` predicate's `inputData` is the **body's output** — type it to match, or the
  generated project's `tsc` fails. See [workflow/condition/&lt;id&gt;.ts](./condition.md).

## Registration — `config.yaml`

List each workflow id under `workflows:` in [config.yaml](./config.md). Each is registered on the `new Mastra({ … })` instance, keyed by its camelCase export name:

```yaml title="config.yaml"
workflows:
  - research-flow
  - compare-answers
```

```typescript title="src/mastra/index.ts (generated)"
import { researchFlow } from './workflows/research-flow';
import { compareAnswers } from './workflows/compare-answers';

export const mastra = new Mastra({
  agents: { researchAgent, supportAgent },
  workflows: { researchFlow, compareAnswers },
  // …storage, logger…
});
```

Workflow-referenced tools (like `merge-answers`) are copied verbatim into `src/mastra/tools/`, deduped with per-agent tools; workflow-referenced [steps](./step.md) (like `rephrase`) are copied into `src/mastra/workflows/steps/`.

## Attaching workflows to an agent (`agent.workflows`)

An agent may attach workflows so its model can invoke them. Each id in [`agent/<id>.yaml`](./agent.md) `workflows:` must **also** be in [config.yaml](./config.md) `workflows:`:

```yaml title="agent/support-agent.yaml"
workflows:
  - compare-answers
```

The generated `Agent` gets a `workflows` field. **Agent⇄workflow cycles are allowed** — if an attached workflow runs the attaching agent (directly or transitively), the field is emitted **lazily off the Mastra instance** to avoid a static import cycle:

```typescript
// cyclic attachment — no static import of the workflow in the agent file
workflows: ({ mastra }) => ({ compareAnswers: mastra!.getWorkflow("compareAnswers") }),
```

keyed by the workflow's export/registration name, with a `mastra!` non-null assertion. Acyclic attachments use a plain static import + object instead:

```typescript
workflows: { researchFlow },
```

This is the same lazy-thunk strategy used for cyclic [sub-agents](./agent.md#sub-agents-agents).

## Gotchas

The generated project is fully strict (`strict: true`, incl. `strictFunctionTypes`) on `@mastra/core` ≥1.43, so **adjacent step IO is type-checked at `tsc` time** — most shape problems below fail the build, not just the run.

1. **Step shapes must chain.** Each step's output feeds the next step's input; the builder does **not** reshape between steps — insert a glue `tool:`/`step:` (like `rephrase`) to adapt shapes. A mismatch **fails `tsc`** on the generated project (e.g. a step that emits `{ text }` followed by one that needs `{ count }`). The workflow's declared `output:` is the one thing **not** enforced against the last step's actual output — a wrong `output:` block compiles and returns the actual shape, so keep `output:` in sync by hand.

2. **`input:` must match the first step.** If the first step is an `agent:`, it reads `{ prompt: string }`, so the workflow `input:` must provide `{ prompt: string }`. Omitting `input:` yields `z.object({})` and the generated project **fails to compile**.

3. **After a `parallel`, the next step takes a record.** `.parallel([...])` produces a result keyed by each child's step id, typed as `z.record(z.string(), <commonChildOutput>)`. The consuming `tool:`/`step:` must declare that record shape (not exact keys), and all parallel children should share one output shape — see the parallel worked example.

4. **Tool `execute` signature.** A `tool:` step uses the tool's `execute` as-is. In this Mastra version a tool receives its input as the **first positional argument** — `execute: async (inputData) => ({ ... })`. A tool written the older way (`execute: async ({ context }) => …`) compiles but `context` is `undefined` at run time. Match the example tool (`tools/merge-answers.ts`). A [step](./step.md) does not have this pitfall — its `execute` is `async ({ inputData }) => …` and `inputData` is typed from `inputSchema`.

## Not in this version

Control flow beyond sequential `.then`, `.parallel`, and `loop` (`.dountil`/`.dowhile`/`.foreach`) is deferred: `branch`/`when_step:` conditions, `parallel`/nested loops **inside** a loop body, a custom `schema/` escape hatch, and human-in-the-loop (suspend/resume). Gen-time chain/condition shape checking also stays deferred — shape mismatches surface at the generated project's strict `tsc`. See the **Deferred** section of the workflows design spec (`.planning/superpowers/specs/2026-06-14-workflows-design.md`) for the full list and engine notes.
