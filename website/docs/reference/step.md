---
title: "workflow/steps/<id>.ts"
---

# workflow/steps/&lt;id&gt;.ts

A **TypeScript module** (not YAML) exporting one Mastra workflow step via `createStep`. The id is the filename (`workflow/steps/rephrase.ts` → id `rephrase`); the file **must export** its camelCase form (`rephrase`) — `validate` checks the file exists *and* declares that export (the [id must also be a valid identifier](./config.md#id-naming)). Referenced by a [workflow](./workflow.md)'s `step:` leaf. The file is copied **verbatim** into the output.

A step is the typed sibling of a glue [tool](./tools.md): its `execute` receives `{ inputData }` **inferred from `inputSchema`**, so a shape mistake fails `tsc` instead of surfacing as `undefined` at run time. Reach for a `step:` (not a glue `tool:`) whenever you're reshaping/merging data between agents and want that reshaping type-checked.

```typescript
import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// Glue step: reshape a research agent's { text } into the { prompt } the support agent reads.
export const rephrase = createStep({
  id: 'rephrase',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ prompt: z.string() }),
  execute: async ({ inputData }) => ({
    prompt: `Using these research notes, answer the user clearly:\n\n${inputData.text}`,
  }),
});
```

## Module shape

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Should equal the filename (step id). Keys this step's result in a `parallel` block. |
| `description` | string | No | Optional human-readable note. |
| `inputSchema` | Zod | Yes | Validates input; **types `execute`'s `inputData`**. |
| `outputSchema` | Zod | Yes | Validates output. |
| `execute` | function | Yes | `async ({ inputData, mastra, getStepResult, … }) => output`; `inputData` is typed from `inputSchema`. |

## step vs. glue tool

| | `workflow/steps/<id>.ts` | glue `tools/<id>.ts` |
|---|---|---|
| `execute` input | `{ inputData }`, **typed** from `inputSchema` | first positional arg, typed `any` |
| Shape mistakes | caught at `tsc` | silent at run time |
| Also usable as an agent tool | no | yes |

Use a **step** for in-workflow shaping/logic; use a **tool** when the same unit must also be callable by an agent.

## Referencing a step

In a [workflow](./workflow.md), a `step:` leaf sits alongside `agent:`/`tool:` — both as a plain step and as a `parallel` child:

```yaml title="workflow/research-flow.yaml"
steps:
  - agent: research-agent
  - step:  rephrase          # → workflow/steps/rephrase.ts
  - agent: support-agent
```

The referenced `workflow/steps/<id>.ts` must exist and export the camelCased id — `validate` checks both.

## Generates `src/mastra/workflows/steps/<id>.ts`

Copied as-is (once, even if shared across workflows). Because an authored `createStep({...})` **is** a `Step`, the workflow uses it **directly** — no `createStep()` wrapper (unlike `agent:`/`tool:`):

```typescript title="src/mastra/workflows/research-flow.ts (generated)"
import { rephrase } from './steps/rephrase';
// ...
  .then(rephrase)            // step used directly; agents/tools are wrapped in createStep(...)
```
