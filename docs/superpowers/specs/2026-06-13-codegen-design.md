# Codegen — Design

**Date:** 2026-06-13
**Component:** TypeScript code generator for the YAML Agent Builder (v1)
**Related:** [`docs/SPEC.md`](../../SPEC.md), [`docs/schema.md`](../../schema.md), [parser design](2026-06-13-parser-design.md)

## Purpose

Consume a `ParsedProject` (from `parseProject(rootDir)`) and emit a runnable Mastra v1 TypeScript
project: `src/mastra/index.ts`, `src/mastra/agents/<id>.ts`, `src/mastra/tools/<id>.ts` (copied
verbatim), plus `package.json`, `tsconfig.json`, and `.gitignore`.

The generator is split into a **pure generation** step (produces an in-memory file map) and a
**filesystem write** step, so generation is testable without touching disk (tests are deferred but
come cheaply later).

## Scope

In scope (v1): emit index/agents/tools/package.json/tsconfig/.gitignore from a `ParsedProject`;
copy tool `.ts` sources verbatim; guarded overwrite of the output directory; a thin CLI script that
wires parse → generate → write over `examples/`.

Out of scope (deferred): `.env.example` generation (provider→env-var mapping is a guess; keys are
resolved by Mastra from env), full CLI binary with flag parsing, workflows / memory / scorers,
formatting/linting the output, watch mode.

## Decisions

| Topic | Decision |
|---|---|
| Emit strategy | Template-string emitters — one pure `string`-returning function per file type. No AST library. |
| Architecture | Pure `generateProject(project, rootDir) → FileMap`, separate `writeProject(map, outDir, opts)` for disk IO. |
| `rootDir` | Flows into `generateProject` so it can read and copy tool `.ts` sources verbatim. |
| Tool handling | Copied byte-for-byte from `tools/<id>.ts` into `src/mastra/tools/<id>.ts`. |
| Output location (CLI default) | `./<config.name>` relative to cwd. Core fn always takes an explicit `outDir`. |
| Overwrite | Guarded clean & regenerate: drop a `.mastra-yaml-builder` marker; auto-clean only dirs that have it (or are empty); else require `force`. Refuse if `outDir` equals/contains/is contained by `rootDir`. |
| Dep versions | Match `sample-mastra` exactly (known-good reference `mastra build` accepts); adjust only if install fails during acceptance. |
| `.gitignore` | Generated into output (`node_modules`, `dist`, `.mastra`, `.env`, `*.db`). |
| Delivery | Library functions + thin CLI script (`scripts/generate-example.ts`), mirroring `parse-example.ts`. |

## Module layout

New `builder/src/codegen/`:

| File | Responsibility |
|---|---|
| `versions.ts` | Pinned dependency versions in one place (seeded from `sample-mastra`). |
| `types.ts` | `FileMap = Record<string, string>` (output-relative path → contents). |
| `emit-helpers.ts` | `backtickString()` (escapes `\`, `` ` ``, `${`); object-literal builders for conditional fields. |
| `emit-agent.ts` | `emitAgent(agent: ResolvedAgent) → string`. |
| `emit-mastra.ts` | `emitIndex(project: ParsedProject) → string`. |
| `emit-project-files.ts` | `emitPackageJson(project)`, `emitTsconfig()`, `emitGitignore()`. |
| `generate.ts` | `generateProject(project, rootDir) → FileMap`; reads tool sources, assembles the map, adds the marker. |
| `write.ts` | `writeProject(map, outDir, { force }) → void`; the only filesystem-mutating piece. |

Public exports (`generateProject`, `writeProject`, `FileMap`) added to `builder/src/index.ts`.
CLI: `builder/scripts/generate-example.ts`.

## Data flow

```
parseProject(rootDir) → ParsedProject
  → generateProject(project, rootDir) → FileMap   (pure; copies tool .ts verbatim)
    → writeProject(map, outDir, { force })          (guarded disk write)
```

## Emit rules

### `src/mastra/agents/<id>.ts`

```ts
import { Agent } from '@mastra/core/agent';
import { echoTool } from '../tools/echo-tool';

export const supportAgent = new Agent({
  id: 'support-agent',
  name: 'Support Agent',
  description: 'Handles customer support questions.',
  instructions: `...`,
  model: 'openai/gpt-5-mini',
  modelSettings: { temperature: 0.7, maxTokens: 2048 },
  tools: { echoTool },
});
```

- Tool imports: `import { <exportName> } from '../tools/<id>'`, deduped, in listed order.
- `description`: line omitted when the string is empty.
- `instructions`: backtick template literal, escaped via `backtickString()`.
- `modelSettings`: include only the keys present (`temperature` / `maxTokens`); omit the whole field
  if neither is set.
- `tools`: object map `{ echoTool, ... }`; omit the field entirely when there are no tools.

### `src/mastra/index.ts`

```ts
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';        // only if storage present
import { supportAgent } from './agents/support-agent';

export const mastra = new Mastra({
  agents: { supportAgent },
  storage: new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' }),  // only if storage
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
});
```

- Agent imports in `config.agents` (listed) order.
- `logger` always emitted (parser always supplies `{ level }`, default `info`).
- `storage` block + `@mastra/libsql` import only when `project.storage` is present.

### `package.json`

- `name` = `config.name`; `type: module`; `engines.node >= 22.13.0`; scripts `dev`/`build`/`start`
  (`mastra dev` / `mastra build` / `mastra start`).
- Deps: always `@mastra/core`, `zod`, `@mastra/loggers` (logger is always present). `@mastra/libsql`
  only if storage.
- Dev deps: `mastra`, `typescript`, `@types/node`.
- All versions sourced from `versions.ts` (matching `sample-mastra`).

### `tsconfig.json`

Mirrors `sample-mastra`: `target ES2022`, `module ES2022`, `moduleResolution bundler`,
`esModuleInterop`, `forceConsistentCasingInFileNames`, `strict`, `skipLibCheck`, `noEmit`,
`outDir dist`, `include: ["src/**/*"]`.

### `.gitignore`

`node_modules`, `dist`, `.mastra`, `.env`, `*.db`, `*.db-*`.

### `src/mastra/tools/<id>.ts`

Copied verbatim from the input `tools/<id>.ts` (read using `rootDir` + the tool's `filePath`).

## Overwrite behavior (`writeProject`)

1. Resolve `outDir` to an absolute path.
2. **Refuse** (hard error) if `outDir` equals, contains, or is contained by `rootDir`.
3. If `outDir` exists and is non-empty:
   - If it contains the `.mastra-yaml-builder` marker → clean and regenerate.
   - Else → error: refuse to overwrite a directory not generated by us unless `force` is passed.
4. Write all files from the `FileMap`, creating directories as needed, then write the marker.

## Acceptance

CLI generates `examples/` → `./my-mastra-app`, then `pnpm install && pnpm build` (= `mastra build`)
in that directory must succeed (install needs network — run at the end). The generated output
directory is added to the repo `.gitignore`.
