# `yamlai init` — Scaffold Command Design

**Date:** 2026-06-18
**Status:** Approved, ready for implementation plan

## Goal

Add a third subcommand to the `yamlai` CLI that scaffolds a complete, valid YAML
Agent Builder project into a target directory, so a new user has something real
to `yamlai generate` from on first use.

```
yamlai init [dir] [--force]
```

## Behavior

- **Default target:** `./mastra-app` when no `dir` is given. Resolves relative to
  the current working directory.
- **Output:** the full `examples/` project (2 agents, 4 workflows — sequential,
  parallel, and two loop forms — plus tools, workflow steps, conditions, prompts,
  a model, and memory config), plus two scaffolding meta-files: `README.md` and
  `.env.example`.
- **Overwrite safety:** refuses to write into a non-empty directory unless
  `--force` is passed. Same semantics as `generate`, because it reuses the same
  writer.
- **Success message:** `Initialized mastra-app/ (N files). Next: yamlai generate mastra-app`
  (folder name reflects the actual target).

Out of scope (YAGNI): interactive prompts, provider selection, flags beyond
`--force`, dependency installation.

## Template Source — single source of truth

`examples/` **is** the scaffold template. There is no second template tree to
keep in sync.

- **Bundling into the package:** `tsc` only emits `.ts`, so the build copies
  `examples/` → `dist/templates/` using a small Node `fs.cpSync` helper. Because
  `package.json` has `files: ["dist"]`, the copied templates ship in the npm
  tarball. Both `build` and `prepublishOnly` perform the copy.
- **Runtime resolution:** `init` resolves the template directory from
  `import.meta.url`:
  1. `<dir-of-init.js>/../templates` — the published location (`dist/templates`).
  2. `<dir-of-init.ts>/../../examples` — the repo location, for dev runs via
     `tsx`.
  First path that exists wins. If neither exists, throw a clear error.

## Components & Flow

New file `builder/scripts/init.ts` exporting `runInit(argv: string[]): void`.

1. Parse args: `--force` flag; first non-flag arg is the target dir (default
   `mastra-app`).
2. Resolve the template directory (see resolution rules above) and the absolute
   target directory.
3. Recursively read every file under the template into a `FileMap`
   (`relPath → utf8 string`). All template files are text (`.yaml`, `.md`,
   `.ts`); no binary handling required.
4. **Name rewrite:** replace the `name:` value in `config.yaml` with the target
   directory's basename (single-line, anchored regex on the top-level `name:`
   key). This makes a later bare `yamlai generate <dir>` emit to a predictably
   named folder.
5. Add two embedded meta-files to the map (kept out of `examples/` so the parse
   input stays clean):
   - `README.md` — short getting-started: what the dir is, `yamlai generate`,
     setting env vars, directory layout.
   - `.env.example` — `OPENAI_API_KEY=` (the template uses `openai/*` models and
     the `openai/text-embedding-3-small` embedder).
6. Call `writeProject(fileMap, targetDir, templateDir, { force })`. This reuses
   the existing guards: refuses non-empty target without `--force`, refuses
   output overlapping the template dir, and refuses paths escaping the output
   directory.
7. Log the success message.

### CLI wiring

`builder/scripts/cli.ts` gains an `init` branch in the subcommand dispatcher,
mirroring the existing `validate` branch, calling `runInit(rest)`.

### Build wiring

`builder/package.json`:
- Add a `copy-templates` step (Node helper using `fs.cpSync(examplesDir,
  'dist/templates', { recursive: true })`).
- `build`: `tsc && <copy-templates>`.
- `prepublishOnly`: same as build (so published packages always contain
  `dist/templates`).

## Error Handling

- Template directory unresolvable → throw with both attempted paths listed.
- Non-empty target without `--force` → propagated from `writeProject` (existing
  message: "Refusing to overwrite non-empty directory … Pass force to override.").
- These surface as a non-zero exit via the CLI, consistent with `generate`.

## Testing

`builder/test/init.test.ts`, run under `node --test` (matching the existing
suite):

1. **Round-trip (primary):** `runInit` into a temp dir, then `parseProject()` the
   result — must succeed with the expected agent/workflow counts. This
   permanently ties the scaffold's validity to the parser; if the template drifts
   into an invalid state, this test fails.
2. Default target directory is `mastra-app` when no dir arg is given.
3. `config.yaml`'s `name:` equals the target dir basename after init.
4. `README.md` and `.env.example` exist in the output.
5. Non-empty target is rejected without `--force` and replaced with `--force`.

## Files Touched

- `builder/scripts/init.ts` — new, `runInit`.
- `builder/scripts/cli.ts` — add `init` dispatch branch.
- `builder/package.json` — build/prepublish copy-templates step.
- `builder/scripts/copy-templates.mjs` — new build helper (plain Node, no tsx).
- `builder/test/init.test.ts` — new tests.
- Docs: a short reference page for `init` under `website/docs/` (follows the
  existing per-command doc pattern; links rather than duplicates).
