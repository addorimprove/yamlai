---
title: "workflow/<id>.yaml"
---

# workflow/&lt;id&gt;.yaml

One file per workflow — a declarative graph of `agent`/`tool`/`step` steps that run **sequentially** (`.then`), in **parallel** (`.parallel`), and/or in a **loop** (`.dountil`/`.dowhile`/`.foreach`). The id is the filename (`workflow/draft-flow.yaml` → id `draft-flow`, export `draftFlow`). Also list the id in [config.yaml](./config.md) `workflows:`.

```yaml
description: Draft the content, then have the editor refine it.

input:  { prompt: string }     # → z.object({ prompt: z.string() })
output: { text: string }       # → z.object({ text: z.string() })

steps:
  - agent: writer-agent      # { prompt } -> { text }   → agent/writer-agent.yaml
  - step:  brief             # { text }  -> { prompt }   → workflow/steps/brief.ts (typed glue step)
  - agent: editor-agent      # { prompt } -> { text }
```

## Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `description` | string | No | `''` | Emitted onto the workflow (`createWorkflow({ description })`) when non-empty. |
| `input` | field map | No | `z.object({})` | Workflow input → Zod. Must match the **first step's** input shape. |
| `output` | field map | No | `z.object({})` | Workflow output → Zod. **Not** enforced against the last step (see Gotchas). |
| `steps` | step[] | Yes | — | The graph, in order (≥1). Each is `agent` / `tool` / `parallel`. |

Workflows are identified by `id` (the filename); there is no `name` field (a `name:` is ignored).

`agent:`/`tool:`/`step:` reference an existing [agent/&lt;id&gt;.yaml](./agent.md) / [tools/&lt;id&gt;.ts](./tools.md) / [workflow/steps/&lt;id&gt;.ts](./step.md). A `tool:`/`step:` file must export the camelCased id; `agent:` ids must be in [config.yaml](./config.md) `agents:`. `validate` catches a missing or mismatched reference.

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

`input { prompt }` → `agent: writer-agent` → `step: brief` (typed glue, `{ text }`→`{ prompt }`) → `agent: editor-agent` → `output { text }`.

```yaml title="workflow/draft-flow.yaml"
input:  { prompt: string }
output: { text: string }
steps:
  - agent: writer-agent
  - step:  brief
  - agent: editor-agent
```

Generates `src/mastra/workflows/draft-flow.ts` — note `brief` is a [step](./step.md), so it's used **directly** while the agents are wrapped in `createStep(...)`:

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { writerAgent } from '../agents/writer-agent';
import { editorAgent } from '../agents/editor-agent';
import { brief } from './steps/brief';

export const draftFlow = createWorkflow({
  id: 'draft-flow',
  description: 'Draft the content, then have the editor refine it.',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(createStep(writerAgent))
  .then(brief)
  .then(createStep(editorAgent))
  .commit();
```

## Worked example — parallel

`input { prompt }` → `parallel: [agent: writer-agent, agent: editor-agent]` → `tool: merge-drafts` → `output { comparison }`. The merge tool runs after `.parallel([...])`, so its input is the keyed-by-step-id **record** — its `inputSchema` must be `z.record(z.string(), z.object({ text: z.string() }))`, not exact keys (see [Gotchas](#gotchas)).

```yaml title="workflow/compare-drafts.yaml"
input:  { prompt: string }
output: { comparison: string }
steps:
  - parallel:
      - agent: writer-agent
      - agent: editor-agent
  - tool: merge-drafts
```

Generates `src/mastra/workflows/compare-drafts.ts`:

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { writerAgent } from '../agents/writer-agent';
import { editorAgent } from '../agents/editor-agent';
import { mergeDrafts } from '../tools/merge-drafts';

export const compareDrafts = createWorkflow({
  id: 'compare-drafts',
  description: 'Have the writer and editor each draft from the same brief, then merge.',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ comparison: z.string() }),
})
  .parallel([createStep(writerAgent), createStep(editorAgent)])
  .then(createStep(mergeDrafts))
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

```yaml title="workflow/polish-loop.yaml"
input:  { text: string, score: number }
output: { text: string, score: number }
steps:
  - loop:
      until: good-enough     # workflow/condition/good-enough.ts
      step: refine           # workflow/steps/refine.ts
      max_iterations: 5
```

```typescript title="src/mastra/workflows/polish-loop.ts (generated)"
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { refine } from './steps/refine';
import { goodEnough } from './condition/good-enough';

export const polishLoop = createWorkflow({
  id: 'polish-loop',
  inputSchema: z.object({ text: z.string(), score: z.number() }),
  outputSchema: z.object({ text: z.string(), score: z.number() }),
})
  .dountil(refine, async (args) => (await goodEnough(args)) || args.iterationCount >= 5)
  .commit();
```

### Worked example — multi-step body (nested workflow)

A `steps:` body is emitted as an **inline nested workflow** (a Mastra `Workflow` is itself a `Step`,
so it can be the loop body). It needs `input:`/`output:` to type the nested workflow's schemas.

```yaml title="workflow/revise-loop.yaml"
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

```typescript title="src/mastra/workflows/revise-loop.ts (generated)"
  .dountil(
    createWorkflow({ id: 'revise-loop-loop-1', inputSchema: …, outputSchema: … })
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
  - draft-flow
  - compare-drafts
```

```typescript title="src/mastra/index.ts (generated)"
import { draftFlow } from './workflows/draft-flow';
import { compareDrafts } from './workflows/compare-drafts';

export const mastra = new Mastra({
  agents: { writerAgent, editorAgent },
  workflows: { draftFlow, compareDrafts },
  // …storage, logger…
});
```

Workflow-referenced tools (like `merge-drafts`) are copied verbatim into `src/mastra/tools/`, deduped with per-agent tools; workflow-referenced [steps](./step.md) (like `brief`) are copied into `src/mastra/workflows/steps/`.

## Attaching workflows to an agent (`agent.workflows`)

Attach workflows so the agent's model can invoke them. Each id in [`agent/<id>.yaml`](./agent.md) `workflows:` must **also** be in [config.yaml](./config.md) `workflows:`:

```yaml title="agent/writer-agent.yaml"
workflows:
  - compare-drafts
```

**Agent⇄workflow cycles are allowed.** If an attached workflow runs the attaching agent (directly or transitively), the field is emitted **lazily off the Mastra instance** — keyed by the workflow's export name, with a `mastra!` assertion — to avoid a static import cycle:

```typescript
// cyclic attachment — no static import of the workflow in the agent file
workflows: ({ mastra }) => ({ compareDrafts: mastra!.getWorkflow("compareDrafts") }),
```

Acyclic attachments use a plain static import instead (`workflows: { draftFlow }`). Same lazy-thunk strategy as cyclic [sub-agents](./agent.md#sub-agents-agents).

## Gotchas

The generated project is fully strict (`strict: true`, incl. `strictFunctionTypes`) on `@mastra/core` ≥1.43 — **adjacent step IO is type-checked at `tsc` time**, so most problems below fail the build, not just the run.

1. **Step shapes must chain.** Each step's output is the next step's input; the builder never reshapes between them — insert a glue `tool:`/`step:` (like `brief`) to adapt. A mismatch fails `tsc`. The one exception: the declared `output:` is **not** checked against the last step, so keep it in sync by hand.
2. **`input:` must match the first step.** An `agent:` first step reads `{ prompt: string }`, so `input:` must provide it. Omitting `input:` yields `z.object({})` and fails to compile.
3. **After a `parallel`, the next step takes a record.** The result is keyed by each child's step id, typed `z.record(z.string(), <commonChildOutput>)` — the consumer must declare that record (not exact keys), and all children should share one output shape.
4. **Tool `execute` signature.** A `tool:` receives input as its **first positional arg** — `execute: async (inputData) => …`. The older `async ({ context }) => …` compiles but `context` is `undefined` at runtime; match `tools/merge-drafts.ts`. A [step](./step.md) avoids this — its `execute` is `async ({ inputData }) => …`, typed from `inputSchema`.

## Not in this version

Deferred beyond sequential `.then`, `.parallel`, and `loop` (`.dountil`/`.dowhile`/`.foreach`):

- `branch` / `when_step:` conditions
- `parallel` or nested loops **inside** a loop body
- a custom `schema/` escape hatch
- human-in-the-loop (suspend/resume)
- gen-time chain/condition shape checks — mismatches surface at the generated project's strict `tsc`
