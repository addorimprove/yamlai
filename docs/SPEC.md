# YAML Agent Builder — Spec (v1)

A **codegen** tool that reads YAML configs and generates a [Mastra](https://mastra.ai) v1
TypeScript project (`new Agent(...)`, `new Mastra(...)`). It is **not** a runtime loader — it
emits a normal Mastra project you can run with `mastra dev` / `mastra build`.

Designed to extend later to other Mastra features (workflows, memory, RAG, evals). **v1 scope:
agents + models + tools only.**

Reference project for the exact Mastra shapes lives in `sample-mastra/` (scaffolded via
`npm create mastra@latest`, pinned to `@mastra/core@1.42`).

---

## Input layout

```
config.yaml
agent/
  ├── agent1.yaml
  └── agent2.yaml
model/
  ├── model1.yaml
  └── model2.yaml
tools/
  ├── tool1.ts
  └── tool2.ts
```

**`id` = filename** for every entity (agent / model / tool). Agents reference models and tools
by these ids. Naming convention: a kebab-case id `support-agent` becomes the camelCase exported
variable `supportAgent` in generated code (same rule for tools).

---

## `config.yaml`

```yaml
name: my-mastra-app          # required — package.json name + output dir
agents:                      # required — EXPLICIT list of agent ids (= agent/<id>.yaml)
  - support-agent
  - research-agent
logger:                      # optional (default: level=info)
  level: info                # debug | info | warn | error
storage:                     # optional — omit entirely → no storage block in index.ts
  type: libsql               # v1 supports libsql only
  url: file:./mastra.db      # or ":memory:" for ephemeral
```

Rules:
- Only **agents** are registered in `new Mastra({...})`. Tools are imported into agent files;
  models are inlined into agents. So `config.yaml` only lists agents.
- Agent listed in `agents:` but missing its `agent/<id>.yaml` → **hard error** (fail fast).
- `storage` is registered at the Mastra level only. v1 agents have no `memory`, so they don't use
  it yet — it's wired and ready for when memory lands.

### → generates `src/mastra/index.ts`
```ts
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { supportAgent } from './agents/support-agent';
import { researchAgent } from './agents/research-agent';

export const mastra = new Mastra({
  agents: { supportAgent, researchAgent },
  storage: new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' }),
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
});
```

---

## `agent/<id>.yaml`

```yaml
# id is the filename (e.g. support-agent.yaml → id: support-agent)
name: Support Agent
description: Handles customer support questions.
instructions: |
  You are a helpful support assistant. Be concise and accurate.
model: gpt-5-mini            # references model/<id>.yaml (id = filename)
tools:                       # references tools/<id>.ts (id = filename); object map in output
  - echo-tool
```

Keys: `id` (filename), `name`, `description`, `instructions`, `model` (single model id),
`tools` (list of tool ids).

### → generates `src/mastra/agents/<id>.ts`
```ts
import { Agent } from '@mastra/core/agent';
import { echoTool } from '../tools/echo-tool';

export const supportAgent = new Agent({
  id: 'support-agent',
  name: 'Support Agent',
  description: 'Handles customer support questions.',
  instructions: `You are a helpful support assistant. Be concise and accurate.`,
  model: 'openai/gpt-5-mini',                 // from the referenced model file
  modelSettings: { temperature: 0.7, maxTokens: 2048 },
  tools: { echoTool },
});
```

---

## `model/<id>.yaml`

```yaml
# id is the filename (e.g. gpt-5-mini.yaml → id: gpt-5-mini)
provider: openai             # split provider + model → router string "provider/model"
model: gpt-5-mini
temperature: 0.7
max_tokens: 2048
```

Mapping:
- `provider` + `model` → Mastra Model Router string `"${provider}/${model}"` (e.g.
  `openai/gpt-5-mini`). Gateway forms work too: `provider: openrouter`, `model:
  anthropic/claude-3.5-haiku` → `openrouter/anthropic/claude-3.5-haiku`.
- `temperature` / `max_tokens` → agent `modelSettings: { temperature, maxTokens }` (they are
  NOT part of the model string).
- API keys are resolved by Mastra from env vars (e.g. `OPENAI_API_KEY`).

Models are **inlined into the agents** that reference them — there is no separate generated model
file.

---

## `tools/<id>.ts`

Plain TypeScript files using Mastra's `createTool`. Zod schemas stay inline in TS (not serialized
to YAML). The codegen copies/imports these as-is.

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const echoTool = createTool({
  id: 'echo-tool',
  description: 'Echoes the input text back.',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string() }),
  execute: async (inputData) => ({ text: inputData.text }),
});
```

The req's richer "tool keys" (id, name, input_schema, output_schema, description, code) with an
embedded `code` field is **deferred** — for v1, tools are just `.ts` files.

---

## Generated project

```
<name>/
├── package.json            # deps below
├── tsconfig.json
└── src/mastra/
    ├── index.ts            # from config.yaml
    ├── agents/<id>.ts      # one per agent (model inlined)
    └── tools/<id>.ts       # copied from tools/
```

`package.json` dependencies emitted by codegen:
- always: `@mastra/core`, `zod`
- if `logger` present (or default): `@mastra/loggers`
- if `storage` present: `@mastra/libsql`
- dev: `mastra`, `typescript`, `@types/node`

---

## Confirmed decisions (req.md Q&A, 2026-06-13)

| Topic | Decision |
|---|---|
| Tool format | Plain `.ts` files (`createTool`). YAML-with-`code` deferred. |
| Zod | Stays as TS in tool files; not serialized to YAML. |
| id / filename | `id` = filename for every entity. |
| References | Agent `model` + `tools[]` reference ids (= filenames). |
| Model field | Split `provider` + `model` → `provider/model` router string. |
| temp / max_tokens | → agent `modelSettings: { temperature, maxTokens }`. |
| Output | Codegen (emit TS project), not a runtime loader. |
| config.yaml registration | Explicit `agents:` list (not auto-discover). |
| config.yaml globals | `logger` + `storage` supported in v1. |
| Scalability | Schema/loader designed to add workflows/memory/RAG later. |
