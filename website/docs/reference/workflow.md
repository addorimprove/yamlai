---
title: "workflow/<id>.yaml"
---

# workflow/&lt;id&gt;.yaml

One file per workflow — a declarative graph of `agent`/`tool` steps that run **sequentially** (`.then`) and/or in **parallel** (`.parallel`). The id is the filename (`workflow/research-flow.yaml` → id `research-flow`, export `researchFlow`). Also list the id in [config.yaml](./config.md) `workflows:`.

```yaml
name: Research Flow
description: Research a question, then have the support agent answer from the notes.

input:  { prompt: string }     # → z.object({ prompt: z.string() })
output: { text: string }       # → z.object({ text: z.string() })

steps:
  - agent: research-agent      # { prompt } -> { text }   → agent/research-agent.yaml
  - tool:  rephrase            # { text }  -> { prompt }   → tools/rephrase.ts (glue tool)
  - agent: support-agent       # { prompt } -> { text }
```

## Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Human-readable name. |
| `description` | string | No | `''` | Short description. |
| `input` | field map | No | `z.object({})` | Workflow input → Zod. Must match the **first step's** input shape. |
| `output` | field map | No | `z.object({})` | Workflow output → Zod. **Not** enforced against the last step (see Gotchas). |
| `steps` | step[] | Yes | — | The graph, in order (≥1). Each is `agent` / `tool` / `parallel`. |

`agent:`/`tool:` reference the project's existing [agent/&lt;id&gt;.yaml](./agent.md) / [tools/&lt;id&gt;.ts](./tools.md) — each must resolve to an existing file (and `agent:` ids must be in [config.yaml](./config.md) `agents:`) or codegen fails.

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
| `parallel: [ … ]` | `.parallel([createStep(a), createStep(b)])` | ≥2 children (`agent`/`tool`); all run on the **same** input. After a `parallel`, the next step's input is **one object keyed by each child step's id**. |

Steps run in declaration order; each step's output is the next step's input. The chain is finalized with `.commit()`.

## Worked example — sequential

`input { prompt }` → `agent: research-agent` → `tool: rephrase` (glue, `{ text }`→`{ prompt }`) → `agent: support-agent` → `output { text }`.

```yaml title="workflow/research-flow.yaml"
name: Research Flow
input:  { prompt: string }
output: { text: string }
steps:
  - agent: research-agent
  - tool:  rephrase
  - agent: support-agent
```

Generates `src/mastra/workflows/research-flow.ts`:

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { researchAgent } from '../agents/research-agent';
import { supportAgent } from '../agents/support-agent';
import { rephrase } from '../tools/rephrase';

export const researchFlow = createWorkflow({
  id: 'research-flow',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(createStep(researchAgent))
  .then(createStep(rephrase))
  .then(createStep(supportAgent))
  .commit();
```

## Worked example — parallel

`input { prompt }` → `parallel: [agent: research-agent, agent: support-agent]` → `tool: merge-answers` → `output { comparison }`. Because the merge tool runs after `.parallel([...])`, its `inputSchema` mirrors the keyed-by-step-id shape (`{ 'research-agent': {text}, 'support-agent': {text} }`).

```yaml title="workflow/compare-answers.yaml"
name: Compare Answers
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
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ comparison: z.string() }),
})
  .parallel([createStep(researchAgent), createStep(supportAgent)])
  .then(createStep(mergeAnswers))
  .commit();
```

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

Workflow-referenced tools (like `rephrase`, `merge-answers`) are copied verbatim into `src/mastra/tools/`, deduped with per-agent tools.

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

These surface when **`tsc` runs on the generated project**, not at YAML parse time — the error appears in the generated `.ts`, not in your YAML.

1. **Step shapes must chain.** Each step's output feeds the next step's input; the builder does **not** reshape between steps — insert a glue `tool:` (like `rephrase`) to adapt shapes. Only *adjacent* steps are type-checked against each other. The workflow's declared `output:` is **not** enforced against the last step's actual output, so a wrong `output:` block compiles silently — keep it in sync by hand.

2. **`input:` must match the first step.** If the first step is an `agent:`, it reads `{ prompt: string }`, so the workflow `input:` must provide `{ prompt: string }`. Omitting `input:` yields `z.object({})` and the generated project fails to compile.

3. **Agent steps and `strictFunctionTypes`.** The generated `tsconfig.json` sets `strictFunctionTypes: false` (while keeping `strict: true`). This is **required**: Mastra's `createStep(agent)` produces a step whose `execute` reads a concrete `{ prompt }` input, which `strictFunctionTypes` would reject contravariantly in every `.then()` chain. Real step-to-step IO mismatches are still caught — they surface on the step `inputSchema`/`outputSchema`.

## Not in this version

Control flow beyond sequential `.then` + `.parallel` is deferred: `branch`/conditions, `loop`/`foreach`, a custom `step/` resource, a custom `schema/` escape hatch, and human-in-the-loop (suspend/resume). See the **Deferred** section of the workflows design spec (`.planning/superpowers/specs/2026-06-14-workflows-design.md`) for the full list and engine notes.
