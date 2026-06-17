---
title: "condition/<id>.ts"
---

# condition/&lt;id&gt;.ts

A **TypeScript module** (not YAML) exporting one loop predicate. The id is the filename (`condition/good-enough.ts` → id `good-enough`); the export must be its camelCase form (`goodEnough`). Referenced by a [workflow](./workflow.md) `loop:`'s `until:`/`while:`. The file is copied **verbatim** into the output.

A condition is a Mastra `LoopConditionFunction` — an `async` function returning a `boolean`. It receives the **loop body's output** as `inputData`, plus the engine's `iterationCount`, plus the usual step params (`mastra`, `getStepResult`, …).

```typescript
// condition/good-enough.ts
export const goodEnough = async ({
  inputData,
}: {
  inputData: { text: string; score: number };  // = the loop body's output
  iterationCount: number;
}) => inputData.score >= 3;
```

## Module shape

| | Value |
|---|---|
| Export | `export const <camelCaseId> = async (params) => boolean` |
| `params.inputData` | the loop body's output (type it to match the body's `outputSchema`) |
| `params.iterationCount` | number — how many times the body has run so far |
| Return | `Promise<boolean>` — **must be `async`** (Mastra types `LoopConditionFunction` as `=> Promise<boolean>`) |

## Semantics

| Driver | Method | Meaning |
|---|---|---|
| `until: <id>` | `.dountil(body, cond)` | run the body, repeat **until** `cond` returns `true` |
| `while: <id>` | `.dowhile(body, cond)` | run the body, repeat **while** `cond` returns `true` |

`foreach` loops take **no** condition. A loop's `max_iterations:` is folded into the emitted
condition as an iteration guard (see [workflow `loop:`](./workflow.md)).

## Referencing a condition

```yaml title="workflow/<id>.yaml"
steps:
  - loop:
      until: good-enough     # → condition/good-enough.ts
      step: refine
      max_iterations: 5
```

The referenced `condition/<id>.ts` must exist or codegen fails.

## Generated output

Copied as-is to `src/mastra/workflows/condition/<id>.ts` (once, even if shared across loops). The
workflow imports it relative to itself and passes it to the loop method:

```typescript title="src/mastra/workflows/<id>.ts (generated)"
import { goodEnough } from './condition/good-enough';
// ...
  .dountil(refine, async (args) => (await goodEnough(args)) || args.iterationCount >= 5)
```

## Gotchas

- **Type `inputData` to match the body's output.** The builder copies the file verbatim and does
  **not** check shapes at parse time — a mismatch surfaces at the generated project's strict `tsc`.
- **Must be `async`.** A non-async predicate won't satisfy `LoopConditionFunction`.
