---
title: CLI Reference
---

# CLI Reference

```bash
npx @addorimprove/yamlai <input-dir> [output-dir] [--force]
```

```bash
# generate into ./out
npx @addorimprove/yamlai ./my-project ./out

# output defaults to `name` from config.yaml
npx @addorimprove/yamlai ./my-project

# overwrite a non-empty output dir
npx @addorimprove/yamlai ./my-project ./out --force
```

## `init`

Scaffold a complete YAML Agent Builder project to start from.

```bash
yamlai init [dir] [--force]
```

- `dir` — target directory. Defaults to `./mastra-app`.
- `--force` — overwrite a non-empty target directory.

It writes a full working project — agents, models, prompts, tools, and four workflows (sequential, parallel, and two loop forms) — plus a `README.md` and a `.env.example`. The project's `config.yaml` `name` is set to the target directory's basename.

The generated app is written to a separate directory — it cannot overlap the input.

Next steps:

```bash
yamlai validate mastra-app                   # parse-only check
yamlai generate mastra-app mastra-app-build  # emit the Mastra app to ./mastra-app-build
```

## `validate`

Check that a project is well-formed without generating any code. Useful in CI.

```bash
# human-readable summary; non-zero exit on problems
npx @addorimprove/yamlai validate ./my-project

# machine-readable result for CI tooling
npx @addorimprove/yamlai validate ./my-project --json
```

`validate` runs the same parser as `generate` (strict — unknown/typo'd keys are
errors), but emits no files. Beyond schema checks it verifies the structural
contracts codegen relies on — referenced `tool:`/`step:`/`condition` files exist
**and export the camelCased id**, and every id forms a [valid identifier](./reference/config.md#id-naming).
These would otherwise emit code that fails to parse. `validate` does **not**
type-check, though: adjacent-step input/output mismatches are caught later by the
generated project's strict `tsc`, by design.

| Outcome | Text output | `--json` output | Exit |
|---|---|---|---|
| Valid | `✓ valid: N agents, M workflows` (stdout) | `{"ok":true,"issues":[]}` | `0` |
| Validation errors | aggregated `file: message` lines (stderr) | `{"ok":false,"issues":[{"file":"...","message":"..."}]}` | `1` |
| Unexpected error | error message (stderr) | `{"ok":false,"error":"..."}` | `2` |

## Arguments

| Argument | Required | Description |
|---|---|---|
| `<input-dir>` | Yes | Project root containing `config.yaml`. |
| `[output-dir]` | No | Output path. Defaults to `name` from `config.yaml`. |
| `--force` | No | Replace a non-empty output dir (else the write is refused). |

- Paths resolve relative to the current working directory.
- The writer refuses to write into the input dir (or an overlapping path).
- `--force` deletes and rewrites the entire output dir.

## Errors

All problems are collected and reported together (not one at a time):

```text
Found 2 problem(s):
  agent/writer-agent.yaml: references unknown model "gpt-5-mega"
  model/gpt-5-mini.yaml: missing required field "provider"
```

Unknown or misspelled keys (in `config.yaml`, agent/model/workflow files) are now
rejected rather than silently ignored — the same check `validate` runs.

## Exit codes

| Outcome | Output | Exit |
|---|---|---|
| Success | `Generated N files → <outDir>` | `0` |
| Missing input arg | `Usage: yamlai <input-dir> [output-dir] [--force]` | `1` |
| Parse / write error | the error message | non-zero |
