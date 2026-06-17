# `validate` CLI command — design

**Date:** 2026-06-17
**Status:** Approved (brainstorming complete)
**Package:** `builder/` (`@addorimprove/yamlai`)

## Goal

Add a parse-only `yamlai validate <dir>` command (no codegen) and **strengthen
validation globally** so typo'd / unknown keys are caught instead of silently
stripped. `validate` is the fast, exit-code-driven "is this project well-formed?"
check for humans and CI. Generate and validate share one validation path
(`parseProject`).

### Why

- Today the only way to surface parse issues is `parse:example` / `gen:example`.
  A dedicated `validate` gives a no-codegen, exit-code-driven check.
- "Early error checks": none of the Zod schemas are strict, so unknown keys are
  silently stripped everywhere (`agnets:` in config, a stray `name:` in a
  workflow yaml, a typo'd workflow step key). Making schemas strict turns these
  into explicit, aggregated errors — the real payoff of this work.

### Out of scope (deferred)

- Gen-time chain / foreach-array shape checking (stays tsc/runtime-validated).
- Any new config keys.
- (Already handled by the parser today: workflow file existence + attachment ref
  validation — not a gap.)

## Components

### a. Strict schemas — `src/schemas.ts`

Make every *object* schema reject unknown keys: `ConfigSchema`, `AgentSchema`,
`ModelSchema`, `WorkflowSchema`, and the nested object schemas
(`WorkflowStepSchema`, `WorkflowLeafSchema`, `LoopSchema`, `MemorySchema`,
`SemanticRecallSchema`, `WorkingMemorySchema`, and the inline `logger` / `storage`
objects).

- The free-form `input` / `output` maps (`z.record(z.string(), z.unknown())`)
  stay open — they are user field→type maps, not fixed-shape objects.
- `MemorySchema` / `WorkingMemorySchema` are wrapped in `z.preprocess(...)`;
  strict must apply to the *inner* object.
- Zod emits an `unrecognized_keys` issue, which the existing
  `formatZodError` helper (parser.ts:23) already renders. Unknown keys therefore
  flow into the aggregated `ParseError` (with file + message) **with no parser
  changes**.

### b. CLI dispatcher — new `scripts/cli.ts` (becomes the published `bin`)

Dispatches on the first argument:

- `yamlai validate <dir> [--json]` → validate
- `yamlai generate <dir> [out] [--force]` → generate
- `yamlai <dir> [out] [--force]` (first arg is not a known subcommand) →
  generate — **back-compat preserved** for existing `yamlai <dir>` usage.

The current generate logic in `scripts/generate.ts` moves into a reusable
`runGenerate(argv)`; `runValidate(argv)` is new. `package.json`:

- `bin.yamlai` → `dist/scripts/cli.js`
- add a `validate` npm script alongside `gen` (e.g.
  `"validate": "tsx scripts/cli.ts validate"`).

### c. Validate runner — `runValidate(argv)`

Calls `parseProject(root)`.

- **Success, text mode:** `✓ valid: N agents, M workflows` to stdout, exit 0.
- **Success, `--json`:** `{"ok":true,"issues":[]}` to stdout, exit 0.
- **`ParseError`, text mode:** the aggregated `file: message` lines to stderr,
  exit 1.
- **`ParseError`, `--json`:** `{"ok":false,"issues":[{file,message}...]}` to
  stdout, exit 1. (`ParseError.issues` is already `{file, message}[]`.)
- **Unexpected (non-`ParseError`) throw:** message to stderr, exit 2.

## Data flow

```
argv
  → cli dispatch
    → runValidate(root, {json})
      → parseProject(root)
        → ok   ? summary (counts from ParsedProject.agents / .workflows)
          fail ? ParseError.issues
      → format(text | json)
      → process.exit(0 | 1 | 2)
```

## Error handling

| Outcome                         | exit | text (stderr/stdout)        | --json (stdout)                      |
|---------------------------------|------|-----------------------------|--------------------------------------|
| valid                           | 0    | `✓ valid: N agents, M workflows` | `{"ok":true,"issues":[]}`       |
| ParseError (validation issues)  | 1    | aggregated `file: message`  | `{"ok":false,"issues":[...]}`        |
| unexpected error (fs, etc.)     | 2    | error message               | error message (best-effort)          |

## Testing

- **Schema strict:** unknown key in config / agent / model / workflow yaml →
  `ParseError` with a clear "unrecognized key" message (one test per schema).
- **CLI validate:** valid `examples/` → exit 0 + summary; a broken fixture →
  exit 1 + issues; `--json` shape asserted for both ok and fail paths.
- **CLI dispatch back-compat:** bare `yamlai <dir>` still routes to generate.
- **Regression:** existing 113 tests + `parse:example` + `gen:example` stay green
  (the `examples/` project is clean under strict — verified during design).
