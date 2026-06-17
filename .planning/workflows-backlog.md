# Workflows — Pending / Deferred Backlog

**As of:** 2026-06-17 · **Branch:** `feat/workflows`

Shipped so far (NOT pending): sequential (`.then`), parallel (`.parallel`), agent attachment
(`agent.workflows`, cycles allowed), custom `step/<id>.ts` resource, loops (`loop:` →
`.dountil`/`.dowhile`/`.foreach`) with the root `condition/<id>.ts` resource (single-leaf **and**
multi-step bodies, `max_iterations`, pure-count, `concurrency`). 113/113 tests; generated project
typechecks under full strict on `@mastra/core@^1.43`.

Source of truth: `.planning/superpowers/specs/2026-06-14-workflows-design.md` (Deferred section, with
engine notes). Each item below is researched/engine-verified but intentionally not yet built.

---

## Pending items

### 1. `branch` / `when_step:` conditions
- **What:** a `branch:` step → `.branch([[cond, step], …])`, choosing step(s) by predicate.
- **Engine note (verified):** `.branch()` runs **ALL** truthy arms concurrently — *not* "first
  match" as the prose docs claim (`chunk-TRXIXO5J.js:4327`). An `else` would compile to the negation
  of all sibling conditions.
- **Building block:** reuse the existing root `condition/<id>.ts` resource for arm predicates
  (`ConditionFunction = (params) => Promise<boolean>`, no `iterationCount`).
- **Status:** not designed into a plan yet.

### 2. Gen-time chain / condition shape checking
- **What:** verify step↔step, loop-body↔condition, and `foreach`'s array-precondition at *parse*
  time instead of only at the generated project's `tsc`.
- **Why deferred (decision):** the builder copies tools/steps/conditions verbatim and does not parse
  their Zod schemas, so it can't know boundary shapes at parse time. See memory
  `workflow-gentime-checking-deferred.md`.
- **Today:** shape mismatches surface at the generated project's full-strict `tsc` (e.g. `foreach`'s
  body arg types to the literal string `'Previous step must return an array type'`) and at Mastra's
  runtime per-step validation.
- **Status:** own future increment; likely needs the builder to understand verbatim files' IO.

### 3. `parallel` / nested loops inside a loop body
- **What:** allow a loop body's `steps:` sequence to contain a `parallel:` block or a nested `loop:`
  (currently body sub-steps are sequential leaves only).
- **Note:** the multi-step body already emits an inline nested workflow, so this is mostly extending
  the body resolver/emitter to the parallel/loop arms within that nested workflow.
- **Status:** not planned.

### 4. `schema/` escape hatch
- **What:** a `.ts` Zod schema resource for workflow/step IO too complex for the YAML→Zod primitive
  compiler (nested objects, unions, etc.), referenced where `input:`/`output:` are accepted.
- **Status:** not planned.

### 5. Human-in-the-loop (suspend / resume)
- **What:** a suspending step (`suspendSchema`/`resumeSchema` + `suspend()`); the run pauses with
  `status: 'suspended'` and is resumed via `run.resume(...)`.
- **Needs:** storage configured. No new YAML surface — it's a property of a (custom) step.
- **Status:** not planned.

---

## Adjacent (not workflow control-flow, but related & pending)

### 6. Parse-only `validate` CLI command
- **What:** a `validate` CLI command that runs `parseProject` and reports `ParseError`s without
  emitting — the natural home for surfacing the workflows-key/ref validation already in the parser.
- **Source:** memory `validate-cli-command.md`.
- **Status:** future, not planned.

---

## Done / explicitly NOT pending

- Loops `.dountil`/`.dowhile`/`.foreach` — SHIPPED.
- Pure-count loop (`max_iterations` alone) — SHIPPED.
- Multi-step loop bodies (inline nested workflow) — SHIPPED.
- Inline `when: "<js string>"` conditions — REJECTED by design (use a `condition/<id>.ts` file).
