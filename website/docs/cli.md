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
  agent/support-agent.yaml: references unknown model "gpt-5-mega"
  model/gpt-5-mini.yaml: missing required field "provider"
```

## Exit codes

| Outcome | Output | Exit |
|---|---|---|
| Success | `Generated N files → <outDir>` | `0` |
| Missing input arg | `Usage: yamlai <input-dir> [output-dir] [--force]` | `1` |
| Parse / write error | the error message | non-zero |
