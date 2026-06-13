# Plan: `prompt/` folder feature

Date: 2026-06-13

## Concept

A fourth entity folder `prompt/` joins `agent/`, `model/`, `tools/`. Markdown
files hold agent system prompts. The agent's existing `instructions:` field
stops being literal text and becomes a **prompt id** (= filename), resolved the
same way `model:` is resolved. The `.md` content is **inlined** into the
generated agent (like models are inlined), so nothing new is copied to the
output project.

No new agent key is introduced — `instructions:` is reused, its meaning shifts
from inline text to a reference.

## Mapping

```
prompt/<id>.md   ->  read as raw text, becomes ResolvedAgent.instructions
agent/*.yaml     ->  instructions: <id>   (id = prompt/<id>.md, no literal text)
```

Mirrors the existing `model: gpt-5-mini` -> `model/gpt-5-mini.yaml` pattern.
Missing prompt file = hard error.

## Changes (all in `builder/`)

### 1. `src/schemas.ts` — comment only, no shape change
`instructions: z.string().min(1)` stays (a non-empty string), but its meaning is
now a prompt id, identical to how `model: z.string().min(1)` is a model id. Add a
one-line comment clarifying it references `prompt/<id>.md`.

### 2. `src/parser.ts` — resolve the reference
- Add a `readText(relPath)` helper next to `readYaml`: reads the raw file;
  records an issue and returns `undefined` if the file is missing
  (`prompt not found`) or blank (`file is empty`).
- In the agent loop, before pushing the agent: resolve
  `prompt/${agent.instructions}.md` via `readText`, set the resolved
  instructions to `content.trimEnd()`.
- If the prompt file is missing/blank -> issue recorded, `continue` (skip that
  agent — same fail-collection behavior as a bad model).
- The pushed agent uses the **resolved text**, not the id.

### 3. `src/types.ts` — unchanged
`ResolvedAgent.instructions: string` already holds resolved content.
(Decision: do NOT add a `promptId` field — keep minimal.)

### 4. Codegen — unchanged
`emit-agent.ts` already emits `agent.instructions` as a backtick-escaped string
literal via `backtickString` (handles backticks and `${`). Prompts are inlined,
so the writer copies nothing extra — same as models.

## Example migration (`examples/`)

- **New** `examples/prompt/support-prompt.md` — holds the current prompt text:

  > You are a helpful support assistant. Be concise and accurate.
  > Use the echo-tool when you need to repeat the user's input back to them.

- **Edit** `examples/agent/support-agent.yaml` — replace the inline
  `instructions: |` block with `instructions: support-prompt`.

## Error cases (fail-fast, aggregated like existing issues)

| Case | Message |
|---|---|
| `prompt/<id>.md` missing | `prompt/<id>.md: file not found` |
| `prompt/<id>.md` blank | `prompt/<id>.md: file is empty` |

## Docs

- `README.md` — document the `prompt/` folder + that `instructions:` is now a
  prompt id.
- Memory spec `yaml-agent-builder-spec.md` — add `prompt/` to the file-layout
  list and note instructions resolution.

## Verification

- `pnpm parse:example` — resolves the migrated example; instructions text comes
  from the `.md`.
- `pnpm gen:example` — generated agent `.ts` contains the prompt text inline.
- Negative check: point an agent at a non-existent prompt id -> expect the
  "prompt not found" issue.

## Out of scope

Variables / templating in prompts — deferred.
