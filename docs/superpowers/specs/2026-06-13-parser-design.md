# Parser — Design

**Date:** 2026-06-13
**Component:** YAML config parser for the YAML Agent Builder (v1)
**Related:** [`docs/SPEC.md`](../../SPEC.md), [`docs/schema.md`](../../schema.md)

## Purpose

Read a YAML Agent Builder project (`config.yaml` + `agent/*.yaml` + `model/*.yaml` + `tools/*.ts`),
validate it (schema + cross-references), and return a fully resolved in-memory model — or throw a
single error listing every problem found.

The parser does **no code generation**. It is pure and side-effect-free (reads files only) so the
codegen component can consume its output directly.

## Scope

In scope (v1): parse + validate `config.yaml`, `agent/*.yaml`, `model/*.yaml`; verify `tools/*.ts`
existence and derive export names by convention.

Out of scope (deferred): code generation, watch mode, statically parsing `tools/*.ts` to confirm
exports, workflows / memory / scorers.

## Decisions

| Topic | Decision |
|---|---|
| Validation | Zod schemas mirroring `docs/schema.md`. |
| Error strategy | Collect **all** errors, throw one aggregated `ParseError` (not fail-fast). |
| Tool validation | Existence + convention only: verify file exists, derive `camelCase` export name. |
| Tests | Deferred (build parser first). |
| Package manager | pnpm. |
| YAML library | `yaml` (eemeli). |
| Module type | ESM (`"type": "module"`). |

## Project layout

Builder lives in `builder/` (its own package). `examples/` stays at the repo root (referenced by
the smoke script as `../examples`). `sample-mastra/` stays as a Mastra-v1 reference (separate
package, untouched).

```
builder/
├── package.json      # type: module; deps: yaml, zod; dev: typescript, @types/node, tsx
├── tsconfig.json
└── src/
├── schemas.ts        # Zod: ConfigSchema, AgentSchema, ModelSchema
├── types.ts          # resolved output types (ParsedProject etc.)
├── naming.ts         # kebab-case id → camelCase export var
├── parser.ts         # parseProject(rootDir) — single public entry point
├── errors.ts         # ParseError (aggregates issues)
└── index.ts          # public exports
```

## Components

- **schemas.ts** — Zod schemas, one per entity, matching `docs/schema.md` exactly (types, required/
  optional, enums, defaults). `logger.level` enum defaults to `info`; `description` defaults to `""`;
  `tools` defaults to `[]`. `max_tokens` (YAML) validated as positive int; `temperature` 0–2.
- **naming.ts** — `toExportName(id: string): string`, e.g. `echo-tool → echoTool`,
  `support-agent → supportAgent`. Single pure function.
- **types.ts** — the resolved output interfaces (below). No Zod here; these describe the parser's
  return value after resolution/inlining.
- **errors.ts** — `ParseError extends Error` carrying `issues: ParseIssue[]`, each
  `{ file: string; message: string }`. `toString()` renders a readable list.
- **parser.ts** — `parseProject(rootDir): ParsedProject`. Orchestrates the data flow, accumulates
  issues, throws `ParseError` if any.
- **index.ts** — re-exports `parseProject`, `ParseError`, and the public types.

## Data flow — `parseProject(rootDir)`

1. Read + YAML-parse `config.yaml`; validate against `ConfigSchema`.
2. For each id in `config.agents`: read `agent/<id>.yaml`; validate `AgentSchema`.
3. For each agent's `model`: read `model/<id>.yaml`; validate `ModelSchema`.
4. For each id in an agent's `tools[]`: check `tools/<id>.ts` exists; derive `exportName`.
5. Resolve: inline each model into its agent, attach resolved tools; build `routerString` =
   `` `${provider}/${model}` ``, map `max_tokens → maxTokens`, apply `logger` default.
6. If any issues were collected, throw `ParseError`; else return `ParsedProject`.

Errors are accumulated throughout (missing files, malformed YAML, schema violations, unresolved
references) and reported together. Each issue names its `file` and the offending field/path.

## Resolved output types

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface ParsedProject {
  name: string;
  logger: { level: LogLevel };          // defaulted to 'info'
  storage?: { type: 'libsql'; url: string };
  agents: ResolvedAgent[];
}

interface ResolvedAgent {
  id: string;
  name: string;
  description: string;                   // '' if omitted
  instructions: string;
  model: ResolvedModel;                  // full model inlined
  tools: ResolvedTool[];                 // [] if none
}

interface ResolvedModel {
  id: string;
  provider: string;
  model: string;
  routerString: string;                  // `${provider}/${model}`
  temperature?: number;
  maxTokens?: number;
}

interface ResolvedTool {
  id: string;
  filePath: string;                      // path relative to rootDir, e.g. "tools/echo-tool.ts"
  exportName: string;                    // camelCase of id
}
```

## Error handling

`ParseError` aggregates `ParseIssue[]`. Sources of issues:
- `config.yaml` missing / not parseable / fails `ConfigSchema`.
- An agent id in `config.agents` has no `agent/<id>.yaml`.
- An agent file fails `AgentSchema`.
- An agent's `model` has no `model/<id>.yaml`, or that file fails `ModelSchema`.
- An agent's `tools[]` id has no `tools/<id>.ts`.

The parser does not stop at the first issue; it gathers all reachable issues and throws once.

## Testing

Deferred per decision. When added, `examples/` is the happy-path fixture; error cases will use
small malformed fixtures.
